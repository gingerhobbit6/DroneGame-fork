// Stage A4, the rest: 2D radars, the band, the clutter filter, the edges of the beam, blanking arcs and micro-Doppler.
// Each setting has to change play, and each gain has a cost.

import { beforeEach, describe, expect, it } from 'vitest';
import { DRONES, STRUCTURES, WORLD, resetAllFigures } from '../src/sim/config/index.js';
import { BANDS, arcsText, classifiesAt, inCover, parseArcs } from '../src/sim/sensor-model.js';
import { predictRange } from '../src/sim/site-range.js';
import { createSimulation } from '../src/sim/simulation.js';
import { terrainState } from '../src/sim/terrain.js';
import { u } from '../src/sim/units.js';
import { cleanSettings, fieldsFor, unitCost } from '../src/sim/unit-config.js';
import { setUp } from './support/scenarios.js';

const m = () => WORLD.metresPerUnit;
let sim;
beforeEach(() => { resetAllFigures(); sim = createSimulation({ seed: '1', terrainSeed: '1' }); setUp(sim, { seed: '1', laydown: [] }); sim.state.budget = 1e9; });

function radar(id, settings = {}) {
  const s = sim.addStructure(id, u(800), 0);
  for (const [k, v] of Object.entries(settings)) expect(sim.commands.configureUnit(s, k, v)).toBeNull();
  return s;
}
// A small drone out along a compass bearing from a system, at a height above the ground there, moving at vel (m/s, east, north, up).
function probeFrom(s, bearing, metres, agl = 60, vel = null) {
  const rad = (bearing * Math.PI) / 180, x = s.pos.x * m() + Math.sin(rad) * metres, z = s.pos.z * m() - Math.cos(rad) * metres;
  const probe = { pos: { x: x / m(), y: (terrainState.data.groundAt(x, z) + agl) / m(), z: z / m() }, def: DRONES.fpv };
  if (vel) probe.vel = { x: vel[0] / m(), y: vel[2] / m(), z: -vel[1] / m() };
  return probe;
}
const seen = (s, probe) => sim.net.pd(s, probe, { pointing: false });
function untilTrack(test, steps = 10000) { // play the first wave until some track passes the test. Drones start 13 km out
  sim.state.warnedWire = true;
  sim.commands.startWave();
  for (let n = 0; n < steps; n++) { sim.step(); const tr = [...sim.net.tracks.values()].find(test); if (tr) return tr; }
  return null;
}

describe('a 2D radar', () => {
  it('is offered on Medium and Large radars only, and is cheaper', () => {
    expect(fieldsFor('radar').map((f) => f.key)).toContain('dims');
    expect(fieldsFor('radar_l').map((f) => f.key)).toContain('dims');
    expect(fieldsFor('radar_s').map((f) => f.key)).not.toContain('dims');
    expect(unitCost('radar', { dims: 'flat' })).toBe(630000);
  });
  it('measures no height, so its tracks are flat, with a horizontal error', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0]] });
    const s = sim.structures[0];
    expect(sim.commands.configureUnit(s, 'dims', 'flat')).toBeNull();
    expect(s.def.sapient.noise.el).toBeUndefined();
    expect(STRUCTURES.radar.sapient.noise.el).toBe(1.2);
    const tr = untilTrack((t) => t.status === 'confirmed');
    expect(tr).not.toBeNull();
    expect(tr.flat).toBe(true);
    expect(tr.estErr).toBeLessThan(300);
  });
  it('is compared across the ground when an effector measures how far away its track is', () => {
    const s = radar('interceptor');
    const tr = { flat: true, est: { east: s.pos.x * m() + 300, north: -s.pos.z * m() + 400, up: 5000 } };
    expect(sim.net.distToTrack(s, tr)).toBeCloseTo(500);
    expect(sim.net.distToTrack(s, { ...tr, flat: false })).toBeGreaterThan(4900);
  });
});

describe('the band', () => {
  it('measures angles better higher up, sees a little further, costs more, and shows on the Spectrum tab', () => {
    const s = radar('radar', { band: 'k' }), ratio = 24.55 / 9.35;
    expect(s.def.sapient.noise.az).toBeCloseTo(0.6 / ratio);
    expect(s.def.sapient.noise.el).toBeCloseTo(1.2 / ratio);
    expect(s.def.range).toBe(Math.round(3100 * ratio ** (1 / 8)));
    expect(s.def.cost).toBe(1170000);
    expect(s.def.emits[0].f).toEqual(BANDS.k.f);
    expect(STRUCTURES.radar.emits[0].f).toEqual([[9.2, 9.5]]);
    sim.commands.configureUnit(s, 'band', null);
    expect(s.def.sapient.noise.az).toBe(0.6);
    expect(s.def.range).toBe(3100);
  });
  it('is cheaper and worse lower down', () => {
    const s = radar('radar', { band: 's' });
    expect(s.def.sapient.noise.az).toBeGreaterThan(1.8);
    expect(s.def.range).toBeLessThan(3100);
    expect(s.def.cost).toBe(765000);
  });
});

