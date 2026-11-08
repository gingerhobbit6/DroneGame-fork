// The area the player draws is what the enemy attacks: strike drones aim inside it and spotters circle it.

import { afterEach, describe, expect, it } from 'vitest';
import { createGame } from '../src/game.js';
import { DRONES, resetAllFigures } from '../src/sim/config/index.js';
import { aimInZone, cleanZone, distToZone, inZone, zoneCentre } from '../src/sim/attack-area.js';
import { createSimulation } from '../src/sim/simulation.js';
import { hdist, u } from '../src/sim/units.js';
import { MIXED, play, setUp } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

const AREA = [[100, -60], [200, -60], [200, 40], [100, 40]]; // scene units: 2 to 4 km east of the station
const STRIKER = Object.values(DRONES).find((d) => d.role !== 'spotter' && !d.seeksEmitters).id;
const SPOTTER = Object.values(DRONES).find((d) => d.role === 'spotter').id;

const fresh = (laydown = []) => { const sim = createSimulation(); setUp(sim, { seed: '1', laydown }); return sim; };
afterEach(() => resetAllFigures());

describe('the outline', () => {
  it('finds spots inside it, whatever shape it is', () => {
    const notch = [[0, 0], [100, 0], [100, 100], [50, 10], [0, 100]];
    let i = 0;
    const rng = () => [0.51, 0.9, 0.2, 0.05][i++ % 4];
    for (let n = 0; n < 20; n++) { const { x, z } = aimInZone(notch, rng); expect(inZone(notch, x, z)).toBe(true); }
  });
  it('falls back to the centre of an outline with no area', () => {
    const line = [[0, 0], [10, 0], [20, 0]];
    expect(aimInZone(line, () => 0.5)).toEqual({ ...zoneCentre(line), structure: null });
  });
  it('treats anything that is not an outline as no area', () => {
    for (const bad of [null, undefined, 'x', [], [[0, 0], [1, 1]], [[0, 0], [1, 1], [2]], [[0, 0], [1, 1], ['2', 3]], [[0, 0], [1, 1], [NaN, 3]]]) expect(cleanZone(bad)).toBeNull();
    expect(cleanZone(AREA)).toBe(AREA);
  });
});

describe('the attack', () => {
  it('goes for the station when no area is drawn', () => {
    const sim = fresh();
    expect(sim.spawnDrone(STRIKER, 0).aim).toBeNull();
  });
  it('lands inside the area, and costs site integrity', () => {
    const sim = fresh();
    sim.commands.setZone(AREA);
    const drones = [0, 2, 4].map((bearing) => sim.spawnDrone(STRIKER, bearing));
    for (const d of drones) expect(inZone(AREA, d.aim.x, d.aim.z)).toBe(true);
    for (let i = 0; i < 40000 && sim.drones.length; i++) sim.step();
    expect(sim.state.leaks).toBe(3);
    expect(sim.state.health).toBeLessThan(100);
    for (const d of drones) expect(inZone(AREA, d.pos.x, d.pos.z)).toBe(true);
  });
  it('sends spotters to circle the area', () => {
    const sim = fresh();
    sim.commands.setZone(AREA);
    const d = sim.spawnDrone(SPOTTER, 0);
    for (let i = 0; i < 40000 && d.mode !== 'orbit'; i++) sim.step();
    for (let i = 0; i < 200; i++) sim.step();
    expect(d.mode).toBe('orbit');
    expect(hdist(d.pos, zoneCentre(AREA))).toBeCloseTo(u(d.def.loiterDist), 3);
  });
  it('recognises a spotter circling the area, which only works if tracks are measured from it', () => {
    const sim = fresh(MIXED);
    sim.commands.setZone(AREA);
    play(sim, 3);
    expect(sim.state.kills).toBeGreaterThan(0);
    expect(sim.bus.entries.some((e) => e.msg.alert?.description.includes('loitering'))).toBe(true);
  }, 60000);
  it('gives the same run for the same area, and a different one without it', () => {
    const run = (zone) => { const sim = fresh(MIXED); if (zone) sim.commands.setZone(zone); play(sim, 2); return sim.digest(); };
    const first = run(AREA);
    expect(run(AREA)).toBe(first);
    expect(run(null)).not.toBe(first);
  }, 120000);
});

describe('keeping the area', () => {
  it('survives the rebuild when the first wave starts, and locks', () => {
    const sim = fresh();
    sim.commands.setZone(AREA);
    sim.state.warnedWire = true;
    sim.commands.startWave();
    expect(sim.state.zone).toEqual(AREA);
    expect(sim.commands.setZone(null)).toMatch(/locked/);
    expect(sim.state.zone).toEqual(AREA);
    expect(sim.currentLaydown().zone).toEqual(AREA);
  });
  it('stays on a reset that keeps the laydown, and goes on one that clears it', () => {
    const sim = fresh();
    sim.commands.setZone(AREA);
    sim.commands.reset('keep');
    expect(sim.state.zone).toEqual(AREA);
    expect(sim.state.zoneCentre).toEqual(zoneCentre(AREA));
    sim.commands.reset('clear');
    expect(sim.state.zone).toBeNull();
    expect(sim.state.zoneCentre).toEqual({ x: 0, y: 0, z: 0 });
  });
  it('comes back with a saved laydown, and ignores a broken one', () => {
    const sim = fresh();
    sim.commands.setZone(AREA);
    const spec = sim.currentLaydown();
    sim.commands.reset('clear');
    expect(sim.commands.loadLaydown(spec, sim.state.terrainSeed)).toBeNull();
    expect(sim.state.zone).toEqual(AREA);
    expect(sim.commands.loadLaydown({ ...spec, zone: [[1, 2]] }, sim.state.terrainSeed)).toBeNull();
    expect(sim.state.zone).toBeNull();
  });
  it('leaves a laydown with no area unchanged', () => {
    expect('zone' in fresh().currentLaydown()).toBe(false);
  });
});

describe('from the map', () => {
  const closed = { points: AREA, closed: true };
  const game = () => { const g = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() }); g.commands.deploy('1', '1'); return g; };

  it('hands over a closed outline, and not one still being drawn', () => {
    const g = game();
    g.setViewOption('zone', { points: AREA, closed: false });
    expect(g.sim.state.zone).toBeNull();
    g.setViewOption('zone', closed);
    expect(g.sim.state.zone).toEqual(AREA);
    g.setViewOption('zone', null);
    expect(g.sim.state.zone).toBeNull();
  });
  it('refuses a change once the first wave has started', () => {
    const g = game();
    g.setViewOption('zone', closed);
    g.sim.state.warnedWire = true;
    g.commands.startWave();
    g.setViewOption('zone', null);
    expect(g.sim.state.zone).toEqual(AREA);
  });
});

describe('distance to the area', () => {
  it('is to its outline, and nothing inside it', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(distToZone(square, 5, 5)).toBe(0);
    expect(distToZone(square, 15, 5)).toBe(5);
    expect(distToZone(square, 13, 14)).toBe(5); // past a corner
  });
});
