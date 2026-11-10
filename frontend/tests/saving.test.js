// Run records and saved laydowns: every run is reported once, and what is saved really does reproduce the run.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSimulation } from '../src/sim/simulation.js';
import { ADAPT, FUSION, STRUCTURES, GAME_VERSION, resetAllFigures, exportFigures } from '../src/sim/config/index.js';
import { MIXED, play, playWave, setUp } from './support/scenarios.js';
import { replayRun, sampleLaydown, sampleRun } from './support/replay.js';

const sim = createSimulation();
const runs = [];
sim.on('runEnded', (r) => runs.push(r));
const fresh = (laydown = MIXED, seed = '1') => { setUp(sim, { seed, laydown }); sim.state.warnedWire = true; runs.length = 0; };
afterEach(() => { resetAllFigures(); FUSION.authority = 'auto'; sim.commands.setAutoStart(false); sim.state.seed = '1'; sim.commands.reset('clear'); sim.commands.loadLaydown({ structures: [], fusionUplinks: [], fusionCell: 'B8' }, '1'); runs.length = 0; });

describe('a run is reported once, however it ends', () => {
  it('when the site is lost', () => {
    fresh([['rf', 900, 0]]);
    play(sim, 8);
    expect(sim.state.over).toBe(true);
    expect(runs.length).toBe(1);
    expect(runs[0].waves_completed).toBe(sim.state.wave - 1); // the wave that broke through was not completed
    sim.commands.reset('keep'); // retrying after a loss is not a second run
    expect(runs.length).toBe(1);
    expect(runs[0].health).toBe(0);
  }, 30000);

  it('when the player resets, starts again, or loads something else', () => {
    fresh();
    sim.commands.startWave();
    sim.run(100);
    sim.commands.reset('keep');
    expect(runs.length).toBe(1);
    sim.commands.startWave();
    sim.run(100);
    sim.commands.reset('clear');
    expect(runs.length).toBe(2);
    fresh();
    sim.commands.startWave();
    sim.run(100);
    sim.commands.loadLaydown(sim.currentLaydown(), '1');
    expect(runs.length).toBe(1);
  }, 30000);

  it('when the page closes, without reporting it twice', () => {
    fresh();
    sim.commands.startWave();
    sim.run(100);
    sim.endRun();
    sim.endRun();
    expect(runs.length).toBe(1);
    sim.commands.reset('keep');
    expect(runs.length).toBe(1);
  }, 30000);

  it('but not before a wave has started, or in the sandbox', () => {
    fresh();
    sim.run(50);
    sim.endRun();
    sim.commands.reset('keep');
    sim.commands.enterSandbox();
    sim.commands.launchSandboxWave();
    sim.run(100);
    sim.commands.exitSandbox();
    expect(runs).toEqual([]);
  }, 30000);
});

describe('the record', () => {
  it('holds the laydown and figures the run started with, not what came later', () => {
    fresh();
    sim.commands.setFigure('structures', 'radar', 'published', 3000);
    const spec = sim.currentLaydown();
    sim.commands.startWave();
    sim.commands.setFigure('structures', 'radar', 'published', 1000);
    sim.run(100);
    sim.commands.reset('keep');
    const r = runs[0];
    expect(r.spec).toEqual(spec);
    expect(r.figures.structures.radar.published).toBe(3000);
    expect(r.game_version).toBe(GAME_VERSION);
    expect(r.scenario_seed).toBe('1');
    expect(r.world).toBe('1');
  }, 30000);

  it('counts only completed waves', () => {
    fresh();
    playWave(sim);
    sim.endRun();
    expect(runs[0].waves_completed).toBe(1);
    fresh();
    playWave(sim);
    sim.commands.startWave();
    sim.run(50);
    sim.endRun();
    expect(runs[0].waves_completed).toBe(1);
  }, 30000);

  it('ends with where the run stopped', () => {
    fresh();
    sim.commands.startWave();
    sim.run(123);
    sim.endRun();
    expect(runs[0].commands.at(-1)).toEqual({ step: 123, name: 'endRun', args: [] });
    expect(runs[0].commands.slice(0, 3).map((c) => c.name)).toEqual(['setAuthority', 'setAutoStart', 'startWave']);
  }, 30000);
});

