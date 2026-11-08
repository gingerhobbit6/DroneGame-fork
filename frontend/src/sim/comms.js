// The communications model: how SAPIENT messages get between the nodes and the fusion node.
//
// Every sensor and effector has a terminal (Starlink or cellular) wired to the network; the fusion node has its own
// terminals. A message goes node terminal -> network -> fusion terminal (or back), and each end has to be up:
//  - Starlink needs a clear view of the sky (terrain and trees block it)
//  - cellular needs a tower in range with a clear path; lower bands reach further but can clash with jammers
//  - a jammer that is switched on and covers the link's band degrades links nearby
//  - each terminal is a queue: a message waits for the link, and is dropped if the wait is too long or the packet is lost
// The result for each message is a delay (or a drop with a reason). Every packet is recorded for the network diagram.
// No game rendering here, so it can run headless.

import { WORLD, TERRAIN, COMMS, SPECTRUM, overlaps } from './config/index.js';
import { noiseBands } from './jamming.js';
import { terrainState } from './terrain.js';
import { rand } from './rng.js';
import { inArcOf } from './sensor-model.js';
import { clamp } from './world.js';

const LOCAL = { ok: true, local: true, delay: 0, dropped: false };

// deps: { getTime, nodes: Map, fusion, gui, getJammers: () => structure[] }
export function createComms(deps) {
  const { nodes, fusion, gui } = deps;
  const queues = new Map();   // key -> { busyUntil }
  const stats = new Map();    // node id -> { bits (decaying), sent, dropped, lastDelay }
  const packets = [];         // recent packets, newest last
  const listeners = new Set();
  let packetSeq = 0;
  const skyCache = new Map(); // node id -> { blocked, x, z, y }
  const towerCache = new Map(); // node id and band reach -> { best, x, z, y, T3 }: a terrain raycast per tower is too dear for every message

  const mpu = () => WORLD.metresPerUnit;
  const T = () => deps.getTime();
  const towers = () => (terrainState.data ? terrainState.data.towers : []);

  // where a node is, in metres (scene axes), and the height of its antenna
  const where = (s) => ({ x: s.pos.x * mpu(), z: s.pos.z * mpu(), y: (s.pos.y || 0) * mpu() + (s.def.mount || 3) });

  // ---------- link quality ----------
  // Fraction of the sky above the dish's minimum elevation that terrain or trees block, at 12 compass points.
  function skyBlocked(s) {
    const w = where(s);
    const cached = skyCache.get(s.nodeId);
    if (cached && cached.x === w.x && cached.z === w.z && cached.y === w.y) return cached.blocked;
    const T3 = terrainState.data;
    const el = (COMMS.starlink.minElevation * Math.PI) / 180, dist = 1500;
    let blocked = 0;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = T3.los(w.x, w.y, w.z, w.x + Math.cos(a) * dist, w.y + Math.tan(el) * dist, w.z + Math.sin(a) * dist, 0);
      if (!r.clear || r.canopy > TERRAIN.opticalCanopyTol) blocked++;
    }
    blocked /= 12;
    skyCache.set(s.nodeId, { blocked, x: w.x, z: w.z, y: w.y });
    return blocked;
  }

  // best cell tower for a node on a given band: the one with the best signal, or null
  function bestTower(s, bandId) {
    const band = COMMS.cellular.bands[bandId] || COMMS.cellular.bands.B8;
    const range = COMMS.cellular.towerRange * band.rangeFactor;
    const w = where(s), key = `${s.nodeId}|${range}`, cached = towerCache.get(key);
    if (cached && cached.x === w.x && cached.z === w.z && cached.y === w.y && cached.T3 === terrainState.data) return cached.best;
    const T3 = terrainState.data;
    let best = null;
    towers().forEach((t, i) => {
      const d = Math.hypot(t.x - w.x, t.z - w.z);
      if (d > range) return;
      const r = T3.los(w.x, w.y, w.z, t.x, t.ground + COMMS.towerHeight, t.z, TERRAIN.endClear);
      if (!r.clear) return;
      const q = (1 - d / range) * Math.exp(-r.canopy / (TERRAIN.rfCanopyLength * 3));
      if (!best || q > best.q) best = { tower: i, q, d };
    });
    towerCache.set(key, { best, x: w.x, z: w.z, y: w.y, T3 });
    return best;
  }

  // jamming that overlaps a link's frequency band: each jammer that is on and nearby cuts the quality
  function jamQuality(s, bandF) {
    const w = where(s);
    let q = 1;
    const hits = [];
    for (const j of deps.getJammers()) {
      if (j.mode !== 'Jam' || !j.jamBands) continue;
      const jf = [...noiseBands(j)].flatMap((b) => (SPECTRUM.bands[b] ? SPECTRUM.bands[b].f : []));
      if (!overlaps(jf, bandF)) continue;
      const jw = where(j), d = Math.hypot(jw.x - w.x, jw.z - w.z), range = j.def.range;
      if (d < range && inArcOf(j.def, j.pos, s.pos)) { q *= clamp(d / range, 0, 1) * 0.5; hits.push(j.short); }
    }
    return { q, hits };
  }

  // A node's link to the network: { up, quality, latency, capacity, loss, band, via, reason }
  function linkFor(s, kind, bandId) {
    if (!kind) return { up: false, quality: 0, reason: 'no terminal wired' };
    if (kind === 'starlink') {
      const blocked = skyBlocked(s);
      const base = clamp(1 - blocked / COMMS.starlink.skyBlockLimit, 0, 1);
      const jam = jamQuality(s, COMMS.starlink.band);
      const quality = base * jam.q;
      const up = quality > 0.12;
      return {
        up, quality, latency: COMMS.starlink.latency, capacity: COMMS.starlink.capacity * quality, loss: COMMS.starlink.loss + (1 - quality) * 0.08,
        band: COMMS.starlink.band, via: `sky ${Math.round((1 - blocked) * 100)}% clear`, jammedBy: jam.hits,
        reason: up ? '' : jam.hits.length ? `jammed by ${jam.hits.join(', ')}` : `sky ${Math.round(blocked * 100)}% blocked`,
      };
    }
    const band = COMMS.cellular.bands[bandId] || COMMS.cellular.bands.B8;
    const tw = bestTower(s, bandId);
    if (!tw) return { up: false, quality: 0, band: band.f, reason: 'no tower in range with a clear path' };
    const jam = jamQuality(s, band.f);
    const quality = tw.q * jam.q;
    const up = quality > 0.1;
    return {
      up, quality, latency: COMMS.cellular.latency + tw.d / 3e8 * 2, capacity: COMMS.cellular.capacity * quality * quality, loss: COMMS.cellular.loss + (1 - quality) * 0.1,
      band: band.f, via: `tower ${tw.tower + 1}, ${(tw.d / 1000).toFixed(1)} km`, jammedBy: jam.hits,
      reason: up ? '' : jam.hits.length ? `jammed by ${jam.hits.join(', ')}` : 'signal too weak',
    };
  }

  const nodeLink = (s) => linkFor(s, s.uplink, s.cellBand);
  // the fusion node may have both terminals; pick what suits this node (same network avoids the internet hop)
  function fusionLink(prefer) {
    const options = [];
    for (const kind of fusion.uplinks) options.push({ kind, link: linkFor(fusion, kind, fusion.cellBand) });
    const up = options.filter((o) => o.link.up);
    if (!up.length) return { up: false, reason: options.length ? `fusion node terminals down (${options.map((o) => o.link.reason).join('; ')})` : 'fusion node has no terminal wired' };
    const same = up.find((o) => o.kind === prefer);
    const pick = same || up.sort((a, b) => b.link.quality - a.link.quality)[0];
    return { ...pick.link, up: true, kind: pick.kind, sameNetwork: !!same };
  }

  // The whole path between a node and the fusion node.
  function pathFor(s) {
    const a = nodeLink(s);
    if (!a.up) return { ok: false, reason: a.reason, a };
    const b = fusionLink(s.uplink);
    if (!b.up) return { ok: false, reason: b.reason, a };
    return {
      ok: true, a, b,
      latency: a.latency + b.latency + (b.sameNetwork ? 0 : COMMS.internetLatency),
      loss: 1 - (1 - a.loss) * (1 - b.loss),
      hops: [s.uplink, ...(b.sameNetwork ? [] : ['internet']), b.kind],
    };
  }

  // ---------- queues ----------
  // A link serves messages one after another at its capacity. Returns the wait + send time, or null if the wait is too long.
  function hop(key, bytes, capacity, t) {
    const q = queues.get(key) || { busyUntil: 0 };
    const start = Math.max(t, q.busyUntil);
    if (start - t > COMMS.queueLimit) return null;
    const tx = (bytes * 8) / Math.max(capacity, 1);
    q.busyUntil = start + tx;
    queues.set(key, q);
    return start - t + tx;
  }

  const nodeStats = (id) => {
    let st = stats.get(id);
    if (!st) { st = { bits: 0, t: 0, sent: 0, dropped: 0, lastDelay: 0, lastReason: '' }; stats.set(id, st); }
    return st;
  };

  // ---------- transmit ----------
  // Route one message. `type` is the SAPIENT message type; the node is whichever end is not the fusion node or GUI.
  function transmit(msg, from, to, type) {
    const t = T();
    const nodeId = from === fusion.nodeId || from === gui.nodeId ? to : from;
    const node = nodes.get(nodeId);
    if (!node || nodeId === gui.nodeId || nodeId === fusion.nodeId || node.def.id === 'perimeter' || node.def.local) return LOCAL; // on-site, wired
    const bytes = (COMMS.bytes[type] || 150) + COMMS.overhead;
    const st = nodeStats(nodeId);
    const p = pathFor(node);
    let res;
    if (!p.ok) res = { ok: false, dropped: true, reason: p.reason, delay: 0 };
    else {
      const w1 = hop('n:' + nodeId, bytes, p.a.capacity, t);
      const w2 = w1 === null ? null : hop(`f:${p.b.kind}:${from === fusion.nodeId ? 'tx' : 'rx'}`, bytes, p.b.capacity, t); // dropped at the node: it never reaches the fusion queue
      if (w1 === null || w2 === null) res = { ok: false, dropped: true, reason: 'link congested', delay: 0 };
      else if (rand() < p.loss) res = { ok: false, dropped: true, reason: 'packet lost', delay: 0 };
      else res = { ok: true, dropped: false, delay: p.latency + w1 + w2, reason: '' };
      st.bits = st.bits * Math.exp(-(t - st.t) / 2) + (bytes * 8) / 2; st.t = t; // decaying average rate over ~2 s
      st.capacity = p.a.capacity; st.latency = p.latency; st.loss = p.loss; st.via = p.a.via; st.hops = p.hops;
    }
    st.sent++; if (res.dropped) { st.dropped++; st.lastReason = res.reason; } else st.lastDelay = res.delay;
    const pkt = {
      n: ++packetSeq, t, type, from, to, nodeId, bytes, msg, delay: res.delay, dropped: !!res.dropped, reason: res.reason,
      hops: p.ok ? p.hops : [node.uplink || 'none'], toFusion: to === fusion.nodeId,
    };
    packets.push(pkt);
    if (packets.length > 3000) packets.splice(0, packets.length - 3000 + 300);
    for (const f of listeners) f(pkt);
    return { ...res, pkt };
  }

  function linkStats(id) {
    const st = nodeStats(id), t = T();
    const utilisation = st.capacity ? clamp((st.bits * Math.exp(-(t - st.t) / 2)) / st.capacity, 0, 1.5) : 0;
    return { ...st, utilisation };
  }

  function reset() { queues.clear(); stats.clear(); packets.length = 0; skyCache.clear(); towerCache.clear(); packetSeq = 0; }

  return { transmit, pathFor, nodeLink, fusionLink, linkFor, linkStats, towers, packets, listeners, reset, skyBlocked };
}
