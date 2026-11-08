// How far a system reaches from where it actually stands. A catalogue range means an open field: flat, clear ground, on its standard mast.
// reachOnPath takes that down for one real path, and is what detection and jamming use, so the prediction here cannot disagree with play.

import { SENSING, TERRAIN } from './config/index.js';
import { earthBulge, freeSpaceLoss, fresnelRadius, pathLoss, reachFactor } from './propagation.js';
import { coverKey, inCover } from './sensor-model.js';
import { bandGhz, heardBand } from './rf-model.js';
import { clearSight } from './world.js';

// How much ground clutter hides low flyers from radar, by ground cover (open, forest, built, power-line corridor):
// the radar's low-flyer range is multiplied by this.
const COVER_CLUTTER = [1.5, 0.7, 0.5, 0.5, 1.5]; // the last is water: open, so low flyers over it are easy to see
const BUILT_UP = 2;
const ACOUSTIC = { hillLoss: 0.5, noiseLoss: 0.5 }; // share of its reach kept behind a hill and in a built-up area: assumptions
const REFERENCE_RF_GHZ = 2.4;    // a jammer's band in a prediction, which has no one link to read it from

// Quoted accuracy is what a system does on a strong signal. Error from noise grows as the signal weakens: angle error goes with 1 / sqrt(SNR)
// for a monopulse radar, and range error likewise. EDGE_ERROR is that noise at the limit of reach, as a multiple of the quoted figure: an assumption.
const EDGE_ERROR = 2;
const MAX_ERROR_SCALE = 8;       // past this a bearing says nothing useful, and the detection is unlikely anyway

export const BEARINGS = 90;      // directions a prediction looks in
const STEPS = 32;                // points checked along each direction

const isRadio = (def) => def.kind === 'radar' || def.kind === 'rf' || def.kind === 'jammer';
// A weapon whose round or interceptor flies to the target. It is cued over the terrain, so it needs no sight line and reaches as far
// anywhere, but its round must be able to catch what it is sent at. Every other system works along a clear path from where it stands.
export const flies = (def) => def.fire === 'guided';
export const usesPath = (def) => !flies(def);
// A drone's usual height: the middle of its height band, or the average of the middles of its bands if it flies more than one.
export const typicalAltitude = (droneDef) => { const bands = droneDef.altModes ?? [droneDef.alt]; return bands.reduce((sum, [lo, hi]) => sum + (lo + hi) / 2, 0) / bands.length; };
export const antennaHeight = (def) => def.mount ?? (def.fire === 'beam' ? 4 : 0);

// How far this sensor reaches for this type of drone in an open field, before terrain and clutter. 0 means it can never detect it.
export function reachFor(def, droneDef) {
  const kind = def.kind || def.id;
  if (def.senses === 'rf' && !heardBand(def, droneDef)) return 0; // silent, or on no band it covers (rf-model.js)
  if (kind === 'radar') return def.range * Math.pow((droneDef.rcs ?? SENSING.refRcs) / SENSING.refRcs, 0.25);
  if (kind === 'camera') return def.range * ((droneDef.size ?? SENSING.refSize) / SENSING.refSize);
  if (kind === 'rf') return def.range * Math.sqrt(droneDef.rfPower ?? 1);
  if (kind === 'acoustic') return def.range * (droneDef.sound ?? 1);
  return def.range;
}

// The frequency a path is worked out at: the radar's own band, the band a detector hears the drone on, or the band given.
function pathGhz(def, droneDef, ghz) {
  if (ghz) return ghz;
  if (def.kind === 'radar') return (def.emits[0].f[0][0] + def.emits[0].f[0][1]) / 2;
  const band = def.kind === 'rf' && heardBand(def, droneDef);
  return band ? bandGhz(band) : REFERENCE_RF_GHZ;
}

// How far this system reaches along the path from a to b ({ x, y, z } in metres). ghz: the band, where the caller knows it; open: its
// open-field reach, where the caller has worked it out.
export function reachOnPath(def, droneDef, world, a, b, ghz, open = reachFor(def, droneDef)) {
  if (!open || !usesPath(def)) return open;
  if (isRadio(def)) return open * reachFactor(pathLoss(world, a, b, pathGhz(def, droneDef, ghz)).loss);
  const sight = world.los(a.x, a.y, a.z, b.x, b.y, b.z);
  if (def.kind === 'acoustic') { // sound carries over hills and through trees, but hills weaken it and a noisy place drowns it
    const noisy = world.coverAt(a.x, a.z) === BUILT_UP;
    return open * (sight.clear ? 1 : ACOUSTIC.hillLoss) * (noisy ? ACOUSTIC.noiseLoss : 1);
  }
  return clearSight(sight) ? open : 0; // a camera or laser needs a clear line
}

// How many times the quoted error applies at this range, given the reach on this path, so hills and trees worsen it too. A radar's signal falls
// with the fourth power of range because it travels both ways. Everything else here only receives, so its signal falls with the square.
export function errorScale(def, range, reach) {
  if (!reach) return MAX_ERROR_SCALE;
  const noise = EDGE_ERROR * (range / reach) ** (def.kind === 'radar' ? 2 : 1);
  return Math.min(MAX_ERROR_SCALE, Math.hypot(1, noise));
}
export const ERROR_AT_LIMIT = Math.hypot(1, EDGE_ERROR);

// Is a low flyer at this spot lost in ground clutter, for a radar this far away? Only one moving slower than a radar's Doppler filter
// can tell from the still ground (speed in m/s); hills, trees and buildings hide the rest through line of sight.
export const inClutter = (def, world, x, z, agl, horizontal, speed) => !!def.lowAlt && speed < SENSING.clutterSpeed && agl < def.lowAlt && horizontal > def.lowRange * COVER_CLUTTER[world.coverAt(x, z)];

