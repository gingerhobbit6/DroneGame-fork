// Untrusted map packs: the limits that stop a small or crafted file costing a lot of memory, or walling off the map.

import { describe, expect, it, vi } from 'vitest';
import { createPackStore, decodePack, pixelsOf } from '../src/api/pack-store.js';
import { parsePack } from '../src/sim/world-pack.js';
import { tilesOver } from '../src/render/map-texture.js';
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
    const at = { layer: 'satellite', west: 422000, top: 166000, width: 3, height: 4 };
    const { pictures } = await decodePack(await encodePack({ pictures: [{ ...at, type: 'image/png', data: pngHeader(30000, 30000) }, { ...at, type: 'image/jpeg', data: jpegHeader(8000, 8000) }] }));
    expect(pictures.map((p) => p.blob.type)).toEqual(['image/jpeg']);
  });

  it('refuses a picture whose placement would request an enormous decoded bitmap', async () => {
    const picture = { layer: 'osmap', west: 422000, top: 166000, width: 1e30, height: 100, type: 'image/png', data: pngHeader(1, 1) };
    await expect(decodePack(await encodePack({ pictures: [picture] }))).rejects.toThrow(/picture/);
  });

  it('accepts the one-tile overhang used by Estonian base-map pieces', async () => {
    const picture = { layer: 'osmap', west: 393100, top: 194900, width: 1000, height: 1000, type: 'image/png', data: pngHeader(1, 1) };
    const { pictures } = await decodePack(await encodePack({ pictures: [picture] }));
    expect(pictures).toHaveLength(1);
  });

  it('refuses overlapping, duplicate and excessive picture sections before making Blobs', async () => {
    const picture = { layer: 'osmap', west: 422000, top: 166000, width: 100, height: 100, type: 'image/png', data: pngHeader(1, 1) };
    await expect(decodePack(await encodePack({ pictures: [picture], change: (h) => { h.sections[5].offset = h.sections[4].offset; } }))).rejects.toThrow(/section/);
    await expect(decodePack(await encodePack({ pictures: [picture], change: (h) => { h.sections[5].name = 'ground'; } }))).rejects.toThrow(/section/);
    await expect(decodePack(await encodePack({ pictures: Array.from({ length: 101 }, () => picture) }))).rejects.toThrow(/picture/);
  });
  it('refuses repeated full-pack pictures that multiply decoding work', async () => {
    const picture = { layer: 'osmap', west: 394000, top: 194000, width: 56000, height: 56000, type: 'image/png', data: pngHeader(1, 1) };
    await expect(decodePack(await encodePack({ pictures: [picture, picture, picture] }))).rejects.toThrow(/picture coverage/);
  });
});

describe('features', () => {
  const parts = fixtureParts(), header = { ...parts.header, gridsSha256: 'a'.repeat(64) };
  const check = (change) => () => parsePack(header, parts.grids, { ...parts.features, ...change });

  it.each([
    ['a building that would wall off the map', { buildings: [[0, 0, 1e12, 1e12, 8, 0]] }], ['a building of negative height', { buildings: [[0, 0, 10, 10, -5, 0]] }],
    ['a road with no points', { roads: [['A Road']] }], ['a road point that is not numbers', { roads: [['A Road', [[0, 'x']]]] }], ['roads that are not a list', { roads: 5 }],
    ['too many road points', { roads: [['A Road', Array.from({ length: 400001 }, (_, i) => [i % 2, 0])]] }],
    ['an overlong road class', { roads: [['A'.repeat(65), [[0, 0]]]] }],
    ['a name with no position', { names: [['Testville', 'Populated Place', 'Large']] }], ['names that are not a list', { names: {} }],
    ['too many names', { names: Array.from({ length: 25001 }, () => ['Place', 'Populated Place', 'Large', 0, 0]) }],
    ['an overlong name', { names: [['x'.repeat(81), 'Populated Place', 'Large', 0, 0]] }],
    ['an overlong name kind', { names: [['Place', 'x'.repeat(65), 'Large', 0, 0]] }],
    ['too many power-line points', { lines: [Array.from({ length: 30001 }, (_, i) => [i % 2 * 20, 0])] }],
    ['a malformed border ring', { beyond: [[[0, 0], null, [20, 20]]] }],
  ])('refuse %s', (_, change) => { expect(check(change)).toThrow(/features/); });

  it('take a pack with no roads or names', () => {
    expect(check({ roads: undefined, names: undefined })).not.toThrow();
  });
});

