// Untrusted map packs: the limits that stop a small or crafted file costing a lot of memory, or walling off the map.

import { describe, expect, it } from 'vitest';
import { decodePack, pixelsOf } from '../src/api/pack-store.js';
import { parsePack } from '../src/sim/world-pack.js';
import { encodePack, fixtureParts, pngHeader } from './support/fixture-pack.js';

// a JPEG start, a table segment the reader must step over, then the frame header with the size
const jpegHeader = (w, h) => new Uint8Array([0xff, 0xd8, 0xff, 0xc4, 0, 3, 9, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0]);

describe('picture sizes', () => {
  it('are read from a PNG or JPEG header, and anything else has none', () => {
    expect(pixelsOf(pngHeader(4000, 3000))).toBe(12e6);
    expect(pixelsOf(jpegHeader(7000, 2560))).toBe(7000 * 2560);
    expect(pixelsOf(new Uint8Array([1, 2, 3]))).toBe(Infinity);
    expect(pixelsOf(new Uint8Array([0xff, 0xd8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(Infinity);
  });

  it('leave out a picture that declares a vast size, before the browser decodes it', async () => {
    const at = { layer: 'satellite', west: 1, top: 2, width: 3, height: 4 };
    const { pictures } = await decodePack(await encodePack({ pictures: [{ ...at, type: 'image/png', data: pngHeader(30000, 30000) }, { ...at, type: 'image/jpeg', data: jpegHeader(8000, 8000) }] }));
    expect(pictures.map((p) => p.blob.type)).toEqual(['image/jpeg']);
  });
});

describe('features', () => {
  const parts = fixtureParts(), header = { ...parts.header, gridsSha256: 'a'.repeat(64) };
  const check = (change) => () => parsePack(header, parts.grids, { ...parts.features, ...change });

  it.each([
    ['a building that would wall off the map', { buildings: [[0, 0, 1e12, 1e12, 8, 0]] }], ['a building of negative height', { buildings: [[0, 0, 10, 10, -5, 0]] }],
    ['a road with no points', { roads: [['A Road']] }], ['a road point that is not numbers', { roads: [['A Road', [[0, 'x']]]] }], ['roads that are not a list', { roads: 5 }],
    ['a name with no position', { names: [['Testville', 'Populated Place', 'Large']] }], ['names that are not a list', { names: {} }],
  ])('refuse %s', (_, change) => { expect(check(change)).toThrow(/features/); });

  it('take a pack with no roads or names', () => {
    expect(check({ roads: undefined, names: undefined })).not.toThrow();
  });
});
