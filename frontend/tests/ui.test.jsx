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
import { Approvals, Toast, TuningFields } from '../src/ui/Panels.jsx';
import { Sandbox } from '../src/ui/Sandbox.jsx';
import { Overlay } from '../src/ui/Overlay.jsx';
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
    expect($('#budget').textContent).toMatch(/^£/); // what is left to spend, and the site's integrity, show throughout a run
    expect($('#health-num').textContent).toBe('100%');
    expect($('#hud-spend').textContent).toBe('Spent £0: systems £0, shots and rounds £0');
  });
  it('counts the drones that came down on your own systems, and the systems lost: they are neither kills nor leaks', () => {
    armed();
    show(<Hud />);
    expect($('#hud-systems')).toBeNull(); // nothing to say yet, and the box is tall enough
    game.sim.ledger.flights.push({ type: 'fpv', wave: 1, seen: {}, shots: {}, engaged: null, end: 'struck' });
    game.sim.ledger.lost.radar = 1;
    refresh();
    expect([$('#struck').textContent, $('#lost').textContent, $('#kills').textContent, $('#leaks').textContent]).toEqual(['1', '1', '0', '0']);
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
    expect($('#status').textContent).toMatch(/per £1 destroyed/);
    expect($('#hud-ammo').textContent).toMatch(/Ammunition \d+ of \d+ left · \d+ loaded/);
    expect($('#health-fill').style.background).toMatch(/229|e53935/); // red, in a real run and not only in the sandbox
    expect($('#health-num').textContent).toBe('20%');
  }, 30000);
  it('gives the evasion of the level chosen in the sandbox, which is what its drones get', () => {
    show(<Hud />);
    const evasion = () => $('#hud-top-left').textContent.match(/first-person-view ([\d.]+)/)[1];
    const wave1 = evasion();
    act(() => { game.sim.state.sandbox = true; game.sim.state.sbLevel = 6; game.bump(); });
    expect(Number(evasion())).toBeLessThan(Number(wave1));
    expect(Number(evasion())).toBe(Number(game.sim.spawnDrone('fpv', 0, {}).evade.toFixed(2)));
  });
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
    fireEvent.click(screen.getByText('Remove'));
    expect($('.tool.active').textContent).toContain('Remove');
    expect($('#tool-sell').textContent).toContain('% back'); // buying on a budget, so a refund
    game.sim.state.budget = 10;
    refresh();
    expect(document.querySelectorAll('.tool.poor').length).toBe(TOOLBAR.length);
    game.sim.state.packed = true; // a deployed pack has no budget, so Remove offers no refund
    refresh();
    expect($('#tool-sell').textContent).not.toContain('% back');
    game.sim.state.packed = false;
  });
});

describe('control panel', () => {
  // the Controls menu, and the Run panel that now holds the attack, sandbox, reset and clear buttons
  const panel = ({ onView = vi.fn(), onSandbox = vi.fn() } = {}) => show(<><ControlPanel onView={onView} /><Hud openDock={vi.fn()} onView={onView} onSandbox={onSandbox} /></>);

  it('starts a wave and sets the speed', () => {
    armed();
    panel();
    game.sim.state.warnedWire = true;
    fireEvent.click($('#btn-wave'));
    expect(game.sim.state.wave).toBe(1);
    expect($('#btn-wave').disabled).toBe(true);
    expect($('#btn-wave').textContent).toBe('Wave 1 in progress');
    expect([...document.querySelectorAll('[data-speed]')].map((b) => b.textContent)).toEqual(['1×', '2×', '3×', '4×', '5×', '10×']);
    fireEvent.click($('[data-speed="3"]'));
    expect(game.clock).toMatchObject({ speed: 3, lastSpeed: 3 });
    expect($('[data-speed="3"]').className).toContain('active');
    fireEvent.click($('#speed-play'));
    expect(game.clock).toMatchObject({ speed: 0, lastSpeed: 3 });
    expect($('#speed-control').className).toBe('paused');
    expect($('#speed-play').getAttribute('aria-label')).toBe('Play at 3x');
    fireEvent.click($('#speed-play'));
    expect(game.clock.speed).toBe(3);
    fireEvent.click($('[data-speed="10"]'));
    expect(game.clock).toMatchObject({ speed: 10, lastSpeed: 10 });
  });

  it('says that starting locks the laydown, and keeps the wiring warning up until it is put right', () => {
    armed();
    panel();
    expect($('#btn-wave').dataset.note).toBe('locks systems and wiring'); // drawn under the button's own text
    expect($('#btn-wave').title).toMatch(/locks your systems and wiring for the whole run/);
    expect($('#btn-wave').textContent).toBe('Start wave 1');
    expect($('#wire-warning')).toBeNull();
    act(() => { game.sim.commands.wireNode(game.sim.structures[0], null); });
    fireEvent.click($('#btn-wave')); // the first press only warns
    expect(game.sim.state.wave).toBe(0);
    expect($('#wire-warning').textContent).toMatch(/1 system has no network link and will be offline/);
    expect($('#wire-warning').getAttribute('role')).toBe('alert');
    fireEvent.click($('#btn-wire-start'));
    expect(game.sim.unwired()).toEqual([]);
    expect(game.sim.state.wave).toBe(1);
    expect($('#wire-warning')).toBeNull();
    expect($('#btn-wave').dataset.note).toBeUndefined();
  });
  it('can start with a system left unwired, when told to', () => {
    armed();
    panel();
    act(() => { game.sim.commands.wireNode(game.sim.structures[0], null); });
    fireEvent.click($('#btn-wave'));
    fireEvent.click($('#btn-start-anyway'));
    expect(game.sim.state.wave).toBe(1);
    expect(game.sim.unwired()).toHaveLength(1);
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
    const onSandbox = vi.fn(), onView = vi.fn();
    panel({ onSandbox, onView });
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
    fireEvent.click($('#btn-view-nodes'));
    expect(onView).toHaveBeenCalledWith('nodes');
    fireEvent.click($('#btn-plan'));
    expect(onView).toHaveBeenCalledWith('plan');
    expect($('#btn-tuning')).toBeNull(); // tuning is in The Lab view of the SAPIENT panel
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
    for (let i = 0; i < 9000 && !game.sim.net.pendingRequests.length; i++) game.sim.step(); // the first request comes about 310 s in
    expect(game.clock.speed).toBe(0);
    refresh();
    expect($('#approval').className).not.toContain('hidden');
    expect($('.req-h').textContent).toBe('AUTHORISE ENGAGEMENT?');
    while (game.sim.net.pendingRequests.length) fireEvent.click(screen.getAllByText('Deny')[0]);
    expect(game.clock.speed).toBe(2);
    expect($('#approval').className).toContain('hidden');
  }, 30000);
});

