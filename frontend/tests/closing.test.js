// The fusion node judges a track by how fast it closes on the site, not by its speed: a drone flying away is left alone.

import { beforeEach, describe, expect, it } from 'vitest';
import { resetAllFigures } from '../src/sim/config/index.js';
import { createSimulation } from '../src/sim/simulation.js';
import { hereU, u } from '../src/sim/units.js';
import { setUp } from './support/scenarios.js';

let sim;
beforeEach(() => {
  resetAllFigures();
  sim = createSimulation({ seed: '1', terrainSeed: '1' });
  setUp(sim, { seed: '1', laydown: [['radar', 600, 0], ['interceptor', 490, 99]] }); // where the mixed laydown has them, wired
  sim.state.sandbox = true; sim.state.budget = 1e9;
});

// A fixed-wing strike drone 2 km north of the station, 200 m up, flying in or (turned for home) away.
function shahed(home) {
  const d = sim.spawnDrone('fw', 0, { jitter: 0, altFrac: 0.5 }), z = -u(2000);
  d.pos.set(0, hereU(0, z) + u(200), z);
  if (home) d.mode = 'home';
  return d;
}
const interceptorShots = () => sim.ledger.shots.interceptor?.n ?? 0;

describe('a track flying away', () => {
  it('is seen leaving and given no rounds', () => {
    shahed(true);
    sim.run(600);
    const tracks = [...sim.net.tracks.values()].filter((tr) => tr.status === 'confirmed');
    expect(tracks.length).toBe(1);
    expect(tracks[0].closing).toBeLessThan(-30);
    expect(interceptorShots()).toBe(0);
  }, 60000);

  it('where the same drone flying in is engaged', () => {
    shahed(false);
    let fastest = -Infinity;
    for (let i = 0; i < 600; i++) { sim.step(); for (const tr of sim.net.tracks.values()) fastest = Math.max(fastest, tr.closing ?? -Infinity); }
    expect(fastest).toBeGreaterThan(30);
    expect(interceptorShots()).toBeGreaterThan(0);
  }, 60000);
});
