// A patrol's route: an open line of waypoints from a start to an end, and the corridor, a band of a chosen width along it. Points are
// [x, z] in scene units. Nothing here draws a random number.

import { WORLD } from './config/index.js';
import { terrainState } from './terrain.js';
import { onMap, u } from './units.js';

const SAMPLE = 20; // metres between ground checks along each leg
export const MAX_WAYPOINTS = 32; // MAX_ZONE_POINTS in backend/app/schemas.py
export const CORRIDOR = { min: 20, max: 1000 }; // metres wide: PATROL_WIDTH in backend/app/schemas.py

const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

function groundProblem(x, z) {
  const xm = x * WORLD.metresPerUnit, zm = z * WORLD.metresPerUnit, data = terrainState.data;
  if (!onMap(x, z)) return 'The route goes off the map';
  if (data.coverAt(xm, zm) === 4) return 'The route crosses water';
  if (data.slope(xm, zm) > 0.4) return 'The route crosses ground too steep to walk';
  if (data.onBuilding(xm, zm)) return 'The route goes through a building';
  return null;
}

// Distance along the route to each waypoint, in scene units. The last is the whole route.
export function legEnds(route) {
  const ends = [0];
  for (let i = 1; i < route.length; i++) ends.push(ends[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
  return ends;
}

// Why this route can't be walked, or null. Every leg from start to end is checked on the ground.
export function routeProblem(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_WAYPOINTS || !points.every(isPoint)) return `A route needs 2 to ${MAX_WAYPOINTS} waypoints`;
  if (!(legEnds(points).at(-1) > 0)) return 'The route has no length';
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const steps = Math.max(1, Math.ceil((Math.hypot(bx - ax, bz - az) * WORLD.metresPerUnit) / SAMPLE));
    for (let s = 0; s <= steps; s++) {
      const problem = groundProblem(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps);
      if (problem) return problem;
    }
  }
  return null;
}

export const widthProblem = (width) => (Number.isFinite(width) && width >= CORRIDOR.min && width <= CORRIDOR.max ? null : `The corridor must be ${CORRIDOR.min} to ${CORRIDOR.max} m wide`);

// The point this far along the route (scene units, held to the ends) and the way the route runs there, as a unit vector.
export function pointAt(p, dist) {
  const d = Math.min(Math.max(dist, 0), p.ends.at(-1));
  let i = 1;
  while (i < p.ends.length - 1 && d > p.ends[i]) i++;
  const [ax, az] = p.route[i - 1], [bx, bz] = p.route[i], len = p.ends[i] - p.ends[i - 1] || 1, f = (d - p.ends[i - 1]) / len;
  return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, dx: (bx - ax) / len, dz: (bz - az) / len };
}

// How far along the route the nearest point to (x, z) is, and how far off the route (x, z) is, both in scene units.
export function nearest(p, x, z) {
  let best = { along: 0, off: Infinity };
  for (let i = 1; i < p.route.length; i++) {
    const [ax, az] = p.route[i - 1], [bx, bz] = p.route[i], len = p.ends[i] - p.ends[i - 1];
    const t = len ? Math.min(Math.max(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len), 0), 1) : 0;
    const off = Math.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t));
    if (off < best.off) best = { along: p.ends[i - 1] + t * len, off };
  }
  return best;
}

export const inCorridor = (p, x, z) => nearest(p, x, z).off <= u(p.width / 2);
