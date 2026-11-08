// Stage A4, part 1: a fixed-panel radar only sees through its arc, which faces away from what is defended unless it is turned, and every
// radar covers a band of elevation, so a drone close overhead can pass above it.

import { beforeEach, describe, expect, it } from 'vitest';
import { DRONES, STRUCTURES, WORLD, resetAllFigures } from '../src/sim/config/index.js';
import { coverArc, inCover, outwardFrom, standingAt } from '../src/sim/sensor-model.js';
import { BEARINGS, predictRange } from '../src/sim/site-range.js';
import { createSimulation } from '../src/sim/simulation.js';
import { terrainState } from '../src/sim/terrain.js';
import { u } from '../src/sim/units.js';
import { fieldsFor, unitCost, unitDef } from '../src/sim/unit-config.js';
import { suggestSpot } from '../src/ui/assistant/spots.js';
import { setUp } from './support/scenarios.js';

const facing = (def, deg) => Object.defineProperty(Object.create(def), 'facing', { value: deg });
let sim;
beforeEach(() => { resetAllFigures(); sim = createSimulation({ seed: '1', terrainSeed: '1' }); setUp(sim, { seed: '1', laydown: [] }); });

// A small drone out along a compass bearing from a system, at a height above the ground there.
function probeFrom(s, bearing, metres, agl = 60) {
  const m = WORLD.metresPerUnit, rad = (bearing * Math.PI) / 180;
  const x = s.pos.x * m + Math.sin(rad) * metres, z = s.pos.z * m - Math.cos(rad) * metres;
  return { pos: { x: x / m, y: (terrainState.data.groundAt(x, z) + agl) / m, z: z / m }, def: DRONES.fpv };
}

describe('the cover', () => {
  it('is all round for a rotating radar, and one arc per panel for a fixed one', () => {
    expect(coverArc(STRUCTURES.radar)).toBe(360);
    expect(coverArc(STRUCTURES.radar_s)).toBe(120);
    expect(coverArc(STRUCTURES.radar_a800)).toBe(90);
    expect(coverArc(unitDef('radar_s', { panels: 3 }))).toBe(360);
    expect(coverArc(unitDef('radar_a400', { panels: 2 }))).toBe(180);
  });
  it('is centred on where the radar faces, and wraps past north', () => {
    const east = facing(STRUCTURES.radar_s, 90), north = facing(STRUCTURES.radar_s, 0);
    expect(inCover(east, 90, 0)).toBe(true);
    expect(inCover(east, 149, 0)).toBe(true);
    expect(inCover(east, 151, 0)).toBe(false);
    expect(inCover(east, 270, 0)).toBe(false);
    expect(inCover(north, 350, 0)).toBe(true);
    expect(inCover(north, 59, 0)).toBe(true);
  });
  it('covers a band of elevation from a little below the horizon', () => {
    const r = facing(STRUCTURES.radar_s, 0);
    expect(inCover(r, 0, -9)).toBe(true);
    expect(inCover(r, 0, -11)).toBe(false);
    expect(inCover(r, 0, 69)).toBe(true);
    expect(inCover(r, 0, 71)).toBe(false);
    expect(inCover(STRUCTURES.camera, 123, 89)).toBe(true); // only radars are limited here
  });
});

describe('which way a placed radar faces', () => {
  it('faces away from the station, and then from a drawn area', () => {
    const s = sim.addStructure('radar_s', u(1000), 0);
    expect(s.def.facing).toBe(90);
    sim.commands.setZone([[u(2000), u(-200)], [u(2400), u(-200)], [u(2400), u(200)], [u(2000), u(200)]]);
    expect(s.def.facing).toBe(270);
    expect(outwardFrom({ x: 0, z: 0 }, { x: 0, z: -10 })).toBe(0); // north is -z
  });
  it('can be turned, and goes back to facing away when reset', () => {
    sim.state.budget = 1e9;
    expect(sim.commands.place('radar_s', u(1000), u(40))).toBeNull();
    const s = sim.structures.at(-1);
    expect(sim.commands.configureUnit(s, 'facing', 200)).toBeNull();
    expect(s.def.facing).toBe(200);
    sim.commands.configureUnit(s, 'facing', null);
    expect(s.def.facing).toBe(outwardFrom({ x: 0, z: 0 }, s.pos));
  });
  it('charges for each extra panel, and only fixed-panel radars have panels or a facing', () => {
    expect(unitCost('radar_s', { panels: 3 })).toBe(3 * STRUCTURES.radar_s.cost);
    expect(fieldsFor('radar_s').map((f) => f.key)).toEqual(expect.arrayContaining(['panels', 'facing']));
    expect(fieldsFor('radar').map((f) => f.key)).not.toContain('panels');
    expect(fieldsFor('radar_giraffe').map((f) => f.key)).not.toContain('facing');
  });
  it('reaches further through a narrower arc per panel, at no price, and only fixed panels have one', () => {
    const narrow = unitDef('radar_s', { arc: 30, panels: 2 });
    expect(coverArc(narrow)).toBe(60);
    expect(narrow.range).toBe(Math.round(unitDef('radar_s').range * Math.SQRT2)); // a quarter of the arc: fourth root of 4
    expect(unitCost('radar_s', { arc: 30 })).toBe(STRUCTURES.radar_s.cost);
    expect(fieldsFor('radar').map((f) => f.key)).not.toContain('arc');
    expect(fieldsFor('jammer').map((f) => f.key)).not.toContain('arc');
  });
});

