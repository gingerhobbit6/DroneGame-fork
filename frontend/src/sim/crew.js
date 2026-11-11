// Systems off the network (def.networked === false) fight on their own: the crew picks the nearest drone it can see in reach, and
// fires or jams once it has reacted. A machine gunner or a soldier with a jammer sees by eye, a quadcopter at about 300 m and a Shahed
// at about 2 km in daylight, less in poor light. It hears a loud drone further off, and a wearable detector warns of a drone with a radio
// link within 400 m: warned either way, the crew is ready by the time it comes into sight, and a jammer is pointed down its bearing
// straight away. Nothing here draws a random number.

import { CREW, WORLD } from './config/index.js';
import { CONDITIONS, ENV } from './conditions.js';
import { terrainState } from './terrain.js';
import { clearSight } from './world.js';
import { u } from './units.js';
import { barsDrone } from './engage-rules.js';

const SCAN = 0.5; // seconds between looks round for a new target
const EYE_HEIGHT = 2.5; // metres: a gunner standing in a vehicle, when the system has no mast height of its own

export const crewed = (def) => def.networked === false;

// How far (m) this crew can see this drone.
export const sightRange = (drone) => Math.min(CREW.eyeMax, drone.def.size / Math.tan((CREW.eyeAngle * Math.PI) / 180)) * Math.max(CREW.nightFloor, CONDITIONS[ENV.now].visible);
// How far (m) this crew hears this drone: sound needs no line of sight, but rain drowns it.
export const hearingRange = (drone) => CREW.earRange * (drone.def.sound ?? 1) * CONDITIONS[ENV.now].acoustic;
// Is the crew warned of this drone: by its detector, which hears a radio link (so not a fibre-optic or silent one), or by ear?
export const alerts = (s, d) => {
  const metres = s.pos.distanceTo(d.pos) * WORLD.metresPerUnit;
  return (!!d.def.rfEmitter && metres <= CREW.alertRange) || metres <= hearingRange(d);
};

function crewSees(s, d) {
  const m = WORLD.metresPerUnit;
  if (s.pos.distanceTo(d.pos) * m > sightRange(d)) return false;
  const r = terrainState.data.los(s.pos.x * m, s.pos.y * m + (s.def.mount ?? EYE_HEIGHT), s.pos.z * m, d.pos.x * m, d.pos.y * m, d.pos.z * m);
  return clearSight(r);
}

// Keep the target while it can still be seen in reach, else look round for the nearest one that can; a jammer may also take one its
// detector warns of. A crew warned for longer than its reaction time fires the moment a drone comes into sight. A jammer is on while
// it has a target, pointed at it.
export function crewTask(w, s, dt) {
  const jammer = s.def.fire === 'jam', reach = u(s.def.range);
  const ok = (d) => !d.dead && !barsDrone(w.engageRules, s.def.id, d.def.id) && s.pos.distanceTo(d.pos) <= reach && (crewSees(s, d) || (jammer && alerts(s, d)));
  if (s.task && !ok(s.task.drone)) s.task = null;
  s.scanT = (s.scanT ?? 0) - dt;
  if (s.scanT <= 0) {
    s.scanT = SCAN;
    const warned = w.drones.some((d) => !d.dead && alerts(s, d));
    s.alertSince = warned ? (s.alertSince ?? w.state.time) : null;
    if (!s.task) {
      let best = null, bd = Infinity;
      for (const d of w.drones) { const dist = s.pos.distanceTo(d.pos); if (dist < bd && ok(d)) { bd = dist; best = d; } }
      const ready = s.alertSince != null && w.state.time - s.alertSince >= CREW.reaction;
      if (best) s.task = { drone: best, activeAt: ready ? w.state.time : w.state.time + CREW.reaction, crew: true };
    }
  }
  if (!jammer) return;
  const on = !!s.task && w.state.time >= s.task.activeAt;
  s.mode = on ? 'Jam' : 'Standby';
  if (on) s.aim = Math.atan2(s.task.drone.pos.x - s.pos.x, s.task.drone.pos.z - s.pos.z);
}