describe('the clutter filter', () => {
  it('trades false alarms against low flyers, and a high filter misses a crossing drone', () => {
    const s = radar('radar', { clutter: 'high' });
    expect(s.def.falseAlarm).toBeCloseTo(0.05);
    expect(s.def.lowRange).toBeCloseTo(350);
    const crossing = probeFrom(s, 90, 800, 100, [0, 20, 0]), closing = probeFrom(s, 90, 800, 100, [-20, 0, 0]);
    expect(seen(s, crossing)).toBe(0);
    expect(seen(s, closing)).toBeGreaterThan(0.5);
    sim.commands.configureUnit(s, 'clutter', 'low');
    expect(s.def.falseAlarm).toBeCloseTo(0.2);
    expect(s.def.lowRange).toBeCloseTo(700);
    expect(seen(s, crossing)).toBeGreaterThan(0.5);
  });
});

describe('the edges of the beam', () => {
  it('raising the low edge cuts clutter false alarms, and a low flyer under it is not seen', () => {
    const s = radar('radar'), under = probeFrom(s, 90, 400, 18);
    const before = seen(s, under);
    expect(before).toBeGreaterThan(0);
    sim.commands.configureUnit(s, 'elevLow', 5);
    expect(s.def.falseAlarm).toBeCloseTo(0.1 * 2 ** -1.5);
    expect(inCover(s.def, 0, 4)).toBe(false);
    expect(inCover(s.def, 0, 6)).toBe(true);
    expect(seen(s, under)).toBe(0);
  });
  it('lowering the top edge searches less sky, so reaches further, and leaves a gap overhead', () => {
    const s = radar('radar', { elevTop: 20 });
    expect(s.def.range).toBe(Math.round(3100 * 2 ** 0.25));
    expect(inCover(s.def, 0, 25)).toBe(false);
    expect(fieldsFor('radar_a400').map((f) => f.key)).not.toContain('elevTop'); // its beam is already only 20° tall
  });
});

describe('blanking arcs', () => {
  it('are read as typed or as saved, and anything else is refused', () => {
    expect(parseArcs('40-80, 350 - 10')).toEqual([[40, 80], [350, 10]]);
    expect(parseArcs([[40, 80]])).toEqual([[40, 80]]);
    expect(parseArcs('')).toEqual([]);
    for (const bad of ['40', '40-80-90', '40-400', '1-2,3-4,5-6,7-8', '40-40', 'north-south', [[40.5, 80]], [[40, 80, 1]], [['40', '80']]]) expect(parseArcs(bad)).toBeUndefined();
    expect(arcsText([[40, 80], [350, 10]])).toBe('40-80, 350-10');
    expect(cleanSettings('radar', { blank: [[40, 80], [1, 2, 3]] })).toEqual({});
    expect(cleanSettings('radar', { blank: [[40, 80]] })).toEqual({ blank: [[40, 80]] });
  });
  it('see nothing, past north too, and the predicted range shows the gap', () => {
    const s = radar('radar'), data = terrainState.data;
    expect(predictRange(s.def, DRONES.fpv, data, s.pos.x * m(), s.pos.z * m()).first[0]).toBeGreaterThan(0);
    expect(sim.commands.configureUnit(s, 'blank', '350-10')).toBeNull();
    expect(inCover(s.def, 355, 0)).toBe(false);
    expect(inCover(s.def, 5, 0)).toBe(false);
    expect(inCover(s.def, 15, 0)).toBe(true);
    expect(seen(s, probeFrom(s, 0, 800, 100))).toBe(0);
    expect(seen(s, probeFrom(s, 90, 800, 100))).toBeGreaterThan(0.5);
    expect(predictRange(s.def, DRONES.fpv, data, s.pos.x * m(), s.pos.z * m()).first[0]).toBe(0);
  });
  it('take away false alarms in step with what they blank', () => {
    const alarms = (blank) => {
      setUp(sim, { seed: '1', laydown: [['radar', 600, 0]] });
      if (blank) sim.commands.configureUnit(sim.structures[0], 'blank', blank);
      sim.run(4000); // 200 scans and no drones: every detection is a false alarm
      return sim.structures[0].detections || 0;
    };
    expect(alarms(null)).toBeGreaterThan(8);
    expect(alarms('0-359')).toBeLessThan(2);
  });
  it('give their own message when they cannot be read', () => {
    expect(sim.commands.configureUnit(radar('radar'), 'blank', '40-')).toMatch(/such as 40-80/);
  });
});

describe('micro-Doppler', () => {
  it('names multirotor or fixed wing, close in only, and is standard on the IRIS and the A400', () => {
    expect(classifiesAt(STRUCTURES.radar, 1500, 3100)).toBe(true);
    expect(classifiesAt(STRUCTURES.radar, 1600, 3100)).toBe(false);
    expect(classifiesAt(STRUCTURES.radar_a400, 1000, 2730)).toBe(true);
    expect(classifiesAt(STRUCTURES.radar_s, 100, 1000)).toBe(false);
    expect(unitCost('radar_s', { microDoppler: 'yes' })).toBe(51750);
    expect(unitCost('radar', { microDoppler: 'no' })).toBe(765000);
  });
  it('classifies tracks with no camera on the site, and without it nothing is classified', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0]] });
    expect(untilTrack((t) => t.airframe && t.airframe !== 'Unknown', 12000)).not.toBeNull(); // wave 1 is inside 1.5 km by then
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0]] });
    sim.commands.configureUnit(sim.structures[0], 'microDoppler', 'no');
    expect(untilTrack((t) => t.airframe && t.airframe !== 'Unknown', 12000)).toBeNull();
  });
});
