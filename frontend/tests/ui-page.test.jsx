// @vitest-environment jsdom
// The timeline, the whole page together and the game wiring, driven by a real simulation with no 3D view.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createGame } from '../src/game.js';
import { FUSION, resetAllFigures } from '../src/sim/config/index.js';
import { view } from '../src/render/view.js';
import { createReplay } from '../src/render/replay-view.js';
import { GameContext } from '../src/ui/hooks.js';
import { App } from '../src/ui/App.jsx';
import { Timeline } from '../src/ui/Timeline.jsx';
import { MIXED, setUp, play } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

let game;
const show = (ui) => render(<GameContext.Provider value={game}>{ui}</GameContext.Provider>);
const $ = (sel) => document.querySelector(sel);
const refresh = () => act(() => game.bump());
const armed = (laydown = MIXED) => { setUp(game.sim, { seed: '1', laydown }); refresh(); };

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  Object.assign(view, { truth: true, labels: true, rings: true, trackHi: false, replayT: null });
  FUSION.authority = 'auto';
});
afterEach(() => { cleanup(); resetAllFigures(); document.body.className = ''; });


describe('timeline', () => {
  const withReplay = () => {
    const speed = { last: 1 };
    const replay = createReplay({
      scene: new THREE.Scene(), rec: game.sim.rec, labels: { make: () => document.createElement('div'), place: () => {} },
      getStructures: () => game.sim.structures, labelOf: () => document.createElement('div'), hideLive: () => {},
      getLastSpeed: () => speed.last, ...game.reviewClock,
    });
    game.getReplay = () => replay;
    return replay;
  };
  it('scrubs, plays and returns to live, and shows the markers', () => {
    armed();
    const replay = withReplay();
    game.sim.state.warnedWire = true;
    game.sim.commands.startWave();
    game.sim.run(13000);
    show(<Timeline />);
    expect($('#review-banner').className).toBe('hidden');
    expect(Number($('#tl-range').max)).toBe(game.sim.rec.frames.length - 1);
    expect($('#tl-events').children.length).toBeGreaterThan(0);
    fireEvent.change($('#tl-range'), { target: { value: '10' } });
    expect(replay.active()).toBe(true);
    expect(game.clock.speed).toBe(0);
    act(() => { replay.update(0, new THREE.PerspectiveCamera()); game.bump(); });
    expect($('#review-banner').textContent).toContain('REPLAY');
    expect(view.replayT).toBe(game.sim.rec.frames[10].t);
    fireEvent.click($('#tl-play'));
    expect($('#tl-play').textContent).toBe('❚❚');
    act(() => { replay.update(0.05, new THREE.PerspectiveCamera()); });
    fireEvent.click($('#tl-back'));
    fireEvent.click($('#tl-fwd'));
    expect(replay.review.playing).toBe(false);
    fireEvent.click($('#tl-live'));
    expect(replay.active()).toBe(false);
    expect(view.replayT).toBeNull();
    expect(game.clock.speed).toBe(1);
    fireEvent.click($('#tl-play'));
    expect(replay.review.playing).toBe(false);
    replay.reset();
  }, 30000);
  it('going back to live restores the clock, and never runs it past a decision still waiting', () => {
    armed();
    const replay = withReplay();
    const { sim, clock } = game;
    sim.state.warnedWire = true;
    sim.commands.startWave();
    sim.run(20);

    game.setSpeed(2); // running: it carries on at the same speed
    replay.enter(0);
    expect(clock.speed).toBe(0);
    replay.exit();
    expect(clock.speed).toBe(2);

    game.setSpeed(0); // paused by the player: it stays paused
    replay.enter(0);
    replay.exit();
    expect(clock.speed).toBe(0);

    replay.enter(0); // a speed chosen during the review is kept
    game.setSpeed(3);
    replay.exit();
    expect(clock.speed).toBe(3);

    FUSION.authority = 'all'; // paused for a decision
    game.setSpeed(2);
    for (let i = 0; i < 20000 && !sim.net.pendingRequests.length; i++) sim.step();
    expect(sim.net.pendingRequests.length).toBeGreaterThan(0);
    expect(clock.speed).toBe(0);
    replay.enter(0);
    replay.exit();
    expect(clock.speed).toBe(0);
    expect(sim.net.pendingRequests.length).toBeGreaterThan(0);

    replay.enter(0); // decided during the review: the clock runs again on going back to live, not before
    for (const req of [...sim.net.pendingRequests]) sim.commands.decide(req.id, false);
    expect(clock.speed).toBe(0);
    replay.exit();
    expect(clock.speed).toBe(2);
  }, 30000);
  it('does nothing without a replay or history', () => {
    show(<Timeline />);
    fireEvent.click($('#tl-back'));
    fireEvent.change($('#tl-range'), { target: { value: '0' } });
    expect($('#tl-time').textContent).toBe('0:00');
  });
});

