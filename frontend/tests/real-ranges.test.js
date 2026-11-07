// The researched ranges, the UK systems, and the radio path a jammer needs.

import { afterEach, describe, expect, it } from 'vitest';
import { DRONES, STRUCTURES, TOOLBAR, resetAllFigures } from '../src/sim/config/index.js';
import { jamReaches } from '../src/sim/jamming.js';
import { reachFor } from '../src/sim/network/sensors.js';
import { terrainState } from '../src/sim/terrain.js';
import { u } from '../src/sim/units.js';
import { makeWorld } from '../src/sim/world.js';
import { UNIT_FIELDS, setSetting, unitCost, unitDef } from '../src/sim/unit-config.js';

const UK = ['radar_a400', 'radar_giraffe', 'jammer_auds', 'jammer_neo', 'jammer_jupiter', 'missile_rr', 'missile_hvm', 'missile_paladin', 'missile_skysabre', 'laser_rfdew'];
const EU = ['rf_airfence', 'jammer_sf'];
const realTerrain = terrainState.data;
afterEach(() => { terrainState.data = realTerrain; resetAllFigures(); });

describe('the researched ranges', () => {
  it('scales radar reach as the A400 datasheet does', () => {
    const a400 = STRUCTURES.radar_a400;
    for (const [rcs, km] of [[0.1, 4.87], [1, 8.66], [10, 15.4]]) {
      expect(reachFor(a400, { rcs }) / 1000).toBeCloseTo(km, 0);
    }
  });

  it('puts fixed RF sensors and RF effectors on a 9 m mast, and carried ones lower', () => {
    const rf = Object.values(STRUCTURES).filter((d) => d.kind === 'rf' || d.kind === 'jammer' || d.id === 'laser_rfdew');
    expect(rf.length).toBeGreaterThan(7);
    for (const d of rf) expect(d.mount, d.id).toBe({ manpack: 1.5, vehicle: 3 }[d.mobile] ?? 9);
    expect(STRUCTURES.jammer.mobile).toBe('manpack'); // the DroneGun is handheld
    expect(STRUCTURES.jammer_jupiter.mobile).toBe('vehicle');
  });

  it('lets a large RF detector hear further than the map, but never a silent drone', () => {
    expect(STRUCTURES.rf_l.range).toBe(14000);
    expect(reachFor(STRUCTURES.rf_l, DRONES.fw)).toBe(0);
  });
});

describe('the UK and European systems', () => {
  it('can all be bought from the toolbar, with a source or a stated assumption', () => {
    const offered = TOOLBAR.flatMap((g) => g.classes);
    for (const id of [...UK, ...EU]) {
      expect(offered).toContain(id);
      expect(STRUCTURES[id].product).toBeTruthy();
      expect(STRUCTURES[id].ref.confidence).toBeTruthy();
      expect(STRUCTURES[id].ref.cost.capex).toBeTruthy();
    }
  });

  it('fits the budget, even for Sky Sabre', () => {
    for (const id of [...UK, ...EU]) expect(STRUCTURES[id].cost).toBeLessThan(15000000);
  });

  it('sets a jammer with no published range by its power, reach going with the square root', () => {
    expect(STRUCTURES.jammer_sf.range / STRUCTURES.jammer_neo.range).toBeCloseTo(Math.sqrt(800 / 45), 0); // 800 W against 45 W
    expect(STRUCTURES.jammer_neo.range / STRUCTURES.jammer.range).toBeCloseTo(Math.sqrt(45 / 40), 1); // the DroneGun Tactical stands for 40 W
    expect(STRUCTURES.jammer_jupiter.range / STRUCTURES.jammer.range).toBeCloseTo(Math.sqrt(600 / 40), 1); // up to 600 W
  });

  it('gives K-CEMA its own receiver as standard, refunded if it is taken off', () => {
    const field = UNIT_FIELDS.find((f) => f.key === 'receiver'), off = {};
    expect(unitDef('jammer_neo').library).toBe('full');
    setSetting(off, field, 'jammer_neo', 'off');
    expect(unitDef('jammer_neo', off).library).toBeUndefined();
    expect(STRUCTURES.jammer_neo.cost - unitCost('jammer_neo', off)).toBe(unitCost('jammer', { receiver: 'full' }) - STRUCTURES.jammer.cost);
    expect(unitDef('jammer').library).toBeUndefined(); // the others still come without one
  });
});

describe('a jammer needs a radio path', () => {
  const at = (x, y = 0) => ({ x, y, z: 0, distanceTo(o) { return Math.hypot(x - o.x, y - o.y, o.z); } });
  const jammer = { def: { ...STRUCTURES.jammer, mount: 9 }, pos: at(0) }; // 1 km in an open field, on a 9 m mast
  const drone = (m, agl = 60) => ({ def: DRONES.fpv, pos: at(u(m), u(agl)) });
  // Flat ground, with a bank of ground or trees running north to south from 200 m east.
  function ground({ ridge = 0, trees = 0 } = {}) {
    const R = 2000, cell = 20, N = Math.round((2 * R) / cell) + 1, heights = new Float32Array(N * N), canopy = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -R + i * cell;
      if (x >= 200 && x <= 300) heights[j * N + i] = ridge;
      if (x >= 200 && x <= 500) canopy[j * N + i] = trees;
    }
    terrainState.data = makeWorld({ seed: 't', N, cell, R, ground: heights, canopy, bldg: new Uint8Array(N * N), cover: new Uint8Array(N * N), buildings: [], lines: [], towers: [], station: [] });
  }

  it('reaches its open-field range with a clear path, and no further', () => {
    ground();
    expect(jamReaches(jammer, drone(900), 'control24')).toBe(true);
    expect(jamReaches(jammer, drone(1100), 'control24')).toBe(false);
  });

  it('is cut short by a hill', () => {
    ground({ ridge: 150 });
    expect(jamReaches(jammer, drone(900, 20), 'control24')).toBe(false);
  });

  it('is cut short by trees when the drone flies low behind them', () => {
    ground({ trees: 20 });
    expect(jamReaches(jammer, drone(900, 60), 'control24')).toBe(true);
    expect(jamReaches(jammer, drone(900, 10), 'control24')).toBe(false);
    expect(jamReaches({ ...jammer, def: STRUCTURES.jammer }, drone(900, 60), 'control24')).toBe(false); // held at 1.5 m, the trees stop it
  });

  it('works out each band on its own, and a lower band gets through trees that stop a higher one', () => {
    ground({ trees: 20 });
    const furthest = (band) => Math.max(0, ...Array.from({ length: 20 }, (_, i) => 50 * (i + 1)).filter((r) => jamReaches(jammer, drone(r, 25), band)));
    expect(furthest('video58')).toBeGreaterThan(0);
    expect(furthest('control900')).toBeGreaterThan(furthest('video58'));
  });
});
