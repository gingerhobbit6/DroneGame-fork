// Limits real weapons have: a missile's minimum range, a plain gun's spread growing with distance, and armour that keeps out what
// would wreck a truck.

import { beforeEach, describe, expect, it } from 'vitest';
import { DRONES, STRUCTURES, resetAllFigures } from '../src/sim/config/index.js';
import { hitChance } from '../src/sim/hit-chance.js';
import { createSimulation } from '../src/sim/simulation.js';
import { armourOf } from '../src/sim/targeting.js';
import { reachText } from '../src/ui/SystemCard.jsx';
import { hereU, u } from '../src/sim/units.js';
import { setUp } from './support/scenarios.js';

let sim;
beforeEach(() => { resetAllFigures(); sim = createSimulation({ seed: '1', terrainSeed: '1' }); });

// A drone of this type hovering this many metres east of a system, at this height.
function hover(type, s, xm, height = 120) {
  const d = sim.spawnDrone(type, 0, { jitter: 0, altFrac: 0.5 });
  d.def = { ...d.def, speed: 0 };
  return moveTo(d, s, xm, height);
}
function moveTo(d, s, xm, height = 120) {
  const x = s.pos.x + u(xm);
  d.pos.set(x, hereU(x, s.pos.z) + u(height), s.pos.z);
  return d;
}

describe('a minimum range', () => {
  it('is published for Starstreak and bounded for CAMM, and assumed for the other missiles', () => {
    expect(STRUCTURES.missile_hvm.minRange).toBe(300);
    expect(STRUCTURES.missile_skysabre.minRange).toBe(1000);
    for (const id of ['missile', 'missile_s', 'missile_rr', 'missile_l']) expect(STRUCTURES[id].minRange).toBeGreaterThan(0);
    for (const id of ['interceptor', 'gun_hmg', 'laser']) expect(STRUCTURES[id].minRange).toBeUndefined();
    expect(reachText(STRUCTURES.missile_hvm)).toBe('0.3 km to 7.0 km'); // as the toolbar lists it
    expect(reachText(STRUCTURES.gun_hmg)).toBe('1.2 km');
  });

  it('keeps a missile off a drone closer than it, until the drone is far enough out', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0], ['missile_s', -400, 300]] }); // where the mixed laydown wires its missile
    sim.state.sandbox = true; sim.state.budget = 1e9;
    const launcher = sim.structures.find((s) => s.def.id === 'missile_s');
    expect(sim.unwired()).not.toContain(launcher);
    const d = hover('fpv', launcher, 150); // about 190 m from the launcher, inside its 300 m
    sim.run(600);
    expect(sim.ledger.shots.missile_s).toBeUndefined();
    moveTo(d, launcher, 900);
    sim.run(600);
    expect(sim.ledger.shots.missile_s?.n).toBeGreaterThan(0);
  }, 60000);
});

describe('a plain gun', () => {
  const target = { speed: DRONES.shahed136.speed, evade: 1 };
  const atLimit = (def) => hitChance(def, target, def.range) / hitChance(def, target, 1);

  it('keeps a quarter of its chance at its limit, where an airburst gun keeps three quarters', () => {
    for (const id of ['gun_s', 'gun_50', 'gun_hmg', 'gun_gepard']) expect(atLimit(STRUCTURES[id])).toBeCloseTo(0.25, 2);
    for (const id of ['missile_paladin', 'gun_l', 'gun_skyranger']) expect(atLimit(STRUCTURES[id])).toBeCloseTo(0.75, 2);
  });

  it('leaves the Gepard what the crews report at about 3 km', () => {
    const gepard = STRUCTURES.gun_gepard, before = { ...gepard, pk: 0.4, rangeLoss: undefined }; // as it was calibrated
    expect(hitChance(gepard, target, 3000) / hitChance(before, target, 3000)).toBeCloseTo(1, 2);
    expect(hitChance(gepard, target, 500)).toBeGreaterThan(hitChance(before, target, 500)); // and more close in
  });
});

describe('armour', () => {
  it('halves a strike on an armoured hull, its own or a Patria’s', () => {
    expect(armourOf(STRUCTURES.missile_hvm)).toBe(2);
    expect(armourOf({ ...STRUCTURES.radar_a800, vehicle: 'patria' })).toBe(2);
    expect(armourOf({ ...STRUCTURES.radar_a800, vehicle: 'hilux' })).toBe(1);
    expect(armourOf(STRUCTURES.radar)).toBe(1);
  });

  it('lets a Stormer survive the strike that destroys a radar', () => {
    setUp(sim, { seed: '1', laydown: [] });
    sim.commands.setZone([[100, -60], [200, -60], [200, 40], [100, 40]]);
    const stormer = sim.addStructure('missile_hvm', 150, 0), radar = sim.addStructure('radar_s', 150, 30);
    for (const s of [stormer, radar]) {
      const d = sim.spawnDrone('fw', 0);
      d.aim = { x: s.pos.x, z: s.pos.z, structure: s, kind: 'system' };
      for (let i = 0; i < 40000 && sim.drones.includes(d); i++) sim.step();
    }
    expect(stormer.health).toBe(STRUCTURES.missile_hvm.health - DRONES.fw.damage / 2);
    expect(sim.structures.includes(radar)).toBe(false);
  }, 60000);
});
