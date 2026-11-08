// The November performance audit's fixes outside the simulation: each keeps its answer while doing less work.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { paintPictures } from '../src/render/map-texture.js';
import { groundHit } from '../src/render/placement.js';
import { createSimulation } from '../src/sim/simulation.js';
import { hereU, u } from '../src/sim/units.js';
import { coverageGrid } from '../src/ui/coverage.js';

let sim;
beforeAll(() => { sim = createSimulation({ seed: '1', terrainSeed: '7' }); sim.commands.deploy('1', '7'); });

describe('the ground under the cursor', () => {
  const camera = new PerspectiveCamera(45, 16 / 9, 0.02, 8000);
  const ray = new Raycaster(), at = new Vector3();
  const aim = (x, y) => { ray.setFromCamera(new Vector2(x, y), camera); return groundHit(ray.ray, camera.far, at); };

  it('is on the ray and on the ground, wherever the cursor is', () => {
    camera.position.set(0, 300, 380); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    for (const [x, y] of [[0, 0], [0.8, -0.6], [-0.9, 0.3], [0.2, 0.9]]) {
      expect(aim(x, y)).not.toBeNull();
      expect(Math.abs(at.y - hereU(at.x, at.z))).toBeLessThan(u(0.5)); // within half a metre of the ground
      const along = at.clone().sub(ray.ray.origin), t = along.length();
      expect(along.normalize().dot(ray.ray.direction)).toBeCloseTo(1, 6);
      const before = ray.ray.at(t - u(20), new Vector3());
      expect(before.y).toBeGreaterThan(hereU(before.x, before.z)); // the first ground it meets, not a hill behind
    }
  });

  it('misses when the cursor is on the sky', () => {
    camera.position.set(0, 5, 0); camera.lookAt(100, 40, 0); camera.updateMatrixWorld();
    expect(aim(0, 0.5)).toBeNull();
  });
});

describe('a map picture', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is decoded at the size it is drawn, not at its own', async () => {
    const asked = [];
    vi.stubGlobal('createImageBitmap', async (blob, options) => { asked.push(options); return { close() {} }; });
    const f = { g: { drawImage() {} }, west: 0, top: 10000, span: 10000, px: (m) => m / 10 };
    await paintPictures(f, [{ layer: 'osmap', west: 0, top: 10000, width: 4000, height: 2500, blob: 'piece' }], 'osmap', () => true);
    expect(asked).toEqual([{ resizeWidth: 400, resizeHeight: 250, resizeQuality: 'high' }]);
  });
});

describe('the coverage map', () => {
  it('keeps its grid while an escort walks within a cell, but not when a system moves', () => {
    expect(sim.commands.place('rf', 10, 10)).toBeNull();
    const s = sim.structures.at(-1);
    s.escort = true;
    const walking = coverageGrid(sim, 'fpv');
    s.pos.x += u(30);
    expect(coverageGrid(sim, 'fpv')).toBe(walking);
    s.escort = false;
    const fixed = coverageGrid(sim, 'fpv');
    s.pos.x += u(30);
    expect(coverageGrid(sim, 'fpv')).not.toBe(fixed);
  });
});
