// Past a border the national map can be blank, and the pack outlines that ground so it is shaded from its heights.

import { describe, expect, it } from 'vitest';
import { paintBeyond } from '../src/render/map-texture.js';

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
