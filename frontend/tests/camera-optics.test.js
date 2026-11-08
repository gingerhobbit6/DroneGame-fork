// Stage A5, the camera: pixels on the drone decide detection, recognition and identification, a zoom camera reaches further on a
// cue, and channels, resolution, lens, rangefinder, search arc and slew are fields that change play, each at a cost.

import { beforeEach, describe, expect, it } from 'vitest';
import { DRONES, STRUCTURES, WORLD, resetAllFigures } from '../src/sim/config/index.js';
import { airframeConfidence, pixelsOn, thermalSharpness, zoomMax } from '../src/sim/camera-model.js';
import { outwardFrom } from '../src/sim/sensor-model.js';
import { createSimulation } from '../src/sim/simulation.js';
import { terrainState } from '../src/sim/terrain.js';
import { u } from '../src/sim/units.js';
import { fieldsFor, unitCost, unitDef } from '../src/sim/unit-config.js';
import { setUp } from './support/scenarios.js';

const m = () => WORLD.metresPerUnit;
let sim;
beforeEach(() => { resetAllFigures(); sim = createSimulation({ seed: '1', terrainSeed: '1' }); setUp(sim, { seed: '1', laydown: [] }); sim.state.budget = 1e9; });

// A small drone out along a compass bearing from a system, at a height above the ground there, and the camera pointed straight at it.
function aimedAt(s, bearing, metres, agl = 100) {
  const rad = (bearing * Math.PI) / 180, x = s.pos.x * m() + Math.sin(rad) * metres, z = s.pos.z * m() - Math.cos(rad) * metres;
  const probe = { pos: { x: x / m(), y: (terrainState.data.groundAt(x, z) + agl) / m(), z: z / m() }, def: DRONES.fpv };
  const up = probe.pos.y * m() - (s.pos.y * m() + s.def.mount);
  s.point = { az: bearing, el: (Math.atan2(up, metres) * 180) / Math.PI };
  return probe;
}
// Detection reports from one node during the first wave, with what each one named.
function reportsFrom(laydown, settings = {}) {
  setUp(sim, { seed: '1', laydown });
  const camera = sim.structures.find((s) => s.def.kind === 'camera');
  for (const [k, v] of Object.entries(settings)) expect(sim.commands.configureUnit(camera, k, v)).toBeNull();
  sim.state.warnedWire = true;
  sim.commands.startWave();
  const id = sim.structures.find((s) => s.def.kind === 'camera').nodeId; // the wave rebuilt every unit, with new node ids
  for (let n = 0; n < 16000 && sim.state.waveActive; n++) sim.step();
  return sim.bus.entries.filter((e) => e.type === 'detection_report' && e.msg.node_id === id).map((e) => e.msg.detection_report);
}
const named = (r) => !!r.classification?.[0]?.sub_class?.[0]?.sub_class;
const modelOf = (r) => r.classification?.[0]?.sub_class?.[0]?.sub_class?.[0]?.sub_class?.[0]?.type;

describe('pixels on the drone', () => {
  it('are 4 at the edge of its reach, and name the airframe at 8, surely at 13', () => {
    expect(pixelsOn(650, 650)).toBe(4);
    expect(pixelsOn(650, 325)).toBe(8);
    expect(airframeConfidence(7.9)).toBe(0);
    expect(airframeConfidence(8)).toBe(0.85);
    expect(airframeConfidence(13)).toBe(0.95);
  });
  it('mean a camera detects some drones it cannot yet name', () => {
    const reports = reportsFrom([['radar', 600, 0], ['camera', 378, 589]]).filter((r) => r.classification?.[0]?.type === 'Air Vehicle');
    expect(reports.some(named)).toBe(true);
    expect(reports.some((r) => !named(r))).toBe(true);
  }, 60000);
  it('name the model once the drone is identified, and the track carries it', () => {
    // a second radar keeps the track after the strikes reach the first, so the camera can still look close up
    const reports = reportsFrom([['radar', 600, 0], ['radar', -600, 0], ['camera', 378, 589]]), labels = Object.values(DRONES).map((d) => d.label ?? d.name);
    const models = reports.map(modelOf).filter(Boolean);
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((t) => labels.includes(t))).toBe(true);
    expect([...sim.net.tracks.values()].some((tr) => labels.includes(tr.model))).toBe(true);
  }, 60000);
});

describe('the zoom', () => {
  it('reaches further on a cue, and widens again when half its dwell there finds nothing', () => {
    const s = sim.addStructure('camera', u(800), 0), probe = aimedAt(s, 90, 2000);
    expect(zoomMax(s.def)).toBe(4);
    expect(sim.net.pd(s, probe)).toBe(0); // searching: 2 km is beyond its 650 m
    s.cue = { trackId: 'none', from: sim.state.time, onAt: null };
    expect(sim.net.pd(s, probe)).toBeGreaterThan(0.5);
    s.cue.onAt = sim.state.time - s.def.dwell;
    expect(sim.net.pd(s, probe)).toBe(0);
  });
  it('is the lens: a small camera has none, and the large one zooms from 7.1° to 0.5°', () => {
    expect(fieldsFor('camera_s').map((f) => f.key)).not.toContain('trackView');
    expect(zoomMax(unitDef('camera_s'))).toBe(1);
    expect(zoomMax(unitDef('camera_l'))).toBeCloseTo(14.2);
    expect(unitDef('camera_l').range).toBe(450);
  });
});

