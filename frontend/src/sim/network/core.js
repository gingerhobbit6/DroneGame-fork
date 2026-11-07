// What every part of the SAPIENT network shares: the node table, the tracker, message delivery and geometry.

import * as S from '../sapient.js';
import { WORLD, FUSION_DEF } from '../config/index.js';
import { createTracker } from '../tracker.js';
import { createComms } from '../comms.js';
import { terrainState } from '../terrain.js';
import { distToZone } from '../attack-area.js';

export const RB_UNITS = 'RANGE_BEARING_COORDINATE_SYSTEM_DEGREES_M';
// A real world's scene is aligned to the national grid, so its bearings are measured from grid north.
export const rbDatum = () => (terrainState.data?.geo ? 'RANGE_BEARING_DATUM_GRID' : 'RANGE_BEARING_DATUM_TRUE');
export const deg = (r) => (r * 180) / Math.PI;
export const round = (x, n = 3) => Number(x.toFixed(n));
export const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
export const dur = (value) => ({ units: 'TIME_UNITS_SECONDS', value });

export const classDepth = (cls) => {
  let n = 0, c = cls && cls[0] && cls[0].sub_class;
  while (c && c[0]) { n++; c = c[0].sub_class; }
  return n;
};

// ctx: { drones: Drone[], getTime(): sim seconds, acceptTask(structure, drone): {ok, reasons?}, monitoring(), on... hooks }
export function createCore(ctx) {
  const mpu = () => WORLD.metresPerUnit;
  const T = () => ctx.getTime();
  const nodes = new Map();  // node id -> node record (the structure object itself for placed systems)
  const tracker = createTracker(() => S.ulid()); // the fusion node's tracks live here
  const names = new Map();  // id -> display name (kept after a node leaves, so the log stays readable)
  const nameOf = (id) => names.get(id) || String(id).slice(0, 8);

  // ids are assigned in init(), from the seeded id stream
  const fusion = { def: FUSION_DEF, nodeId: '', name: 'Site Fusion Node', short: 'FUSION', pos: { x: 0, y: 0, z: 0 }, mode: 'Fuse', statusT: 0 };
  const gui = { nodeId: '', name: 'C2 Operator GUI', short: 'C2-GUI' };
  const routeTo = (s) => (s === fusion ? gui.nodeId : fusion.nodeId);
  fusion.uplinks = new Set(); fusion.cellBand = 'B8'; // which networks the fusion node has terminals on
  const scheduled = [];     // things that happen when a message arrives: { at, fn }, sorted by time
  const comms = createComms({ getTime: T, nodes, fusion, gui, getJammers: () => [...nodes.values()].filter((n) => n.def.kind === 'jammer') });

  // Send a message: it is recorded and validated, then the comms model decides how long it takes or whether it is lost.
  const send = (msg, from, to) => {
    const entry = S.send(msg, from, to, fusion.nodeId);
    const res = comms.transmit(msg, from, to, S.typeOf(msg));
    entry.net = { dropped: res.dropped, reason: res.reason, delay: res.delay, local: !!res.local };
    return res;
  };
  // Do `fn` when the message arrives (never, if it was lost)
  function deliver(res, fn) {
    if (res.dropped) return;
    if (res.delay <= 0.0005) { fn(); return; }
    const at = T() + res.delay;
    let i = scheduled.length;
    while (i > 0 && scheduled[i - 1].at > at) i--;
    scheduled.splice(i, 0, { at, fn });
  }

  // Heights are metres above the station base. A node's antenna is its ground height plus its mast.
  const antennaM = (s) => (s.pos.y || 0) * mpu() + (s.def.mount || 0);
  function rel(s, d) {
    const m = mpu();
    const east = (d.pos.x - s.pos.x) * m;
    const north = -(d.pos.z - s.pos.z) * m;
    const up = d.pos.y * m - antennaM(s);
    const hr = Math.hypot(east, north);
    return { east, north, up, hr, rng: Math.hypot(hr, up) };
  }
  const bearingOf = (r) => ({ az: (deg(Math.atan2(r.east, r.north)) + 360) % 360, el: deg(Math.atan2(r.up, r.hr)) });
  // distance from a node to where a track is believed to be (the effector is cued to the estimate, not the truth)
  const distToTrack = (s, tr) => {
    const m = mpu();
    return Math.hypot(tr.est.east - s.pos.x * m, tr.est.north + s.pos.z * m, tr.flat ? 0 : tr.est.up - (s.pos.y || 0) * m); // no measured height: across the ground
  };
  // where a track is from what is being defended, as a direction: from the drawn area's centre if there is one, or the station
  const fromSite = (tr) => { const c = ctx.siteCentre(), m = mpu(); return { east: tr.est.east - c.x * m, north: tr.est.north + c.z * m }; };
  // and how far: to a drawn area's outline, so nothing inside it, as a long thin area is as close along its whole length; else to the station
  const siteDist = (tr) => {
    const zone = ctx.zone?.(), m = mpu();
    if (zone) return distToZone(zone, tr.est.east / m, -tr.est.north / m) * m;
    const { east, north } = fromSite(tr);
    return Math.hypot(east, north);
  };

  return { ctx, mpu, T, nodes, tracker, names, nameOf, fusion, gui, routeTo, scheduled, comms, send, deliver, antennaM, rel, bearingOf, distToTrack, fromSite, siteDist };
}
