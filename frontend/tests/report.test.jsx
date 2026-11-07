// @vitest-environment jsdom
// The end-of-deployment report, ending a deployment by choice, and a deployment pack, under which the budget only counts the cost.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame } from '../src/game.js';
import { ECONOMY, resetAllFigures } from '../src/sim/config/index.js';
import { GameContext } from '../src/ui/hooks.js';
import { ControlPanel } from '../src/ui/ControlPanel.jsx';
import { Hud } from '../src/ui/Hud.jsx';
import { Overlay } from '../src/ui/Overlay.jsx';
import { MIXED, play, setUp } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

let game;
const $ = (sel) => document.querySelector(sel);
const show = (ui) => render(<GameContext.Provider value={game}>{ui}</GameContext.Provider>);
const sum = (list, key) => list.reduce((n, x) => n + x[key], 0);

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('the deployment report', () => {
  it('adds up what was fired, jammed, stopped and spent, from the ledger', () => {
    setUp(game.sim, { seed: '1', laydown: MIXED });
    play(game.sim, 2);
    const r = game.sim.report(), { ledger, state } = game.sim;
    expect(r.intercepted).toBe(state.kills);
    expect(sum(r.killers, 'n')).toBe(r.intercepted);
    expect(sum(r.fired, 'cost')).toBe(Object.values(ledger.shots).reduce((n, s) => n + s.cost, 0));
    expect(r.fired.length).toBeGreaterThan(0);
    expect(r.jammed.map((j) => j.id)).toEqual(['jammer']); // MIXED has two, of one type
    expect(r.jammed[0].seconds).toBeGreaterThan(0);
    expect(r.cost.spent).toBe(ledger.capex + ledger.consumables);
    expect(r.waves).toBe(2);
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
    expect($('#report-used').textContent).toContain('Interceptor drones'); // they take the first wave before it reaches the jammers
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

  it('hides the budget and site integrity, except in the sandbox', () => {
    game.sim.commands.deploy('1', '1');
    show(<Hud />);
    act(() => { game.sim.commands.setPacked(true); game.bump(); });
    expect($('#budget')).toBeNull();
    expect($('#health-fill')).toBeNull();
    act(() => { game.sim.commands.enterSandbox(); game.bump(); });
    expect($('#budget')).not.toBeNull();
  });
});
