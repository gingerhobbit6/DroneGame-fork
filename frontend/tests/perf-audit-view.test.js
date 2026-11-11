// The November performance audit's fixes outside the simulation: each keeps its answer while doing less work.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { paintPictures } from '../src/render/map-texture.js';
import { groundHit } from '../src/render/placement.js';
import { createSimulation } from '../src/sim/simulation.js';
import { hereU, u } from '../src/sim/units.js';
import { BUILD, WORLD } from '../src/sim/config/index.js';
import { coverageGrid, zoneShare } from '../src/ui/coverage.js';
import { inZone } from '../src/zone.js';

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

  it('scores a zone from the cells inside it, with the same answer as counting the whole grid', () => {
    const own = createSimulation({ seed: '1', terrainSeed: '7' });
    own.commands.deploy('1', '7');
    expect(own.commands.place('radar', 10, 10)).toBeNull();
    const zone = { points: [[-20, -20], [60, -20], [60, 60], [-20, 60]], closed: true }, m = WORLD.metresPerUnit;
    const probed = vi.spyOn(own.net, 'coverageAt');
    const drawn = zoneShare(own, 'fpv', zone), open = zoneShare(own, 'fpv', null);
    const asked = probed.mock.calls.length;
    const g = coverageGrid(own, 'fpv');
    expect(asked).toBeLessThan((g.n * g.n) / 20); // a few hundred cells, not all 45,000
    const counted = (inside) => {
      let cells = 0, seen = 0;
      for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) {
        if (!inside(-g.half + (i + 0.5) * g.cell, -g.half + (j + 0.5) * g.cell)) continue;
        cells++;
        if (g.counts[j * g.n + i] > 0) seen++;
      }
      return seen / cells;
    };
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBe(counted((xm, zm) => inZone(zone.points, xm / m, zm / m)));
    expect(open).toBe(counted((xm, zm) => Math.hypot(xm, zm) <= BUILD.maxDist));
  });

  it('can be worked out a few rows at a time, with the same counts and the same zone score as all at once', () => {
    const laid = () => {
      const made = createSimulation({ seed: '1', terrainSeed: '7' });
      made.commands.deploy('1', '7');
      expect(made.commands.place('radar', 10, 10)).toBeNull();
      expect(made.commands.place('rf', 30, 10)).toBeNull();
      return made;
    };
    const first = laid(), whole = coverageGrid(first, 'fpv'), share = zoneShare(first, 'fpv', null), own = laid();
    expect(whole.rows).toBe(whole.n);
    expect(share).toBeGreaterThan(0);
    const part = coverageGrid(own, 'fpv', 0); // no time at all still works one row out
    expect(part.rows).toBe(1);
    expect(zoneShare(own, 'fpv', null)).toBe(share); // rows not worked out yet are not read as unseen
    let calls = 1;
    while (part.rows < part.n) { coverageGrid(own, 'fpv', 0); calls++; }
    expect(calls).toBe(part.n); // a row a call
    expect(coverageGrid(own, 'fpv', 0)).toBe(part); // the same grid, filled in place
    expect(part.counts).toEqual(whole.counts);
    expect(whole.counts.some((c) => c > 0)).toBe(true);
  });

  it('is worked out again when a jammer starts or stops deafening a radio detector, but not when an effector is sold', () => {
    const own = createSimulation({ seed: '1', terrainSeed: '7' });
    own.commands.deploy('1', '7');
    expect(own.commands.place('rf', 10, 10)).toBeNull();
    expect(own.commands.place('jammer', 30, 10)).toBeNull();
    const jammer = own.structures.at(-1), seen = (g) => g.counts.reduce((a, b) => a + b, 0);
    const heard = coverageGrid(own, 'fpv');
    expect(seen(heard)).toBeGreaterThan(0);
    expect(own.commands.place('interceptor', 50, 10)).toBeNull();
    own.commands.sell(50, 10);
    expect(coverageGrid(own, 'fpv')).toBe(heard);
    expect(own.commands.place('jammer', -100, 10)).toBeNull();
    own.structures.at(-1).mode = 'Jam'; // 2 km off, beyond its own reach: the detector still hears
    expect(coverageGrid(own, 'fpv')).toBe(heard);
    jammer.mode = 'Jam';
    const deaf = coverageGrid(own, 'fpv');
    expect(deaf).not.toBe(heard);
    expect(seen(deaf)).toBeLessThan(seen(heard));
    jammer.jamBands = new Set();
    expect(seen(coverageGrid(own, 'fpv'))).toBe(seen(heard));
  });
});