describe('detection and prediction', () => {
  it('sees a drone in front of a panel and not one behind it', () => {
    const s = sim.addStructure('radar_s', u(800), 0); // faces east, away from the station
    expect(sim.net.pd(s, probeFrom(s, 90, 500), { pointing: false })).toBeGreaterThan(0.5);
    expect(sim.net.pd(s, probeFrom(s, 270, 500), { pointing: false })).toBe(0);
  });
  it('trades a narrower arc for reach: further in front, blind at the old edges', () => {
    const s = sim.addStructure('radar_s', u(800), 0); // faces east
    const far = probeFrom(s, 90, 1200), side = probeFrom(s, 130, 500);
    const wide = { far: sim.net.pd(s, far, { pointing: false }), side: sim.net.pd(s, side, { pointing: false }) };
    expect(sim.commands.configureUnit(s, 'arc', 30)).toBeNull();
    expect(sim.net.pd(s, far, { pointing: false })).toBeGreaterThan(wide.far);
    expect(wide.side).toBeGreaterThan(0.5);
    expect(sim.net.pd(s, side, { pointing: false })).toBe(0);
  });
  it('misses a drone too high overhead, even for a radar that rotates', () => {
    const s = sim.addStructure('radar', u(800), 0);
    expect(sim.net.pd(s, probeFrom(s, 0, 1500, 60), { pointing: false })).toBeGreaterThan(0);
    expect(sim.net.pd(s, probeFrom(s, 0, 150, 450), { pointing: false })).toBe(0); // about 70° up: over a 60° beam
  });
  it('predicts range only inside the arc, and averages over the arc', () => {
    const data = terrainState.data, east = facing(STRUCTURES.radar_s, 90);
    const p = predictRange(east, DRONES.fpv, data, 800, 0);
    p.first.forEach((r, i) => { if (!inCover(east, (i * 360) / BEARINGS, 0)) expect(r).toBe(0); });
    expect(p.first.filter((r) => r > 0).length).toBeLessThanOrEqual(Math.ceil((BEARINGS * 120) / 360) + 1);
    expect(p.mean).toBeGreaterThan(0);
    const west = predictRange(facing(STRUCTURES.radar_s, 270), DRONES.fpv, data, 800, 0);
    expect(west.first[Math.round(BEARINGS / 4)]).toBe(0); // about due east, behind a west-facing panel
  });
  it('still predicts range for high and low flyers when the beam leaves a gap close in', () => {
    const data = terrainState.data;
    for (const id of ['radar', 'radar_s', 'radar_a400', 'radar_l']) {
      const def = facing(STRUCTURES[id], 90);
      for (const drone of [DRONES.spotter, DRONES.fw, DRONES.fpv]) expect(predictRange(def, drone, data, 800, 0).max).toBeGreaterThan(0);
    }
    const tall = facing(Object.defineProperty(Object.create(STRUCTURES.radar_l), 'mount', { value: 40 }), 90);
    expect(predictRange(tall, DRONES.fo, data, 800, 0).max).toBeGreaterThan(0); // a low flyer passes under a tall mast's beam close in
  });
  it('never changes the definition it was handed to preview a spot', () => {
    const before = Object.getOwnPropertyNames(STRUCTURES.radar_s).length;
    const placed = standingAt(STRUCTURES.radar_s, { x: 0, z: 0 }, { x: 10, z: 0 });
    expect(placed.facing).toBe(90);
    expect(Object.getOwnPropertyNames(STRUCTURES.radar_s).length).toBe(before);
    expect(STRUCTURES.radar_s.facing).toBeUndefined();
  });
  it('suggests a spot for a panel radar facing the way it will once placed', () => {
    const spot = suggestSpot(sim, STRUCTURES.radar_s);
    expect(spot).not.toBeNull();
    expect(spot.why).toMatch(/Sees about \d+%/);
  });
});
