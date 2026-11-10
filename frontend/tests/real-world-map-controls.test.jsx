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
      expect($('#map-sources').open).toBe(false); // folded behind its ©, leaving the grid reference to read
      expect(nextBaseMap('live')).toBe('os');
      expect(nextBaseMap('dark')).toBe('topo'); // skips what this pack does not have
      expect(nextBaseMap('dark', { pictures: [{ layer: 'satellite' }] })).toBe('satellite');
    });
    it('centres on this laptop, marks it, and says when it is outside the world', async () => {
      await deployed();
      const v = fakeView();
      game.getView = () => v;
      view.baseMap = 'live';
      v.centreOn.mockImplementation(() => expect(view.baseMap).toBe('os'));
      useGeolocation(fixAt(...NEAR));
      show(<MapControls />);
      fireEvent.click($('#map-me'));
      await until(() => view.me);
      expect(view.baseMap).toBe('os');
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
      expect(view.startAt.privateLocation).toBe(true);
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
