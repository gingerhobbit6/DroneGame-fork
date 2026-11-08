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
    const { pack, pictures } = await decodePack(await encodePack({ pictures: [{ layer: 'osmap', west: 1, top: 2, width: 3, height: 4, type: 'image/png', data }, { layer: 'evil', west: 1, top: 2, width: 3, height: 4, type: 'text/html', data }] }));
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

describe('choosing a world', () => {
  let game, buffer, entry;
  const show = (ui) => render(<GameContext.Provider value={game}>{ui}</GameContext.Provider>);
  const type = (q, value) => fireEvent.change($(q), { target: { value } });

  beforeEach(async () => {
    HTMLCanvasElement.prototype.getContext = () => null;
    buffer = await encodePack();
    const { pack } = await decodePack(buffer);
    entry = { file: 'a.sgmap', hash: pack.header.gridsSha256, name: 'Fixture', east: CENTRE.east, north: CENTRE.north, half: 28000, tier: 'lidar', lidarHalf: 7000 };
    const api = createFakeApi();
    api.packs = { list: vi.fn(async () => [entry]), downloads: vi.fn(async () => ({ terrain50: true, squares: ['TF'] })), build: vi.fn(async () => ({ running: true, message: 'Starting' })), buildStatus: vi.fn(async () => ({ running: false, ok: true, message: 'Finished' })) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new NodeBlob([buffer]) })));
    vi.stubGlobal('indexedDB', undefined);
    game = createGame({ seed: '1', terrainSeed: '1', api, storage: createFakeStorage() });
    Object.assign(view, { baseMap: 'os', mapRoads: false, mapGrid: 'national', mapContours: false, scenery: true, mapPanel: true, mapLoading: false, startAt: null, planView: false, me: null, zone: null, wizard: 'closed' });
    history.replaceState(null, '', '/');
  });
  afterEach(() => { cleanup(); resetAllFigures(); vi.unstubAllGlobals(); });

  it('still deploys generated ground as before, seed in the address', () => {
    show(<Overlay />);
    fireEvent.click($('#btn-deploy'));
    expect(game.sim.state.started).toBe(true);
    expect(location.search).toContain('terrain=1');
  });
  it('opens with a real map ready to deploy, unless the address says generated ground', async () => {
    show(<Overlay />);
    await until(() => !$('#btn-deploy').disabled && $('#site-info')?.textContent.includes('SU 2200 6600'));
    expect($('#world-real').checked).toBe(true);
    fireEvent.click($('#btn-deploy'));
    expect(parseWorldId(game.sim.state.terrainSeed)).toMatchObject({ e0: CENTRE.east, n0: CENTRE.north });
    cleanup();
    history.replaceState(null, '', '/?seed=1&terrain=1');
    game = createGame({ seed: '1', terrainSeed: '1', api: game.api, storage: createFakeStorage() });
    show(<Overlay />);
    await settle();
    expect($('#world-generated').checked).toBe(true);
  }, 30000);
  it('does not let the opening map overwrite what the player chose while it loaded', async () => {
    show(<Overlay />);
    fireEvent.click($('#world-generated'));
    await settle();
    expect($('#world-generated').checked).toBe(true);
    expect($('#world-real-panel')).toBeNull();
  }, 30000);
  it('asks for a map and start point before a real deploy, then keeps the site out of the address', async () => {
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    expect($('#btn-deploy').disabled).toBe(true);
    await until(() => $('#pack-list').options.length === 2);
    type('#pack-list', entry.hash.slice(0, 32));
    await until(() => $('#site-info')?.textContent.includes('SU 2200 6600'));
    fireEvent.click($('#btn-deploy'));
    expect(game.sim.state.started).toBe(true);
    expect(parseWorldId(game.sim.state.terrainSeed)).toMatchObject({ e0: CENTRE.east, n0: CENTRE.north });
    expect(location.search).toBe('?seed=1');
  }, 30000);
  it('starts at this laptop when a pack covers it', async () => {
    useGeolocation(fixAt(...NEAR));
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    fireEvent.click($('#use-my-location'));
    await until(() => $('#site-info')?.textContent.includes('Start point'));
    expect($('#world-note').textContent).toContain('Your location, good to about 40 m');
    const { e0, n0 } = (() => { fireEvent.click($('#btn-deploy')); return parseWorldId(game.sim.state.terrainSeed); })();
    expect(Math.abs(e0 - 422300)).toBeLessThan(100);
    expect(Math.abs(n0 - 166300)).toBeLessThan(100);
  }, 30000);
  it('offers to build a map when none covers the laptop, and uses it when built', async () => {
    useGeolocation(fixAt(...FAR));
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    fireEvent.click($('#use-my-location'));
    await until(() => $('#pack-build'));
    expect($('#pack-build').textContent).toContain('NN');
    fireEvent.click($('#pack-lidar'));
    fireEvent.click($('#pack-build-go'));
    await until(() => game.api.packs.build.mock.calls.length);
    expect(game.api.packs.build.mock.calls[0][0]).toMatchObject({ lidar: false });
    expect(game.api.packs.build.mock.calls[0][0].north).toBeGreaterThan(700000);
    // once built, the list has a map there, and the picker goes to it rather than offering to build it again
    const { east, north } = game.api.packs.build.mock.calls[0][0];
    game.api.packs.list.mockImplementation(async () => [entry, { ...entry, file: 'built.sgmap', hash: 'b'.repeat(64), east, north }]);
    const opened = () => fetch.mock.calls.some(([url]) => String(url).includes('built.sgmap'));
    for (let i = 0; i < 200 && !opened(); i++) await settle(30); // the builder is asked how it is going every 2 s
    expect(opened()).toBe(true);
  }, 30000);
  it('says when the laptop is outside Great Britain, or a location is refused', async () => {
    useGeolocation(fixAt(40, -100));
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    fireEvent.click($('#use-my-location'));
    await until(() => $('#world-note')?.textContent.includes('outside Great Britain'));
    useGeolocation({ getCurrentPosition: (_, no) => no({ code: 1 }) });
    fireEvent.click($('#use-my-location'));
    await until(() => $('#world-note')?.textContent.includes('blocked'));
  }, 30000);
  it('takes a typed start point, and refuses a bad one', async () => {
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    await until(() => $('#pack-list').options.length === 2);
    type('#site-ref', 'not a ref');
    fireEvent.click($('#site-ref-go'));
    await until(() => $('#world-note')?.textContent.includes('not a position'));
    type('#site-ref', 'SU 225 665');
    fireEvent.click($('#site-ref-go'));
    await until(() => $('#site-info')?.textContent.includes('SU 2250 6650'));
    type('#site-ref', 'SU 240 660'); // in the pack, but with no room for a whole world
    fireEvent.click($('#site-ref-go'));
    await until(() => $('#pack-build'));
    expect($('#btn-deploy').disabled).toBe(true);
  }, 30000);
  it('guides the choice of a site before deploying, then carries on into the wizard', async () => {
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    await until(() => $('#pack-list').options.length === 2);
    expect($('#site-guide')).toBeNull(); // nobody has to have the guide
    fireEvent.click($('#btn-guide'));
    expect(game.sim.state.started).toBe(false);
    expect($('#site-guide').textContent).toContain('Where do you want to defend?');
    expect($('#btn-guide').disabled).toBe(true);
    expect($('#btn-guide').textContent).toBe('Needs a ready map first');
    type('#site-ref', '56.8, -5');
    fireEvent.click($('#site-ref-go'));
    await until(() => $('#site-guide').textContent.includes('No map at NN'));
    expect($('#btn-guide').disabled).toBe(true);
    type('#site-ref', 'SU 225 665');
    fireEvent.click($('#site-ref-go'));
    await until(() => $('#site-guide').textContent.includes('Ready at SU 225 665'));
    expect($('#site-guide').textContent).toContain('Fixture');
    expect($('#btn-guide').textContent).toBe('Defend here and carry on');
    fireEvent.click($('#btn-guide'));
    expect(game.sim.state.started).toBe(true);
    expect(view.wizard).toBe('open');
    expect(location.search).not.toContain('terrain'); // the site stays out of the address
  }, 30000);
  it('lets the guide be closed, and leaves generated ground to go straight to the wizard', async () => {
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    fireEvent.click($('#btn-guide'));
    fireEvent.click($('#site-guide button'));
    expect($('#site-guide')).toBeNull();
    expect($('#btn-guide').textContent).toBe('Guide me through it');
    fireEvent.click($('#btn-guide'));
    fireEvent.click($('#world-generated'));
    expect($('#btn-guide').disabled).toBe(false);
    fireEvent.click($('#btn-guide'));
    expect(game.sim.state.started).toBe(true);
    expect(view.wizard).toBe('open');
  }, 30000);
  it('says what a build would download, from what this computer already has', async () => {
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    await until(() => $('#pack-list').options.length === 2);
    const rows = () => [...$('#pack-needs').children].map((row) => row.textContent);
    type('#site-ref', '52.9, 0.5'); // in TF, which this computer has
    fireEvent.click($('#site-ref-go'));
    await until(() => $('#pack-needs'));
    expect(rows()[0]).toContain('On this computer');
    expect(rows()[1]).toMatch(/OS maps of TF.*On this computer/);
    expect(rows()[2]).toMatch(/OS maps of TG.*Download, up to about 0\.55 GB/); // a 70 km pack here reaches into TG
    expect(rows()[3]).toMatch(/Lidar.*Download, up to about 7\.1 GB/);
    expect($('#pack-build').textContent).toContain('Up to about 7.7 GB to download');
    type('#site-ref', '56.8, -5'); // in NN, which it does not
    fireEvent.click($('#site-ref-go'));
    await until(() => $('#pack-build').textContent.includes('NN'));
    expect(rows()[1]).toMatch(/OS maps of NG, NH, NM, NN.*Download, up to about 2\.2 GB/); // a 70 km pack here reaches into three more
    expect($('#pack-build').textContent).toContain('Up to about 9.3 GB to download');
    fireEvent.click($('#pack-lidar'));
    expect(rows().join()).not.toContain('Lidar');
    expect($('#pack-build').textContent).toContain('Up to about 2.2 GB to download');
  }, 30000);
  it('offers an Estonian map with its own downloads, and sends the build on the Estonian grid', async () => {
    game.api.packs.downloads = vi.fn(async () => ({ terrain50: true, squares: ['SU'], estonia: { heights: true, features: false, surface: false } }));
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    await until(() => $('#pack-list').options.length === 2);
    type('#site-ref', '59.2606, 25.9587');
    fireEvent.click($('#site-ref-go'));
    await until(() => $('#pack-needs'));
    expect($('#pack-build').textContent).toContain('E 611700 N 6570700');
    const rows = () => [...$('#pack-needs').children].map((row) => row.textContent);
    expect(rows()[0]).toMatch(/ground heights.*On this computer/);
    expect(rows()[1]).toMatch(/buildings, roads.*Download, up to about 1\.3 GB/);
    expect(rows()[2]).toMatch(/Lidar.*Download, up to about 3\.8 GB/);
    expect(rows().join()).toContain('Basic map tiles');
    expect($('#pack-build').textContent).toContain('Up to about 5.1 GB to download');
    expect($('#pack-build').textContent).toContain('Estonian data stops at the national border');
    fireEvent.click($('#pack-build-go'));
    await until(() => game.api.packs.build.mock.calls.length);
    expect(game.api.packs.build.mock.calls[0][0]).toEqual({ east: 611708, north: 6570776, lidar: true });
    expect(location.search + location.hash).toBe(''); // the site stays out of the address
  }, 30000);
  it('calls the map by the right name in each country', () => {
    expect(mapName('os', worldId('a'.repeat(32), 422000, 166000))).toBe('OS map');
    expect(mapName('os', worldId('a'.repeat(32), 611700, 6570700))).toBe('Basic map');
    expect(mapName('satellite', worldId('a'.repeat(32), 611700, 6570700))).toBe('Satellite');
  });
  it('still offers a build when the save server cannot say what it has', async () => {
    game.api.packs.downloads = vi.fn(async () => { throw new Error('down'); });
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    await until(() => $('#pack-list').options.length === 2);
    type('#site-ref', '56.8, -5');
    fireEvent.click($('#site-ref-go'));
    await until(() => $('#pack-build'));
    expect($('#pack-needs')).toBeNull();
    expect($('#pack-build').textContent).toContain('This can download');
  }, 30000);
  it('switches map style and loaded data from controls that can be seen', async () => {
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    await until(() => $('.site-map-styles button.on'));
    const style = (name) => [...document.querySelectorAll('.site-map-styles button')].find((b) => b.textContent === name);
    const tick = (name) => [...document.querySelectorAll('.site-legend label')].find((l) => l.textContent === name).querySelector('input');
    expect([...document.querySelectorAll('.site-map-styles button')].map((b) => b.textContent)).toEqual(['Street', 'Light', 'Dark', 'Satellite', 'Hybrid', 'No live map']);
    expect(style('Street').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(style('Dark'));
    expect(style('Dark').getAttribute('aria-pressed')).toBe('true');
    expect(style('Street').getAttribute('aria-pressed')).toBe('false');
    expect(tick('Lidar heights').checked).toBe(true);
    fireEvent.click(tick('Lidar heights'));
    expect(tick('Lidar heights').checked).toBe(false);
    expect(tick('Map pictures').checked).toBe(false);
    fireEvent.click(tick('Map pictures'));
    expect(tick('Map pictures').checked).toBe(true);
    fireEvent.click(style('Street')); // the next test starts from the usual style
    expect($('#site-map-mine').textContent).toContain('My maps');
    fireEvent.click($('#site-map-world'));
  }, 30000);
  it('refuses a click outside Great Britain, without offering to build there', async () => {
    const made = vi.spyOn(L, 'map');
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    await until(() => $('#pack-list').options.length === 2);
    act(() => { made.mock.results[0].value.fire('click', { latlng: L.latLng(35.7, 139.7) }); });
    await until(() => $('#world-note')?.textContent.includes('outside Great Britain'));
    expect($('#pack-build')).toBeNull();
    expect($('#btn-deploy').disabled).toBe(true);
    act(() => { made.mock.results[0].value.fire('click', { latlng: L.latLng(51.3954, -1.6808) }); }); // and back again
    await until(() => $('#site-info')?.textContent.includes('Ready to play'));
    made.mockRestore();
  }, 30000);
  it('takes typed latitude and longitude or eastings and northings, refuses off the grid, and keeps them out of the URL', async () => {
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    await until(() => $('#pack-list').options.length === 2);
    type('#site-ref', '422500, 166500');
    fireEvent.click($('#site-ref-go'));
    await until(() => $('#site-info')?.textContent.includes('SU 2250 6650'));
    type('#site-ref', `${NEAR[0]}, ${NEAR[1]}`);
    fireEvent.click($('#site-ref-go'));
    await until(() => /SU 22[23]\d 66[23]\d/.test($('#site-info')?.textContent));
    const here = $('#site-info').textContent;
    type('#site-ref', '51.3954° N, 1.6808° W');
    fireEvent.click($('#site-ref-go'));
    await until(() => $('#site-info').textContent === here);
    type('#site-ref', '48.85, 2.35');
    fireEvent.click($('#site-ref-go'));
    await until(() => $('#world-note')?.textContent.includes('outside Great Britain'));
    expect($('#site-info').textContent).toBe(here); // a refused position leaves the start point alone
    type('#site-ref', '700000 100000');
    fireEvent.click($('#site-ref-go'));
    await until(() => $('#world-note')?.textContent.includes('outside Great Britain'));
    expect(location.search + location.hash).toBe('');
  }, 30000);

  describe('the map controls', () => {
    const deployed = async () => {
      const decoded = await game.loadPack({ ...entry, hash: entry.hash.slice(0, 32) });
      expect(game.commands.deploy('1', `pack:${decoded.pack.hash}:422000:0166000:real`)).toBeNull();
    };
    const fakeView = () => ({ centreOn: vi.fn(), refreshMap: vi.fn(async () => null), viewFromAbove: vi.fn() });

    it('offers only the generated ground on generated ground, with no real maps, overlays or outside credit', () => {
      show(<MapControls />);
      expect($('#map-plan')).toBeTruthy();
      expect($('#map-type-generated').getAttribute('aria-checked')).toBe('true');
      expect([...document.querySelectorAll('#map-types button')].map((b) => b.id)).toEqual(['map-type-generated']);
      expect($('#map-overlays')).toBeNull();
      expect($('#map-credit')).toBeNull();
    });
    it('shows options that cannot be used as greyed out, with the reason', async () => {
      await deployed();
      show(<MapControls />);
      for (const id of ['satellite', 'hybrid']) {
        expect($(`#map-type-${id}`).disabled).toBe(true);
        expect($(`#map-type-${id}`).textContent).toContain('Not in this map pack');
      }
      expect($('#map-credit').textContent).toContain('OS credit');
      expect(nextBaseMap('live')).toBe('os');
      expect(nextBaseMap('dark')).toBe('topo'); // skips what this pack does not have
      expect(nextBaseMap('dark', { pictures: [{ layer: 'satellite' }] })).toBe('satellite');
    });
    it('centres on this laptop, marks it, and says when it is outside the world', async () => {
      await deployed();
      const v = fakeView();
      game.getView = () => v;
      useGeolocation(fixAt(...NEAR));
      show(<MapControls />);
      fireEvent.click($('#map-me'));
      await until(() => view.me);
      expect(v.centreOn).toHaveBeenCalledWith(view.me.x, view.me.z, 200);
      expect(view.me.accuracy).toBeGreaterThan(0);
      expect($('#map-message').textContent).toContain('You are at SU');
      useGeolocation(fixAt(...FAR));
      fireEvent.click($('#map-me'));
      await until(() => $('#map-message').textContent.includes('outside this world'));
      expect(view.me).toBeNull();
      fireEvent.click($('#map-open-here'));
      expect(game.sim.state.started).toBe(false);
      expect(view.startAt.note).toContain('Your location');
      await deployed();
      fireEvent.click($('#map-site'));
      expect(v.centreOn).toHaveBeenCalledWith(0, 0);
    }, 30000);
    it('goes to a typed grid reference, and places the chosen system there', async () => {
      await deployed();
      const v = fakeView();
      game.getView = () => v;
      show(<MapControls />);
      type('#map-ref', 'nonsense');
      fireEvent.submit($('#map-goto'));
      expect($('#map-message').textContent).toContain('not a grid reference');
      type('#map-ref', 'NN 166 712');
      fireEvent.submit($('#map-goto'));
      expect($('#map-message').textContent).toContain('outside this world');
      type('#map-ref', 'SU 225 665');
      fireEvent.submit($('#map-goto'));
      expect(v.centreOn).toHaveBeenCalledWith(25, -25);
      game.setTool('rf');
      game.setLoadout('rf', fieldsFor('rf').find((f) => f.key === 'mount'), 12); // the settings chosen for it come too
      fireEvent.submit($('#map-goto'));
      expect(game.sim.structures[0]).toMatchObject({ pos: { x: 25, z: -25 }, def: { mount: 12 } });
      await settle();
      expect($('#map-message').textContent).toContain('Placed at SU 225 665');
    }, 30000);

    it('switches map from the cards, with roads and contours shown as part of the maps that include them', async () => {
      await deployed();
      const v = fakeView();
      game.getView = () => v;
      show(<MapControls />);
      expect($('#topo-legend')).toBeNull();
      fireEvent.click($('#map-type-topo'));
      expect(view.baseMap).toBe('topo');
      expect($('#map-type-topo').getAttribute('aria-checked')).toBe('true');
      expect($('#map-overlay-mapContours').disabled).toBe(true);
      expect($('#topo-legend').textContent).toMatch(/Contours every \d+ m/);
      fireEvent.click($('#map-type-os'));
      expect($('#topo-legend')).toBeNull();
      fireEvent.click($('#map-overlay-mapContours'));
      expect(view.mapContours).toBe(true);
      expect($('#topo-legend')).toBeTruthy();
      fireEvent.click($('#map-overlay-scenery'));
      expect(view.scenery).toBe(false);
      expect($('#map-overlay-scenery').getAttribute('aria-pressed')).toBe('false');
      fireEvent.click($('#map-close'));
      expect($('#map-panel')).toBeNull();
    }, 30000);
    it('shows the national grid or MGRS, and reads the cursor out on the one showing', async () => {
      await deployed();
      const v = fakeView();
      game.getView = () => v; // one view: a new one each render would restart the map previews for ever
      game.cursor = () => ({ x: 0, z: 0 });
      show(<MapControls />);
      expect($('#map-grid-national').textContent).toBe('OS grid');
      expect($('#map-grid-national').getAttribute('aria-pressed')).toBe('true');
      expect($('#map-here').textContent).toMatch(/^SU \d{3} \d{3}, /);
      fireEvent.click($('#map-grid-mgrs'));
      expect(view.mapGrid).toBe('mgrs');
      expect($('#map-grid-mgrs').getAttribute('aria-pressed')).toBe('true');
      expect($('#map-here').textContent).toMatch(/^30U [A-Z]{2} \d{3} \d{3}, /);
      fireEvent.click($('#map-grid-mgrs'));
      expect(view.mapGrid).toBe(false);
      expect([nextGrid('national'), nextGrid('mgrs'), nextGrid(false)]).toEqual(['mgrs', false, 'national']);
    }, 30000);
    it('goes back to the start screen from a game, and opens on the place asked for', async () => {
      await deployed();
      game.commands.place('rf', 25, -25);
      game.leaveWorld({ e: 422500, n: 166500, note: 'Your location.' });
      expect(game.sim.state.started).toBe(false);
      expect(game.sim.structures).toHaveLength(0);
      show(<Overlay />);
      expect($('#world-real').checked).toBe(true);
      await until(() => $('#site-info')?.textContent.includes('Start point'));
      expect($('#terrain-input').value).toBe('1');
      expect(view.startAt).toBeNull();
    }, 30000);
    it('keeps the wizard closed when a real deploy is refused', async () => {
      show(<Overlay />);
      fireEvent.click($('#world-real'));
      fireEvent.click($('#btn-guide'));
      expect($('#btn-guide').disabled).toBe(true);
      await until(() => $('#pack-list').options.length === 2);
      type('#pack-list', entry.hash.slice(0, 32));
      await until(() => !$('#btn-guide').disabled);
      vi.spyOn(game.commands, 'deploy').mockReturnValue('That start point is not allowed');
      fireEvent.click($('#btn-guide'));
      expect(view.wizard).toBe('closed');
      expect(game.sim.state.started).toBe(false);
    }, 30000);
    it('saves and reloads a real world with its zone, keeping the site out of the address', async () => {
      await deployed();
      game.setViewOption('zone', ringZone(1000));
      const points = view.zone.points;
      show(<SavedTab active />);
      type('#save-name', 'Real');
      fireEvent.click($('#save-laydown'));
      await until(() => $('#saved-list'));
      game.setViewOption('zone', null);
      const load = [...document.querySelectorAll('#saved-list button')].find((b) => b.textContent === 'Load');
      fireEvent.click(load);
      await act(async () => { fireEvent.click(load); });
      await until(() => view.zone);
      expect(view.zone).toEqual({ points, closed: true });
      expect(parseWorldId(game.sim.state.terrainSeed)).toMatchObject({ e0: CENTRE.east, n0: CENTRE.north });
      expect(location.search).toBe('?seed=1');
    }, 30000);
  });
});
