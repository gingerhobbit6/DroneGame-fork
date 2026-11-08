// The run's statistics: the flight log adds up to the ledger, per wave and for the whole run, and every drone ends once.

import { beforeAll, describe, expect, it } from 'vitest';
import { createSimulation } from '../src/sim/simulation.js';
import { STRUCTURES } from '../src/sim/config/index.js';
import { liveStats, RANGE_BINS, runStats, spread, wavesFlown } from '../src/sim/stats.js';
import { JAMMERS, MIXED, play, setUp } from './support/scenarios.js';

const total = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
const add = (rows, key) => rows.reduce((n, r) => n + r[key], 0);

describe('spread', () => {
  it('gives the mean, standard deviation and extremes, or null for nothing', () => {
    expect(spread([])).toBeNull();
    expect(spread([1000, 3000])).toEqual({ n: 2, mean: 2000, sd: 1000, min: 1000, max: 3000 });
  });
});

describe('after two waves against the mixed laydown', () => {
  let sim, all;
  beforeAll(() => {
    sim = createSimulation();
    setUp(sim, { seed: '1', laydown: MIXED });
    play(sim, 2);
    all = runStats(sim);
  }, 120000);

  it('counts every drone the ledger counts, and each one ends once', () => {
    const { ledger, state } = sim;
    expect(all.drones.launched).toBe(total(ledger.launched));
    expect(all.drones.killed).toBe(state.kills);
    expect(all.drones.leaked).toBe(total(ledger.leaked));
    expect(all.drones.left).toBe(total(ledger.escaped));
    expect(all.drones.killed + all.drones.leaked + all.drones.struck + all.drones.left + all.drones.airborne).toBe(all.drones.launched);
  });

  it('keeps the live figures within a sim-second, then works them out again', () => {
    const first = liveStats(sim);
    expect(first).toEqual(runStats(sim));
    expect(liveStats(sim)).toBe(first);
    sim.run(20); // a sim-second
    expect(liveStats(sim)).not.toBe(first);
  });

  it('splits the run into its waves, which add up to it', () => {
    expect(wavesFlown(sim.ledger)).toEqual([1, 2]);
    const [one, two] = [runStats(sim, 1), runStats(sim, 2)];
    expect(one.drones.launched + two.drones.launched).toBe(all.drones.launched);
    expect(one.drones.killed + two.drones.killed).toBe(all.drones.killed);
    expect(one.cost.fired + two.cost.fired).toBeCloseTo(all.cost.fired);
    expect(one.fire.falseAlarms + two.fire.falseAlarms).toBe(all.fire.falseAlarms);
  });

  it('matches the shots in the ledger, with hits no more than rounds', () => {
    const guided = Object.entries(sim.ledger.shots).filter(([id]) => STRUCTURES[id].fire === 'guided');
    expect(all.fire.rounds).toBe(guided.reduce((n, [, s]) => n + s.n, 0));
    expect(all.cost.fired).toBeCloseTo(total(Object.fromEntries(Object.entries(sim.ledger.shots).map(([id, s]) => [id, s.cost]))));
    expect(all.fire.hits).toBeGreaterThan(0);
    expect(all.fire.hits).toBeLessThanOrEqual(all.fire.rounds);
    expect(all.fire.hitRate).toBeCloseTo(all.fire.hits / all.fire.rounds);
  });

  it('credits each kill to one effector, at a range from the site', () => {
    expect(add(all.effectors, 'kills')).toBe(all.drones.killed);
    expect(all.range.kill.n).toBe(all.drones.killed);
    expect(all.range.kill.min).toBeGreaterThan(0);
    expect(all.range.kill.max).toBeLessThan(30000);
    expect(all.range.bins).toHaveLength(RANGE_BINS.length);
    expect(all.range.bins.reduce((a, b) => a + b, 0)).toBe(all.drones.killed);
    const interceptor = all.effectors.find((e) => e.id === 'interceptor');
    expect(interceptor.placed).toBe(3);
    expect(interceptor.rounds.left).toBeLessThanOrEqual(interceptor.rounds.of);
    expect(interceptor.perKill).toBeCloseTo(interceptor.cost / interceptor.kills);
  });

  it('says which sensor saw each drone first, and how long engaging it took', () => {
    expect(add(all.sensors, 'first')).toBe(all.drones.seen);
    for (const s of all.sensors) expect(s.seen).toBeLessThanOrEqual(all.drones.launched);
    expect(all.sensors.find((s) => s.id === 'radar').range.mean).toBeGreaterThan(0);
    expect(all.time.toEngage.min).toBeGreaterThanOrEqual(0);
    expect(all.time.toKill.mean).toBeGreaterThan(all.time.toEngage.mean);
  });

  it('breaks the attack down by drone type', () => {
    expect(add(all.types, 'launched')).toBe(all.drones.launched);
    expect(add(all.types, 'killed')).toBe(all.drones.killed);
    expect(add(all.types, 'cost')).toBe(all.cost.enemy);
  });
});

describe('jamming', () => {
  it('credits a crash to the jammer type that caused it, with its time switched on', () => {
    const sim = createSimulation();
    setUp(sim, { seed: '1', laydown: JAMMERS });
    play(sim, 1);
    const jammer = runStats(sim).effectors.find((e) => e.id === 'jammer');
    expect(jammer.kills).toBe(total(sim.ledger.killedBy.jammer));
    expect(jammer.kills).toBeGreaterThan(0);
    expect(jammer.jam).toBeGreaterThan(0);
    expect(jammer.hitRate).toBeNull();
  }, 120000);
});
