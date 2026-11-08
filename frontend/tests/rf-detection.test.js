// Stage A6 part 1, radio detection: a drone is heard on the bands of its own links, by a detector that covers them, while none of
// your own jammers nearby is filling them. A classifier library names what it knows; sensitivity and direction finding are hardware.

import { beforeEach, describe, expect, it } from 'vitest';
import { DRONES, STRUCTURES, WORLD, resetAllFigures } from '../src/sim/config/index.js';
import { bandGhz, heardBand, radiates } from '../src/sim/rf-model.js';
import { reachFor } from '../src/sim/site-range.js';
import { createSimulation } from '../src/sim/simulation.js';
import { terrainState } from '../src/sim/terrain.js';
import { u } from '../src/sim/units.js';
import { unitCost, unitDef } from '../src/sim/unit-config.js';
import { setUp } from './support/scenarios.js';

const m = () => WORLD.metresPerUnit;
const hz = (band) => Math.round(bandGhz(band) * 1e9);
let sim;
beforeEach(() => { resetAllFigures(); sim = createSimulation({ seed: '1', terrainSeed: '1' }); setUp(sim, { seed: '1', laydown: [] }); sim.state.budget = 1e9; });

// A drone of this type this far east of a system, this high above the ground there.
function eastOf(s, type, metres, agl = 100) {
  const x = s.pos.x * m() + metres, z = s.pos.z * m();
  return { pos: { x: x / m(), y: (terrainState.data.groundAt(x, z) + agl) / m(), z: z / m() }, def: DRONES[type] };
}

describe('the bands a drone is heard on', () => {
  it('are those of its control and video links', () => {
    expect(radiates(DRONES.fpv)).toEqual(['control24', 'video58']);
    expect(radiates(DRONES.spotter)).toEqual(['control900', 'video58']);
    expect(radiates(DRONES.orlan10)).toEqual(['control900']);
    expect(radiates(DRONES.fo)).toEqual([]);
    expect(radiates(DRONES.gerbera)).toEqual(['control24']); // a mesh modem on a band no source gives
  });
  it('must be one the detector covers, and it hears the lowest, which carries furthest', () => {
    expect(heardBand(unitDef('rf_s'), DRONES.orlan10)).toBeNull(); // 2.4 and 5.8 GHz only
    expect(reachFor(unitDef('rf_s'), DRONES.orlan10)).toBe(0);
    expect(heardBand(unitDef('rf_s'), DRONES.spotter)).toBe('video58');
    expect(heardBand(unitDef('rf'), DRONES.spotter)).toBe('control900');
    expect(heardBand(unitDef('rf'), DRONES.fpv)).toBe('control24');
  });
});

describe('your own jammer', () => {
  it('deafens a detector within its range on the bands it jams, while it jams', () => {
    const rf = sim.addStructure('rf', u(300), u(300)), jammer = sim.addStructure('jammer', u(400), u(300)), fpv = eastOf(rf, 'fpv', 1000);
    const heard = sim.net.pd(rf, fpv);
    expect(heard).toBeGreaterThan(0.5);
    jammer.mode = 'Jam';
    expect(sim.net.pd(rf, fpv)).toBe(0); // both its links are in the jammer's bands
    expect(sim.net.pd(rf, eastOf(rf, 'spotter', 1000, 400))).toBeGreaterThan(0.5); // still heard on 900 MHz
    jammer.jamBands = new Set(['control24']);
    expect(sim.net.pd(rf, fpv)).toBeGreaterThan(0); // its video is still heard
    expect(sim.net.pd(rf, fpv)).toBeLessThanOrEqual(heard); // on a higher band, which carries less far
  });
  it('leaves a detector beyond its range alone', () => {
    const rf = sim.addStructure('rf', u(300), u(300)), jammer = sim.addStructure('jammer', u(-1500), u(300)); // 1.8 km off, and it reaches 1 km
    jammer.mode = 'Jam';
    expect(sim.net.pd(rf, eastOf(rf, 'fpv', 1000))).toBeGreaterThan(0.5);
  });
});

