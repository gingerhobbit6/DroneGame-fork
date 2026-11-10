// Place names painted on a real map: small enough to leave the map readable, larger places first, none piled on another.

import { describe, expect, it } from 'vitest';
import { paintNames } from '../src/render/map-texture.js';

// A canvas context that records what is written and where, each letter half as wide as the font is tall.
function fakeContext() {
  const drawn = [];
  const g = { font: '', measureText: (t) => ({ width: t.length * parseInt(g.font.split(' ')[1], 10) * 0.5 }), strokeText() {}, fillText: (text, x, y) => drawn.push({ text, x, y, font: g.font }) };
  return { g, drawn };
}
const data = { R: 1000, geo: { e0: 0, n0: 0, packEast: 0, packNorth: 0 } };
const frame = (g) => ({ g, west: -1000, top: 1000, px: (m) => m }); // one canvas pixel a metre, so positions read straight off

describe('place names on the map', () => {
  it('draws Large and Medium names small, leaving out small places and landforms', () => {
    const { g, drawn } = fakeContext();
    paintNames(frame(g), { names: [['Town', 'Town', 'Large', 0, 0], ['Hamlet', 'Hamlet', 'Small', 300, 0], ['Hill', 'Landform', 'Large', 0, 300], ['Village', 'Village', 'Medium', 0, -300]] }, data);
    expect(drawn.map((d) => d.text)).toEqual(['Town', 'Village']);
    expect(drawn[0].font).toBe('600 24px system-ui');
    expect(drawn[1].font).toBe('600 17px system-ui');
  });

  it('keeps the larger of two names that would overlap, and both when they are apart', () => {
    const { g, drawn } = fakeContext();
    paintNames(frame(g), { names: [['Brook', 'Water', 'Medium', 10, 5], ['Kingstone', 'Town', 'Large', 0, 0], ['Far End', 'Village', 'Medium', 500, 500]] }, data);
    expect(drawn.map((d) => d.text)).toEqual(['Kingstone', 'Far End']);
  });
});
