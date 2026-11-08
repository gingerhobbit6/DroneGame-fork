// @vitest-environment jsdom
// The zone, moving the popup and the debrief on the real page, driven by a real simulation with no 3D view.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { FUSION, resetAllFigures } from '../src/sim/config/index.js';
import { view } from '../src/render/view.js';
import { App } from '../src/ui/App.jsx';
import { placed } from '../src/ui/useMovable.js';
import { GameContext } from '../src/ui/hooks.js';
import { Overlay } from '../src/ui/Overlay.jsx';
import { MIXED, play, setUp } from './support/scenarios.js';
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

describe('the zone', () => {
  it('lets you draw as soon as the step opens, and stops when you leave', () => {
    opened();
    expect(game.getTool()).toBe('zone');
    click('Skip this step');
    expect(title()).toBe('See them first');
    expect(game.getTool()).toBeNull();
  });
  it('closes only with three points', () => {
    opened();
    expect(button('Close the zone').disabled).toBe(true);
    setView('zone', TRIANGLE);
    click('Close the zone');
    expect(view.zone.closed).toBe(true);
    expect(game.getTool()).toBeNull();
    click('Next');
    expect(title()).toBe('See them first');
  });
  it('leaves another tool alone when the zone is closed by the button', () => {
    opened();
    setView('zone', TRIANGLE);
    act(() => game.setTool('radar'));
    click('Close the zone');
    expect(view.zone.closed).toBe(true);
    expect(game.getTool()).toBe('radar');
  });
  it('undoes a point, offers a ready-made ring, and can redraw', () => {
    opened();
    setView('zone', TRIANGLE);
    click('Undo point');
    expect(view.zone.points.length).toBe(2);
    click('Use a 1 km ring');
    expect(view.zone.closed).toBe(true);
    expect(game.getTool()).toBeNull();
    click('Redraw');
    expect(view.zone).toBeNull();
    expect(game.getTool()).toBe('zone');
  });
  it('keeps the zone over a reset of the same laydown, but not a new one', () => {
    deployed();
    setView('zone', { ...TRIANGLE, closed: true });
    act(() => game.commands.reset('keep'));
    expect(view.zone).not.toBeNull();
    act(() => game.commands.reset('clear'));
    expect(view.zone).toBeNull();
  });
  it('is saved with a laydown and comes back when it is loaded', async () => {
    opened();
    fireEvent.click($('[aria-label="Close the wizard"]'));
    setView('zone', { ...TRIANGLE, closed: true });
    fireEvent.click($('#btn-sapient'));
    fireEvent.click($('[data-tab="saved"]'));
    fireEvent.change($('#save-name'), { target: { value: 'with a zone' } });
    await act(async () => { fireEvent.submit($('#save-laydown').closest('form')); });
    expect(game.api.laydowns.rows.get(1).spec.zone).toEqual(TRIANGLE.points);
    setView('zone', null);
    const load = button('Load');
    fireEvent.click(load);
    await act(async () => { fireEvent.click(load); });
    expect(view.zone).toEqual({ points: TRIANGLE.points, closed: true });
  });
});

describe('drawing the area without the wizard', () => {
  const openPanel = () => { deployed(); fireEvent.click($('#map-zone')); };

  it('starts drawing from the map rail, closes the area and scores it', () => {
    openPanel();
    expect(game.getTool()).toBe('zone');
    expect($('#wizard')).toBeNull();
    expect($('#zone-finish').disabled).toBe(true);
    setView('zone', { points: TRIANGLE.points, closed: false });
    expect($('#zone-panel').textContent).toContain('3 points so far');
    fireEvent.click($('#zone-finish'));
    expect(view.zone.closed).toBe(true);
    expect(game.getTool()).toBe(null);
    expect(document.querySelectorAll('#zone-panel .wz-bars > div').length).toBeGreaterThan(0);
  });
  it('undoes a point, redraws and clears', () => {
    openPanel();
    setView('zone', { points: TRIANGLE.points, closed: false });
    fireEvent.click($('#zone-undo'));
    expect(view.zone.points.length).toBe(2);
    fireEvent.click($('#zone-clear'));
    expect(view.zone).toBe(null);
    setView('zone', { points: TRIANGLE.points, closed: true });
    fireEvent.click($('#map-zone')); // closing the panel stops drawing
    expect(game.getTool()).toBe(null);
    fireEvent.click($('#map-zone')); // an area is already drawn, so opening shows it and leaves the map clicks alone
    expect(game.getTool()).toBe(null);
    fireEvent.click($('#zone-redraw'));
    expect(view.zone).toBe(null);
    expect(game.getTool()).toBe('zone');
  });
  it('leaves a system being placed alone when it closes', () => {
    deployed();
    setView('zone', { points: TRIANGLE.points, closed: true });
    fireEvent.click($('#map-zone'));
    act(() => game.setTool('radar'));
    fireEvent.click($('#map-zone'));
    expect(game.getTool()).toBe('radar');
  });
  it('makes way for the map panel', () => {
    openPanel();
    expect($('#zone-panel')).not.toBeNull();
    setView('mapPanel', true);
    expect($('#zone-panel')).toBeNull();
    setView('mapPanel', false);
  });
});

