// @vitest-environment jsdom
// Pack files, the start screen's world picker, the laptop's location and the map controls, against a real simulation.

import { Blob as NodeBlob } from 'node:buffer';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { createPackStore, decodePack } from '../src/api/pack-store.js';
import { resetAllFigures } from '../src/sim/config/index.js';
import { fieldsFor } from '../src/sim/unit-config.js';
import { parseWorldId, worldId } from '../src/sim/world-pack.js';
import { view } from '../src/render/view.js';
import { tilesOver } from '../src/render/map-texture.js';
import { GameContext } from '../src/ui/hooks.js';
import { Overlay } from '../src/ui/Overlay.jsx';
import { MapControls, mapName, nextBaseMap, nextGrid } from '../src/ui/MapControls.jsx';
import { ControlPanel } from '../src/ui/ControlPanel.jsx';
import { SavedTab } from '../src/ui/dock/SavedTab.jsx';
import { ringZone } from '../src/zone.js';
import { accuracyText, locateMe } from '../src/ui/locate.js';
import { encodePack, CENTRE, pngHeader } from './support/fixture-pack.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

globalThis.Blob = NodeBlob; // jsdom's Blob has no stream(), which every browser's does

const $ = (q) => document.querySelector(q);
const settle = (ms = 50) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const until = async (test) => { for (let i = 0; i < 100 && !test(); i++) await settle(30); expect(test()).toBeTruthy(); };
const fixAt = (latitude, longitude, accuracy = 40) => ({ getCurrentPosition: (ok) => ok({ coords: { latitude, longitude, accuracy } }) });
const useGeolocation = (value) => Object.defineProperty(navigator, 'geolocation', { configurable: true, value });
const NEAR = [51.3954, -1.6808], FAR = [56.8, -5.0]; // NEAR is about SU 223 663

describe('reading a pack file', () => {
  it('reads a good one, with its pictures', async () => {
    const data = pngHeader(3, 4);
    const { pack, pictures } = await decodePack(await encodePack({ pictures: [{ layer: 'osmap', west: CENTRE.east, top: CENTRE.north, width: 3, height: 4, type: 'image/png', data }, { layer: 'evil', west: 1, top: 2, width: 3, height: 4, type: 'text/html', data }] }));
    expect(pack.header.name).toBe('Fixture');
    expect(pack.grids.ground.length).toBe(2801 * 2801);
    expect(pack.features.names[0][0]).toBe('Testville');
    expect(pictures.map((p) => p.layer)).toEqual(['osmap']);
  });
  const damaged = async (change) => decodePack(await encodePack({ change }));
  it('refuses what is not a pack', async () => {
    await expect(decodePack(new ArrayBuffer(4))).rejects.toThrow(/not a Site Guard/);
    await expect(decodePack(new TextEncoder().encode('hello world, not a pack').buffer)).rejects.toThrow(/not a Site Guard/);
    const other = new Uint8Array(await encodePack());
    other[5] = 9;
    await expect(decodePack(other.buffer)).rejects.toThrow(/different version/);
  });
  it('refuses a fingerprint that does not match the grids', async () => {
    await expect(damaged((h) => { h.gridsSha256 = 'f'.repeat(64); })).rejects.toThrow(/fingerprint/);
  });
  it('stops at the declared size, so a small file cannot expand without limit', async () => {
    await expect(damaged((h) => { h.sections[4].rawLength = 10; })).rejects.toThrow(/longer/); // the features, whose size is their own
    await expect(damaged((h) => { h.sections[4].rawLength += 5; })).rejects.toThrow(/shorter/);
    await expect(damaged((h) => { h.sections[0].rawLength = 2 ** 40; for (const i of [1, 2, 3]) h.sections[i].rawLength = 2 ** 38; })).rejects.toThrow(/damaged/); // not the grid the header gives
    await expect(damaged((h) => { h.sections[4].rawLength = 33 * 1024 * 1024; })).rejects.toThrow(/unreasonable/); // more features than any real pack
    await expect(damaged((h) => { h.sections[0].rawLength = 2 ** 26; })).rejects.toThrow(/damaged/); // grids that disagree are refused before any is unpacked
  });
  it('refuses sections outside the file, or missing', async () => {
    await expect(damaged((h) => { h.sections[0].offset = 1e12; })).rejects.toThrow(/damaged/);
    await expect(damaged((h) => { h.sections.pop(); })).rejects.toThrow(/missing/);
  });
});

