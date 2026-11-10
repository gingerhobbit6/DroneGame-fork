// A vehicle laydown as a handful of numbers, so a search can vary it, and the rules a laydown has to keep.
//
// A DESIGN is the full layout:  { vehicles: [{ at: [x, z], sys: [[id, settings?], ...] }], remote: [[id, x, z, settings?]], bunker }
// metres from the station, north is -z. PARAMS are the numbers a search varies; fromParams() turns them into a design.
//
// What needs a vehicle (a "site") and what does not:
//   radars, guns and interceptors ride on a vehicle: each one is a place that has to be staffed and kept supplied. The aim is as few
//   of these places as will do.
//   networked jammers and acoustic or RF detectors can be put out on their own ("remote"), so they do not count as sites.

import { STRUCTURES, MOUNTS } from '../../src/sim/config/index.js';

export const RULES = {
  maxVehicles: 10, maxPerVehicle: 3, minGap: 60, // metres between any two separate emplacements (the game's own rule, BUILD.spacing)
  minDist: 250, maxDist: 2500,
  // How many sensors may share one vehicle. The brief allows 1; set --sensors N on any lab command to allow more (the rest of the
  // vehicle rules still hold). Read from the environment each time so the worker threads, which are started afterwards, agree.
  get maxSensors() { return Math.max(1, Number(process.env.LAB_MAX_SENSORS) || 1); },
};
export const SELF_PROPELLED = new Set(['gun_gepard', 'laser_rfdew', 'laser_s', 'gun_skyranger']);
export const OFFS = [[0, 0], [5, 0], [0, 5]]; // where a vehicle's systems sit around its middle, metres
export const RADAR = ['radar_s', { panels: 3 }];

// The numbers a search can change, with their ranges. kind 'int' is rounded.
export const SPACE = {
  R: { min: 300, max: 700, kind: 'int', step: 10 }, // ring the vehicles stand on, metres
  rot: { min: 0, max: 1, kind: 'num' },             // ring turned by this fraction of one vehicle spacing
  radars: { min: 1, max: 6, kind: 'int' },          // vehicles that carry a radar
  p1: { min: 0, max: 6, kind: 'int' },              // vehicles that carry a P1 interceptor
  hmg2: { min: 0, max: 10, kind: 'int' },           // vehicles that carry a second machine gun
  jam: { min: 0, max: 20, kind: 'int' },            // remote jammers
  rho1: { min: 1.05, max: 1.7, kind: 'num' },       // inner jammer ring, as a multiple of R
  rho2: { min: 1.5, max: 2.8, kind: 'num' },        // outer jammer ring, as a multiple of R
};
export const NAMES = Object.keys(SPACE);

export const clampParam = (key, v) => {
  const s = SPACE[key];
  let x = Math.min(s.max, Math.max(s.min, v));
  if (s.kind === 'int') x = Math.round(x / (s.step || 1)) * (s.step || 1);
  return x;
};

// n indices spread evenly round a ring of k, starting near `from`, skipping any in `taken` where it can.
function spread(k, n, from, taken = new Set()) {
  const out = [];
  n = Math.min(n, k);
  for (let j = 0; j < n; j++) {
    let i = Math.round(from + (j * k) / n) % k;
    for (let tries = 0; tries < k && (taken.has(i) || out.includes(i)); tries++) i = (i + 1) % k;
    out.push(i);
  }
  return out;
}

