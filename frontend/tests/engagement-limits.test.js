// Limits real weapons have: a missile's minimum range, a plain gun's spread growing with distance, armour that keeps out what
// would wreck a truck, and the sight line a gun or a beam-riding missile needs.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DRONES, STRUCTURES, WORLD, resetAllFigures } from '../src/sim/config/index.js';
import { muzzle } from '../src/sim/effectors.js';
import { hitChance, meetTime } from '../src/sim/hit-chance.js';
import { createSimulation } from '../src/sim/simulation.js';
import { antennaHeight, reachOnPath, usesPath } from '../src/sim/site-range.js';
import { armourOf } from '../src/sim/targeting.js';
import { terrainState } from '../src/sim/terrain.js';
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

describe('a sight line', () => {
  // Make this weapon's own sight line clear, or blocked, whatever the ground: the world's answer is swapped, and put back after the test.
  let swapped = null;
  function sight(s, clear) {
    const m = WORLD.metresPerUnit, world = terrainState.data;
    swapped ??= { world, los: world.los };
    const { los } = swapped, x = s.pos.x * m, y = s.pos.y * m + antennaHeight(s.def), z = s.pos.z * m;
    world.los = (ax, ay, az, ...to) => (ax === x && ay === y && az === z ? { clear, blocker: clear ? null : 'terrain', canopy: 0 } : los(ax, ay, az, ...to));
  }
  afterEach(() => { if (swapped) swapped.world.los = swapped.los; swapped = null; });
  const placed = (id) => {
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0], [id, -400, 300]] }); // where the mixed laydown wires its missile
    sim.state.sandbox = true; sim.state.budget = 1e9;
    return sim.structures.find((s) => s.def.id === id);
  };

  it('is needed by every gun and beam-riding missile, and by no other round that flies', () => {
    for (const def of Object.values(STRUCTURES)) if (def.kind === 'gun') expect(usesPath(def), def.id).toBe(true);
    for (const id of ['missile_rr', 'missile_hvm']) expect(usesPath(STRUCTURES[id])).toBe(true);
    for (const id of ['interceptor', 'interceptor_s', 'missile', 'missile_s', 'missile_l', 'missile_skysabre']) expect(usesPath(STRUCTURES[id])).toBe(false);
    expect(antennaHeight(STRUCTURES.gun_hmg)).toBeCloseTo(2.64, 2); // it sights along its muzzle, 1.2 model units up
    const hidden = { los: () => ({ clear: false, blocker: 'terrain', canopy: 0 }) }, a = { x: 0, y: 3, z: 0 }, b = { x: 500, y: 100, z: 0 };
    expect(reachOnPath(STRUCTURES.gun_hmg, DRONES.fpv, hidden, a, b)).toBe(0); // so its drawn range stops at a hill, as its fire does
    expect(reachOnPath(STRUCTURES.missile, DRONES.fpv, hidden, a, b)).toBe(STRUCTURES.missile.range);
  });

  it('holds a gun’s fire on a drone it cannot see, and fires once it can', () => {
    const gun = placed('gun_hmg');
    expect(sim.unwired()).not.toContain(gun);
    hover('fpv', gun, 600);
    sight(gun, false);
    sim.run(600);
    expect(sim.ledger.shots.gun_hmg).toBeUndefined();
    expect(sim.bus.entries.some((e) => e.msg.task_ack?.reason?.includes('no line of sight to target'))).toBe(true); // offered it, and said why not
    sight(gun, true);
    sim.run(600);
    expect(sim.ledger.shots.gun_hmg?.n).toBeGreaterThan(0);
  }, 60000);

  it('loses a beam-riding missile once its launcher can no longer see the target', () => {
    const flight = (lose) => {
      const launcher = placed('missile_rr'), d = hover('fw', launcher, 1500, 300);
      sight(launcher, true);
      for (let n = 0; n < 1200 && !sim.missiles.length; n++) sim.step();
      expect(sim.missiles.length).toBeGreaterThan(0);
      if (lose) sight(launcher, false); // the missile is on its way
      sim.run(1200);
      return d;
    };
    expect(flight(false).dead).toBe(true);
    const d = flight(true);
    expect(d.dead).toBe(false);
    expect(d.hp).toBe(DRONES.fw.hp);
  }, 60000);
});

describe('meeting a target', () => {
  it('lets a slow round meet a drone coming its way, but never one going past or away faster than it', () => {
    expect(meetTime([1000, 0, 0], [-50, 0, 0], 25)).toBeCloseTo(1000 / 75, 6); // head on: they close at 75 m/s
    expect(meetTime([1000, 0, 0], [20, 0, 0], 80)).toBeCloseTo(1000 / 60, 6); // a slower drone going away is run down
    expect(meetTime([1000, 0, 0], [50, 0, 0], 25)).toBe(Infinity); // a faster one going away never is
    expect(meetTime([1000, 0, 0], [0, 50, 0], 25)).toBe(Infinity); // nor one crossing at twice its speed
    expect(meetTime([1000, 0, 0], [0, 0, 0], 300)).toBeCloseTo(1000 / 300, 6);
  });
});

describe('a gun round', () => {
  it('leaves its low muzzle for a low drone without being taken for a round in the ground', () => {
    setUp(sim, { seed: '1', laydown: [] });
    const gun = sim.addStructure('gun_hmg', -20, 0); // on the flat station platform, 400 m west of the middle
    const d = hover('fpv', gun, 800, 20); // 800 m off, at the height strike drones come in at
    const round = { def: gun.def, pos: muzzle(gun).clone(), target: d, life: 10, from: 800, cueError: 0, src: gun, shot: null };
    round.vel = d.pos.clone().sub(round.pos).setLength(u(gun.def.missileSpeed));
    sim.missiles.push(round);
    sim.step();
    expect(sim.missiles).toContain(round); // 2.6 m up and climbing 1 m a step: under the 4 m at which a missile counts as down
    expect(round.pos.y).toBeGreaterThan(hereU(round.pos.x, round.pos.z));
  });
});
