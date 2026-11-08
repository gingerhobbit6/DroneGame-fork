// The area the player is defending, which is what the enemy attacks once one is drawn. Points are [x, z] in scene units.

import { BUILD, WORLD } from './config/index.js';
import { onMap, u } from './units.js';

// A drawn area or a patrol is the site, so the old station's build ring no longer limits anything.
export const siteIsFree = (w) => !!(w.state.zone || w.patrol);

// Why a spot is out of reach for anything placed, or null: off the map once the site is free, otherwise outside the station's build ring.
export function reachProblem(w, x, z) {
  if (siteIsFree(w)) return onMap(x, z) ? null : 'That is off the map';
  return Math.hypot(x, z) > u(BUILD.maxDist) ? `Outside the build zone (maximum ${BUILD.maxDist} m). Draw an area to defend anywhere on the map` : null;
}

const EDGE_MARGIN = 200; // metres: drones start this far inside the edge of the map
const MIN_RUN = 2000; // metres: an attack with less room than this to fly in comes from somewhere else

// How far from the centre, along this direction, before the edge of the map.
function roomToEdge(centre, dx, dz) {
  const edge = u(WORLD.radius - EDGE_MARGIN);
  const along = (c, d) => (d > 0 ? (edge - c) / d : d < 0 ? (-edge - c) / d : Infinity);
  return Math.min(along(centre.x, dx), along(centre.z, dz));
}

// How far out, in metres, a drone of this kind starts: `share` (0 to 1) of the way across its launch band (WORLD.launchBand).
export function launchDistance(def, share) {
  if (def.launch === 'edge') return Infinity; // flown from far off the map, so it comes in at the edge (launchPoint stops it there)
  const [near, far] = WORLD.launchBand[def.launch ?? (def.model === 'quad' ? 'short' : 'long')];
  return near + share * (far - near);
}

// Where a drone starts: `dist` metres out from what is being defended along its bearing, and always on the map. Defending near
// the map's edge, a bearing may have no room to fly in, so it uses the opposite one. In a corner both can be short, and the
// middle of the map never is.
export function launchPoint(centre, angle, dist) {
  const cos = Math.cos(angle), sin = Math.sin(angle), toMiddle = Math.hypot(centre.x, centre.z);
  const options = [[cos, sin], [-cos, -sin], [-centre.x / toMiddle, -centre.z / toMiddle]];
  const [dx, dz] = options.find(([x, z]) => roomToEdge(centre, x, z) >= u(MIN_RUN));
  const reach = Math.min(u(dist), roomToEdge(centre, dx, dz));
  return { x: centre.x + dx * reach, z: centre.z + dz * reach };
}

export function inZone(points, x, z) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i], [xj, zj] = points[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// A saved laydown's area comes from outside the game, so anything that is not a usable outline counts as no area.
export const cleanZone = (points) => (Array.isArray(points) && points.length >= 3 && points.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) ? points : null);

export function zoneCentre(points) {
  const sum = points.reduce((total, [x, z]) => ({ x: total.x + x, z: total.z + z }), { x: 0, z: 0 });
  return { x: sum.x / points.length, z: sum.z / points.length };
}

// A random spot inside the area for one drone to aim at. An outline with no area to speak of falls back to its centre.
export function aimInZone(points, rng) {
  const xs = points.map(([x]) => x), zs = points.map(([, z]) => z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  for (let i = 0; i < 50; i++) {
    const x = x0 + rng() * (x1 - x0), z = z0 + rng() * (z1 - z0);
    if (inZone(points, x, z)) return { x, z, structure: null };
  }
  return { ...zoneCentre(points), structure: null };
}
