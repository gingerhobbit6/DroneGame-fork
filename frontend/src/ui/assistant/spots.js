// Where the wizard suggests a system goes. It tries spots across the build zone and asks the simulation's own checks what each
// would see or reach in the player's zone, so the advice cannot disagree with the game. It reads the terrain and the laydown, as
// the plan map does, and never the wave queue or where drones really are. Nothing here draws a random number or changes the run.

import { BUILD, DRONE_CLASSES, WORLD } from '../../sim/config/index.js';
import { opticalLos } from '../../sim/effectors.js';
import { reachFor } from '../../sim/network/sensors.js';
import { typicalAltitude } from '../../sim/site-range.js';
import { terrainState } from '../../sim/terrain.js';
import { hereU } from '../../sim/units.js';
import { inZone } from '../../zone.js';
import { zoneCentre } from '../../sim/attack-area.js';
import { standingAt } from '../../sim/sensor-model.js';
import { answer, COUNTS } from './guide.js';

const OUTSIDE_WEIGHT = 0.5, OUTSIDE_POINTS = 16, OUTSIDE_MARGIN = 1000; // a look past the edge of the zone, for early warning
const RING_STEP = 300, RING_POINTS = 12, FINE_STEP = 150;
const SEEN = 0.5; // a sensor counts as seeing a spot at this chance per scan, as the coverage map does
const ALL_COVERED = 95; // percent

