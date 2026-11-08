// How many sensors would see a drone of a given type at each spot. The plan map draws this, and the wizard scores the zone with it.

import { BUILD, DRONES, DRONE_CLASSES, WORLD, exportFigures } from '../sim/config/index.js';
import { coverKey } from '../sim/sensor-model.js';
import { terrainState } from '../sim/terrain.js';
import { typicalAltitude } from '../sim/site-range.js';
import { inZone } from '../zone.js';

const caches = new WeakMap(); // sim -> drone type -> the last grid worked out
const CELL = 250; // metres

// A patrol's escorts move and turn every step, and a jammer on a pan-and-tilt head turns, so these count by the grid's own cell and
// by 15°, or the grid would be worked out again on every refresh.
const placed = (n, v) => (n.escort ? Math.round((v * WORLD.metresPerUnit) / CELL) : v);
const covers = (n) => coverKey(n.escort || n.slewTo != null ? Object.create(n.def, { facing: { value: Math.round(n.def.facing / 15) * 15 } }) : n.def);

// For each cell, how many sensors would see a drone of this type there (it flies at that type's usual height).
export function coverageGrid(sim, threat) {
  const { net } = sim;
  const def = DRONES[threat];
  const agl = typicalAltitude(def);
  // everything the answer depends on: node ids repeat after a reload, so they cannot tell two laydowns apart
  const key = [threat, sim.state.terrainSeed, JSON.stringify(exportFigures()), ...[...net.nodes.values()].map((n) => `${n.nodeId}:${placed(n, n.pos.x)}:${placed(n, n.pos.z)}:${n.def.range}:${n.def.mount}:${n.def.fov}:${covers(n)}`)].join('|');
  if (!caches.has(sim)) caches.set(sim, new Map());
  const cache = caches.get(sim), hit = cache.get(threat);
  if (hit && hit.key === key) return hit;
  const cell = CELL, half = terrainState.data.R - 200, n = Math.round((2 * half) / cell);
  const counts = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) counts[j * n + i] = net.coverageAt(-half + (i + 0.5) * cell, -half + (j + 0.5) * cell, agl, def);
  const grid = { key, n, cell, half, counts };
  cache.set(threat, grid);
  return grid;
}

// The share of the zone at least one sensor can see (0 to 1). With no zone drawn, it scores everything inside the build limit.
export function zoneShare(sim, threat, zone) {
  const g = coverageGrid(sim, threat), mpu = WORLD.metresPerUnit;
  // panels ask on every refresh, and the scan tests every cell against the outline, so it is kept with the grid it was made from
  const area = zone && zone.closed ? JSON.stringify(zone.points) : `within ${BUILD.maxDist}`;
  g.shares ??= new Map();
  if (!g.shares.has(area)) g.shares.set(area, scanShare(g, zone, mpu));
  return g.shares.get(area);
}

function scanShare(g, zone, mpu) {
  const inside = zone && zone.closed ? (xm, zm) => inZone(zone.points, xm / mpu, zm / mpu) : (xm, zm) => Math.hypot(xm, zm) <= BUILD.maxDist;
  let cells = 0, seen = 0;
  for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) {
    if (!inside(-g.half + (i + 0.5) * g.cell, -g.half + (j + 0.5) * g.cell)) continue;
    cells++;
    if (g.counts[j * g.n + i] > 0) seen++;
  }
  return cells ? seen / cells : 0;
}

// Each of the four types, with its height and how much of the zone is seen, with the weakest first.
export function zoneScores(sim, zone) {
  return DRONE_CLASSES
    .map((def) => ({ id: def.id, name: def.name, height: Math.round(typicalAltitude(def)), share: zoneShare(sim, def.id, zone) }))
    .sort((a, b) => a.share - b.share);
}