describe('looking again', () => {
  it('cuts short a look to name a model for an unclassified track, but not a look to classify one', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0], ['camera', 378, 589]] });
    expect(sim.commands.configureUnit(sim.structures[0], 'microDoppler', 'no')).toBeNull(); // only the camera classifies
    sim.state.warnedWire = true;
    sim.commands.startWave();
    const camera = sim.structures.find((s) => s.def.kind === 'camera'), reach = camera.def.range * zoomMax(camera.def);
    const near = () => [...sim.net.tracks.values()].filter((tr) => tr.status === 'confirmed' && sim.net.distToTrack(camera, tr) < reach);
    for (let n = 0; n < 8000 && near().length < 2; n++) sim.step();
    const [a, b] = near();
    const looksSent = (identify) => { // while it dwells on one track, with another unclassified again
      camera.cue = { trackId: a.id, until: sim.state.time + 60, from: sim.state.time, onAt: null, identify };
      camera.lookedAt.set(a.id, sim.state.time); // as choosing it does
      camera.lookedAt.delete(b.id);
      b.cls = null;
      const from = sim.bus.entries.length;
      sim.run(30); // a tasking tick
      return sim.bus.entries.slice(from).filter((e) => e.type === 'task' && e.msg.destination_id === camera.nodeId && e.msg.task.command?.look_at).length;
    };
    expect(looksSent(false)).toBe(0);
    expect(looksSent(true)).toBe(1); // the task can still be lost on the way, as any can
  }, 60000);
});

describe('the hardware', () => {
  it('prices channels, resolution, lens and slew, and more pixels reach further', () => {
    expect(unitCost('camera', { channels: 'visible' })).toBe(50000);
    expect(unitCost('camera', { channels: 'thermal' })).toBe(80000);
    expect(unitCost('camera_s', { channels: 'both' })).toBe(31250);
    expect(unitDef('camera', { pixels: 'fhd' }).range).toBe(975);
    expect(unitCost('camera', { pixels: 'fhd' })).toBe(Math.round(100000 + Math.log2(1.5) * 0.3 * 100000));
    expect(unitCost('camera', { pixels: 'sd' })).toBe(70000);
    expect(unitCost('camera', { fnumber: 1.4 })).toBe(Math.round(100000 + ((2 / 1.4) ** 2 - 1) * 0.1 * 100000));
    expect(unitCost('camera', { slew: 180 })).toBe(110000);
    expect(unitCost('camera', { rangefinder: 'yes' })).toBe(120000);
  });
  it('blurs thermal light: a slower lens or finer pixels gain less than they would', () => {
    expect(thermalSharpness(unitDef('camera_s'))).toBe(1);
    expect(thermalSharpness(unitDef('camera_s', { fnumber: 2 }))).toBeCloseTo(12 / 20); // a 20 µm spot on 12 µm pixels
    expect(unitDef('camera_l', { pixels: 'fhd' }).range).toBe(450); // at f/5.5 mid-wave light already spreads over 22 µm
    expect(unitDef('camera_l', { fnumber: 4 }).range).toBe(Math.round((450 * 22) / 16));
    expect(thermalSharpness(STRUCTURES.radar)).toBe(1);
  });
  it('a rangefinder measures range, so the camera reports it', () => {
    expect(unitDef('camera', { rangefinder: 'yes' }).sapient.noise.range).toBe(5);
    expect(unitDef('camera').sapient.noise.range).toBeUndefined();
    const reports = reportsFrom([['radar', 600, 0], ['camera', 378, 589]], { rangefinder: 'yes' });
    expect(reports.some((r) => r.range_bearing.range > 0)).toBe(true);
  }, 60000);
});

describe('the search', () => {
  it('sweeps only its arc, facing away from what is defended', () => {
    const s = sim.addStructure('camera', u(800), 0);
    expect(sim.commands.configureUnit(s, 'searchArc', 60)).toBeNull();
    const mid = outwardFrom(sim.state.zoneCentre, s.pos), off = () => Math.abs(((s.point.az - mid + 540) % 360) - 180);
    sim.run(800); // long enough to turn into its arc from wherever it started
    let widest = 0;
    for (let n = 0; n < 400; n++) { sim.step(); widest = Math.max(widest, off()); }
    expect(widest).toBeLessThanOrEqual(31);
    expect(widest).toBeGreaterThan(25); // and it does sweep it
  });
});
