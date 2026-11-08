// A shot can miss, a beam weakens with distance, and a sensor's error grows as its signal fades.

import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { DRONES, STRUCTURES, TOOLBAR, resetAllFigures } from '../src/sim/config/index.js';
import { enoughInAir, updateMissiles } from '../src/sim/effectors.js';
import { beamFactor, burnTime, hitChance } from '../src/sim/hit-chance.js';
import { ERROR_AT_LIMIT, errorScale } from '../src/sim/site-range.js';
import { createSimulation } from '../src/sim/simulation.js';
import { SITE_POS, u } from '../src/sim/units.js';
import { setUp } from './support/scenarios.js';

const sim = createSimulation();
const { interceptor: sting, interceptor_p1: p1, interceptor_s: hunter, interceptor_l: merops, missile, missile_l: nasams, missile_paladin: gun, laser } = STRUCTURES;
const { fpv, fo, fw } = DRONES;
const near = (x, y, tolerance = 0.03) => expect(Math.abs(x - y)).toBeLessThan(tolerance);

beforeAll(() => { resetAllFigures(); setUp(sim, { seed: '1', laydown: [] }); });

describe('the chance a shot hits', () => {
  it('gives every guided weapon a chance between zero and one', () => {
    const guided = Object.values(STRUCTURES).filter((d) => d.fire === 'guided');
    expect(guided.length).toBeGreaterThan(10);
    for (const def of guided) {
      expect(def.pk, def.id).toBeGreaterThan(0);
      expect(def.pk, def.id).toBeLessThanOrEqual(1);
      expect(def.ref.basis, def.id).toMatch(/Hit chance/);
      for (const d of Object.values(DRONES)) for (const r of [0, def.range]) {
        const p = hitChance(def, d, r);
        expect(p, `${def.id} ${d.id}`).toBeGreaterThan(0);
        expect(p, `${def.id} ${d.id}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('matches what was reported, where something was', () => {
    near(hitChance(sting, { speed: 51, evade: 0.8 }, 5000), 0.68, 0.06); // one round on a Shahed: with the track, about three a kill in play, as reported
    expect(hitChance(nasams, { speed: 50, evade: 0.6 }, 5000)).toBeGreaterThan(0.9); // the 94% given for NASAMS in Ukraine
    expect(gun.damage).toBeGreaterThanOrEqual(DRONES.shahed136.hp); // Gepard crews down a Shahed with one brief burst
    expect(hitChance(gun, { speed: 50, evade: 0.6 }, 1000)).toBeGreaterThan(0.75);
    near(hitChance(p1, fpv, 5000), 1 / 3, 0.06); // $3,000 a kill at $1,000 a drone
    expect(hitChance(hunter, { speed: 5, evade: 1 }, 0)).toBeGreaterThan(0.8); // the maker's 85%, on an easy target
  });

  it('falls against an evasive target', () => {
    expect(hitChance(sting, { ...fpv, evade: 0.3 }, 1000)).toBeLessThan(hitChance(sting, { ...fpv, evade: 0.9 }, 1000));
  });

  it('loses less to evasion the faster the round is than its target', () => {
    const kept = (def) => hitChance(def, { speed: 50, evade: 0.6 }, 1000) / hitChance(def, { speed: 50, evade: 1 }, 1000);
    near(kept(sting), 0.8, 0.001); // 80 m/s: it has to match every turn
    expect(kept(nasams)).toBeGreaterThan(0.9); // 400 m/s: it barely notices
  });

  it('falls with range', () => {
    expect(hitChance(missile, fw, missile.range)).toBeLessThan(hitChance(missile, fw, 0));
    near(hitChance(missile, fw, missile.range) / hitChance(missile, fw, 0), 0.75, 0.001);
  });

  it('falls on a poor track, reaching half at the seeker limit', () => {
    near(hitChance(missile, fw, 1000, 300) / hitChance(missile, fw, 1000, 0), 0.5, 0.001);
    expect(hitChance(missile, fw, 1000, 30)).toBeGreaterThan(hitChance(missile, fw, 1000, 200));
  });

  it('falls against a target nearly as fast as the round', () => {
    expect(hitChance(hunter, fpv, 500)).toBeLessThan(0.3); // it is slower than an FPV
    expect(hitChance(hunter, fo, 500)).toBeGreaterThan(hitChance(hunter, fpv, 500));
    expect(hitChance(merops, fw, 500)).toBeLessThan(hitChance(missile, fw, 500));
  });

  it('keeps the Hit chance figure editable, and clamps a silly one', () => {
    expect(hitChance({ ...missile, pk: 50 }, { speed: 0, evade: 1 }, 0)).toBe(1);
    expect(hitChance({ ...missile, pk: 0 }, fw, 0)).toBe(0);
  });
});

describe('a round in flight', () => {
  const world = (target) => ({ missiles: [], drones: [target], emit() {} });
  // Fire many rounds that are already on top of a target too tough to kill, and count the damage.
  function fire(def, n = 2000) {
    const target = { pos: new Vector3(0, 50, 0), def: { speed: 30 }, evade: 0.6, hp: 1e12, dead: false };
    const w = world(target), start = target.hp;
    for (let i = 0; i < n; i++) {
      w.missiles.push({ def, pos: new Vector3(0, 50, 0), vel: new Vector3(), target, life: 10, from: 500, cueError: 0 });
      updateMissiles(w, 0.05);
    }
    expect(w.missiles.length).toBe(0); // every round is used up, hit or miss
    return (start - target.hp) / def.damage / n;
  }

  it('hits about as often as its chance says', () => {
    near(fire(sting), hitChance(sting, { speed: 30, evade: 0.6 }, 500), 0.05);
    near(fire(p1), hitChance(p1, { speed: 30, evade: 0.6 }, 500), 0.05);
  });

  it('never hits with no chance, and always with a certain one', () => {
    expect(fire({ ...sting, pk: 0 }, 200)).toBe(0);
    expect(fire({ ...missile, pk: 50, missileSpeed: 1e6 }, 200)).toBeGreaterThan(0.5);
  });

  it('damages its target even when the fuze sets it off outside the blast', () => {
    const target = { pos: new Vector3(0, 50, 0), def: { speed: 30 }, evade: 1, hp: 1e12, dead: false };
    const w = world(target), def = { ...sting, pk: 50, missileSpeed: 1e6, fuze: 15, splash: 1 };
    w.missiles.push({ def, pos: new Vector3(u(10), 50, 0), vel: new Vector3(), target, life: 10, from: 0, cueError: 0 });
    updateMissiles(w, 0.001);
    expect(target.hp).toBe(1e12 - def.damage);
  });

  it('leaves others alone when it misses, and catches them in its blast when it hits', () => {
    const at = () => ({ pos: new Vector3(0, 50, 0), def: { speed: 30 }, evade: 1, hp: 1e12, dead: false });
    const target = at(), other = at();
    const w = { missiles: [], drones: [target, other], emit() {} };
    w.missiles.push({ def: { ...sting, pk: 0 }, pos: new Vector3(0, 50, 0), vel: new Vector3(), target, life: 10, from: 0, cueError: 0 });
    updateMissiles(w, 0.001);
    expect(other.hp).toBe(1e12);
    w.missiles.push({ def: { ...sting, pk: 50, missileSpeed: 1e6 }, pos: new Vector3(0, 50, 0), vel: new Vector3(), target, life: 10, from: 0, cueError: 0 });
    updateMissiles(w, 0.001);
    expect(other.hp).toBeLessThan(1e12);
  });
});

describe('when to hold fire', () => {
  const launcher = { def: sting, pos: new Vector3(0, 0, 0) };
  const target = (metresFromSite, hp = 20) => ({ pos: new Vector3(u(metresFromSite), 0, 0), def: fpv, evade: 0.6, hp });
  const inAir = (t, n, def = sting) => Array.from({ length: n }, () => ({ def, target: t, from: 500, cueError: 0 }));
  const hold = (t, n, def) => enoughInAir({ missiles: inAir(t, n, def), state: { zoneCentre: SITE_POS } }, launcher, t);

  it('fires when nothing is in the air', () => {
    expect(hold(target(5000), 0)).toBe(false);
  });

  it('waits to see the result while there is time', () => {
    expect(hold(target(5000), 1)).toBe(true);
  });

  it('fires a salvo when there is no time to look, and stops once it is likely enough', () => {
    const close = target(100);
    expect(hold(close, 1)).toBe(false); // about 2 in 3
    expect(hold(close, 2)).toBe(true); // nearly 9 in 10
  });

  it('keeps firing if the rounds in the air could not kill it even if they all hit', () => {
    expect(hold(target(5000, 500), 1)).toBe(false);
  });
});

describe('a launcher with rounds in the air', () => {
  it('moves on to the next target instead of waiting', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0], ['radar', -600, 0], ['interceptor', 0, 300]] });
    sim.state.sandbox = true;
    sim.spawnDrone('fpv', 0.5, {});
    sim.spawnDrone('fpv', 2.5, {});
    let most = 0;
    for (let i = 0; i < 10000 && most < 2; i++) {
      sim.step();
      most = Math.max(most, new Set(sim.missiles.map((m) => m.target)).size);
    }
    sim.state.sandbox = false;
    expect(most).toBe(2);
  }, 30000);
});

describe('a beam', () => {
  it('is at full strength close in', () => {
    expect(beamFactor(laser, 0)).toBe(1);
    expect(beamFactor(laser, laser.range * 0.25)).toBe(1);
  });

  it('takes twice as long at twice the range, as published for a real laser', () => {
    near(beamFactor(laser, laser.range * 0.5) / beamFactor(laser, laser.range), 2, 0.001);
    near(burnTime(laser, fw, laser.range) / burnTime(laser, fw, laser.range * 0.5), 2, 0.001);
  });

  it('takes longer on a tougher and more evasive target', () => {
    expect(burnTime(laser, fw, 1000)).toBeGreaterThan(burnTime(laser, fpv, 1000));
    expect(burnTime(laser, { hp: 20, evade: 0.3 }, 1000)).toBeGreaterThan(burnTime(laser, { hp: 20, evade: 0.9 }, 1000));
  });
});

describe('sensor error', () => {
  const radar = STRUCTURES.radar, rf = STRUCTURES.rf;

  it('is the quoted figure close in, and larger at the limit of reach', () => {
    near(errorScale(radar, 1, 3000), 1, 0.001);
    expect(errorScale(radar, 3000, 3000)).toBeCloseTo(ERROR_AT_LIMIT, 5);
    expect(errorScale(rf, 3000, 3000)).toBeCloseTo(ERROR_AT_LIMIT, 5);
  });

  it('holds up longer for a radar, whose signal fades faster but starts stronger', () => {
    expect(errorScale(radar, 1500, 3000)).toBeLessThan(errorScale(rf, 1500, 3000));
    expect(errorScale(radar, 6000, 3000)).toBeGreaterThan(errorScale(rf, 6000, 3000));
  });

  it('gets worse when hills or trees cut the reach, and stops at a limit', () => {
    expect(errorScale(rf, 1000, 500)).toBeGreaterThan(errorScale(rf, 1000, 3000));
    expect(errorScale(rf, 1000, 0)).toBe(8);
    expect(errorScale(radar, 1e6, 1)).toBe(8);
  });

  it('reaches the reports and the tracker: errors widen with range in play', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0]] });
    sim.state.sandbox = true;
    sim.spawnDrone('fpv', 0, {});
    const reported = () => sim.bus.entries.filter((e) => e.type === 'detection_report' && e.from !== sim.net.fusion.nodeId).map((e) => e.msg.detection_report.range_bearing.azimuth_error);
    sim.run(1200);
    const errors = reported();
    sim.state.sandbox = false;
    expect(errors.length).toBeGreaterThan(5);
    expect(Math.max(...errors)).toBeGreaterThan(Math.min(...errors));
    expect(Math.min(...errors)).toBeGreaterThanOrEqual(STRUCTURES.radar.sapient.noise.az);
  }, 30000);

  it('keeps every sensor on the toolbar with a reported error', () => {
    for (const id of TOOLBAR.flatMap((g) => g.classes)) if (STRUCTURES[id].role === 'sensor') expect(STRUCTURES[id].sapient.noise.az, id).toBeGreaterThan(0);
  });
});