describe('the classifier library', () => {
  it('names the airframe of a link it knows, calls any other a drone, and with none hears energy only', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0], ['rf', 300, 300], ['rf', -300, 300], ['rf', 0, -400]] });
    const [, hobby, none] = sim.structures.filter((s) => s.def.kind === 'rf');
    expect(sim.commands.configureUnit(hobby, 'library', 'hobby')).toBeNull();
    expect(sim.commands.configureUnit(none, 'library', 'none')).toBeNull();
    sim.state.warnedWire = true;
    sim.commands.startWave(); // the first wave is all first-person-view drones, on 2.4 and 5.8 GHz
    const with_ = (library) => sim.structures.find((s) => s.def.kind === 'rf' && s.def.library === library); // starting a wave rebuilds every unit
    sim.run(7500);
    const from = (s) => sim.bus.entries.filter((e) => e.type === 'detection_report' && e.from === s.nodeId).map((e) => e.msg.detection_report);
    const drones = (s) => from(s).filter((r) => r.classification[0].type === 'Air Vehicle');
    const airframe = (r) => r.classification[0].sub_class[0].sub_class?.[0]?.type;
    const [plain, hobbyist, deaf] = ['commercial', 'hobby', 'none'].map(with_);
    expect(drones(plain).length).toBeGreaterThan(5);
    expect(drones(plain).every((r) => !airframe(r))).toBe(true); // a commercial library does not know a hobby link
    expect(drones(plain).every((r) => r.signal[0].centre_frequency === hz('control24'))).toBe(true);
    expect(drones(hobbyist).length).toBeGreaterThan(5);
    expect(drones(hobbyist).every((r) => airframe(r) === 'Multirotor')).toBe(true);
    expect(from(deaf).length).toBeGreaterThan(5);
    expect(drones(deaf)).toEqual([]);
  }, 60000);
  it('costs more the more it knows, and with none it has twice the false alarms', () => {
    expect(unitCost('rf', { library: 'full' })).toBe(56000);
    expect(unitCost('rf', { library: 'none' })).toBe(32000);
    expect(unitDef('rf', { library: 'none' }).falseAlarm).toBeCloseTo(0.1);
    expect(unitDef('rf', { library: 'hobby' }).falseAlarm).toBeCloseTo(0.05);
  });
});

describe('the receiver', () => {
  it('hears twice as far for every 6 dB of sensitivity, at a price', () => {
    expect(unitDef('rf', { sensitivity: -96 }).range).toBe(7000);
    expect(unitCost('rf', { sensitivity: -96 })).toBe(60000);
    expect(unitDef('rf', { sensitivity: -84 }).range).toBe(1750);
    expect(unitCost('rf', { sensitivity: -84 })).toBe(30000);
  });
  it('gives a bearing by angle of arrival, or only a sector', () => {
    expect(unitDef('rf_s').sapient.noise.az).toBe(30);
    expect(unitDef('rf_s', { df: 'aoa' }).sapient.noise.az).toBe(5);
    expect(unitCost('rf_s', { df: 'aoa' })).toBe(15000);
    expect(unitDef('rf', { df: 'sector' }).sapient.noise.az).toBe(30);
    expect(unitCost('rf', { df: 'sector' })).toBe(20000);
  });
});

describe('the bands monitored and the bandwidth', () => {
  it('hear only the bands it monitors, from those its hardware covers, with fewer false alarms', () => {
    const rf = sim.addStructure('rf', u(300), u(300)), small = sim.addStructure('rf_s', u(-300), u(300));
    expect(sim.commands.configureUnit(rf, 'monitored', ['video58', 'control24'])).toBeNull();
    expect(rf.def.settings.monitored).toEqual(['control24', 'video58']); // kept in one order
    expect(heardBand(rf.def, DRONES.spotter)).toBe('video58'); // no longer on 900 MHz
    expect(rf.def.falseAlarm).toBeCloseTo(STRUCTURES.rf.falseAlarm * (2 / 3));
    for (const bad of [['gnss'], []]) expect(sim.commands.configureUnit(rf, 'monitored', bad)).toMatch(/Not a valid/);
    expect(sim.commands.configureUnit(small, 'monitored', ['control900'])).toMatch(/Not a valid/); // not a band it can hear
  });
  it('with a narrow receiver, come round once per band it monitors, for less', () => {
    expect(unitDef('rf').sapient.interval).toBe(1);
    expect(unitDef('rf', { ibw: 'narrow' }).sapient.interval).toBe(3);
    expect(unitDef('rf', { ibw: 'narrow', monitored: ['control24'] }).sapient.interval).toBe(1);
    expect(unitCost('rf', { ibw: 'narrow' })).toBe(STRUCTURES.rf.cost * 0.75);
  });
  it('make a narrow detector report that much less often in a run', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0], ['rf', 300, 300], ['rf', 300, 340]] });
    expect(sim.commands.configureUnit(sim.structures[2], 'ibw', 'narrow')).toBeNull();
    sim.state.warnedWire = true;
    sim.commands.startWave();
    sim.run(7500);
    const [wide, narrow] = ['wide', 'narrow'].map((ibw) => sim.structures.find((s) => s.def.kind === 'rf' && (s.def.ibw ?? 'wide') === ibw)); // starting a wave rebuilds every unit
    const reports = (s) => sim.bus.entries.filter((e) => e.type === 'detection_report' && e.from === s.nodeId).length;
    expect(reports(narrow)).toBeGreaterThan(0);
    expect(reports(narrow)).toBeLessThan(reports(wide) * 0.6);
  }, 60000);
});
