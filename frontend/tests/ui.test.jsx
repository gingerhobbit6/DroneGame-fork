// @vitest-environment jsdom
// The React panels, driven by a real simulation with no 3D view.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { FUSION, WORLD, ADAPT, resetAllFigures, TOOLBAR } from '../src/sim/config/index.js';
import { view } from '../src/render/view.js';
import { GameContext } from '../src/ui/hooks.js';
import { useHotkeys } from '../src/ui/useHotkeys.js';
import { Hud } from '../src/ui/Hud.jsx';
import { Toolbar } from '../src/ui/Toolbar.jsx';
import { ControlPanel } from '../src/ui/ControlPanel.jsx';
import { Approvals, Toast, Tuning } from '../src/ui/Panels.jsx';
import { Sandbox } from '../src/ui/Sandbox.jsx';
import { Overlay } from '../src/ui/Overlay.jsx';
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

// A spotter on station, with no weapons left that could shoot it down first.
function setUpSpotter() {
  for (const st of game.sim.structures.slice()) if (st.def.role === 'effector') game.sim.commands.sell(st.pos.x, st.pos.z);
  const d = game.sim.spawnDrone('spotter', 1, {});
  d.pos.set(Math.cos(1) * 120, d.pos.y, Math.sin(1) * 120); // just outside its standoff radius
  for (let i = 0; i < 400 && game.sim.spotterBonus() === 0; i++) game.sim.step();
}

describe('HUD', () => {
  it('shows the run, and shows a hostile seed as text', () => {
    game = createGame({ seed: '<img src=x onerror=alert(1)>', terrainSeed: '<b>t</b>', api: createFakeApi(), storage: createFakeStorage() });
    show(<Hud />);
    expect($('#status img')).toBeNull();
    expect($('#status').textContent).toContain('<img src=x onerror=alert(1)>');
    expect($('#status').textContent).toContain('<b>t</b>');
    expect($('#budget')).toBeNull(); // the budget shows only in the sandbox
    expect($('#hud-spend').textContent).toBe('Spent $0: systems $0, shots and rounds $0');
  });
  it('reports spotters and the cost exchange during a run', () => {
    armed();
    show(<Hud />);
    game.sim.state.warnedWire = true;
    play(game.sim, 2);
    game.sim.state.health = 20;
    setUpSpotter();
    refresh();
    expect($('#status .warn').textContent).toMatch(/spotter on station/);
    expect($('#status').textContent).toMatch(/per \$1 destroyed/);
    expect($('#hud-ammo').textContent).toMatch(/Ammunition \d+ of \d+ left · \d+ loaded/);
    act(() => { game.sim.state.sandbox = true; game.bump(); });
    expect($('#health-fill').style.background).toMatch(/229|e53935/);
  }, 30000);
});

describe('toolbar', () => {
  it('opens and closes a list, and marks what you cannot afford', () => {
    show(<Toolbar />);
    fireEvent.click(screen.getByText('Laser'));
    expect(game.catalogue()).toBe('laser');
    expect($('.tool.active').textContent).toContain('Laser');
    expect($('.tool.active').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByText('Laser'));
    expect(game.catalogue()).toBeNull();
    expect(game.getTool()).toBeNull();
    fireEvent.click(screen.getByText('Sell'));
    expect($('.tool.active').textContent).toContain('Sell');
    game.sim.state.budget = 10;
    refresh();
    expect(document.querySelectorAll('.tool.poor').length).toBe(TOOLBAR.length);
  });
});