export function fromParams(p, k) {
  const R = p.R, ang = (i) => ((i + p.rot) / k) * Math.PI * 2;
  const at = (a, r) => [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)];
  const radarAt = new Set(spread(k, Math.min(p.radars, k), 0));
  const p1At = new Set(spread(k, Math.min(p.p1, k), 0.5, radarAt));
  const hmg2At = new Set(spread(k, Math.min(p.hmg2, k), 0.25, new Set([...radarAt, ...p1At])));
  const vehicles = [];
  for (let i = 0; i < k; i++) {
    const sys = [['gun_hmg']];
    if (hmg2At.has(i)) sys.push(['gun_hmg']);
    if (radarAt.has(i)) sys.push(RADAR);
    if (p1At.has(i)) sys.push(['interceptor_p1']);
    vehicles.push({ at: at(ang(i), R), sys });
  }
  const remote = [];
  const inner = Math.round(p.jam * 0.67), outer = p.jam - inner;
  for (let j = 0; j < inner; j++) remote.push(['jammer_sf', ...at(((j + 0.5) / inner) * Math.PI * 2 + (p.rot / k) * Math.PI * 2, R * p.rho1)]);
  for (let j = 0; j < outer; j++) remote.push(['jammer_sf', ...at((j / outer) * Math.PI * 2 + (p.rot / k) * Math.PI * 2, R * p.rho2)]);
  return { vehicles, remote, bunker: 15 };
}

// Why a design breaks the rules, or null. The sim itself also refuses a placement it cannot afford or that is off the ring.
export function problem(design, mounts = MOUNTS) {
  const { vehicles, remote = [] } = design;
  if (vehicles.length > RULES.maxVehicles) return `${vehicles.length} vehicles (max ${RULES.maxVehicles})`;
  for (const [i, v] of vehicles.entries()) {
    const ids = v.sys.map((s) => s[0]);
    if (ids.some((id) => SELF_PROPELLED.has(id))) { if (ids.length > 1) return `vehicle ${i}: a self-propelled system rides alone`; continue; }
    for (const id of ids) if (!mounts[id]) return `vehicle ${i}: ${id} is not vehicle-mountable`;
    if (ids.length > RULES.maxPerVehicle) return `vehicle ${i}: more than ${RULES.maxPerVehicle} systems`;
    if (ids.filter((id) => STRUCTURES[id].role === 'sensor').length > RULES.maxSensors) return `vehicle ${i}: more than ${RULES.maxSensors} sensor${RULES.maxSensors > 1 ? 's' : ''}`;
    if (ids.some((id) => mounts[id] === 3) && ids.length > 2) return `vehicle ${i}: a heavy system leaves room for one more`;
  }
  for (const [id] of remote) {
    const d = STRUCTURES[id];
    if (!((d.kind === 'jammer' && d.networked !== false) || (d.role === 'sensor' && ['acoustic', 'rf'].includes(d.kind)))) return `remote ${id} must be a networked jammer, acoustic or RF detector`;
  }
  const sites = [...vehicles.map((v) => v.at), ...remote.map((r) => [r[1], r[2]])];
  for (const [x, z] of sites) { const d = Math.hypot(x, z); if (d < RULES.minDist || d > RULES.maxDist) return `a site at ${Math.round(d)} m is outside the ${RULES.minDist}-${RULES.maxDist} m ring`; }
  for (let a = 0; a < sites.length; a++) for (let b = a + 1; b < sites.length; b++) {
    if (Math.hypot(sites[a][0] - sites[b][0], sites[a][1] - sites[b][1]) < RULES.minGap) return `two sites are closer than ${RULES.minGap} m`;
  }
  return null;
}

export const siteCount = (design) => design.vehicles.length;
export const describe = (design) => {
  const count = {};
  for (const v of design.vehicles) for (const [id] of v.sys) count[id] = (count[id] || 0) + 1;
  for (const [id] of design.remote || []) count[`${id} (remote)`] = (count[`${id} (remote)`] || 0) + 1;
  return Object.entries(count).map(([id, n]) => `${n}x ${id}`).join(', ');
};

// V11 from the brief, as numbers: 10 vehicles at 450 m, radars on 4, P1 on 3, 12 remote jammers.
export const V11 = { R: 450, rot: 0, radars: 4, p1: 3, hmg2: 0, jam: 12, rho1: 1.33, rho2: 1.9 };
