// How the enemy finds a patrol. A spotter searches the corridor, flying along the route, until its camera picks the patrol out with a
// clear line of sight. Then it circles the patrol and passes a fix to the strikes each time it sees it. Strikes home on that fix, so
// it goes stale when the spotter is jammed, shot down or loses sight behind ground or trees. A strike with a camera that comes close
// enough sees the patrol for itself. With no fix yet, strikes circle the middle of the corridor and wait for one. All the figures are
// ASSUMPTIONS (PATROL.enemy). Nothing here draws a random number.

import { PATROL, TERRAIN, WORLD } from './config/index.js';
import { terrainState } from './terrain.js';
import { hdist, u } from './units.js';
import { nearest, pointAt } from './route.js';

const LOOK_EVERY = 1; // seconds between looks, so a long line of sight is not traced every step
const EYE = 1.7; // metres: what a camera looks for is a person standing
const STRIKE_DISTANCE = 30; // metres: as close as a strike must come to hit (drones.js)

// Can this drone's camera see the patrol? Only within range, with video that works, along a line clear of ground and trees.
function sees(w, d, range) {
  const g = w.patrol.group, m = WORLD.metresPerUnit;
  if (d.videoJammed || Math.hypot(d.pos.x - g.x, d.pos.y - g.y, d.pos.z - g.z) > u(range)) return false;
  const r = terrainState.data.los(d.pos.x * m, d.pos.y * m, d.pos.z * m, g.x * m, g.y * m + EYE, g.z * m);
  return r.clear && r.canopy <= TERRAIN.opticalCanopyTol;
}

// Look once a second, keeping the answer between looks.
function looks(w, d, range) {
  if (!(w.state.time < d.lookAt)) { d.lookAt = w.state.time + LOOK_EVERY; d.seesPatrol = sees(w, d, range); }
  return d.seesPatrol;
}

// Where a spotter flies or circles, and whether it has found the patrol. While it searches it flies the route end to end and back.
export function spotterGoal(w, d, spd) {
  const p = w.patrol;
  if (looks(w, d, PATROL.enemy.sightRange)) {
    if (!d.found) w.rec.event('spotter', `${d.def.name} found the patrol`, d.uid);
    d.found = true;
    p.fix = { x: p.group.x, z: p.group.z, t: w.state.time };
  }
  if (d.found) return { c: p.fix, found: true };
  if (d.search == null) { d.search = nearest(p, d.pos.x, d.pos.z).along; d.searchDir = 1; }
  const q = pointAt(p, d.search), total = p.ends.at(-1);
  if (hdist(d.pos, q) < u(200)) { // over the route: sweep along it, turning at each end
    d.search += d.searchDir * spd;
    if (d.search >= total || d.search <= 0) { d.search = Math.min(Math.max(d.search, 0), total); d.searchDir *= -1; }
  }
  return { c: q, found: false };
}

// A strike flown by video, over a radio link or a fibre, has a camera of its own.
const hasCamera = (d) => !!d.def.links?.video || (d.def.variantOf ?? d.type) === 'fo';

// What a strike drone homes on: the patrol itself when it sees it, the last fix otherwise, or the corridor's middle to wait at.
export function patrolAim(w, d) {
  const p = w.patrol, g = p.group;
  if (hasCamera(d) && looks(w, d, PATROL.enemy.strikeSight)) return { x: g.x, z: g.z, structure: null, patrol: true };
  if (p.fix) return { x: p.fix.x, z: p.fix.z, structure: null, patrol: true };
  return { ...pointAt(p, p.ends.at(-1) / 2), structure: null, hold: true };
}

// A strike that arrives where the fix was hits the patrol only if the patrol is still there.
export function patrolThere(w, x, z) {
  const { spots, count } = w.patrol.group;
  for (let i = 0; i < count; i++) if (Math.hypot(spots[i * 2] - x, spots[i * 2 + 1] - z) <= u(STRIKE_DISTANCE)) return true;
  return false;
}