describe('live map tile limits', () => {
  it('refuses non-geographic and excessive bounds before enumeration', () => {
    expect(() => tilesOver({ north: 51, south: 50, east: 1e30, west: 1e30 })).toThrow(/tile/);
    expect(() => tilesOver({ north: 60, south: 40, east: 30, west: -20 })).toThrow(/tile/);
  });
  it('keeps ordinary map bounds', () => {
    expect(tilesOver({ north: 51.42, south: 51.40, east: -1.70, west: -1.72 }).length).toBeGreaterThan(0);
  });
});

it('refuses oversized imports and server responses before reading their bodies', async () => {
  const read = vi.fn(), store = createPackStore({ api: {}, idb: null });
  await expect(store.importFile({ size: 449 * 1024 * 1024, arrayBuffer: read })).rejects.toThrow(/too large/);
  expect(read).not.toHaveBeenCalled();
  const blob = vi.fn(), fromServer = createPackStore({ api: {}, idb: null, fetchFile: async () => ({ ok: true, headers: { get: () => String(449 * 1024 * 1024) }, blob }) });
  await expect(fromServer.fileOf({ source: 'server', file: 'large.sgmap' })).rejects.toThrow(/too large/);
  expect(blob).not.toHaveBeenCalled();
});

it('keeps only the active and most recently selected decoded packs', async () => {
  const hashes = ['a', 'b', 'c'].map((letter) => letter.repeat(32));
  let active = hashes[0];
  const decode = async (buffer) => ({ pack: { hash: new TextDecoder().decode(buffer), header: {} }, pictures: [] });
  const fetchFile = async (hash) => ({ ok: true, headers: { get: () => null }, blob: async () => new Blob([hash]) });
  const store = createPackStore({ api: {}, idb: null, decode, fetchFile, pinned: () => active });
  const entry = (hash) => ({ hash, file: hash, source: 'server' });
  for (const hash of hashes) await store.load(entry(hash));
  expect(store.get(hashes[0])).not.toBeNull();
  expect(store.get(hashes[1])).toBeNull();
  expect(store.get(hashes[2])).not.toBeNull();
  await store.load(entry(hashes[1]));
  expect(store.get(hashes[0])).not.toBeNull();
  expect(store.get(hashes[1])).not.toBeNull();
  expect(store.get(hashes[2])).toBeNull();
  active = hashes[1];
  await store.load(entry(hashes[2]));
  expect(store.get(hashes[0])).toBeNull();
  expect(store.get(hashes[1])).not.toBeNull();
  expect(store.get(hashes[2])).not.toBeNull();
  const imported = 'd'.repeat(32);
  expect((await store.importFile(new Blob([imported]))).hash).toBe(imported);
  expect(store.get(hashes[1])).not.toBeNull();
  expect(store.get(hashes[2])).toBeNull();
  expect(store.get(imported)).not.toBeNull();
});

it('decodes different selected packs one at a time and drops superseded results', async () => {
  const older = 'a'.repeat(32), newer = 'b'.repeat(32);
  let decoding = 0, mostAtOnce = 0;
  const decode = async (buffer) => {
    mostAtOnce = Math.max(mostAtOnce, ++decoding);
    await new Promise((resolve) => setTimeout(resolve, 0));
    decoding--;
    return { pack: { hash: new TextDecoder().decode(buffer) }, pictures: [] };
  };
  const store = createPackStore({
    api: {}, idb: null, decode,
    fetchFile: async (hash) => ({ ok: true, headers: { get: () => null }, blob: async () => new Blob([hash]) }),
  });
  const entry = (hash) => ({ hash, file: hash, source: 'server' });
  const [oldResult, newResult] = await Promise.all([store.load(entry(older)), store.load(entry(newer))]);
  expect(oldResult.pack.hash).toBe(older);
  expect(newResult.pack.hash).toBe(newer);
  expect(mostAtOnce).toBe(1);
  expect(store.get(older)).toBeNull();
  expect(store.get(newer)).not.toBeNull();
});