describe('replaying a saved run', () => {
  const finish = () => { sim.endRun(); return runs.at(-1); };

  it('reproduces a plain run', () => {
    fresh();
    play(sim, 3);
    const r = JSON.parse(JSON.stringify(finish()));
    replayRun(sim, r);
    expect(sim.digest()).toBe(r.digest);
  }, 60000);

  it('reproduces a run with operator inputs, tuning, and time between waves', () => {
    fresh();
    sim.commands.setFigure('drones', 'fpv', 'speed', 25);
    sim.commands.setAdapt('evadePerWave', 0.1);
    sim.commands.setRangeScale(1.2);
    sim.commands.setFpvGap(15);
    sim.commands.setAutoStart(false);
    sim.commands.startWave();
    sim.run(500);
    sim.commands.toggleJamBand(sim.structures.find((s) => s.jamBands), 'gnss', true);
    sim.commands.setFigure('structures', 'radar', 'falseAlarm', 0.9); // tuned mid-run: changes what every later scan draws
    sim.run(4000);
    sim.run(77);
    sim.commands.startWave();
    sim.commands.injectFault();
    sim.commands.clearMessages();
    sim.run(600);
    const r = JSON.parse(JSON.stringify(finish()));
    resetAllFigures();
    replayRun(sim, r);
    expect(sim.digest()).toBe(r.digest);
  }, 60000);

  it('reproduces engagement decisions', () => {
    fresh([['radar', 600, 0], ['rf', 900, 0], ['rf', -900, 0], ['interceptor', 490, 99], ['missile', -400, 300]]);
    sim.commands.setAuthority('all');
    sim.commands.startWave();
    let answered = 0, approve = true;
    for (let i = 0; i < 9000; i++) { // 450 s: the first drone is tracked about 310 s in, once it clears the hills
      sim.step();
      for (const req of [...sim.net.pendingRequests]) { sim.commands.decide(req.id, approve); approve = !approve; answered++; }
    }
    expect(answered).toBeGreaterThan(2);
    const r = JSON.parse(JSON.stringify(finish()));
    FUSION.authority = 'auto';
    replayRun(sim, r);
    expect(sim.digest()).toBe(r.digest);
  }, 60000);

  it('reproduces a run that was lost, as most are', () => {
    fresh([]);
    play(sim, 8);
    expect(sim.state.over).toBe(true);
    const r = JSON.parse(JSON.stringify(runs.at(-1)));
    replayRun(sim, r);
    expect(sim.state.over).toBe(true);
    expect(sim.digest()).toBe(r.digest);
  }, 60000);

  it('reproduces a deployment pack run that costs more than the budget', () => {
    sim.commands.reset('clear');
    sim.state.started = true;
    sim.commands.setPacked(true);
    const dearest = Object.values(STRUCTURES).sort((a, b) => b.cost - a.cost)[0].id;
    for (let i = 0; i < 4; i++) expect(sim.commands.place(dearest, 30 + i * 8, -40)).toBe(null);
    expect(sim.state.budget).toBeLessThan(0);
    sim.commands.autoWire();
    sim.state.warnedWire = true;
    sim.commands.startWave();
    sim.run(100);
    const r = JSON.parse(JSON.stringify(finish()));
    sim.commands.setPacked(false);
    sim.commands.reset('clear');
    replayRun(sim, r);
    expect(sim.structures.length).toBe(r.spec.structures.length);
    expect(sim.digest()).toBe(r.digest);
    sim.commands.setPacked(false);
  }, 60000);

  it('a different seed gives a different run, so the digest means something', () => {
    fresh();
    play(sim, 2);
    const r = finish();
    replayRun(sim, { ...r, scenario_seed: '2' });
    expect(sim.digest()).not.toBe(r.digest);
  }, 60000);
});

