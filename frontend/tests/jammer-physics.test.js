// Stage A6 part 2, how far a jammer reaches: only the bands it is fitted for, an omni or sector antenna, and a control link that is
// easier to jam the further the drone is from its operator. Each band jammed also makes it louder to emitter-seeking drones.

import { Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { DRONES, WORLD, resetAllFigures } from '../src/sim/config/index.js';
import { fromOperator, jamReaches } from '../src/sim/jamming.js';
import { JAM_BANDS } from '../src/sim/rf-model.js';
import { predictRange, BEARINGS } from '../src/sim/site-range.js';
import { createSimulation } from '../src/sim/simulation.js';
import { emission } from '../src/sim/targeting.js';
import { terrainState } from '../src/sim/terrain.js';
import { u } from '../src/sim/units.js';
import { unitCost, unitDef } from '../src/sim/unit-config.js';
import { setUp } from './support/scenarios.js';

const m = () => WORLD.metresPerUnit;
let sim;
beforeEach(() => { resetAllFigures(); sim = createSimulation({ seed: '1', terrainSeed: '1' }); setUp(sim, { seed: '1', laydown: [] }); sim.state.budget = 1e9; });

// A drone of this type this far east (negative: west) of a system, this high above the ground, launched `operator` metres further out.
function eastOf(s, type, metres, agl = 100, operator = 5000) {
  const x = s.pos.x * m() + metres, z = s.pos.z * m(), at = (xm) => new Vector3(xm / m(), (terrainState.data.groundAt(xm, z) + agl) / m(), z / m());
  return { def: DRONES[type], pos: at(x), launch: at(x + Math.sign(metres || 1) * operator) };
}

describe('the bands fitted', () => {
  it('are all four as standard, and each one left out saves its price', () => {
    expect(unitDef('jammer').fitted).toEqual(JAM_BANDS);
    expect(unitCost('jammer', { fitted: ['control24', 'video58'] })).toBe(42000);
  });
  it('are the only bands it can jam, and taking one out stops it being jammed', () => {
    const jammer = sim.addStructure('jammer', u(300), u(300));
    expect(sim.commands.configureUnit(jammer, 'fitted', ['gnss', 'control24'])).toBeNull();
    expect(jammer.def.settings.fitted).toEqual(['control24', 'gnss']); // kept in one order
    expect([...jammer.jamBands]).toEqual(['control24']);
    sim.commands.toggleJamBand(jammer, 'video58', true);
    sim.commands.toggleJamBand(jammer, 'gnss', true);
    expect([...jammer.jamBands]).toEqual(['control24', 'gnss']);
    expect(sim.commands.configureUnit(jammer, 'fitted', ['wifi'])).toMatch(/Not a valid/);
    expect(sim.commands.configureUnit(jammer, 'fitted', [])).toMatch(/Not a valid/);
  });
  it('hold when a laydown is saved and loaded, even if the save says to jam another band', () => {
    const jammer = sim.addStructure('jammer', u(300), u(300));
    sim.commands.configureUnit(jammer, 'fitted', ['control24']);
    const spec = sim.currentLaydown();
    spec.structures[0].jam = ['control24', 'video58'];
    expect(sim.commands.loadLaydown(spec, '1')).toBeNull();
    expect([...sim.structures[0].jamBands]).toEqual(['control24']);
  });
});

describe('a sector antenna', () => {
  it('reaches about three times as far, at a price', () => {
    expect(unitDef('jammer', { antenna: 'sector' }).range).toBe(3162);
    expect(unitCost('jammer', { antenna: 'sector' })).toBe(72000);
  });
  it('jams only through its arc', () => {
    const omni = sim.addStructure('jammer', u(300), u(300)), sector = sim.addStructure('jammer', u(300), u(-300));
    for (const [k, v] of [['antenna', 'sector'], ['facing', 90]]) expect(sim.commands.configureUnit(sector, k, v)).toBeNull();
    expect(jamReaches(sector, eastOf(sector, 'fpv', 2000), 'control24')).toBe(true);
    expect(jamReaches(sector, eastOf(sector, 'fpv', -500), 'control24')).toBe(false); // behind it
    expect(jamReaches(omni, eastOf(omni, 'fpv', 2000), 'control24')).toBe(false);
    expect(jamReaches(omni, eastOf(omni, 'fpv', -500), 'control24')).toBe(true);
  });
  it('draws its ring through its arc only', () => {
    const sector = sim.addStructure('jammer', u(300), u(300));
    for (const [k, v] of [['antenna', 'sector'], ['facing', 90]]) sim.commands.configureUnit(sector, k, v);
    const ring = predictRange(sector.def, DRONES.fpv, terrainState.data, 300, -300);
    const at = (bearing) => ring.first[Math.round((bearing * BEARINGS) / 360)];
    expect(at(90)).toBeGreaterThan(1000);
    expect(at(270)).toBe(0);
  });
  it('deafens your own detectors only in front of it', () => {
    const rf = sim.addStructure('rf', u(300), u(300)), jammer = sim.addStructure('jammer', u(400), u(300)), fpv = eastOf(rf, 'fpv', 1000);
    for (const [k, v] of [['antenna', 'sector'], ['facing', 90]]) sim.commands.configureUnit(jammer, k, v);
    jammer.mode = 'Jam';
    expect(sim.net.pd(rf, fpv)).toBeGreaterThan(0.5); // the detector is behind it
    sim.commands.configureUnit(jammer, 'facing', 270);
    expect(sim.net.pd(rf, fpv)).toBe(0);
  });
});

describe('the operator', () => {
  it('sets how far a control link can be jammed: further the further away the operator is', () => {
    const jammer = sim.addStructure('jammer', u(300), u(300));
    const near = eastOf(jammer, 'lancet3', 900, 100, 1800), far = eastOf(jammer, 'lancet3', 900, 100, 5400); // its range holds 4.5 km out
    expect(fromOperator(near)).toBeCloseTo(0.4);
    expect(fromOperator(far)).toBeCloseTo(1.2);
    expect(jamReaches(jammer, near, 'control900', fromOperator(near))).toBe(false);
    expect(jamReaches(jammer, far, 'control900', fromOperator(far))).toBe(true);
  });
});

describe('the bands jammed', () => {
  it('make it louder, each against the bands it jams as standard', () => {
    const jammer = sim.addStructure('jammer', u(300), u(300));
    jammer.mode = 'Jam';
    const standard = emission(jammer);
    sim.commands.toggleJamBand(jammer, 'gnss', true);
    expect(emission(jammer)).toBeCloseTo(standard * 1.5);
    jammer.mode = 'Standby';
    expect(emission(jammer)).toBe(0);
  });
});