const predictions = new WeakMap(); // world -> results, because the same spot is asked for by the ring, the panel and the cursor

// Range around a spot in each direction, against one type of drone at its usual height. first[i] is how far cover runs unbroken on bearing
// i * 360 / BEARINGS, and 0 outside a radar's arc. covered is the share of the open-field area inside its arc that is really seen, gaps
// included, and mean, min and worst are over that arc too. limited means the map's edge stopped it.
export function predictRange(def, droneDef, world, x, z, alt = typicalAltitude(droneDef)) {
  const open = reachFor(def, droneDef);
  const sx = Math.round(x / world.cell) * world.cell, sz = Math.round(z / world.cell) * world.cell;
  let results = predictions.get(world);
  if (!results) predictions.set(world, results = new Map());
  const key = `${def.id}|${sx}|${sz}|${open}|${def.mount}|${droneDef.id}|${alt}|${coverKey(def)}`;
  const saved = results.get(key);
  if (saved) return saved;
  const out = calculate(def, droneDef, world, sx, sz, alt, open);
  if (results.size >= 2000) results.clear();
  results.set(key, out);
  return out;
}

function calculate(def, droneDef, world, x, z, alt, open) {
  const first = new Float32Array(BEARINGS);
  const far = open > alt ? Math.sqrt(open * open - alt * alt) : 0;
  const steps = Math.min(STEPS, Math.ceil(far / world.cell)) || 1;
  const a = { x, y: world.groundAt(x, z) + antennaHeight(def), z }, b = { x: 0, y: 0, z: 0 };
  let seen = 0, total = 0, limited = false;
  const looks = Array.from({ length: BEARINGS }, (_, i) => inCover(def, (i * 360) / BEARINGS, 0));
  for (let i = 0; i < BEARINGS; i++) {
    if (!looks[i]) continue;
    const rad = (i / BEARINGS) * 2 * Math.PI, east = Math.sin(rad), south = -Math.cos(rad);
    let unbroken = true, started = false;
    for (let s = 1; s <= steps && far; s++) {
      const r = (far * s) / steps;
      b.x = x + east * r; b.z = z + south * r;
      if (Math.abs(b.x) > world.R || Math.abs(b.z) > world.R) { limited = true; break; }
      b.y = world.groundAt(b.x, b.z) + alt;
      const inBand = inCover(def, (i * 360) / BEARINGS, (Math.atan2(b.y - a.y, r) * 180) / Math.PI);
      const ok = inBand && Math.hypot(r, b.y - a.y) <= reachOnPath(def, droneDef, world, a, b) * 1.001 && !inClutter(def, world, b.x, b.z, alt, r, droneDef.speed);
      total += r;
      if (ok) { seen += r; started = true; } else if (started || inBand) unbroken = false; // close in, over or under the beam is a gap, not the edge
      if (unbroken && ok) first[i] = r;
    }
  }
  let sum = 0, min = Infinity, max = 0, worst = 0, counted = 0;
  first.forEach((r, i) => { if (!looks[i]) return; counted++; sum += r; max = Math.max(max, r); if (r < min) { min = r; worst = i; } });
  return { open, first, mean: counted ? sum / counted : 0, min: counted ? min : 0, max, covered: total ? seen / total : 0, limited, worst: (worst * 360) / BEARINGS, alt };
}

// Everything needed to draw and explain one path, from a spot out along a bearing to the system's open-field range or the map's edge.
export function pathReport(def, droneDef, world, x, z, bearing, alt = typicalAltitude(droneDef)) {
  const open = reachFor(def, droneDef), rad = (bearing * Math.PI) / 180;
  const east = Math.sin(rad), south = -Math.cos(rad);
  let D = Math.max(open > alt ? Math.sqrt(open * open - alt * alt) : 0, world.cell * 2);
  while (D > world.cell && (Math.abs(x + east * D) > world.R || Math.abs(z + south * D) > world.R)) D -= world.cell;
  const n = Math.min(120, Math.ceil(D / world.cell));
  const ghz = isRadio(def) ? pathGhz(def, droneDef) : null;
  const a = { x, y: world.groundAt(x, z) + antennaHeight(def), z };
  const b = { x: x + east * D, z: z + south * D, y: 0 };
  b.y = world.groundAt(b.x, b.z) + alt;
  const points = [];
  let blocker = null;
  for (let s = 0; s <= n; s++) {
    const t = s / n, d = t * D, px = x + east * d, pz = z + south * d, k = world.cellOf(px, pz);
    const ground = world.groundAt(px, pz) + (s && s < n ? earthBulge(d, D) : 0);
    const top = ground + world.bldg[k] + (d > TERRAIN.endClear ? world.canopy[k] : 0);
    const ray = a.y + (b.y - a.y) * t;
    points.push({ d, ground, top, ray, zone: ghz && s && s < n ? fresnelRadius(d, D, ghz) : 0 });
    if (s && s < n && top - ray > (blocker ? blocker.above : 0)) blocker = { d, above: top - ray, what: world.bldg[k] ? 'building' : world.canopy[k] ? 'trees' : 'ground' };
  }
  const loss = isRadio(def) ? pathLoss(world, a, b, ghz) : null;
  return {
    D, ghz, alt, points, blocker, open, mast: antennaHeight(def),
    free: ghz ? freeSpaceLoss(D, ghz) : null, loss,
    reach: reachOnPath(def, droneDef, world, a, b),
  };
}
