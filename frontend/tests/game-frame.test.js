// @vitest-environment jsdom
// Exercise the real frame loop and labels while replacing the WebGL surface with a small drawing adapter.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import { createGame } from '../src/game.js';
import { WORLD } from '../src/sim/config/index.js';
import { createGameView } from '../src/render/game-view.js';
import { createLabels } from '../src/render/labels.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

vi.mock('../src/render/game-view.js', () => ({ createGameView: vi.fn() }));
vi.mock('../src/render/placement.js', async (importOriginal) => ({
  ...await importOriginal(),
  createPlacement: () => ({ update() {}, refresh() {} }),
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