describe('moving it out of the way', () => {
  const BOX = { left: 262, top: 400, width: 300, height: 300 };
  const dragTo = (el, x, y) => {
    fireEvent.pointerDown(el, { button: 0, clientX: 300, clientY: 410 });
    fireEvent.pointerMove(el, { clientX: x, clientY: y });
    fireEvent.pointerUp(el);
  };
  let rect;
  beforeEach(() => { rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX); });
  afterEach(() => rect.mockRestore());

  it('follows a drag on its header and stays put between steps', () => {
    opened();
    dragTo($('.wz-head'), 500, 110);
    expect($('#wizard').style.left).toBe('462px');
    expect($('#wizard').style.top).toBe('100px');
    goToStep(2);
    expect($('#wizard').style.left).toBe('462px');
  });
  it('anchors to the nearer edge, so it can never run off the screen', () => {
    const fixed = { position: 'fixed', right: 'auto', width: BOX.width };
    expect(placed(100, 50, BOX, 1600, 900)).toEqual({ ...fixed, left: 100, top: 50, bottom: 'auto', maxHeight: 838, transform: 'none' });
    expect(placed(100, 500, BOX, 1600, 900)).toEqual({ ...fixed, left: 100, top: 'auto', bottom: 100, maxHeight: 788, transform: 'none' });
    expect(placed(-50, 5000, BOX, 1600, 900)).toEqual({ ...fixed, left: 0, top: 'auto', bottom: 0, maxHeight: 888, transform: 'none' });
    expect(placed(5000, -50, BOX, 1600, 900)).toEqual({ ...fixed, left: 1300, top: 0, bottom: 'auto', maxHeight: 888, transform: 'none' });
  });
  it('still lets the header buttons work, and ignores a right-click', () => {
    opened();
    dragTo($('[aria-label="Collapse the wizard"]'), 500, 110);
    expect($('#wizard').style.left).toBe('');
    fireEvent.pointerDown($('.wz-head'), { button: 2, clientX: 300, clientY: 410 });
    fireEvent.pointerMove($('.wz-head'), { clientX: 500, clientY: 110 });
    expect($('#wizard').style.left).toBe('');
  });
  it('goes home on a double-click or when the window changes size', () => {
    opened();
    dragTo($('.wz-head'), 500, 110);
    fireEvent.doubleClick($('.wz-head'));
    expect($('#wizard').style.left).toBe('');
    dragTo($('.wz-head'), 500, 110);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect($('#wizard').style.left).toBe('');
  });
  it('moves the sandbox panel by its title', () => {
    deployed();
    act(() => { game.commands.enterSandbox(); });
    dragTo($('#sandbox h3'), 500, 110);
    expect($('#sandbox').style.left).toBe('462px');
    expect($('#sandbox').style.top).toBe('100px');
    fireEvent.doubleClick($('#sandbox h3'));
    expect($('#sandbox').style.left).toBe('');
  });
  it('moves the approval card, which keeps its place for the next request, and its buttons still answer', () => {
    deployed();
    game.commands.decide = vi.fn();
    const pending = game.sim.net.pendingRequests;
    pending.push({ id: 'r1', text: 'Engage T1?' });
    refresh();
    dragTo($('#approval .mv-bar'), 500, 110);
    expect($('#approval').style.left).toBe('462px');
    expect($('#approval').style.transform).toBe('none');
    dragTo(button('Approve'), 700, 300);
    expect($('#approval').style.left).toBe('462px');
    click('Approve');
    expect(game.commands.decide).toHaveBeenCalledWith('r1', true);
    pending.length = 0;
    refresh();
    pending.push({ id: 'r2', text: 'Engage T2?' });
    refresh();
    expect($('#approval').style.left).toBe('462px');
    pending.length = 0;
  });
  it('keeps its place when collapsed, and a drag on the pill does not open it', () => {
    opened();
    dragTo($('.wz-head'), 500, 110);
    fireEvent.click($('[aria-label="Collapse the wizard"]'));
    expect($('#wizard-pill').style.left).toBe('462px');
    dragTo($('#wizard-pill'), 600, 110);
    fireEvent.click($('#wizard-pill'));
    expect($('#wizard')).toBeNull();
    expect($('#wizard-pill').style.left).toBe('562px');
    fireEvent.pointerDown($('#wizard-pill'), { button: 0, clientX: 300, clientY: 410 });
    fireEvent.pointerUp($('#wizard-pill'));
    fireEvent.click($('#wizard-pill'));
    expect($('#wizard')).not.toBeNull();
  });
});

describe('the debrief', () => {
  const lost = () => { setUp(game.sim, { seed: '1', laydown: [['rf', 900, 0]] }); play(game.sim, 8); };

  it('shows what got through, with the worst highlighted', () => {
    lost();
    render(<GameContext.Provider value={game}><Overlay /></GameContext.Provider>);
    expect($('.card h1').textContent).toBe('SITE LOST');
    expect($('#debrief tr.gap')).not.toBeNull();
    expect($('#debrief').textContent).toContain('did the most damage');
    expect($('#btn-first-leak')).toBeNull(); // nothing to review with, without a 3D view
  });
  it('goes back to the first leak, then back to the results', () => {
    lost();
    const replay = { enter: vi.fn(), exit: vi.fn() };
    game.getReplay = () => replay;
    render(<GameContext.Provider value={game}><Overlay /></GameContext.Provider>);
    fireEvent.click($('#btn-first-leak'));
    expect(replay.enter).toHaveBeenCalled();
    expect($('#overlay')).toBeNull();
    fireEvent.click($('#btn-results'));
    expect(replay.exit).toHaveBeenCalled();
    expect($('#overlay')).not.toBeNull();
  });
  it('closes the review when a new run starts', () => {
    lost();
    game.getReplay = () => ({ enter: vi.fn(), exit: vi.fn() });
    render(<GameContext.Provider value={game}><Overlay /></GameContext.Provider>);
    fireEvent.click($('#btn-first-leak'));
    act(() => { game.commands.reset('keep'); });
    expect($('#btn-results')).toBeNull();
  });
});