describe('the timeline\'s notes', () => {
  it('shows the fusion node\'s warnings for a while, but not its news or an engagement request', () => {
    armed();
    show(<Timeline />);
    expect($('#tl-alerts').children.length).toBe(0);
    const { net } = game.sim;
    act(() => {
      net.raiseAlert('information', 'New track T1 confirmed');
      net.raiseAlert('warning', 'Engagement request: Authorise Interceptor drones 01 to engage T1?');
      net.raiseAlert('warning', 'Lost contact with Radar 01: no terminal wired');
      net.raiseAlert('critical', 'Radar 01 destroyed');
      game.bump();
    });
    expect([...$('#tl-alerts').children].map((r) => r.className)).toEqual(['warn', 'crit']);
    expect($('#tl-alerts').textContent).toContain('0:00 Lost contact with Radar 01: no terminal wired');
    expect(screen.getByRole('log')).toBe($('#tl-alerts')); // a screen reader announces each one
    const steps = (seconds) => seconds / 0.05;
    game.sim.run(steps(20 * WORLD.timeScale) - 20); // nearly 20 real seconds at 1x
    refresh();
    expect($('#tl-alerts').children.length).toBe(2);
    game.sim.run(40);
    refresh();
    expect($('#tl-alerts').children.length).toBe(0);
  });
  it('says when the clock is stopped', () => {
    armed();
    show(<Timeline />);
    expect($('#tl-paused')).toBeNull();
    act(() => game.setSpeed(0));
    expect($('#tl-paused').textContent).toBe('PAUSED');
    expect($('#tl-paused').title).toMatch(/Press Space/);
    expect($('#timeline').className).toContain('paused');
    act(() => game.setSpeed(1));
    expect($('#tl-paused')).toBeNull();
  });
});

describe('toasts', () => {
  it('show a message and fade it out', () => {
    vi.useFakeTimers();
    show(<Toast />);
    act(() => game.toast('hello'));
    expect($('#toast').textContent).toBe('hello');
    expect($('#toast').className).toBe('show');
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite'); // a screen reader announces it
    act(() => { vi.advanceTimersByTime(3000); });
    expect($('#toast').className).toBe('');
    vi.useRealTimers();
  });
});

describe('tuning', () => {
  it('commits valid numbers and restores invalid ones', () => {
    const before = WORLD.timeScale, adapt = ADAPT.evadePerWave;
    show(<TuningFields />);
    const [time, evade] = document.querySelectorAll('#tuning input');
    fireEvent.change(time, { target: { value: '9' } });
    expect(WORLD.timeScale).toBe(9);
    fireEvent.change(time, { target: { value: '0.1' } }); // under the minimum
    expect(WORLD.timeScale).toBe(9);
    expect(time.value).toBe('9');
    fireEvent.change(time, { target: { value: '1000' } }); // a slip that would have the frame loop at its cap on every frame
    expect(WORLD.timeScale).toBe(20);
    expect(time.value).toBe('20');
    fireEvent.change(evade, { target: { value: '' } });
    expect(ADAPT.evadePerWave).toBe(adapt);
    WORLD.timeScale = before;
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
    expect([...document.querySelectorAll('.card .mv-title')].map((t) => t.textContent)).toEqual(['Start']); // movable like every box
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
    expect($('.card .mv-title').textContent).toBe('Results');
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