describe('the pack store', () => {
  it('lists what the server has, loads once, and survives a stopped server', async () => {
    const buffer = await encodePack();
    const { pack } = await decodePack(buffer);
    const api = { packs: { list: async () => [{ file: 'a.sgmap', hash: pack.header.gridsSha256, name: 'A', east: CENTRE.east, north: CENTRE.north, half: 28000 }] } };
    const fetchFile = vi.fn(async () => ({ ok: true, blob: async () => new NodeBlob([buffer]) }));
    const store = createPackStore({ api, idb: null, fetchFile });
    const { packs } = await store.list();
    expect(packs[0].hash).toBe(pack.hash);
    const [a, b] = await Promise.all([store.load(packs[0]), store.load(packs[0])]); // clicked while it was still loading
    expect(a).toBe(b);
    await store.load(packs[0]);
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(store.get(pack.hash).pack.header.name).toBe('Fixture');
    const down = createPackStore({ api: { packs: { list: async () => { throw new Error('down'); } } }, idb: null });
    expect(await down.list()).toEqual({ packs: [], serverDown: true });
  });
  it('exports a pack as a file that another player can import', async () => {
    const buffer = await encodePack();
    const mine = createPackStore({ api: {}, idb: null, fetchFile: async () => ({ ok: true, blob: async () => new NodeBlob([buffer]) }) });
    const file = await mine.fileOf({ source: 'server', file: 'a.sgmap' });
    const added = await createPackStore({ api: {}, idb: null }).importFile(file);
    expect(added.hash).toBe((await decodePack(buffer)).pack.hash);
  });
  it('keeps the pack it has when another with the same ground but other contents is imported', async () => {
    const store = createPackStore({ api: {}, idb: null });
    const first = await store.importFile(new NodeBlob([await encodePack()]));
    expect((await store.importFile(new NodeBlob([await encodePack()]))).hash).toBe(first.hash); // the same file again is fine
    await expect(store.importFile(new NodeBlob([await encodePack({ change: (h) => { h.name = 'Other'; } })]))).rejects.toThrow(/different map pack/);
    expect(store.get(first.hash).pack.header.name).toBe('Fixture');
  });
  it('notices a pack that has changed, or cannot be fetched', async () => {
    const buffer = await encodePack();
    const store = createPackStore({ api: {}, idb: null, fetchFile: async () => ({ ok: true, blob: async () => new NodeBlob([buffer]) }) });
    await expect(store.load({ hash: 'b'.repeat(32), file: 'a.sgmap' })).rejects.toThrow(/changed/);
    const gone = createPackStore({ api: {}, idb: null, fetchFile: async () => ({ ok: false }) });
    await expect(gone.load({ hash: 'b'.repeat(32), file: 'a.sgmap' })).rejects.toThrow(/could not be fetched/);
  });
});

describe('the laptop location', () => {
  it('gives the grid position and accuracy', async () => {
    const fix = await locateMe(fixAt(...NEAR, 45));
    expect(fix.accuracy).toBe(45);
    expect(Math.abs(fix.e - 422300)).toBeLessThan(100);
    expect(Math.abs(fix.n - 166300)).toBeLessThan(100);
    expect(accuracyText(45)).toBe('good to about 45 m');
    expect(accuracyText(9000)).toBe('only good to about 9 km');
  });
  it.each([[1, /blocked/], [2, /could not work out/], [3, /too long/], [9, /could not be found/]])('explains failure %i', async (code, message) => {
    await expect(locateMe({ getCurrentPosition: (_, no) => no({ code }) })).rejects.toThrow(message);
  });
  it('explains a browser with no location', async () => {
    await expect(locateMe(null)).rejects.toThrow(/cannot share/);
  });
  it('answers from whichever reading comes first, and reports a later, better one', async () => {
    const calls = [];
    const pending = locateMe({ getCurrentPosition: (yes, no, options) => calls.push({ yes, no, options }) }, (better) => calls.push({ better }));
    expect(calls.map((c) => c.options.enableHighAccuracy)).toEqual([false, true]);
    expect(calls[0].options.maximumAge).toBeGreaterThan(calls[1].options.maximumAge); // the rough one may reuse a recent answer
    fixAt(...NEAR, 900).getCurrentPosition(calls[0].yes);
    expect((await pending).accuracy).toBe(900);
    fixAt(...NEAR, 30).getCurrentPosition(calls[1].yes);
    expect(calls[2].better.accuracy).toBe(30);
  });
  it('keeps the rough answer if the precise one fails, and the reverse', async () => {
    const roughOnly = { getCurrentPosition: (yes, no, options) => { if (options.enableHighAccuracy) no({ code: 3 }); else fixAt(...NEAR, 900).getCurrentPosition(yes); } };
    expect((await locateMe(roughOnly)).accuracy).toBe(900);
    const preciseOnly = { getCurrentPosition: (yes, no, options) => { if (options.enableHighAccuracy) fixAt(...NEAR, 30).getCurrentPosition(yes); else no({ code: 2 }); } };
    expect((await locateMe(preciseOnly)).accuracy).toBe(30);
    const none = { getCurrentPosition: (_, no, options) => no({ code: options.enableHighAccuracy ? 3 : 2 }) };
    await expect(locateMe(none)).rejects.toThrow(/too long/);
  });
});

describe('map tiles over a world', () => {
  it('finds the tiles and their corners on the grid', () => {
    const tiles = tilesOver({ north: 51.47, south: 51.35, east: -1.62, west: -1.82 });
    expect(tiles.length).toBeGreaterThan(50);
    expect(tiles.length).toBeLessThan(250);
    const { origin, right, down } = tiles[0];
    expect(right.e).toBeGreaterThan(origin.e); // east along a row
    expect(down.n).toBeLessThan(origin.n); // south down a column
    expect(Math.hypot(right.e - origin.e, right.n - origin.n)).toBeGreaterThan(1000); // zoom 14 tiles are about 1.5 km here
    expect(Math.hypot(right.e - origin.e, right.n - origin.n)).toBeLessThan(2000);
  });
});
