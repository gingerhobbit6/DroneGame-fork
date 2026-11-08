// Stage A6 part 3, a jammer's own ears: a receiver and library that hear drones on the bands it is fitted for, but not through its own
// barrage; reactive jamming of the links it hears and knows; and a jammer switched on by the fusion node, its own receiver or by hand.

import { Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { DRONES, STRUCTURES, WORLD, resetAllFigures } from '../src/sim/config/index.js';
import { REACTIVE_RATE, hears, jamming } from '../src/sim/jamming.js';
import { createSimulation } from '../src/sim/simulation.js';
import { terrainState } from '../src/sim/terrain.js';
import { u } from '../src/sim/units.js';
import { unitCost, unitDef } from '../src/sim/unit-config.js';
import { setUp } from './support/scenarios.js';

const m = () => WORLD.metresPerUnit;
let sim;
beforeEach(() => { resetAllFigures(); sim = createSimulation({ seed: '1', terrainSeed: '1' }); setUp(sim, { seed: '1', laydown: [] }); sim.state.budget = 1e9; });

// A drone of this type this far east of a system, 100 m above the ground, launched 5 km further out.
function eastOf(s, type, metres) {
  const z = s.pos.z * m(), at = (xm) => new Vector3(xm / m(), (terrainState.data.groundAt(xm, z) + 100) / m(), z / m());
  return { def: DRONES[type], pos: at(s.pos.x * m() + metres), launch: at(s.pos.x * m() + metres + 5000) };
}

// The same, as a real drone in the air that stays where it is and that jamming cannot bring down, so it can be heard for as long as needed.
function parked(s, type, metres) {
  sim.state.sandbox = true;
  const d = sim.spawnDrone(type, 0, { jitter: 0, altFrac: 0.5 }), at = eastOf(s, type, metres);
  d.pos.copy(at.pos); d.launch = at.launch; d.def = { ...DRONES[type], speed: 0 }; d.jamResist = 1;
  return d;
}

function jammerWith(settings, xm = 300) {
  const s = sim.addStructure('jammer', u(xm), u(300));
  for (const [k, v] of Object.entries(settings)) expect(sim.commands.configureUnit(s, k, v)).toBeNull();
  return s;
}

describe('a receiver', () => {
  it('costs what a Small RF detector does with the same library', () => {
    expect(unitCost('jammer', { receiver: 'full' })).toBe(STRUCTURES.jammer.cost + STRUCTURES.rf_s.cost * 1.4);
    expect(unitCost('jammer', { receiver: 'none' })).toBe(STRUCTURES.jammer.cost + STRUCTURES.rf_s.cost * 0.8);
  });
  it('hears a drone on the lowest link band it is fitted for, as far as it jams, but nothing without one and no silent drone', () => {
    expect(hears(jammerWith({}, 0), eastOf(sim.structures[0], 'fpv', 500), sim.structures)).toBeNull();
    const s = jammerWith({ receiver: 'none' });
    expect(hears(s, eastOf(s, 'fpv', 500), sim.structures)).toBe('control24');
    expect(hears(s, eastOf(s, 'fpv', 1500), sim.structures)).toBeNull();
    expect(hears(s, eastOf(s, 'fo', 500), sim.structures)).toBeNull();
    sim.commands.configureUnit(s, 'fitted', ['video58', 'gnss']);
    expect(hears(s, eastOf(s, 'fpv', 500), sim.structures)).toBe('video58');
  });
  it('is blanked by its own barrage and your other jammers nearby, but hears between reactive bursts', () => {
    const s = jammerWith({ receiver: 'hobby' }), fpv = eastOf(s, 'fpv', 500);
    s.mode = 'Jam';
    expect(hears(s, fpv, sim.structures)).toBeNull(); // it fills both of the drone's bands
    sim.commands.toggleJamBand(s, 'video58', false);
    expect(hears(s, fpv, sim.structures)).toBe('video58');
    sim.commands.toggleJamBand(s, 'video58', true);
    sim.commands.configureUnit(s, 'technique', 'reactive');
    expect(hears(s, fpv, sim.structures)).toBe('control24');
    sim.addStructure('jammer', u(400), u(300)).mode = 'Jam';
    expect(hears(s, fpv, sim.structures)).toBeNull();
  });
});

describe('reactive jamming', () => {
  it('jams only the links of drones its library knows, harder, and never GNSS', () => {
    const s = jammerWith({ receiver: 'hobby', technique: 'reactive' });
    for (const b of ['control900', 'gnss']) sim.commands.toggleJamBand(s, b, true);
    s.mode = 'Jam';
    // video: false throughout, as it is received by the operator 5 km further out, beyond this jammer
    expect(jamming(s, eastOf(s, 'fpv', 500), sim.structures)).toEqual({ control: true, video: false, gnss: false, rate: REACTIVE_RATE });
    expect(jamming(s, eastOf(s, 'spotter', 500), sim.structures)).toBeNull(); // a tactical link
    sim.commands.configureUnit(s, 'receiver', 'tactical');
    expect(jamming(s, eastOf(s, 'spotter', 500), sim.structures)).toEqual({ control: true, video: false, gnss: false, rate: REACTIVE_RATE });
    sim.commands.configureUnit(s, 'technique', 'barrage');
    expect(jamming(s, eastOf(s, 'spotter', 500), sim.structures)).toEqual({ control: true, video: false, gnss: true, rate: 1 });
    sim.commands.configureUnit(s, 'technique', 'reactive');
    sim.commands.configureUnit(s, 'receiver', 'off');
    expect(jamming(s, eastOf(s, 'fpv', 500), sim.structures)).toBeNull(); // nothing to hear the link with
  });
  it('is quieter to emitter-seeking drones', () => {
    expect(unitDef('jammer', { technique: 'reactive' }).signature).toBeCloseTo(STRUCTURES.jammer.signature / 2);
  });
});

describe('switching on', () => {
  // Its mode once a second, half way between the fusion node's turns, which come once a second from the start of a run.
  const watch = (s, seconds) => Array.from({ length: seconds }, () => { sim.run(20); return s.mode; });
  beforeEach(() => sim.run(10));

  it('by its own receiver, with the network down, but not for a drone that sends nothing', () => {
    const s = jammerWith({ receiver: 'commercial', trigger: 'receiver' });
    s.offline = true;
    parked(s, 'fo', 500);
    expect(watch(s, 2)).toEqual(['Standby', 'Standby']);
    parked(s, 'fpv', 500);
    expect(watch(s, 2)).toEqual(['Jam', 'Jam']);
  });
  it('a barrage stops to listen every few seconds, as it cannot hear through itself; a reactive jammer keeps on', () => {
    const s = jammerWith({ receiver: 'hobby', trigger: 'receiver' });
    parked(s, 'fpv', 500);
    expect(watch(s, 8)).toEqual(['Jam', 'Jam', 'Jam', 'Standby', 'Jam', 'Jam', 'Jam', 'Standby']);
    sim.commands.configureUnit(s, 'technique', 'reactive');
    expect(watch(s, 4)).toEqual(['Jam', 'Jam', 'Jam', 'Jam']);
  });
  it('by hand, which a saved laydown keeps', () => {
    const s = jammerWith({ trigger: 'manual' });
    sim.commands.setJamming(s, true);
    expect(watch(s, 1)).toEqual(['Jam']);
    const spec = sim.currentLaydown();
    expect(spec.structures[0].on).toBe(true);
    expect(sim.commands.loadLaydown(spec, '1')).toBeNull();
    sim.run(10);
    const back = sim.structures[0];
    expect(watch(back, 1)).toEqual(['Jam']);
    sim.commands.setJamming(back, false);
    expect(watch(back, 1)).toEqual(['Standby']);
    sim.commands.setJamming(back, true);
    sim.commands.configureUnit(back, 'trigger', 'track');
    expect(sim.currentLaydown().structures[0].on).toBeUndefined(); // only kept while it is switched by hand
  });
});
