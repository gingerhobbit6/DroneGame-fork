// @vitest-environment jsdom
// The end-of-deployment report, ending a deployment by choice, and a deployment pack, under which the budget only counts the cost.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame } from '../src/game.js';
import { ECONOMY, resetAllFigures } from '../src/sim/config/index.js';
import { runStats } from '../src/sim/stats.js';
import { u } from '../src/sim/units.js';
import { GameContext } from '../src/ui/hooks.js';
import { ControlPanel } from '../src/ui/ControlPanel.jsx';
import { Hud } from '../src/ui/Hud.jsx';
import { Overlay } from '../src/ui/Overlay.jsx';
import { MIXED, play, setUp } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

let game;
const $ = (sel) => document.querySelector(sel);
const show = (ui) => render(<GameContext.Provider value={game}>{ui}</GameContext.Provider>);

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('the deployment report', () => {
  it('adds up what was stopped and spent, from the ledger', () => {
    setUp(game.sim, { seed: '1', laydown: MIXED });
    play(game.sim, 2);
    const r = game.sim.report(), { ledger, state } = game.sim;
    expect(r.intercepted).toBe(state.kills);
    const airborne = game.sim.ledger.flights.filter((f) => !f.end).length;
    expect(r.intercepted + r.leaked + r.struck + r.left + r.missed + airborne).toBe(r.launched); // every drone launched is accounted for
    expect(r.cost.spent).toBe(ledger.capex + ledger.consumables);
    expect(r.waves).toBe(2);
  }, 60000);

  it('counts a strike that came down where a patrol had been, so the outcomes still add up to the launches', () => {
    const { sim } = game;
    setUp(sim, { seed: '1', laydown: [] });
    expect(sim.commands.setPatrol([[10, 10], [30, 10], [30, 30]])).toBeNull(); // open, flat ground near the station on terrain 1
    sim.commands.startWave();
    const p = sim.getPatrol();
    p.fix = { x: p.group.x + u(200), z: p.group.z, t: 0 }; // a fix the patrol has walked 200 m away from
    const d = sim.spawnDrone('fw', 0);
    d.pos.set(p.fix.x + u(10), d.pos.y, p.fix.z);
    sim.step();
    const r = sim.report(), stats = runStats(sim);
    expect([r.missed, stats.drones.missed, stats.types.find((t) => t.id === 'fw').missed]).toEqual([1, 1, 1]);
    expect(r.intercepted + r.leaked + r.struck + r.left + r.missed + stats.drones.airborne).toBe(r.launched);
  }, 60000);

  it('ends a deployment between waves on a second click, counting the wave just fought', () => {
    setUp(game.sim, { seed: '1', laydown: MIXED });
    play(game.sim, 1);
    show(<><ControlPanel onToggleDock={() => {}} onToggleTuning={() => {}} onSandbox={() => {}} /><Overlay /></>);
    fireEvent.click($('#btn-end'));
    expect(game.sim.state.over).toBe(false);
    fireEvent.click($('#btn-end'));
    act(() => game.bump());
    expect(game.sim.state).toMatchObject({ over: true, ended: true });
    expect($('.card h1').textContent).toBe('DEPLOYMENT ENDED');
    expect($('#deployment-report').textContent).toContain('after 1 full wave(s)');
    expect($('#stats-effectors').textContent).toContain('jamming'); // the run's statistics follow the report
  }, 60000);

  it('cannot end a deployment that has not started', () => {
    game.sim.commands.deploy('1', '1');
    game.sim.commands.endDeployment();
    expect(game.sim.state.over).toBe(false);
    show(<ControlPanel onToggleDock={() => {}} onToggleTuning={() => {}} onSandbox={() => {}} />);
    expect($('#btn-end')).toBeNull();
  });
});

describe('with a deployment pack', () => {
  it('lets the cost run past the budget, which only counts it', () => {
    game.sim.commands.deploy('1', '1');
    game.sim.commands.setPacked(true);
    for (const [xm, zm] of [[600, 0], [-600, 0], [0, 600], [0, -600]]) expect(game.sim.commands.place('laser_l', xm / 20, zm / 20)).toBeNull(); // 20 m a scene unit
    expect(game.sim.state.budget).toBeLessThan(0);
    expect(game.sim.ledger.capex).toBeGreaterThan(ECONOMY.budget);
    game.sim.commands.setPacked(false);
    expect(game.sim.commands.place('laser_l', 30, 30)).toMatch(/Not enough budget/);
  });

  it('keeps the setting in the run log, so a replay costs the same', () => {
    game.sim.commands.deploy('1', '1');
    game.sim.commands.setPacked(true);
    game.sim.commands.startWave();
    expect(game.sim.log).toContainEqual({ step: 0, name: 'setPacked', args: [true] });
  });

  it('hides the budget, which a pack cannot run out of, except in the sandbox, and keeps site integrity', () => {
    game.sim.commands.deploy('1', '1');
    show(<Hud />);
    expect($('#budget')).not.toBeNull();
    act(() => { game.sim.commands.setPacked(true); game.bump(); });
    expect($('#budget')).toBeNull();
    expect($('#health-fill')).not.toBeNull();
    act(() => { game.sim.commands.enterSandbox(); game.bump(); });
    expect($('#budget')).not.toBeNull();
  });
});
