// The rules play on grids, wherever those grids came from.

import { describe, expect, it } from 'vitest';
import { createSimulation } from '../src/sim/simulation.js';
import { generateTerrain, terrainState } from '../src/sim/terrain.js';
import { makeWorld, pickMasts, rasterBox } from '../src/sim/world.js';
import { hereU } from '../src/sim/units.js';
import { mulberry32 } from '../src/sim/rng.js';
import { COMMS, STRUCTURES, TERRAIN, WORLD } from '../src/sim/config/index.js';
import { MIXED, setUp } from './support/scenarios.js';

const u = (m) => m / 20;

describe('a world from any source', () => {
  const emptyGrids = (N, cell, R) => ({ N, cell, R, ground: new Float32Array(N * N), canopy: new Uint8Array(N * N), bldg: new Uint8Array(N * N), cover: new Uint8Array(N * N) });
  const features = { seed: 'hand-made', buildings: [], lines: [], towers: [], station: [] };

  it('lets a system stand between houses on a real map, but not on one', () => {
    const grids = emptyGrids(11, 20, 100);
    const houses = [{ x: -8, z: 0, w: 10, d: 10, h: 8, angle: 0 }, { x: 40, z: 40, w: 20, d: 4, h: 8, angle: Math.PI / 2 }];
    grids.bldg.fill(8); // every cell is marked, as cells touching a house are
    const w = makeWorld({ ...grids, ...features, buildings: houses, geo: {} });
    expect(w.onBuilding(-8, 0)).toBe(true);
    expect(w.onBuilding(-2.5, 0)).toBe(true); // within a metre of the wall
    expect(w.onBuilding(5, 0)).toBe(false); // the gap, in a marked cell
    expect(w.onBuilding(40, 48)).toBe(true); // along a turned house
    expect(w.onBuilding(48, 40)).toBe(false); // beside it
    expect(makeWorld({ ...grids, ...features, buildings: houses }).onBuilding(5, 0)).toBe(true); // generated ground only has the grid
    expect(makeWorld({ ...grids, ...features, geo: {} }).onBuilding(5, 0)).toBe(true); // a map with no outlines
    grids.bldg.fill(0);
    expect(w.onBuilding(-8, 0)).toBe(false); // an unmarked cell stays free, so no laydown that worked before can stop working
  });

  it('answers the rules from its grids', () => {
    const grids = emptyGrids(11, 20, 100); // posts from -100 to 100 m
    const post = (x, z) => ((z + 100) / 20) * 11 + (x + 100) / 20;
    for (let x = -100; x <= 100; x += 20) grids.ground[post(x, -40)] = 50; // a ridge to the north
    grids.bldg[post(40, 0)] = 30; grids.cover[post(40, 0)] = 2;
    grids.canopy[post(-40, 0)] = 15; grids.cover[post(-40, 0)] = 1;
    const w = makeWorld({ ...grids, ...features });
    expect(w.groundAt(0, -40)).toBe(50);
    expect(w.groundAt(0, -30)).toBe(25);
    expect(w.los(0, 10, 0, 0, 10, -100)).toMatchObject({ clear: false, blocker: 'terrain' });
    expect(w.los(0, 10, 0, 100, 10, 0)).toMatchObject({ clear: false, blocker: 'building' });
    expect(w.los(0, 10, 0, -100, 10, 0, 0).canopy).toBeGreaterThan(0);
    expect([w.coverAt(40, 0), w.bldgAt(40, 0), w.canopyAt(-40, 0)]).toEqual([2, 30, 15]);
    expect(w.slope(0, -20)).toBeGreaterThan(0.4);
    expect(w.slope(0, 40)).toBe(0);
  });

  it('marks a building on the grids, clearing trees and staying inside them', () => {
    const grids = emptyGrids(11, 20, 100);
    grids.canopy.fill(15);
    rasterBox(grids, { x: 100, z: 100, w: 30, d: 30, h: 300 });
    expect(grids.bldg[120]).toBe(255); // the far corner, and the height is capped
    expect(grids.canopy[120]).toBe(0);
    expect(grids.cover[120]).toBe(2);
    expect(grids.bldg[0]).toBe(0);
    expect(grids.bldg.length).toBe(121);
  });

  it('picks masts repeatably, on the highest ground above the floor, spread out', () => {
    const grids = emptyGrids(701, 20, 7000);
    for (let k = 0; k < grids.ground.length; k++) grids.ground[k] = (k % 701) * 0.5 - 100; // rising to the east
    const masts = pickMasts(grids, mulberry32(1), 0);
    expect(masts.length).toBeGreaterThan(0);
    expect(masts.length).toBeLessThanOrEqual(COMMS.towers);
    expect(pickMasts(grids, mulberry32(1), 0)).toEqual(masts);
    for (const m of masts) expect(m.ground).toBeGreaterThan(0);
    for (let i = 1; i < masts.length; i++) {
      expect(masts[i].ground).toBeLessThanOrEqual(masts[i - 1].ground);
      expect(Math.hypot(masts[i].x - masts[0].x, masts[i].z - masts[0].z)).toBeGreaterThan(3000);
    }
    expect(pickMasts(grids, mulberry32(1), 1e6)).toEqual([]);
  });

  // no station, heights relative to the site, a ridge to the north, and a cliff down to sea to the east
  function handMadeWorld() {
    const N = 2 * WORLD.radius / 20 + 1; // as big as a real world, so drones start on it
    const grids = emptyGrids(N, 20, WORLD.radius);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -WORLD.radius + i * 20, z = -WORLD.radius + j * 20, k = j * N + i;
      let h = -0.004 * z + 25 * Math.sin(x / 700) * Math.sin(z / 900);
      if (z < -3000) h += Math.min(330, (-z - 3000) * 0.3);
      if (x > 1700 && x < 2000) h += (2000 - x) * 0.9;
      if (x >= 2000) { h = -43.7; grids.cover[k] = 4; }
      grids.ground[k] = Math.round(h * 10) / 10;
      if (x > 800 && x < 1600 && z > -1500 && z < -500) { grids.canopy[k] = 18; grids.cover[k] = 1; }
    }
    rasterBox(grids, { x: -1650, z: 650, w: 300, d: 300, h: 8 });
    return makeWorld({ ...grids, ...features, towers: pickMasts(grids, mulberry32(1), -40) });
  }

  it('plays a whole game, repeatably, with drones above the ground over cliffs and sea', () => {
    const play = () => {
      const sim = createSimulation({ seed: '1', terrainSeed: 'unused' });
      terrainState.data = handMadeWorld();
      sim.state.started = true;
      expect(sim.canPlace(u(2200), 0, STRUCTURES.rf)).toBe(false); // sea
      expect(sim.canPlace(u(1850), 0, STRUCTURES.rf)).toBe(false); // cliff
      expect(sim.canPlace(u(-1650), u(650), STRUCTURES.rf)).toBe(false); // village
      expect(sim.canPlace(u(0), u(1000), STRUCTURES.rf)).toBe(true);
      setUp(sim, { seed: '1', laydown: MIXED });
      sim.state.warnedWire = true;
      let lowest = Infinity;
      for (let wave = 0; wave < 3 && !sim.state.over; wave++) {
        sim.commands.startWave();
        for (let n = 0; sim.state.waveActive && !sim.state.over && n < 60000; n += 20) {
          sim.run(20);
          for (const d of sim.drones) lowest = Math.min(lowest, d.pos.y - hereU(d.pos.x, d.pos.z));
        }
      }
      return { digest: sim.digest(), kills: sim.state.kills, wave: sim.state.wave, lowest };
    };
    const first = play();
    expect(first.wave).toBe(3);
    expect(first.kills).toBeGreaterThan(0);
    expect(first.lowest).toBeGreaterThan(0);
    expect(play()).toEqual(first);
  }, 120000);
});

describe('generated ground', () => {
  it('is made once for a seed and kept, and made afresh for another seed or other figures', () => {
    const a = generateTerrain('cache-a');
    expect(generateTerrain('cache-a')).toBe(a);
    const b = generateTerrain('cache-b');
    expect(b).not.toBe(a);
    const relief = TERRAIN.relief;
    TERRAIN.relief = relief + 1;
    try { expect(generateTerrain('cache-b')).not.toBe(b); } finally { TERRAIN.relief = relief; }
  }, 60000);
});
