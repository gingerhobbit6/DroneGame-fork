// @vitest-environment jsdom
// The wizard on the real page, driven by a real simulation with no 3D view.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { FUSION, STRUCTURES, resetAllFigures } from '../src/sim/config/index.js';
import { view } from '../src/render/view.js';
import { App } from '../src/ui/App.jsx';
import { MIXED, setUp } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

const TRIANGLE = { points: [[0, 0], [50, 0], [50, 50]], closed: false };
let game;
const $ = (sel) => document.querySelector(sel);
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const click = (text) => fireEvent.click(button(text));
const refresh = () => act(() => game.bump());
const setView = (key, value) => act(() => game.setViewOption(key, value));
const title = () => $('#wizard h2').textContent;
const goToStep = (n) => fireEvent.click($(`[aria-label^="Step ${n}:"]`));
const page = () => { game.attach = vi.fn(); render(<App game={game} />); };
const deployed = () => { page(); fireEvent.click($('#btn-deploy')); };
const opened = () => { deployed(); fireEvent.click($('#btn-wizard')); };
const armed = () => { setUp(game.sim, { seed: '1', laydown: MIXED }); refresh(); };

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  Object.assign(view, { zone: null, spot: null, wizard: 'closed', coverageOn: false, coverageThreat: null });
  FUSION.authority = 'auto';
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('getting started', () => {
  it('shows the purpose, and no wizard, before deploying', () => {
    page();
    expect($('.card h1').textContent).toBe('Defend a site');
    expect($('.card').textContent).toContain('£11.3M');
    expect($('#btn-wizard')).toBeNull();
    expect($('#wizard')).toBeNull();
  });
  it('opens the wizard when asked to guide', () => {
    page();
    fireEvent.click($('#btn-guide'));
    expect(game.sim.state.started).toBe(true);
    expect(title()).toBe('Mark what you are defending');
  });
  it('stays out of the way for someone who knows the game, until the button is pressed', () => {
    deployed();
    expect($('#wizard')).toBeNull();
    expect($('#btn-wizard').textContent).toContain('Open the wizard');
    fireEvent.click($('#btn-wizard'));
    expect($('#wizard')).not.toBeNull();
    expect($('#btn-wizard').textContent).toContain('Close the wizard');
    fireEvent.click($('#btn-wizard'));
    expect($('#wizard')).toBeNull();
  });
  it('can go straight to the saved laydowns', () => {
    page();
    fireEvent.click($('#btn-load-saved'));
    expect($('#dock').className).not.toContain('hidden');
    expect($('[data-tab="saved"]').className).toBe('active');
  });
  it('collapses to a pill, and reopens from it', () => {
    opened();
    fireEvent.click($('[aria-label="Collapse the wizard"]'));
    expect($('#wizard')).toBeNull();
    expect($('#wizard-pill').textContent).toContain('Step 1 of 9');
    fireEvent.click($('#wizard-pill'));
    expect($('#wizard')).not.toBeNull();
    fireEvent.click($('[aria-label="Close the wizard"]'));
    expect($('#wizard')).toBeNull();
    expect($('#wizard-pill')).toBeNull();
  });
  it('explains why each step matters', () => {
    opened();
    expect($('.wz-why').textContent).toContain('Why draw a zone?');
  });
});