describe('saved laydowns', () => {
  it('a laydown saved in one session plays the same when loaded in another', () => {
    fresh();
    const saved = JSON.parse(JSON.stringify({ spec: sim.currentLaydown(), world: sim.state.terrainSeed }));
    play(sim, 3);
    const direct = sim.digest();
    sim.commands.reset('clear');
    expect(sim.structures.length).toBe(0);
    expect(sim.commands.loadLaydown(saved.spec, saved.world)).toBeNull();
    expect(sim.structures.length).toBe(MIXED.length);
    sim.state.warnedWire = true;
    play(sim, 3);
    expect(sim.digest()).toBe(direct);
  }, 60000);

  it('keeps wiring and jam bands, and charges for it', () => {
    fresh();
    sim.structures.find((s) => s.jamBands).jamBands.add('gnss');
    const spec = sim.currentLaydown(), budget = sim.commands.reset('keep') || sim.state.budget;
    sim.commands.reset('clear');
    sim.commands.loadLaydown(spec, '1');
    expect(sim.state.budget).toBe(budget);
    expect(sim.structures.some((s) => s.jamBands && s.jamBands.has('gnss'))).toBe(true);
    expect(sim.net.fusion.uplinks.size).toBe(2);
  });

  it('switches to the ground it was saved on', () => {
    const changes = [];
    sim.on('terrain', () => changes.push(sim.state.terrainSeed));
    fresh();
    const spec = sim.currentLaydown();
    sim.commands.loadLaydown(spec, 'other-ground');
    expect(sim.state.terrainSeed).toBe('other-ground');
    expect(changes).toEqual(['other-ground']);
    sim.commands.loadLaydown(spec, 'other-ground');
    expect(changes.length).toBe(1);
  });

  it('refuses a laydown that costs more than the budget at today\'s prices, and changes nothing', () => {
    fresh();
    const spec = sim.currentLaydown(), before = sim.structures.length;
    sim.commands.setFigure('structures', 'radar', 'cost', 2e9);
    expect(sim.commands.loadLaydown(spec, '1')).toMatch(/more than the/);
    expect(sim.structures.length).toBe(before);
  });
});

describe('figures', () => {
  it('enemy learning is a figure too: exported, applied and reset', () => {
    const base = ADAPT.evadePerWave;
    sim.commands.setAdapt('evadePerWave', 0.2);
    sim.commands.setAdapt('notAFigure', 9);
    expect(ADAPT.notAFigure).toBeUndefined();
    const saved = exportFigures();
    expect(saved.adapt).toEqual({ evadePerWave: 0.2 });
    sim.commands.resetAllFigures();
    expect(ADAPT.evadePerWave).toBe(base);
    sim.commands.applyFigures(saved);
    expect(ADAPT.evadePerWave).toBe(0.2);
    sim.commands.applyFigures({});
    expect(ADAPT.evadePerWave).toBe(base);
    sim.commands.importFigures({ adapt: { evadePerWave: 'lots' } });
    expect(ADAPT.evadePerWave).toBe(base);
  });
  it('resetting one figure is logged like any other change', () => {
    fresh();
    const base = STRUCTURES.radar.cost;
    sim.commands.setFigure('structures', 'radar', 'cost', 5);
    sim.commands.resetFigure('structures', 'radar', 'cost');
    expect(STRUCTURES.radar.cost).toBe(base);
    expect(sim.log.at(-1).name).toBe('resetFigure');
  });
});

describe('the contract with the backend', () => {
  // The backend's tests post these same files, so a change of shape on either side fails a test.
  const fixture = (name) => JSON.parse(readFileSync(join(import.meta.dirname, '../../backend/tests/fixtures', name), 'utf8'));
  const shape = (v) => (Array.isArray(v) ? (v.length ? [shape(v[0])] : []) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k])])) : typeof v);

  it('a real run still has the shape the backend tests use', () => {
    expect(shape(sampleRun(sim))).toEqual(shape(fixture('run.json')));
  }, 30000);
  it('a real laydown still has the shape the backend tests use', () => {
    expect(shape(sampleLaydown(sim))).toEqual(shape(fixture('laydown.json')));
  });
});