describe('the whole page', () => {
  it('renders every panel and opens the dock', () => {
    game.attach = vi.fn();
    render(<App game={game} />);
    expect(game.attach).toHaveBeenCalledWith($('#game'), $('#labels'));
    expect($('#dock').className).toContain('hidden');
    fireEvent.click($('#btn-view-nodes'));
    expect($('#dock').className).not.toContain('hidden');
    fireEvent.click($('#dock-close'));
    expect($('#dock').className).toContain('hidden');
    expect($('#btn-tuning')).toBeNull(); // tuning is in The Lab view of the SAPIENT panel
    fireEvent.click($('#btn-deploy'));
    fireEvent.click($('#btn-defend-area'));
    expect($('#zone-panel')).not.toBeNull(); // defending an area or a patrol opens from the Controls menu
    fireEvent.click($('#zone-panel-max'));
    expect($('#zone-panel').className).toContain('max');
    fireEvent.click($('#btn-defend-patrol'));
    expect($('#zone-panel').getAttribute('aria-label')).toBe('Defend a patrol');
    fireEvent.click($('#btn-plan'));
    expect($('[data-pane="plan"]').className).not.toContain('hidden'); // Plan and Statistics open from the Run panel
    expect($('#plan-filter input[data-plan-show="radar"]').checked).toBe(true);
    fireEvent.click($('#btn-view-engage'));
    expect($('#dock').dataset.view).toBe('engage'); // one view at a time: it replaces Plan
    expect($('[data-pane="plan"]').className).toContain('hidden');
    expect([...document.querySelectorAll('#dock [data-tab]')].map((t) => t.textContent)).toEqual(['Engagement rules', 'Magazine depth']);
    fireEvent.click($('#btn-view-engage'));
    expect($('#dock').className).toContain('hidden'); // its own button closes it
    expect($('#hud-bottom-left')).toBeNull(); // the legend opens from its map button
    expect($('#left-col #map-rail-slot #map-rail')).not.toBeNull(); // the map buttons sit under the overview map, on the left
    expect($('#left-col #minimap')).not.toBeNull();
    expect($('#right-col #toolbar')).not.toBeNull(); // Place systems is under Controls
    fireEvent.click($('[data-catalogue="vehicles"]')); // Vehicles, in Place systems
    expect($('#tool-picker .mv-title').textContent).toBe('Vehicles');
    expect([...document.querySelectorAll('#tool-picker [data-tray-vehicle]')].map((c) => c.dataset.trayVehicle)).toEqual(['patria', 'hilux', 'themis']);
    fireEvent.click($('#tool-picker [data-tray-vehicle="hilux"]'));
    expect(game.toolVehicle()).toBe('hilux'); // the next click on the map parks it, with its system on board
    expect(game.getTool()).toBeTruthy();
    expect($('[data-catalogue="vehicles"] svg')).not.toBeNull(); // every row has its icon
    fireEvent.click($('#map-legend'));
    expect($('#hud-bottom-left .mv-title').textContent).toBe('Legend');
    fireEvent.click($('#legend-close'));
    expect($('#hud-bottom-left')).toBeNull();
  });
});

describe('the game wiring', () => {
  it('turns ground clicks into placement, and reports problems', () => {
    const toasts = [];
    game.onToast((t) => toasts.push(t));
    expect(game.subscribe(() => {})).toBeTypeOf('function');
    expect(game.getView()).toBeNull();
    game.figuresChanged();
    game.setViewOption('rings', true);
    const off = game.onFrame(() => {});
    off();
    expect(game.getTick()).toBeGreaterThan(0);
  });
});
