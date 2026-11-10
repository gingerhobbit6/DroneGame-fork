import { beforeAll, describe, expect, it } from 'vitest';
import { createSimulation } from '../src/sim/simulation.js';
import { MIXED, GNSS_RING, SCENARIOS, runReferences, setUp, play } from './support/scenarios.js';
import want from './support/reference-digests.json';

describe('reference runs', () => {
  let sim;
  beforeAll(() => { sim = createSimulation(); });
  it.each(SCENARIOS)('reproduces the recorded digest for $name exactly', (scenario) => {
    expect(runReferences(sim, [scenario])).toEqual({ [scenario.name]: want[scenario.name] });
  }, 240000);
});

describe('regressions', () => {
  it('a run does not depend on build time or placement order', () => {
    const sim = createSimulation();
    const digests = [[0, MIXED], [1, MIXED], [137, MIXED], [0, [...MIXED].reverse()]].map(([idle, laydown]) => {
      setUp(sim, { seed: '1', laydown });
      sim.run(idle);
      play(sim, 3);
      return sim.digest();
    });
    expect(new Set(digests).size).toBe(1);
  }, 60000);

  it('a reset restores systems the enemy destroyed', () => {
    const sim = createSimulation();
    setUp(sim, { seed: '1', laydown: [['radar', 400, 0], ['laser', 430, 133], ['laser', -420, 146], ['laser', -267, -362]] });
    play(sim, 30);
    expect(Object.values(sim.ledger.lost).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    sim.commands.reset('keep');
    expect(sim.structures.length).toBe(4);
  }, 60000);

  it.each(['1', '7', '42'])('a drone that drifts away is removed (seed %s)', (seed) => {
    const sim = createSimulation();
    setUp(sim, { seed, laydown: GNSS_RING, gnss: true });
    sim.state.sandbox = true;
    for (let i = 0; i < 60; i++) sim.spawnDrone('fw', (i / 60) * Math.PI * 2);
    for (let n = 0; n < 50000 && sim.drones.length; n += 500) sim.run(500); // from the map edge, up to 38 km out; one that drifts can circle a while
    expect(sim.drones.length).toBe(0);
  }, 60000);
});