describe('placing systems', () => {
  it('walks through the sensors, suggesting a spot the game would allow', () => {
    opened();
    goToStep(2);
    expect($('.wz-tag.now').parentElement.textContent).toContain('Radar');
    expect($('#wz-advice').textContent).toContain('Warning it gives: Fixed-wing spotter');
    click('Show me a good spot');
    const picked = game.getTool();
    expect(STRUCTURES[picked].kind).toBe('radar');
    expect($('#wz-spot-why').textContent).toContain('the build area');
    const { x, z } = view.spot;
    expect(game.sim.canPlace(x, z, game.sim.structures[0]?.def ?? { cost: 0 })).toBe(true);
    act(() => { game.commands.place(picked, x, z); });
    expect(view.spot).toBeNull();
    expect($('.wz-tag.now').parentElement.textContent).toContain('RF detector');
  });
  it('changes what it recommends when you plan against one threat', () => {
    opened();
    goToStep(2);
    const every = $('#wz-advice').textContent;
    fireEvent.change($('#wz-threat'), { target: { value: 'fo' } });
    expect($('#wz-advice').textContent).not.toBe(every);
    expect($('#wz-advice').textContent).toContain('Warning it gives: Fibre-optic');
    expect($('#wz-advice').textContent).not.toContain('Fixed-wing');
    fireEvent.change($('#wz-threat'), { target: { value: '' } });
    expect($('#wz-advice').textContent).toBe(every);
  });
  it('keeps a system of that kind the player picked from the toolbar', () => {
    opened();
    goToStep(2);
    act(() => game.setTool('radar_l'));
    click('Show me a good spot');
    expect(game.getTool()).toBe('radar_l');
  });
  it('says why the last placement was refused, and when no spot is left', () => {
    game.lastRefusal = () => 'Too close to the station (minimum 250 m)';
    game.toast = vi.fn();
    opened();
    goToStep(2);
    expect($('.wz-warn').textContent).toContain('Too close to the station');
    act(() => { game.sim.state.budget = 0; });
    click('Show me a good spot');
    expect(view.spot).toBeNull();
    expect(game.toast).toHaveBeenCalled();
  });
  it('drops a suggested spot when the wizard closes', () => {
    opened();
    goToStep(2);
    click('Show me a good spot');
    expect(view.spot).not.toBeNull();
    fireEvent.click($('[aria-label="Close the wizard"]'));
    expect(view.spot).toBeNull();
  });
  it('rings the control it is talking about, if it can be seen', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 30, width: 100, height: 40 });
    opened();
    goToStep(2);
    expect($('#wizard-spot').style.left).toBe('16px');
    rect.mockReturnValue({ left: 0, top: 0, width: 0, height: 0 });
    refresh();
    expect($('#wizard-spot')).toBeNull();
    rect.mockRestore();
  });
  it('shows which weapon answers which drone, and what is missing', () => {
    opened();
    goToStep(3);
    expect($('.wz-matrix').textContent).toContain('Fibre-optic strike drone');
    expect($('.wz-warn').textContent).toMatch(/Nothing answers .* yet/);
    act(() => { armed(); });
    goToStep(3);
    expect($('.wz-matrix tr.gap')).toBeNull();
    click('Next');
    expect(title()).toBe('Connect it');
  });
  it('is done with sensors once every kind is in', () => {
    opened();
    act(() => { setUp(game.sim, { seed: '1', laydown: [...MIXED, ['acoustic', 0, 700]] }); refresh(); });
    goToStep(2);
    expect($('.wz-tag.now')).toBeNull();
    click('Next');
    expect(title()).toBe('Stop what you can see');
  });
});

describe('proving it', () => {
  const stepWith = (n) => { opened(); act(() => { armed(); }); goToStep(n); };

  it('opens the network tab and wires everything', () => {
    deployed();
    act(() => { game.sim.addStructure('radar', 30, 0); game.bump(); });
    fireEvent.click($('#btn-wizard'));
    goToStep(4);
    expect($('#dock').className).not.toContain('hidden');
    expect($('[data-tab="network"]').className).toBe('active');
    expect($('#wizard .wz-warn').textContent).toContain('1 of 1 systems are offline, and the fusion node has no terminal');
    click('Auto-wire for me');
    expect(game.sim.unwired().length).toBe(0);
    expect($('#wizard').textContent).toContain('All 1 systems are connected');
    click('Next');
    expect(title()).toBe('Check what it can see');
  });
  it('scores coverage and shows the weakest drone on the plan map', () => {
    stepWith(5);
    expect($('[data-tab="plan"]').className).toBe('active');
    expect(view.coverageOn).toBe(true);
    expect(view.coverageThreat).toBeTruthy();
    expect($('#cov-on').checked).toBe(true);
    expect($('#cov-threat').value).toBe(view.coverageThreat);
    expect(document.querySelectorAll('.wz-bars > div').length).toBe(4);
    click('Go back and add a sensor');
    expect(title()).toBe('See them first');
    expect($('#dock').className).toContain('hidden');
  });
  it('rehearses in the sandbox without touching the run', () => {
    stepWith(7);
    click('Enter the sandbox');
    expect(game.sim.state.sandbox).toBe(true);
    click('Launch 10');
    expect(game.sim.state.sbQueue.length).toBeGreaterThan(0);
    expect($('#wizard .wz-warn').textContent).toContain('waiting');
    click('Exit and go on');
    expect(game.sim.state.sandbox).toBe(false);
    expect(game.sim.structures.length).toBe(MIXED.length);
    expect(title()).toBe('Make the figures yours');
  });
  it('only counts a rehearsal that really happened', () => {
    stepWith(7);
    click('Next');
    goToStep(9);
    expect($('.wz-checks').textContent).toContain('Not rehearsed yet');
    goToStep(7);
    click('Enter the sandbox');
    click('Launch 10');
    goToStep(9);
    expect($('.wz-checks').textContent).toContain('Rehearsed in the sandbox');
  });
  it('points at the figures with no verified source', () => {
    const scroll = vi.fn();
    stepWith(8);
    expect($('[data-tab="systems"]').className).toBe('active');
    expect($('#wizard').textContent).toContain('OPTIONAL');
    const first = $('[data-pane="systems"] .fb.assumption');
    first.scrollIntoView = scroll;
    click('Show the first assumption');
    expect(scroll).toHaveBeenCalled();
    click('Skip');
    expect(title()).toBe('Ready to commit?');
  });
});

