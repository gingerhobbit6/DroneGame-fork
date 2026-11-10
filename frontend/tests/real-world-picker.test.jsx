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

describe('choosing a world', () => {
  let game, buffer, entry;
  const show = (ui) => render(<GameContext.Provider value={game}>{ui}</GameContext.Provider>);
  const type = (q, value) => fireEvent.change($(q), { target: { value } });

  beforeEach(async () => {
    HTMLCanvasElement.prototype.getContext = () => null;
    localStorage.clear(); // a previous test's map style must not become this test's default
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
  it('draws listed map summaries without decoding every pack', async () => {
    const other = { ...entry, file: 'other.sgmap', hash: 'b'.repeat(32), name: 'Other area', east: 400000 };
    const third = { ...entry, file: 'third.sgmap', hash: 'c'.repeat(32), name: 'Third area', east: 500000 };
    game.api.packs.list.mockResolvedValueOnce([entry, other, third]);
    const load = vi.spyOn(game, 'loadPack');
    show(<Overlay />);
    await until(() => $('#pack-list')?.options.length === 4 && $('#site-info')?.textContent.includes('Ready to play'));
    expect(load.mock.calls.map(([chosen]) => chosen.file)).toEqual(['a.sgmap']);
    expect($('#site-map-mine').textContent).toContain('My maps (3)');
    type('#pack-list', other.hash);
    await until(() => load.mock.calls.length === 2);
    expect(load.mock.calls[1][0]).toMatchObject(other); // the second pack loads only when selected
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
    const made = vi.spyOn(L, 'map');
    useGeolocation(fixAt(...NEAR));
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    expect($('#use-my-location').nextElementSibling.textContent).toContain('switches to No live map');
    fireEvent.click($('#use-my-location'));
    await until(() => $('#site-info')?.textContent.includes('Start point'));
    expect($('#world-note').textContent).toContain('Your location, good to about 40 m');
    expect($('#world-note').textContent).toContain('choose Street or Satellite above the map'); // why the map has gone blank, and how to get one
    const noLive = [...document.querySelectorAll('.site-map-styles button')].find((b) => b.textContent === 'No live map');
    expect(noLive.getAttribute('aria-pressed')).toBe('true');
    const tiles = [];
    made.mock.results[0].value.eachLayer((layer) => { if (layer instanceof L.TileLayer) tiles.push(layer); });
    expect(tiles).toHaveLength(0); // no map provider sees the new location
    const { e0, n0 } = (() => { fireEvent.click($('#btn-deploy')); return parseWorldId(game.sim.state.terrainSeed); })();
    expect(Math.abs(e0 - 422300)).toBeLessThan(100);
    expect(Math.abs(n0 - 166300)).toBeLessThan(100);
    made.mockRestore();
  }, 30000);
  it('keeps location tiles off when a delayed pack load finishes after Street was reselected', async () => {
    const loaded = await decodePack(buffer);
    let finishLoad;
    const pending = new Promise((resolve) => { finishLoad = resolve; });
    game.loadPack = vi.fn(() => pending);
    useGeolocation(fixAt(...NEAR));
    show(<Overlay />);
    fireEvent.click($('#world-real'));
    await until(() => $('#pack-list')?.options.length === 2);
    type('#pack-list', entry.hash.slice(0, 32));
    await until(() => game.loadPack.mock.calls.length > 0);
    fireEvent.click($('#use-my-location'));
    await until(() => [...document.querySelectorAll('.site-map-styles button')].some((b) => b.textContent === 'No live map' && b.getAttribute('aria-pressed') === 'true'));
    const street = [...document.querySelectorAll('.site-map-styles button')].find((b) => b.textContent === 'Street');
    fireEvent.click(street);
    expect(street.getAttribute('aria-pressed')).toBe('true');
    await act(async () => { finishLoad(loaded); });
    await until(() => $('#site-info')?.textContent.includes('Start point'));
    const offline = [...document.querySelectorAll('.site-map-styles button')].find((b) => b.textContent === 'No live map');
    expect(offline.getAttribute('aria-pressed')).toBe('true');
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

});
