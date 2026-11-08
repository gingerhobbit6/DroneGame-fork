// Map packs in the browser: reading the file format, listing what is available, and remembering imported packs in this browser,
// so a pack keeps working when the save server is stopped. Pack files are untrusted, so everything is checked before use.

import { parsePack } from '../sim/world-pack.js';

const MAGIC = 'SGMAP', VERSION = 1, HEAD = 10;
const MAX_HEADER = 1 << 20, MAX_RAW = 64 * 1024 * 1024; // the largest grid an 80 km pack could need: 4001 x 4001 heights of 4 bytes
const MAX_FEATURES = 32 * 1024 * 1024; // MAX_FEATURES in tools/mapbuild/mapbuild/packfile.py: the densest real pack, 70 km round Hereford, has 15.6 MB
const MAX_PIXELS = 8192 * 8192; // an 80 km satellite picture at 10 m is 8000 pixels square
const DB = 'site-guard-packs', STORE = 'packs';

const reasonable = (rawLength, max) => { if (!Number.isInteger(rawLength) || rawLength <= 0 || rawLength > max) throw new Error('This pack declares an unreasonable size.'); };

// Unpacks into `out` when given, so the grids can share one buffer.
async function gunzip(bytes, rawLength, max = MAX_RAW, out = null) {
  reasonable(rawLength, max);
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  out ??= new Uint8Array(rawLength);
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

// A picture's width x height from its own header, so one declaring a vast size never reaches the image decoder.
export function pixelsOf(b) {
  const at = (i) => (b[i] << 8) | b[i + 1];
  if (b.length >= 24 && at(0) === 0x8950 && at(2) === 0x4e47) return (at(16) * 65536 + at(18)) * (at(20) * 65536 + at(22)); // PNG: IHDR is first
  if (at(0) !== 0xffd8) return Infinity;
  for (let i = 2; i + 9 < b.length; i += 2 + at(i + 2)) { // JPEG: walk the segments to the frame header
    const marker = b[i + 1];
    if (b[i] !== 0xff) return Infinity;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return at(i + 5) * at(i + 7);
  }
  return Infinity;
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
  const cells = section('canopy').rawLength; // every grid has one value a post, and a height is 4 bytes, so sizes are checked before anything is unpacked
  if (!Number.isInteger(header.N) || cells !== header.N * header.N || section('ground').rawLength !== 4 * cells || section('bldg').rawLength !== cells || section('cover').rawLength !== cells) throw new Error('This map pack is damaged.');
  // The four grids unpack one after another into one buffer, in the order they are fingerprinted, so hashing them copies nothing.
  reasonable(4 * cells, MAX_RAW);
  const all = new Uint8Array(7 * cells), raw = {};
  for (let at = 0, k = 0; k < 4; k++) {
    const name = ['ground', 'canopy', 'bldg', 'cover'][k], s = section(name);
    raw[name] = await gunzip(slice(s), s.rawLength, MAX_RAW, all.subarray(at, at + s.rawLength));
    at += s.rawLength;
  }

  const hash = await crypto.subtle.digest('SHA-256', all);
  if (hex(hash) !== header.gridsSha256) throw new Error('This map pack is damaged: its grids do not match their fingerprint.');
  const grids = { ground: new Float32Array(all.buffer, 0, cells), canopy: raw.canopy, bldg: raw.bldg, cover: raw.cover };
  const feature = section('features');
  const features = JSON.parse(new TextDecoder().decode(await gunzip(slice(feature), feature.rawLength, MAX_FEATURES)));
  const pack = parsePack(header, grids, features);
  const pictures = header.sections.filter((s) => s.length <= MAX_RAW && /^picture\d+$/.test(s.name) && ['osmap', 'satellite'].includes(s.layer) && ['image/png', 'image/jpeg'].includes(s.type) && pixelsOf(slice(s)) <= MAX_PIXELS).map((s) => ({
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

  // A pack clicked while it is still loading in the background is decoded once: each decode can hold 64 MB or more.
  const loading = new Map(); // hash -> the load under way
  function load(entry) {
    if (loaded.has(entry.hash)) return Promise.resolve(loaded.get(entry.hash));
    if (!loading.has(entry.hash)) {
      loading.set(entry.hash, (async () => {
        const decoded = await decodePack(await (await fileOf(entry)).arrayBuffer());
        if (decoded.pack.hash !== entry.hash) throw new Error('That map pack has changed since it was listed.');
        loaded.set(decoded.pack.hash, decoded);
        return decoded;
      })().finally(() => loading.delete(entry.hash)));
    }
    return loading.get(entry.hash);
  }

  // A pack file the player chose. It is checked in full before it is kept.
  async function importFile(file) {
    const decoded = await decodePack(await file.arrayBuffer()), { hash } = decoded.pack;
    const stored = !loaded.has(hash) && idb ? await inStore(idb, 'readonly', (s) => s.getKey(hash)).catch(() => undefined) : undefined;
    const kept = loaded.get(hash) ?? (stored ? await load({ hash, source: 'browser' }) : null);
    // the same ground with other features or pictures would change worlds already saved against this pack
    if (kept && JSON.stringify(kept.pack.header) !== JSON.stringify(decoded.pack.header)) throw new Error('A different map pack with the same ground is already here.');
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
