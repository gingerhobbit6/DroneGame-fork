// How many sensors would see a drone of a given type at each spot. The plan map draws this, and the wizard scores the zone with it.

import { BUILD, DRONES, DRONE_CLASSES, WORLD, exportFigures } from '../sim/config/index.js';
import { deafAt } from '../sim/jamming.js';
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

// Only what coverageAt reads: the sensors it counts, and for a radio detector the bands your own jamming deafens it on now, which
// changes whenever a jammer in reach of it is switched.
const counted = (n) => n.def.role === 'sensor' && n.def.id !== 'perimeter';
const nodeKey = (n, nodes) => `${n.nodeId}:${placed(n, n.pos.x)}:${placed(n, n.pos.z)}:${n.def.range}:${n.def.mount}:${n.def.fov}:${covers(n)}${n.def.kind === 'rf' ? `:${[...deafAt(n, nodes)].sort()}` : ''}`;

// What is kept for a drone type until something its answer depends on changes: the grid's cells, each area's share, and the counts
// once the plan map asks for them.
function kept(sim, threat) {
  // everything the answer depends on: node ids repeat after a reload, so they cannot tell two laydowns apart
  const nodes = [...sim.net.nodes.values()];
  const key = [threat, sim.state.terrainSeed, JSON.stringify(exportFigures()), ...nodes.filter(counted).map((n) => nodeKey(n, nodes))].join('|');
  if (!caches.has(sim)) caches.set(sim, new Map());
  const cache = caches.get(sim);
  if (cache.get(threat)?.key !== key) {
    const half = terrainState.data.R - 200;
    cache.set(threat, { key, n: Math.round((2 * half) / CELL), cell: CELL, half, rows: 0, shares: new Map() });
  }
  return cache.get(threat);
}

// For each cell, how many sensors would see a drone of this type there (it flies at that type's usual height). With a budget in
// milliseconds it stops once that is spent and carries on at the next call: the grid's first `rows` rows of `n` are worked out.
export function coverageGrid(sim, threat, budgetMs = Infinity) {
  const g = kept(sim, threat), { n, cell, half } = g;
  g.counts ??= new Uint8Array(n * n);
  if (g.rows === n) return g;
  const def = DRONES[threat], agl = typicalAltitude(def), until = performance.now() + budgetMs;
  while (g.rows < n) { // a whole row each time, so even a budget of nothing gets there
    const j = g.rows;
    for (let i = 0; i < n; i++) g.counts[j * n + i] = sim.net.coverageAt(-half + (i + 0.5) * cell, -half + (j + 0.5) * cell, agl, def);
    g.rows++;
    if (performance.now() >= until) break;
  }
  return g;
}

// The share of the zone at least one sensor can see (0 to 1). With no zone drawn, it scores everything inside the build limit.
export function zoneShare(sim, threat, zone) {
  const g = kept(sim, threat);
  // panels ask on every refresh, and the scan tests every cell against the outline, so it is kept with the grid it was made from
  const area = zone && zone.closed ? JSON.stringify(zone.points) : `within ${BUILD.maxDist}`;
  if (!g.shares.has(area)) g.shares.set(area, scanShare(sim, g, DRONES[threat], zone));
  return g.shares.get(area);
}

// Only the cells inside are worked out, at the grid's own cell centres: the whole grid is 45,000 cells and took seconds.
function scanShare(sim, g, def, zone) {
  const mpu = WORLD.metresPerUnit, agl = typicalAltitude(def);
  const inside = zone && zone.closed ? (xm, zm) => inZone(zone.points, xm / mpu, zm / mpu) : (xm, zm) => Math.hypot(xm, zm) <= BUILD.maxDist;
  let cells = 0, seen = 0;
  for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) {
    const xm = -g.half + (i + 0.5) * g.cell, zm = -g.half + (j + 0.5) * g.cell;
    if (!inside(xm, zm)) continue;
    cells++;
    if ((j < g.rows ? g.counts[j * g.n + i] : sim.net.coverageAt(xm, zm, agl, def)) > 0) seen++; // only a finished row's counts are read
  }
  return cells ? seen / cells : 0;
}

// Each of the four types, with its height and how much of the zone is seen, with the weakest first.
export function zoneScores(sim, zone) {
  return DRONE_CLASSES
    .map((def) => ({ id: def.id, name: def.name, height: Math.round(typicalAltitude(def)), share: zoneShare(sim, def.id, zone) }))
    .sort((a, b) => a.share - b.share);
}