describe('committing', () => {
  const preflight = () => { opened(); act(() => { armed(); }); goToStep(9); };

  it('checks the laydown and sets who decides to fire', () => {
    preflight();
    expect($('.wz-checks').textContent).toContain('Sensors: 5 placed');
    expect($('.wz-checks').textContent).toContain('Network: all connected');
    expect($('.wz-checks').textContent).toContain('Not rehearsed yet');
    fireEvent.click([...document.querySelectorAll('#wizard input[type=radio]')][2]);
    expect(FUSION.authority).toBe('all');
    click('Save this laydown first');
    expect($('[data-tab="saved"]').className).toBe('active');
  });
  it('cannot start from inside the sandbox', () => {
    preflight();
    act(() => { game.commands.enterSandbox(); });
    expect(button('Exit the sandbox first').disabled).toBe(true);
  });
  it('steps back when the wave starts, with no tips during the run', () => {
    preflight();
    click('Start wave 1');
    expect(game.sim.state.wave).toBe(1);
    expect($('#wizard')).toBeNull();
    expect($('#wizard-pill')).toBeNull();
  });
  it('shows only what can still change when opened during a run', () => {
    preflight();
    click('Start wave 1');
    fireEvent.click($('#btn-wizard'));
    expect($('#wizard').textContent).toContain('THE RUN IS LIVE');
    expect(title()).toBe('Wave 1 in progress');
    expect($('#wizard').textContent).toContain('Nothing has reached the site');
    act(() => { game.sim.ledger.leaked.fo = 2; game.bump(); });
    expect($('#wizard').textContent).toContain('2 Fibre-optic strike drone');
    expect($('.wz-progress')).toBeNull();
  });
});

describe('following the game', () => {
  it('opens on the step the game is really at', () => {
    deployed();
    act(() => { armed(); });
    setView('zone', { ...TRIANGLE, closed: true });
    fireEvent.click($('#btn-wizard'));
    expect(title()).toBe('Check what it can see');
  });
  it('remembers a step you skipped when it opens again', () => {
    opened();
    click('Skip this step');
    fireEvent.click($('[aria-label="Close the wizard"]'));
    fireEvent.click($('#btn-wizard'));
    expect(title()).toBe('See them first');
  });
  it('says so when you sell your only radar, and lets you carry on', () => {
    opened();
    act(() => { armed(); });
    goToStep(5);
    act(() => { game.commands.sell(30, 0); });
    expect($('#wizard').textContent).toContain('BACK TO STEP 2 OF 9');
    expect(title()).toBe('You removed your only radar');
    click('Carry on');
    expect(title()).toBe('Check what it can see');
  });
  it('takes you back to the step that came undone', () => {
    opened();
    act(() => { armed(); });
    goToStep(5);
    act(() => { game.commands.sell(30, 0); });
    click('Go back to that step');
    expect(title()).toBe('See them first');
  });
  it('explains other things coming undone, and drops the warning once fixed', () => {
    opened();
    act(() => { armed(); });
    goToStep(9);
    act(() => { game.commands.clearAll(); });
    expect(title()).toBe('Something is offline');
    act(() => { game.commands.autoWire(); });
    expect(title()).toBe('Ready to commit?');
    // interceptors take fixed-wing drones too now, so take away every launcher to leave a drone type unanswered
    const launchers = game.sim.structures.filter((s) => s.def.id === 'missile' || s.def.id === 'interceptor');
    act(() => { for (const s of launchers) game.commands.sell(s.pos.x, s.pos.z); });
    expect(title()).toBe('A drone type has no answer now');
  });
  it('starts over on a new laydown', () => {
    opened();
    act(() => { armed(); });
    goToStep(5);
    act(() => { game.commands.reset('clear'); game.sim.state.started = true; });
    expect(title()).toBe('Mark what you are defending');
  });
  it('forgets skipped steps on a new laydown, even while collapsed', () => {
    opened();
    click('Skip this step');
    fireEvent.click($('[aria-label="Collapse the wizard"]'));
    act(() => { game.commands.reset('clear'); game.sim.state.started = true; });
    fireEvent.click($('#wizard-pill'));
    expect(title()).toBe('Mark what you are defending');
  });
});

