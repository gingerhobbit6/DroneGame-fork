// Map packs in the browser: reading the file format, listing what is available, and remembering imported packs in this browser,
// so a pack keeps working when the save server is stopped. Pack files are untrusted, so everything is checked before use.

import { parsePack } from '../sim/world-pack.js';

const MAGIC = 'SGMAP', VERSION = 1, HEAD = 10;
const MAX_HEADER = 1 << 20, MAX_RAW = 64 * 1024 * 1024; // the largest grid an 80 km pack could need: 4001 x 4001 heights of 4 bytes
const DB = 'site-guard-packs', STORE = 'packs';

async function gunzip(bytes, rawLength) {
  if (!Number.isInteger(rawLength) || rawLength <= 0 || rawLength > MAX_RAW) throw new Error('This pack declares an unreasonable size.');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const out = new Uint8Array(rawLength);
  for (let at = 0; ;) {
    const { done, value } = await reader.read();
    if (done) {
      if (at !== rawLength) throw new Error('This pack is shorter than it says.');
      return out;
    }
    if (at + value.length > rawLength) { await reader.cancel(); throw new Error('This pack is longer than it says.'); } // never trust the declared size
    out.set(value, at);
    at += value.length;
  }
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

// Reads a whole .sgmap file. Returns { pack for the rules, pictures for the view }.
export async function decodePack(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < HEAD || String.fromCharCode(...bytes.subarray(0, 5)) !== MAGIC) throw new Error('This is not a Site Guard map pack.');
  if (bytes[5] !== VERSION) throw new Error('This map pack was made by a different version of the game.');
  const length = new DataView(buffer).getUint32(6, true);
  if (length > MAX_HEADER || HEAD + length > bytes.length) throw new Error('This map pack is damaged.');
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(HEAD, HEAD + length)));
  if (!Array.isArray(header?.sections)) throw new Error('This map pack is damaged.');
  const start = HEAD + length;
  const slice = (s) => {
    if (!Number.isInteger(s.offset) || !Number.isInteger(s.length) || s.offset < 0 || s.length < 0 || start + s.offset + s.length > bytes.length) throw new Error('This map pack is damaged.');
    return bytes.subarray(start + s.offset, start + s.offset + s.length);
  };
  const section = (name) => { const s = header.sections.find((x) => x.name === name); if (!s) throw new Error('This map pack is missing a section.'); return s; };
  const raw = {};
  for (const name of ['ground', 'canopy', 'bldg', 'cover']) raw[name] = await gunzip(slice(section(name)), section(name).rawLength);

  const hash = await crypto.subtle.digest('SHA-256', await new Blob([raw.ground, raw.canopy, raw.bldg, raw.cover]).arrayBuffer());
  if (hex(hash) !== header.gridsSha256) throw new Error('This map pack is damaged: its grids do not match their fingerprint.');
  if (raw.ground.length % 4) throw new Error('This map pack is damaged.');
  const grids = { ground: new Float32Array(raw.ground.buffer, 0, raw.ground.length / 4), canopy: raw.canopy, bldg: raw.bldg, cover: raw.cover };
  const feature = section('features');
  const features = JSON.parse(new TextDecoder().decode(await gunzip(slice(feature), feature.rawLength)));
  const pack = parsePack(header, grids, features);
  const pictures = header.sections.filter((s) => s.length <= MAX_RAW && /^picture\d+$/.test(s.name) && ['osmap', 'satellite'].includes(s.layer) && ['image/png', 'image/jpeg'].includes(s.type)).map((s) => ({
    layer: s.layer, west: s.west, top: s.top, width: s.width, height: s.height, blob: new Blob([slice(s)], { type: s.type }),
  }));
  return { pack, pictures };
}

function openDb(idb) {
  return new Promise((resolve, reject) => {
    const open = idb.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'hash' });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
function inStore(idb, mode, fn) {
  return openDb(idb).then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode), request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

const summary = (pack, source, file) => ({ hash: pack.hash, name: String(pack.header.name || 'Map pack').slice(0, 80), east: pack.header.east, north: pack.header.north, half: pack.header.half, tier: pack.header.tier, lidarHalf: pack.header.lidarHalf || 0, source, file });

export function createPackStore({ api, idb = globalThis.indexedDB, fetchFile = (file) => fetch(`/api/v1/packs/${encodeURIComponent(file)}`) } = {}) {
  const loaded = new Map(); // hash -> { pack, pictures }

  // Everything available: on the local server, and imported into this browser. A stopped server only hides its own packs.
  async function list() {
    const found = new Map();
    if (idb) {
      try {
        for (const row of await inStore(idb, 'readonly', (s) => s.getAll())) found.set(row.hash, { ...row.summary, source: 'browser' });
      } catch { /* blocked browser storage just means no imported packs */ }
    }
    let serverDown = false;
    try {
      for (const row of await api.packs.list()) { const hash = String(row.hash).slice(0, 32); if (hash && !found.has(hash)) found.set(hash, { ...row, hash, source: 'server' }); }
    } catch { serverDown = true; }
    return { packs: [...found.values()], serverDown };
  }

  // Which OS downloads this computer already has, or null if the save server cannot say.
  async function downloads() {
    try { return await api.packs.downloads(); } catch { return null; }
  }

  // The whole pack file, wherever it is kept.
  async function fileOf(entry) {
    if (entry.source === 'browser') {
      const row = await inStore(idb, 'readonly', (s) => s.get(entry.hash));
      if (!row) throw new Error('That map pack is no longer in this browser.');
      return row.blob;
    }
    const reply = await fetchFile(entry.file);
    if (!reply.ok) throw new Error('The map pack could not be fetched from the server.');
    return reply.blob();
  }

  async function load(entry) {
    if (loaded.has(entry.hash)) return loaded.get(entry.hash);
    const decoded = await decodePack(await (await fileOf(entry)).arrayBuffer());
    if (decoded.pack.hash !== entry.hash) throw new Error('That map pack has changed since it was listed.');
    loaded.set(decoded.pack.hash, decoded);
    return decoded;
  }

  // A pack file the player chose. It is checked in full before it is kept.
  async function importFile(file) {
    const decoded = await decodePack(await file.arrayBuffer());
    loaded.set(decoded.pack.hash, decoded);
    const entry = summary(decoded.pack, 'browser');
    if (idb) {
      try {
        await navigator.storage?.persist?.();
        await inStore(idb, 'readwrite', (s) => s.put({ hash: decoded.pack.hash, summary: entry, blob: file }));
      } catch { throw new Error('This browser has no room to keep that map pack.'); }
    }
    return entry;
  }

  return { list, downloads, load, fileOf, importFile, get: (hash) => loaded.get(hash) || null };
}
