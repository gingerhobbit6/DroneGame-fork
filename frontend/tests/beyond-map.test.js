// Past a border the national map can be blank, and the pack outlines that ground so it is shaded from its heights.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { paintBeyond, paintPictures } from '../src/render/map-texture.js';

// A 2D context that records what is asked of it.
function recorder() {
  const calls = [];
  const g = new Proxy({}, { get: (_, name) => (name === 'calls' ? calls : (...args) => calls.push([name, ...args])), set: () => true });
  return { g, calls };
}
const DATA = { R: 1000, geo: { e0: 700000, n0: 6590000, packEast: 700000, packNorth: 6590000 } };
const TOPO = { picture: 'topo picture', lines: { minor: [0, 0, 10, 10], index: [], labels: [{ level: 40, x: 5, z: 5, angle: 0 }] } };
const frame = (g) => ({ g, west: 699000, top: 6591000, span: 2000, size: 200, px: (m) => m / 10 });

describe('ground past the border', () => {
  it('is shaded from the heights, clipped to the outline, holes and all', () => {
    const { g, calls } = recorder();
    const outer = [[0, -1000], [1000, -1000], [1000, 1000], [0, 1000], [0, -1000]], hole = [[400, 0], [600, 0], [600, 200], [400, 0]];
    paintBeyond(frame(g), DATA, [outer, hole], TOPO);
    const names = calls.map(([name]) => name);
    expect(names.filter((n) => n === 'moveTo').length).toBeGreaterThanOrEqual(2); // a path for each ring, and contour strokes after
    expect(calls).toContainEqual(['clip', 'evenodd']);
    expect(calls).toContainEqual(['drawImage', 'topo picture', 0, 0, 200, 200]);
    expect(names).toContain('fillText'); // contour heights are labelled
    expect(names.indexOf('clip')).toBeLessThan(names.indexOf('drawImage'));
    expect(names.at(-1)).toBe('restore');
  });
  it('leaves the map alone when the pack has no outline', () => {
    for (const rings of [undefined, [], 'not a list']) {
      const { g, calls } = recorder();
      paintBeyond(frame(g), DATA, rings, TOPO);
      expect(calls).toEqual([]);
    }
  });
});

describe('a pack picture the browser cannot read', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is left out, and the pictures after it are still drawn', async () => {
    vi.stubGlobal('createImageBitmap', async (blob) => { if (blob === 'junk') throw new Error('The source image could not be decoded.'); return { close() {} }; });
    const { g, calls } = recorder(), f = { g, west: 0, top: 1000, span: 1000, px: (m) => m };
    const at = (blob, west) => ({ layer: 'osmap', west, top: 1000, width: 100, height: 100, blob });
    await paintPictures(f, [at('junk', 0), at('good', 200)], 'osmap', () => true);
    expect(calls.filter(([name]) => name === 'drawImage').map((c) => c[2])).toEqual([200]);
  });
  it('decodes one picture at a time across concurrent map paints', async () => {
    let release, active = 0, peak = 0;
    const held = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal('createImageBitmap', async (blob) => {
      peak = Math.max(peak, ++active);
      if (blob === 'first') await held;
      return { close() { active--; } };
    });
    const { g } = recorder(), f = { g, west: 0, top: 1000, span: 1000, px: (m) => m };
    const picture = (blob) => ({ layer: 'osmap', west: 0, top: 1000, width: 100, height: 100, blob });
    const first = paintPictures(f, [picture('first')], 'osmap', () => true);
    const second = paintPictures(f, [picture('second')], 'osmap', () => true);
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(peak).toBe(1);
    expect(active).toBe(0);
  });
  it('refuses oversized resize requests before starting the browser decoder', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    const { g } = recorder(), f = { g, west: 0, top: 1000, span: 1000, px: (m) => m };
    await expect(paintPictures(f, [{ layer: 'osmap', west: 0, top: 1000, width: 80000, height: 80000, blob: 'small' }], 'osmap', () => true)).rejects.toThrow(/picture/);
    expect(decode).not.toHaveBeenCalled();
  });
});
