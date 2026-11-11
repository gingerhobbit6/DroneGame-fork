// @vitest-environment jsdom
// Exercise the real frame loop and labels while replacing the WebGL surface with a small drawing adapter.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import { createGame } from '../src/game.js';
import { WORLD } from '../src/sim/config/index.js';
import { UNIT_FIELDS } from '../src/sim/unit-config.js';
import { createGameView } from '../src/render/game-view.js';
import { createPlacement } from '../src/render/placement.js';
import { createLabels } from '../src/render/labels.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

vi.mock('../src/render/game-view.js', () => ({ createGameView: vi.fn() }));
vi.mock('../src/render/placement.js', async (importOriginal) => ({
  ...await importOriginal(),
  createPlacement: vi.fn(() => ({ update() {}, refresh() {} })),
}));
vi.mock('../src/render/replay-view.js', () => ({
  createReplay: () => ({ update() {}, active: () => false }),
}));

const radius = WORLD.radius;
beforeAll(() => { WORLD.radius = 3000; }); // label frame behaviour does not depend on the terrain extent
afterAll(() => { WORLD.radius = radius; });

describe('covered frames', () => {
  it('does not retain covered labels when the game becomes visible again', () => {
    const game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
    game.debug.frozen = true;
    const camera = new PerspectiveCamera(), layer = document.createElement('div');
    camera.updateMatrixWorld();
    const labels = createLabels(layer, camera);
    const old = labels.make('Old system', '#fff', 'slabel'), current = labels.make('Current system', '#fff', 'slabel');
    const rect = { left: 0, top: 0, right: 60, bottom: 14 };
    old.getBoundingClientRect = vi.fn(() => rect);
    current.getBoundingClientRect = vi.fn(() => rect);
    let frame, placed = old;
    const draw = vi.fn(() => labels.declutter());
    vi.mocked(createGameView).mockReturnValue({
      scene: new Scene(), camera, labels, structures: { labelOf() {} }, hideLive() {},
      start: (run) => { frame = run; },
      update: () => labels.place(placed, 0, 0, -5, true), draw,
    });
    game.attach(document.createElement('canvas'), layer);
    game.setCovered(true);
    for (let n = 0; n < 1000; n++) frame();
    expect(draw).not.toHaveBeenCalled();
    placed = current;
    game.setCovered(false);
    frame();
    expect(draw).toHaveBeenCalledTimes(1);
    expect(old.getBoundingClientRect).not.toHaveBeenCalled();
    expect(current.style.display).toBe('block');
  });
});

// A started game attached to a view with no WebGL. under.tagged is the system whose name tag a click lands on.
function attached(under = {}) {
  const game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  game.debug.frozen = true;
  game.sim.state.started = true;
  const camera = new PerspectiveCamera(), canvas = document.createElement('canvas');
  let frame;
  vi.mocked(createGameView).mockReturnValue({
    scene: new Scene(), camera, labels: { beginFrame() {} }, structures: { labelOf() {}, labelAt: () => under.tagged }, hideLive() {},
    start: (run) => { frame = run; }, update() {}, draw() {},
  });
  game.attach(canvas, document.createElement('div'));
  return { game, camera, canvas, frame: () => frame() };
}

describe('a fault in a frame', () => {
  it('pauses the game and says so once, and goes on drawing', () => {
    let now = 0;
    const time = vi.spyOn(performance, 'now').mockImplementation(() => (now += 100)); // every frame is a long one, so each owes a step
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { game, frame } = attached();
    const step = vi.spyOn(game.sim, 'step').mockImplementation(() => { throw new Error('broken step'); });
    const draw = vi.spyOn(game.getView(), 'draw'), toasts = [];
    game.onToast((text) => toasts.push(text));
    game.debug.frozen = false;
    for (let n = 0; n < 5; n++) frame();
    expect(step).toHaveBeenCalledTimes(1); // not tried again on every frame
    expect(game.clock.speed).toBe(0);
    expect(toasts).toEqual([expect.stringMatching(/error.*paused.*Reset run/)]);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledTimes(4);
    game.setSpeed(1); // the player presses play, and the step fails again
    frame();
    expect(game.clock.speed).toBe(0);
    expect(toasts).toHaveLength(2);
    frame();
    game.onFrame(() => { throw new Error('broken panel'); }); // a fault that comes back on every frame is reported once
    for (let n = 0; n < 5; n++) frame();
    expect(toasts).toHaveLength(3);
    time.mockRestore(); logged.mockRestore();
  });
});

describe('the Remove tool', () => {
  it('leaves a patrol escort alone, and the system beside it', () => {
    const under = {}, { game } = attached(under);
    expect(game.commands.place('radar', 30, 0)).toBeNull();
    expect(game.commands.place('rf', 34, 0)).toBeNull();
    const [escort, neighbour] = game.sim.structures;
    escort.escort = true;
    game.setTool('sell');
    const { onSelect } = vi.mocked(createPlacement).mock.calls.at(-1)[0];
    under.tagged = escort;
    expect(onSelect(0, 0)).toBe(true); // the click is still about a system, so the ground under it is not used
    expect(game.sim.structures).toEqual([escort, neighbour]);
    under.tagged = neighbour;
    expect(onSelect(0, 0)).toBe(true);
    expect(game.sim.structures).toEqual([escort]);
  });
});

describe('the placement preview', () => {
  it('is judged at the price of the settings chosen in the list, as the click is', async () => {
    const real = await vi.importActual('../src/render/placement.js');
    vi.mocked(createPlacement).mockImplementationOnce(real.createPlacement);
    const { game, camera, canvas, frame } = attached();
    camera.position.set(30, 40, 10); camera.lookAt(30, 0, 0); camera.updateMatrixWorld();
    const judged = vi.spyOn(game.sim, 'canPlace');
    game.sim.state.budget = 1000000;
    game.setTool('radar');
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: innerWidth / 2, clientY: innerHeight / 2 }));
    frame();
    expect(judged).toHaveLastReturnedWith(true);
    game.setLoadout('radar', UNIT_FIELDS.find((f) => f.key === 'mount'), 35); // a taller mast than the budget has left for
    frame();
    expect(judged).toHaveLastReturnedWith(false);
    const at = game.cursor();
    expect(game.placeSystem(at.x, at.z)).toContain('Not enough budget');
  });
});
