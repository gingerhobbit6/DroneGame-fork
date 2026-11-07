// What one of your jammers reaches, hears and does to a drone. Reach: a radio path on each band, through a sector antenna's arc, and for a
// control link further the further the drone is from its operator. Hearing: a jammer may carry its own receiver and library, which hear a
// drone's links on the bands it is fitted for, but not through noise on them: its own barrage, or another of your jammers nearby.

import { WORLD } from './config/index.js';
import { antennaHeight, reachOnPath } from './site-range.js';
import { bandGhz, heardBand, libraryKnows } from './rf-model.js';
import { inArcOf } from './sensor-model.js';
import { terrainState } from './terrain.js';
import { u, hdist } from './units.js';

// Does this jammer reach the drone on this band? It needs a radio path, the same as a radio detector, worked out on that band, and a
// sector antenna has to face it. k scales its reach, for a link that is easier or harder to jam than the one its range is quoted for.
// A handheld jammer's beam (def.beam, degrees wide) points where its soldier aims it (s.aim, crew.js).
const inBeam = (s, d) => !s.def.beam || Math.abs(((Math.atan2(d.pos.x - s.pos.x, d.pos.z - s.pos.z) - (s.aim ?? 0) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) <= (s.def.beam * Math.PI) / 360;

export function jamReaches(s, d, band, k = 1) {
  const dist = s.pos.distanceTo(d.pos);
  if (dist > u(s.def.range * k) || !inArcOf(s.def, s.pos, d.pos) || !inBeam(s, d)) return false;
  const m = WORLD.metresPerUnit;
  const from = { x: s.pos.x * m, y: s.pos.y * m + antennaHeight(s.def), z: s.pos.z * m }, to = { x: d.pos.x * m, y: d.pos.y * m, z: d.pos.z * m };
  return dist <= u(reachOnPath(s.def, d.def, terrainState.data, from, to, bandGhz(band)) * k);
}

// A control link is easier to jam the further the drone is from its operator, whose signal it is listening for: jamming wins when the
// jammer is louder at the drone, so its reach goes with that distance. The launch point stands in for the operator, and a jammer's
// quoted range is taken as against a drone this far from its operator, about where one on a 6 km run comes within a jammer's quoted range near
// the site, so that range holds there: an assumption.
const OPERATOR_REF = 4500; // m
export const fromOperator = (d) => hdist(d.pos, d.launch) / u(OPERATOR_REF);

// A reactive jammer puts its power on the one link it follows, so that link breaks this many times sooner: an assumption.
export const REACTIVE_RATE = 2;

// The bands a receiver at s cannot hear now: those your own jammers fill where it stands, as they cut your own links in comms.js. A jammer's
// own receiver is blanked by its own barrage, but hears between a reactive jammer's bursts.
// shortcut: deaf or not, by the jammer's own range; a jammer's leakage falling off with distance would need a power model.
export function deafAt(s, jammers) {
  const deaf = new Set();
  for (const j of jammers) {
    if (j.def.kind !== 'jammer' || j.mode !== 'Jam') continue;
    if (j === s ? j.def.technique === 'reactive' : Math.hypot(j.pos.x - s.pos.x, j.pos.z - s.pos.z) * WORLD.metresPerUnit >= j.def.range || !inArcOf(j.def, j.pos, s.pos)) continue;
    for (const b of j.jamBands) deaf.add(b);
  }
  return deaf;
}

// The band this jammer's own receiver hears the drone on, or null: none fitted, a silent drone, or noise on every band it would hear.
// shortcut: it hears as far as it can jam; a receiver with its own sensitivity would hear further, if hearing early ever matters.
export function hears(s, d, jammers) {
  if (!s.def.library) return null;
  const band = heardBand(s.def, d.def, deafAt(s, jammers));
  return band && jamReaches(s, d, band) ? band : null;
}

// Can this jammer follow this kind of drone's link? A barrage needs to follow nothing. A reactive jammer follows only a link its library
// knows, and not one that hops frequency faster than it can (droneDef.hops), so only a barrage touches that.
export const canFollow = (def, droneDef) => def.technique !== 'reactive' || (libraryKnows(def, droneDef) && !droneDef.hops);

// What this jammer, switched on, does to this drone: which links it jams and how hard, or null. A barrage jams every drone on its active
// bands. Reactive jams only the links of a drone it can follow and its receiver hears, harder, and never GNSS, which a drone only receives.
export function jamming(s, d, jammers) {
  const links = d.def.links || {}, reactive = s.def.technique === 'reactive';
  if (reactive && !(canFollow(s.def, d.def) && hears(s, d, jammers))) return null;
  const jams = (band, k) => !!band && s.jamBands.has(band) && jamReaches(s, d, band, k);
  // shortcut: video is jammed at the drone, though its receiver is with the operator; jamming it there needs the operator on the map
  const control = jams(links.control, fromOperator(d)), video = jams(links.video), gnss = !reactive && !!links.gnss && jams('gnss');
  return control || video || gnss ? { control, video, gnss, rate: reactive ? REACTIVE_RATE : 1 } : null;
}
