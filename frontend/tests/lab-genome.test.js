// The overnight search's layouts (tools/lab/genome.mjs): whatever is made or changed must be legal, or the search spends the night on
// layouts the runner refuses, and a seeded search must repeat.

import { describe, expect, it } from 'vitest';
import { MOUNTS, STRUCTURES } from '../src/sim/config/index.js';
import { mulberry32 } from '../src/sim/rng.js';
import { REMOTE_OK, keyOfGenome, mutate, random, repair, seeds, toDesign } from '../tools/lab/genome.mjs';
import { RULES, problem } from '../tools/lab/model.mjs';

const isSensor = (id) => STRUCTURES[id].role === 'sensor';

// Everything a genome promises, checked directly and through the runner's own rule check.
function expectLegal(g, label) {
  expect(g.veh.length, label).toBeGreaterThanOrEqual(2);
  expect(g.veh.length, label).toBeLessThanOrEqual(RULES.maxVehicles);
  expect(g.R, label).toBeGreaterThanOrEqual(300);
  expect(g.R, label).toBeLessThanOrEqual(900);
  expect(g.rot >= 0 && g.rot <= 1, label).toBe(true); // 1 is 0.9996 rounded: the same ring as 0
  for (const list of g.veh) {
    expect(list.length >= 1 && list.length <= RULES.maxPerVehicle, `${label}: ${list}`).toBe(true);
    expect(list.every((id) => STRUCTURES[id]), `${label}: ${list}`).toBe(true);
    expect(list.filter(isSensor).length, `${label}: ${list}`).toBeLessThanOrEqual(1);
  }
  expect(g.rem.length, label).toBeLessThanOrEqual(4);
  for (const r of g.rem) {
    expect(REMOTE_OK(r.id), `${label}: ${r.id}`).toBe(true);
    expect(Number.isInteger(r.n) && r.n >= 1 && r.n <= 24, `${label}: ${r.n} of ${r.id}`).toBe(true);
    expect(g.R * r.rho, label).toBeLessThanOrEqual(RULES.maxDist);
  }
  expect(problem(toDesign(g)), `${label}: ${keyOfGenome(g)}`).toBeNull();
}

describe('repair', () => {
  it('brings a wild genome inside every limit', () => {
    const g = repair({
      R: 5000, rot: -3.7,
      veh: Array.from({ length: 14 }, () => ['radar_s', 'rf', 'acoustic', 'gun_hmg', 'missile_s', 'gun_50']), // two sensors, one that needs no vehicle, too many
      rem: [{ id: 'gun_hmg', n: 3, rho: 1.5 }, { id: 'jammer_sf', n: 0, rho: 1.5 }, { id: 'jammer_sf', n: 500, rho: 0.2 }, { id: 'acoustic', n: 4, rho: 0.2 },
        { id: 'jammer_sf', n: 5, rho: 9 }, { id: 'rf_l', n: 2, rho: 1.4 }, { id: 'jammer_neo', n: 2, rho: 1.4 }, { id: 'nonsense', n: 2, rho: 1.4 }],
    });
    expectLegal(g, 'wild');
    expect(g.R).toBe(900);
    expect(g.rot).toBeCloseTo(0.3, 9);
    expect(g.veh).toHaveLength(10);
    expect(g.veh[0]).toEqual(['radar_s', 'gun_hmg', 'missile_s']);
    expect(g.rem.map((r) => r.id)).not.toContain('gun_hmg');
    expect(g.rem.find((r) => r.id === 'jammer_sf').n).toBe(24);
  });

  it('gives an empty or stripped genome two armed vehicles', () => {
    expect(repair({ R: 100, rot: 0, veh: [], rem: [] })).toEqual({ R: 300, rot: 0, veh: [['gun_hmg'], ['gun_hmg']], rem: [] });
    expect(repair({ R: 450, rot: 0, veh: [['acoustic'], []], rem: [] }).veh).toEqual([['gun_hmg'], ['gun_hmg']]);
  });

  it('leaves a self-propelled system alone on its vehicle, and a heavy one with one other', () => {
    const heavy = Object.keys(MOUNTS).find((id) => MOUNTS[id] === 3 && !isSensor(id));
    const g = repair({ R: 450, rot: 0, veh: [['gun_hmg', 'gun_gepard', 'radar_s'], ['gun_hmg', heavy, 'gun_50'], [heavy, heavy, heavy]], rem: [] });
    expect(g.veh).toEqual([['gun_gepard'], [heavy, 'gun_hmg'], [heavy, heavy]]);
    expectLegal(g, 'heavy');
  });

  it('keeps the rings of remote systems apart from the vehicles and from each other', () => {
    const g = repair({ R: 400, rot: 0, veh: [['gun_hmg'], ['gun_hmg']], rem: [{ id: 'jammer_sf', n: 6, rho: 1.0 }, { id: 'acoustic', n: 6, rho: 1.0 }, { id: 'rf_l', n: 6, rho: 1.01 }] });
    const radii = g.rem.map((r) => r.rho * g.R);
    expect(radii[0]).toBeGreaterThanOrEqual(400 + 109);
    expect(radii[1] - radii[0]).toBeGreaterThanOrEqual(89);
    expect(radii[2] - radii[1]).toBeGreaterThanOrEqual(89);
    expectLegal(g, 'rings');
  });
});

describe('made and changed genomes', () => {
  it('start legal: the hand-made starting points and 300 random ones', () => {
    seeds().forEach((g, i) => expectLegal(g, `starting point ${i}`));
    const rand = mulberry32(11);
    for (let i = 0; i < 300; i++) expectLegal(random(rand), `random ${i}`);
  });

  it('stay legal through 600 changes on end, without touching the parent', () => {
    const rand = mulberry32(2026);
    let g = seeds()[0];
    for (let i = 0; i < 600; i++) {
      const before = JSON.stringify(g), kid = mutate(g, rand);
      expect(JSON.stringify(g), `change ${i}`).toBe(before);
      expectLegal(kid, `change ${i}`);
      g = kid;
    }
  });

  it('come out the same for the same random seed, and differ for another', () => {
    const run = (seed) => { const rand = mulberry32(seed); let g = random(rand); const out = [g]; for (let i = 0; i < 40; i++) out.push(g = mutate(g, rand)); return JSON.stringify(out); };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });
});

describe('the layout the runner plays', () => {
  it('has one site per vehicle on the ring, three panels on a small radar, and the remote systems on theirs', () => {
    const g = { R: 500, rot: 0, veh: [['radar_s', 'gun_hmg'], ['gun_hmg']], rem: [{ id: 'jammer_sf', n: 3, rho: 1.4 }] };
    const d = toDesign(g, ['shahed']);
    expect(d.vehicles.map((v) => v.at)).toEqual([[500, 0], [-500, 0]]);
    expect(d.vehicles[0].sys).toEqual([['radar_s', { panels: 3 }], ['gun_hmg']]);
    expect(d.remote).toHaveLength(3);
    for (const [id, x, z] of d.remote) { expect(id).toBe('jammer_sf'); expect(Math.hypot(x, z)).toBeCloseTo(700, 0); }
    expect(d.attack).toEqual(['shahed']);
    expect(toDesign(g)).not.toHaveProperty('attack');
  });
});