describe('control panel', () => {
  const panel = (props = {}) => show(<ControlPanel onToggleDock={vi.fn()} onToggleTuning={vi.fn()} onSandbox={vi.fn()} {...props} />);

  it('starts a wave and sets the speed', () => {
    armed();
    panel();
    game.sim.state.warnedWire = true;
    fireEvent.click($('#btn-wave'));
    expect(game.sim.state.wave).toBe(1);
    expect($('#btn-wave').disabled).toBe(true);
    expect($('#btn-wave').textContent).toBe('Wave 1 in progress');
    fireEvent.click($('[data-speed="3"]'));
    expect(game.clock).toMatchObject({ speed: 3, lastSpeed: 3 });
    expect($('[data-speed="3"]').className).toContain('active');
    fireEvent.click($('[data-speed="0"]'));
    expect(game.clock).toMatchObject({ speed: 0, lastSpeed: 3 });
  });

  it('toggles the view options, including the page class for tracks', () => {
    panel();
    fireEvent.click($('#truth'));
    expect(view.truth).toBe(false);
    fireEvent.click($('#labels-toggle'));
    expect(view.labels).toBe(false);
    fireEvent.click($('#rings'));
    expect(view.rings).toBe(false);
    fireEvent.click($('#track-hi'));
    expect(view.trackHi).toBe(true);
    expect(document.body.className).toContain('track-hi');
    fireEvent.click($('#auto'));
    expect(game.sim.state.autoStart).toBe(true);
    fireEvent.change($('#authority'), { target: { value: 'costly' } });
    expect(FUSION.authority).toBe('costly');
  });

  it('asks twice before throwing away the laydown', () => {
    vi.useFakeTimers();
    armed();
    panel();
    fireEvent.click($('#btn-clear'));
    expect($('#btn-clear').textContent).toBe('Sure? Click again');
    expect(game.sim.structures.length).toBe(MIXED.length);
    act(() => { vi.advanceTimersByTime(3100); });
    expect($('#btn-clear').textContent).toBe('Clear map');
    fireEvent.click($('#btn-clear'));
    fireEvent.click($('#btn-clear'));
    expect(game.sim.structures.length).toBe(0);
    vi.useRealTimers();
  });

  it('resets, opens the sandbox, and does nothing before deployment', () => {
    const onSandbox = vi.fn(), onToggleDock = vi.fn(), onToggleTuning = vi.fn();
    panel({ onSandbox, onToggleDock, onToggleTuning });
    fireEvent.click($('#btn-clear')); // not deployed yet, so this does nothing
    expect($('#btn-clear').textContent).toBe('Clear map');
    fireEvent.click($('#btn-reset'));
    armed();
    fireEvent.click($('#btn-sandbox'));
    expect(onSandbox).toHaveBeenCalled();
    expect(game.sim.state.sandbox).toBe(true);
    expect($('#btn-wave').textContent).toBe('Exit sandbox to start');
    fireEvent.click($('#btn-sandbox'));
    expect(game.sim.state.sandbox).toBe(false);
    fireEvent.click($('#btn-reset'));
    expect(game.sim.structures.length).toBe(MIXED.length);
    fireEvent.click($('#btn-sapient')); fireEvent.click($('#btn-tuning'));
    expect(onToggleDock).toHaveBeenCalled();
    expect(onToggleTuning).toHaveBeenCalled();
  });
});

describe('approvals', () => {
  it('pauses for a decision, and resumes when it is answered', () => {
    FUSION.authority = 'all';
    armed([['radar', 600, 0], ['rf', 900, 0], ['rf', -900, 0], ['interceptor', 490, 99]]);
    show(<Approvals />);
    game.sim.state.warnedWire = true;
    game.sim.commands.startWave();
    game.setSpeed(2);
    for (let i = 0; i < 6000 && !game.sim.net.pendingRequests.length; i++) game.sim.step();
    expect(game.clock.speed).toBe(0);
    refresh();
    expect($('#approval').className).not.toContain('hidden');
    expect($('.req-h').textContent).toBe('AUTHORISE ENGAGEMENT?');
    while (game.sim.net.pendingRequests.length) fireEvent.click(screen.getAllByText('Deny')[0]);
    expect(game.clock.speed).toBe(2);
    expect($('#approval').className).toContain('hidden');
  }, 30000);
});

describe('toasts', () => {
  it('show a message and fade it out', () => {
    vi.useFakeTimers();
    show(<Toast />);
    act(() => game.toast('hello'));
    expect($('#toast').textContent).toBe('hello');
    expect($('#toast').className).toBe('show');
    act(() => { vi.advanceTimersByTime(3000); });
    expect($('#toast').className).toBe('');
    vi.useRealTimers();
  });
});

describe('tuning', () => {
  it('commits valid numbers and restores invalid ones', () => {
    const before = WORLD.timeScale, adapt = ADAPT.evadePerWave;
    show(<Tuning open />);
    const [time, evade] = document.querySelectorAll('#tuning input');
    fireEvent.change(time, { target: { value: '9' } });
    expect(WORLD.timeScale).toBe(9);
    fireEvent.change(time, { target: { value: '0.1' } }); // under the minimum
    expect(WORLD.timeScale).toBe(9);
    expect(time.value).toBe('9');
    fireEvent.change(evade, { target: { value: '' } });
    expect(ADAPT.evadePerWave).toBe(adapt);
    WORLD.timeScale = before;
  });
  it('can be hidden', () => {
    show(<Tuning open={false} />);
    expect($('#tuning').className).toContain('hidden');
  });
});