// What to judge a spot on: a grid over the zone, or over the build zone if none is drawn, plus points just beyond its edge.
function samplePoints(zone) {
  const mpu = WORLD.metresPerUnit, data = terrainState.data;
  const closed = zone && zone.closed;
  const corners = closed ? zone.points.map(([x, z]) => [x * mpu, z * mpu]) : [[-BUILD.maxDist, -BUILD.maxDist], [BUILD.maxDist, BUILD.maxDist]];
  const xs = corners.map((c) => c[0]), zs = corners.map((c) => c[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const inside = closed ? (x, z) => inZone(zone.points, x / mpu, z / mpu) : (x, z) => Math.hypot(x, z) <= BUILD.maxDist;
  const cell = Math.min(Math.max(Math.sqrt((x1 - x0) * (z1 - z0)) / 10, 100), 500);
  const points = [];
  for (let x = x0 + cell / 2; x < x1; x += cell) for (let z = z0 + cell / 2; z < z1; z += cell) if (inside(x, z)) points.push({ x, z, weight: 1, inside: true });
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (!points.length) points.push({ x: cx, z: cz, weight: 1, inside: true }); // a thin zone can fall between the grid lines
  const r = Math.hypot(x1 - x0, z1 - z0) / 2 + OUTSIDE_MARGIN;
  for (let i = 0; i < OUTSIDE_POINTS; i++) {
    const a = (i / OUTSIDE_POINTS) * 2 * Math.PI, x = cx + r * Math.cos(a), z = cz + r * Math.sin(a);
    if (Math.hypot(x, z) < data.R - 200) points.push({ x, z, weight: OUTSIDE_WEIGHT, inside: false });
  }
  return points;
}

// The drones this system is for. A missile kept for fixed-wing tracks is not judged on quadcopters, for example.
function threatsFor(def) {
  const all = DRONE_CLASSES;
  const fits = def.role === 'sensor' ? all.filter((d) => reachFor(def, d) > 0) : all.filter((d) => COUNTS.has(answer(d, def)));
  return fits.length ? fits : all;
}

// A drone of this type over a point, at its usual height.
function probeAt(point, drone) {
  const mpu = WORLD.metresPerUnit, agl = typicalAltitude(drone);
  return { pos: { x: point.x / mpu, y: (terrainState.data.groundAt(point.x, point.z) + agl) / mpu, z: point.z / mpu }, def: drone };
}

// Would a system at s see this probe (a sensor) or be able to engage it (an effector)?
function covers(net, s, probe) {
  if (s.def.role === 'sensor') return net.pd(s, probe, { pointing: false }) >= SEEN;
  if (!COUNTS.has(answer(probe.def, s.def))) return false;
  const mpu = WORLD.metresPerUnit, dist = Math.hypot(s.pos.x - probe.pos.x, s.pos.y - probe.pos.y, s.pos.z - probe.pos.z) * mpu;
  return dist <= s.def.range && opticalLos(s, probe);
}

// What one more look at a point is worth. The first look counts most and a different kind of system is worth more than another
// of the same. A camera is the exception: it has to be cued, so it is worth most where another sensor can already see.
function worth(def, { total, same }) {
  if (def.kind === 'camera') return same ? 0.1 : total ? 1 : 0.2;
  if (!total) return 1;
  return same ? 0.1 : 0.5;
}

const percent = (share) => Math.round(share * 100);

function reasonFor(def, drone, area, seenBefore, seenAfter) {
  const before = percent(seenBefore), after = percent(seenAfter);
  if (def.kind === 'camera') {
    return after ? `Looks over about ${after}% of ${area} where another sensor can cue it.` : 'No other sensor can cue it here yet, so place a radar first if you can.';
  }
  if (after > before) return `${def.role === 'sensor' ? 'Sees' : 'Reaches'} about ${after}% of ${area} against ${drone.name}, up from ${before}%.`;
  if (!after) return `It cannot cover ${area} against ${drone.name} from here, and nowhere it can go does better.`;
  if (before >= ALL_COVERED) return `${area[0].toUpperCase()}${area.slice(1)} is already covered against ${drone.name}, so this adds a second layer away from your other systems.`;
  return `It adds a second layer, but no new cover against ${drone.name}: about ${before}% of ${area} is still all you have.`;
}

// The best spot for this system, as { x, z, why } in scene units, or null if nowhere will take it.
export function suggestSpot(sim, def, zone = null) {
  const { net } = sim, mpu = WORLD.metresPerUnit;
  const points = samplePoints(zone);
  const ours = sim.structures.filter((s) => s.def.role === def.role);
  const insideCount = points.filter((p) => p.inside).length;
  const drawn = zone && zone.closed; // the search starts from the area, wherever it is on the map
  const { x: cx0, z: cz0 } = drawn ? zoneCentre(zone.points) : { x: 0, z: 0 };

  // What each drone type can do today: how many of our systems cover each point.
  const rows = threatsFor(def).map((drone) => {
    const probes = points.map((p) => probeAt(p, drone));
    const looks = probes.map((probe) => {
      const on = ours.filter((s) => covers(net, s, probe));
      return { total: on.length, same: on.filter((s) => s.def.kind === def.kind).length };
    });
    return { drone, probes, looks, seen: looks.filter((l, i) => l.total > 0 && points[i].inside).length };
  }).sort((a, b) => a.seen - b.seen || a.drone.alt[0] - b.drone.alt[0]); // when equally covered, low flyers are the harder to see
  const judged = rows.slice(0, 2); // the weakest two: the first counts most, and it is the one the reason talks about
  const total = points.reduce((sum, p) => sum + p.weight, 0);

  const placed = (x, z) => ({ def: standingAt(def, sim.state.zoneCentre, { x, z }), pos: { x, y: hereU(x, z), z } }); // facing as it would once placed

  function score(x, z) {
    const s = placed(x, z);
    let value = 0;
    judged.forEach(({ probes, looks }, t) => {
      probes.forEach((probe, i) => { if (covers(net, s, probe)) value += (t ? 0.5 : 1) * points[i].weight * worth(def, looks[i]); });
    });
    // Between spots that do as well, keep effectors closer in and everything away from what is already there.
    const nearest = Math.min(1000, ...sim.structures.map((o) => Math.hypot(o.pos.x - x, o.pos.z - z) * mpu));
    const closer = def.role === 'effector' ? 1 - Math.hypot(x - cx0, z - cz0) * mpu / BUILD.maxDist : 0;
    return value / total + 0.02 * closer + 0.02 * (nearest / 1000);
  }

  let best = null, bestScore = -Infinity;
  const consider = (x, z) => {
    if (!sim.canPlace(x, z, def)) return;
    const value = score(x, z);
    if (value > bestScore) { bestScore = value; best = { x, z }; }
  };
  let ring = 0;
  for (let r = drawn ? 50 : BUILD.minDist + 50; r <= BUILD.maxDist; r += RING_STEP, ring++) {
    for (let a = 0; a < RING_POINTS; a++) {
      const angle = ((a + (ring % 2) / 2) / RING_POINTS) * 2 * Math.PI; // alternate rings are staggered
      consider(cx0 + (r * Math.cos(angle)) / mpu, cz0 + (r * Math.sin(angle)) / mpu);
    }
  }
  if (!best) return null;
  const { x: cx, z: cz } = best;
  for (let a = 0; a < 8; a++) consider(cx + (FINE_STEP * Math.cos((a / 8) * 2 * Math.PI)) / mpu, cz + (FINE_STEP * Math.sin((a / 8) * 2 * Math.PI)) / mpu);

  const weakest = judged[0], s = placed(best.x, best.z);
  const here = weakest.probes.map((probe) => covers(net, s, probe));
  // A camera's reason counts only what it can be cued onto. Anything else counts all it would add to what is already covered.
  const after = points.filter((p, i) => p.inside && (def.kind === 'camera' ? here[i] && weakest.looks[i].total > 0 : here[i] || weakest.looks[i].total > 0)).length;
  const area = zone && zone.closed ? 'your zone' : 'the build area';
  return { ...best, why: reasonFor(def, weakest.drone, area, weakest.seen / insideCount, after / insideCount) };
}
