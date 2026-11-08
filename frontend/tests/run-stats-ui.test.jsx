// @vitest-environment jsdom
// The run's statistics on screen: the wizard and the HUD show the same headline, and the SAPIENT dock and the end card the
// same tables, per wave or for the whole run, with prices in pounds.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { resetAllFigures } from '../src/sim/config/index.js';
import { view } from '../src/render/view.js';
import { GameContext } from '../src/ui/hooks.js';
import { App } from '../src/ui/App.jsx';
import { Overlay } from '../src/ui/Overlay.jsx';
import { MIXED, play, setUp } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

let game;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const page = () => { game.attach = vi.fn(); render(<App game={game} />); }; // no 3D view
const tiles = (root) => [...root.querySelectorAll('.st-tiles b')].map((b) => b.textContent);

beforeAll(() => { HTMLCanvasElement.prototype.getContext = () => null; });
beforeEach(() => {
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  setUp(game.sim, { seed: '1', laydown: MIXED });
  play(game.sim, 2);
}, 120000);
afterEach(() => { cleanup(); resetAllFigures(); view.wizard = 'closed'; });

describe('during a run', () => {
  it('shows the same headline in the HUD and the wizard, and both open the full statistics', () => {
    page();
    act(() => { game.setViewOption('wizard', 'open'); game.bump(); });
    const hud = $('#hud-top-left .st-head'), wizard = $('#wizard .st-head');
    expect(hud).not.toBeNull();
    expect(wizard).not.toBeNull();
    expect(tiles(wizard)).toEqual(tiles(hud));
    expect(tiles(hud)[0]).toMatch(/^\d+%$/); // kill rate
    fireEvent.click(wizard.querySelector('.st-open'));
    expect($('#dock').className).not.toContain('hidden');
    expect($('[data-pane="stats"]').className).not.toContain('hidden');
    expect($('#stats-effectors tbody').children.length).toBeGreaterThan(1);
  });

  it('switches every table between the whole run and one wave', () => {
    page();
    fireEvent.click($('#hud-top-left .st-open'));
    const launched = () => Number($('.st-drones b').textContent);
    const whole = launched();
    const waves = $$('.st-waves button').map((b) => b.textContent);
    expect(waves).toEqual(['Whole run', 'Wave 1', 'Wave 2']);
    fireEvent.click($$('.st-waves button')[1]);
    const first = launched();
    fireEvent.click($$('.st-waves button')[2]);
    expect(first + launched()).toBe(whole);
    expect($('#run-stats').textContent).toContain('Systems bought (whole run)');
  });
});

describe('at the end', () => {
  it('shows every statistic on the end card, in pounds', () => {
    act(() => { game.sim.commands.endDeployment(); });
    render(<GameContext.Provider value={game}><Overlay /></GameContext.Provider>);
    expect($('.card #run-stats')).not.toBeNull();
    expect($('#stats-sensors').textContent).toContain('Medium radar');
    expect($('#stats-types tbody').children.length).toBeGreaterThan(0);
    expect($('.st-bars').children.length).toBe(7);
    expect($('#report-cost').textContent).toMatch(/£/);
    expect($('#report-cost').textContent).not.toMatch(/\$/);
  });
});