describe('sandbox panel', () => {
  it('launches attacks from the form', () => {
    armed();
    show(<Sandbox />);
    expect($('#sandbox').className).toContain('hidden');
    act(() => game.commands.enterSandbox());
    expect($('#sandbox').className).not.toContain('hidden');
    fireEvent.change($('#sb-level'), { target: { value: '4' } });
    expect(game.sim.state.sbLevel).toBe(4);
    fireEvent.click($('[data-threat="fpv"]')); // it starts ticked: this takes it out of the mix
    expect($('#sb-launch').disabled).toBe(true);
    fireEvent.click($('[data-threat="fw"]'));
    fireEvent.change($('[data-count="fw"]'), { target: { value: '99' } });
    fireEvent.change($('#sb-dir'), { target: { value: 'rand' } });
    fireEvent.change($('#sb-gap'), { target: { value: '-3' } });
    fireEvent.click($('#sb-launch'));
    expect(game.sim.state.sbQueue.length).toBe(30);
    expect(game.sim.state.sbQueue.every((q) => q.type === 'fw' && q.t === game.sim.state.sbQueue[0].t)).toBe(true);
    fireEvent.click($('#sb-wave'));
    expect(game.sim.state.sbQueue.length).toBeGreaterThan(30);
    fireEvent.click($('#sb-clear'));
    expect($('#sb-info').textContent).toContain('0 drone(s) queued');
    fireEvent.click($('#sb-exit'));
    expect(game.sim.state.sandbox).toBe(false);
  });

  it('launches a mix of threats at once, and can tick a whole group', () => {
    armed();
    show(<Sandbox />);
    act(() => game.commands.enterSandbox());
    fireEvent.click($('[data-threat="fo"]'));
    expect($('#sb-launch').textContent).toBe('Launch 6 drones');
    fireEvent.click($('#sb-launch'));
    expect(game.sim.state.sbQueue.map((q) => q.type).sort()).toEqual(['fo', 'fo', 'fo', 'fpv', 'fpv', 'fpv']);
    fireEvent.click($('#sb-clear'));
    fireEvent.click($('#sb-untick'));
    expect($('#sb-launch').disabled).toBe(true);
    fireEvent.click($('[data-tick-all="Generic types"]'));
    fireEvent.change($('[data-count="fw"]'), { target: { value: '5' } });
    fireEvent.click($('[data-tick-all="Generic types"]')); // a count already typed stays
    expect($('#sb-launch').textContent).toBe('Launch 14 drones');
  });

  it('minimises to its title and live figures, keeps the form, and expands again', () => {
    armed();
    show(<Sandbox />);
    act(() => game.commands.enterSandbox());
    fireEvent.change($('[data-count="fpv"]'), { target: { value: '7' } });
    fireEvent.click($('#sb-minimise'));
    expect($('#sb-launch')).toBeNull();
    expect($('#sandbox h3').textContent).toBe('SANDBOX');
    expect($('#sb-info').textContent).toContain('in the air');
    expect($('#sb-minimise').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click($('#sb-minimise'));
    expect($('[data-count="fpv"]').value).toBe('7');
  });
});

describe('overlay', () => {
  it('deploys with the seeds typed in, and defaults blanks', () => {
    show(<Overlay />);
    fireEvent.click($('#btn-seed-random'));
    expect($('#seed-input').value).toMatch(/^\d{6}$/);
    fireEvent.change($('#seed-input'), { target: { value: ' 99 ' } });
    fireEvent.change($('#terrain-input'), { target: { value: '  ' } });
    fireEvent.click($('#btn-deploy'));
    expect(game.sim.state).toMatchObject({ started: true, seed: '99', terrainSeed: '1' });
    expect(location.search).toBe('?seed=99&terrain=1');
    expect($('#overlay')).toBeNull();
  });
  it('offers a retry when the site is lost', () => {
    armed([['rf', 900, 0]]);
    show(<Overlay />);
    play(game.sim, 8);
    refresh();
    expect($('.card h1').textContent).toBe('SITE LOST');
    fireEvent.click($('#btn-restart'));
    expect(game.sim.state.over).toBe(false);
    expect($('#overlay')).toBeNull();
    expect(game.sim.structures.length).toBe(1);
    play(game.sim, 8);
    refresh();
    fireEvent.click($('#btn-restart-clear'));
    expect(game.sim.structures.length).toBe(0);
  }, 30000);
});

describe('hotkeys', () => {
  function Keys() { useHotkeys(); return <input id="field" />; }
  const key = (k, target = window) => fireEvent.keyDown(target, { key: k });
  it('drive the tools, speed and view, but not while typing', () => {
    show(<Keys />);
    key('1');
    expect(game.getTool()).toBe('radar');
    key('Escape');
    expect(game.getTool()).toBeNull();
    key('Escape');
    key('x');
    expect(game.getTool()).toBe('sell');
    key(' ');
    expect(game.clock.speed).toBe(0);
    key(' ');
    expect(game.clock.speed).toBe(1);
    key('r'); key('T'); key('l');
    expect(view).toMatchObject({ rings: false, truth: false, labels: false });
    key('z');
    fireEvent.keyDown($('#field'), { key: '2' });
    expect(game.getTool()).toBe('sell');
    key('ArrowLeft'); key('ArrowRight');
  });
});
