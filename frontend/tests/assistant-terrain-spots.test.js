// Each terrain is a separate integration case. Build it in a setup hook, leaving the normal timeout for the placement assertions.

import { beforeEach, describe, expect, it } from 'vitest';
import { STRUCTURES, WORLD, resetAllFigures } from '../src/sim/config/index.js';
import { createSimulation } from '../src/sim/simulation.js';
import { suggestSpot } from '../src/ui/assistant/spots.js';
import { zoneShare } from '../src/ui/coverage.js';

const TERRAINS = ['1', '7', '42'];
const LAYDOWN = ['radar', 'rf', 'camera', 'jammer', 'interceptor', 'missile', 'laser', 'rf', 'jammer', 'interceptor'];
const metres = (spot) => Math.hypot(spot.x, spot.z) * WORLD.metresPerUnit;

describe.each(TERRAINS)('placement on terrain %s', (terrain) => {
  let sim;
  beforeEach(() => {
    resetAllFigures();
    sim = createSimulation({ seed: '1', terrainSeed: terrain });
    sim.commands.deploy('1', terrain);
  });
  const placeBest = (id) => {
    const spot = suggestSpot(sim, STRUCTURES[id], null);
    expect(sim.commands.place(id, spot.x, spot.z)).toBeNull();
    return spot;
  };

  it('adds what each new sensor can see', () => {
    placeBest('radar');
    const first = zoneShare(sim, 'fpv', null);
    expect(first).toBeGreaterThan(0.5);
    placeBest('rf');
    expect(zoneShare(sim, 'fpv', null)).toBeGreaterThanOrEqual(first);
  });

  it('keeps long-reach weapons close in when that covers the zone', () => {
    for (const id of ['interceptor', 'missile']) expect(metres(placeBest(id))).toBeLessThan(1500);
  });

  it('does not bunch up', () => {
    for (const id of LAYDOWN) placeBest(id);
    const { structures: all } = sim;
    for (const a of all) {
      const nearest = Math.min(...all.filter((b) => b !== a).map((b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)));
      expect(nearest * WORLD.metresPerUnit).toBeGreaterThanOrEqual(150); // one step of the search grid
    }
  });
});
