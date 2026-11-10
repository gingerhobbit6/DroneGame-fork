// Strikes without a fix keep flying around the patrol corridor, even if they reach its exact middle.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PATROL, WORLD } from '../src/sim/config/index.js';
import { createSimulation, SIM_STEP } from '../src/sim/simulation.js';
import { pickTarget } from '../src/sim/targeting.js';
import { u } from '../src/sim/units.js';
import { setUp } from './support/scenarios.js';

const ROUTE = [[10, 10], [30, 10], [30, 30]];
let sim;
const radius = WORLD.radius;
beforeAll(() => { WORLD.radius = 3000; sim = createSimulation(); }); // the whole hold-point trajectory is within 1 km
afterAll(() => { WORLD.radius = radius; });
beforeEach(() => { setUp(sim, { seed: '1', laydown: [] }); });

function strikeAt(dx, dz, heading = 0) {
  expect(sim.commands.setPatrol(ROUTE, [{ vehicle: 'hilux', system: 'rf', gap: 0 }])).toBeNull();
  const d = sim.spawnDrone('fw', 0);
  const centre = pickTarget({ patrol: sim.getPatrol(), state: sim.state, structures: sim.structures }, d);
  expect(centre.hold).toBe(true);
  d.pos.set(centre.x + dx, d.pos.y, centre.z + dz);
  d.heading = heading;
  return { d, centre };
}

describe('waiting for a patrol fix', () => {
  it.each([0, Math.PI / 2])('keeps a strike at the exact hold point flying with heading %s', (heading) => {
    const { d, centre } = strikeAt(0, 0, heading);
    sim.step();
    expect(sim.drones).toContain(d);
    expect([...d.pos, ...d.vel, d.heading].every(Number.isFinite)).toBe(true);
    const travelled = Math.hypot(d.pos.x - centre.x, d.pos.z - centre.z);
    expect(travelled).toBeCloseTo(u(d.def.speed) * SIM_STEP);
  });

  it('circles inside the hold radius and flies inward outside it', () => {
    const { d, centre } = strikeAt(u(10), 0);
    sim.step();
    expect(d.pos.x).toBe(centre.x + u(10));
    expect(d.pos.z).toBeCloseTo(centre.z - u(d.def.speed) * SIM_STEP);
    d.pos.x = centre.x + u(PATROL.enemy.holdRadius + 100); d.pos.z = centre.z;
    sim.step();
    expect(d.pos.x).toBeCloseTo(centre.x + u(PATROL.enemy.holdRadius + 100) - u(d.def.speed) * SIM_STEP);
    expect(d.pos.z).toBe(centre.z);
  });

  it('keeps the same finite, bounded trajectory when the run is repeated', () => {
    const fly = () => {
      const { d, centre } = strikeAt(0, 0);
      const positions = [];
      for (let n = 0; n < 200; n++) {
        sim.step();
        expect([...d.pos, ...d.vel, d.heading].every(Number.isFinite)).toBe(true);
        expect(Math.hypot(d.pos.x - centre.x, d.pos.z - centre.z)).toBeLessThan(u(PATROL.enemy.holdRadius));
        positions.push(d.pos.toArray());
      }
      return positions;
    };
    const first = fly();
    setUp(sim, { seed: '1', laydown: [] });
    expect(fly()).toEqual(first);
  });
});
