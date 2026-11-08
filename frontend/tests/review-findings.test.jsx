// @vitest-environment jsdom
// Each of these reproduces something the code reviews found, so it cannot quietly come back.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGame } from '../src/game.js';
import { createRunSaver } from '../src/api/run-saver.js';
import { ADAPT, STRUCTURES, importFigures, resetAllFigures } from '../src/sim/config/index.js';
import { terrainState } from '../src/sim/terrain.js';
import { createStructureViews } from '../src/render/structure-view.js';
import { buildWorldView } from '../src/render/terrain-view.js';
import { createLabels, setText } from '../src/render/labels.js';
import { createReplay } from '../src/render/replay-view.js';
import { droneTemplate } from '../src/render/models.js';
import { GameContext, useLoad } from '../src/ui/hooks.js';
import { RunsTab } from '../src/ui/dock/RunsTab.jsx';
import { Timeline } from '../src/ui/Timeline.jsx';
import { MIXED, setUp } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

const $ = (q) => document.querySelector(q);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const SAVE_KEY = 'site-guard.unsaved-runs';
const RUN = { scenario_seed: 's', world: '1', waves_completed: 1, kills: 1, leaks: 0, health: 100, capex: 0, consumables: 0, budget_left: 0, enemy_cost: 0 };

let game, api, storage;
const show = (ui) => render(<GameContext.Provider value={game}>{ui}</GameContext.Provider>);

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  api = createFakeApi(); storage = createFakeStorage();
  game = createGame({ seed: '1', terrainSeed: '1', api, storage });
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('imported figures cannot overwrite built-in objects', () => {
  it.each([
    ['constructor as an item', '{"drones":{"constructor":{"keys":1}}}'],
    ['__proto__ as an item', '{"structures":{"__proto__":{"hasOwnProperty":1}}}'],
    ['constructor as a figure', '{"structures":{"radar":{"constructor":1}}}'],
    ['__proto__ as a group', '{"__proto__":{"radar":{"cost":1}}}'],
  ])('%s', (_, text) => {
    const keys = Object.keys, own = Object.prototype.hasOwnProperty;
    let thrown = null;
    try { importFigures(JSON.parse(text)); } catch (e) { thrown = e; }
    const intact = Object.keys === keys && Object.prototype.hasOwnProperty === own;
    Object.keys = keys; Object.prototype.hasOwnProperty = own; // put them back so a failure here cannot take the test run down too
    expect(intact).toBe(true);
    expect(thrown).toBeNull();
    expect(Object.hasOwn(STRUCTURES.radar, 'constructor')).toBe(false);
  });

  it('enemy learning only accepts its own keys', () => {
    game.commands.setAdapt('constructor', 1);
    expect(Object.hasOwn(ADAPT, 'constructor')).toBe(false);
  });
});

describe('the run saver never loses a run or says it kept one it did not', () => {
  const make = () => {
    const notes = [];
    return { notes, saver: createRunSaver({ api, storage, notify: (m) => notes.push(m), onChange: () => {} }) };
  };

  it('does not claim to have kept a run when storage is full', async () => {
    const { saver, notes } = make();
    api.state.down = true;
    storage.full = true;
    await saver.save(RUN);
    expect(notes.join(' ')).toMatch(/could not be saved or kept/);
    expect(notes.join(' ')).not.toMatch(/being kept/);
    expect(saver.message()).toMatch(/could not be saved or kept/);
  });

  it('holds a copy while saving, so closing the page mid-save loses nothing', async () => {
    const { saver } = make();
    let release;
    api.runs.create = () => new Promise((r) => { release = r; });
    const saving = saver.save(RUN);
    expect(JSON.parse(storage.getItem(SAVE_KEY)).length).toBe(1); // the page could close right now
    expect(saver.pending()).toBe(0); // but this page is on it, so nothing is shown as waiting and a flush leaves it alone
    await saver.flush();
    expect(api.runs.rows.size).toBe(0);
    release({ id: 1 });
    await saving;
    expect(storage.getItem(SAVE_KEY)).toBeNull();
  });

  it('drops the copy when the server refuses, since retrying cannot help', async () => {
    const { saver } = make();
    api.state.refuse = true;
    await saver.save(RUN);
    expect(saver.pending()).toBe(0);
  });

  it('still saves when storage is blocked and the server is up', async () => {
    const { saver, notes } = make();
    storage.full = true;
    await saver.save(RUN);
    expect(api.runs.rows.size).toBe(1);
    expect(notes).toEqual([]);
  });

  it('does not lose a run that is added while a flush is running', async () => {
    const { saver } = make();
    saver.keep({ ...RUN, kills: 1 });
    saver.keep({ ...RUN, kills: 2 });
    const create = api.runs.create;
    let added = false;
    api.runs.create = async (run) => {
      if (!added) { added = true; saver.keep({ ...RUN, kills: 3 }); }
      return create(run);
    };
    await saver.flush();
    const left = JSON.parse(storage.getItem(SAVE_KEY) || '[]');
    expect([...api.runs.rows.values()].map((r) => r.kills)).toEqual([1, 2]);
    expect(left.map((e) => e.run.kills)).toEqual([3]);
  });

  it('copes with something other than a list in storage', async () => {
    storage.setItem(SAVE_KEY, '{"not":"a list"}');
    const { saver } = make();
    expect(saver.pending()).toBe(0);
    saver.keep(RUN);
    expect(saver.pending()).toBe(1);
    await saver.flush();
    expect(api.runs.rows.size).toBe(1);
    storage.setItem(SAVE_KEY, '[1, null, {"nope": true}]');
    expect(saver.pending()).toBe(0);
  });

  it('says so when it has to drop the oldest kept run', () => {
    const { saver, notes } = make();
    for (let i = 0; i < 51; i++) saver.keep({ ...RUN, kills: i });
    expect(saver.pending()).toBe(50);
    expect(notes.join(' ')).toMatch(/oldest/);
  });

  it('still saves the rest when the server keeps failing on one run', async () => {
    const { saver } = make();
    saver.keep({ ...RUN, kills: 1 });
    saver.keep({ ...RUN, kills: 2 });
    const create = api.runs.create;
    api.runs.create = async (run) => {
      if (run.kills === 1) { api.state.down = true; try { return await create(run); } finally { api.state.down = false; } }
      return create(run);
    };
    expect(await saver.flush()).toBe(1);
    expect(JSON.parse(storage.getItem(SAVE_KEY)).map((e) => e.run.kills)).toEqual([1]);
  });

  it('reports a kept run the server refuses, and carries on with the rest', async () => {
    const { saver, notes } = make();
    saver.keep({ ...RUN, kills: 1 });
    saver.keep({ ...RUN, kills: 2 });
    const create = api.runs.create;
    api.runs.create = async (run) => {
      if (run.kills === 1) { api.state.refuse = true; try { return await create(run); } finally { api.state.refuse = false; } }
      return create(run);
    };
    expect(await saver.flush()).toBe(1);
    expect(saver.pending()).toBe(0);
    expect(notes.join(' ')).toMatch(/kept run could not be saved/);
  });
});

describe('run history paging', () => {
  it('steps back when deleting the last run on the last page', async () => {
    for (let i = 0; i < 21; i++) await api.runs.create({ ...RUN, kills: i });
    show(<RunsTab active />);
    await settle();
    fireEvent.click(screen.getByText('Older'));
    await settle();
    expect($('.runs-paging').textContent).toContain('21–21 of 21');
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Sure?'));
    await settle();
    await settle();
    expect(document.querySelectorAll('#runs-list tbody tr').length).toBe(20);
    expect($('.runs-paging').textContent).toContain('1–20 of 20');
  });
});

describe('loading data', () => {
  it('ignores a slow answer to an older request', async () => {
    const answers = [];
    const load = () => new Promise((resolve) => answers.push(resolve));
    let shown = null;
    function Probe({ page }) { shown = useLoad(load, true, [page]).data; return null; }
    const view = render(<Probe page={1} />);
    view.rerender(<Probe page={2} />);
    await settle();
    expect(answers.length).toBe(2);
    await act(async () => { answers[1]('new'); });
    await act(async () => { answers[0]('old'); });
    expect(shown).toBe('new');
  });
});

describe('timeline markers', () => {
  it('keep moving once the history is full and its length stops changing', () => {
    const { rec } = game.sim;
    for (let i = 0; i < 7200; i++) rec.push({ t: i * 0.5, wave: 1, budget: 0, kills: 0, leaks: 0 });
    rec.events.push({ t: 1800, type: 'kill', text: 'a' });
    show(<Timeline />);
    const before = $('#tl-events i').style.left;
    act(() => {
      for (let i = 0; i < 1000; i++) rec.push({ t: 3600 + i * 0.5, wave: 1, budget: 0, kills: 0, leaks: 0 });
      game.bump();
    });
    expect(rec.frames.length).toBe(7200);
    expect($('#tl-events i').style.left).not.toBe(before);
    act(() => { rec.events.push({ t: 3000, type: 'leak', text: 'b' }); game.bump(); });
    expect(document.querySelectorAll('#tl-events i').length).toBe(2);
    act(() => { rec.events.push({ t: 100, type: 'leak', text: 'older than the history' }); game.bump(); });
    expect(document.querySelectorAll('#tl-events i').length).toBe(2);
  });
});

describe('loading a laydown', () => {
  it('does not announce an empty site', () => {
    const toasts = [];
    game.onToast((t) => toasts.push(t));
    setUp(game.sim, { seed: '1', laydown: MIXED });
    const spec = game.sim.currentLaydown();
    toasts.length = 0;
    game.commands.loadLaydown(spec, '1');
    expect(toasts.join(' ')).not.toMatch(/empty/);
    expect(game.sim.structures.length).toBe(MIXED.length);
  });
});

describe('3D resources are freed', () => {
  // every geometry and material that goes into the scene must be disposed when its object leaves
  function track(group) {
    const live = new Set();
    group.traverse((o) => {
      for (const res of [o.geometry, o.material].flat().filter(Boolean)) {
        if (live.has(res)) continue;
        live.add(res);
        res.addEventListener('dispose', () => live.delete(res));
      }
    });
    return live;
  }

  it('when a system is removed', () => {
    setUp(game.sim, { seed: '1', laydown: [['radar', 600, 0], ['jammer', 500, 300], ['laser', 300, 400], ['missile', -400, 300]] });
    const scene = new THREE.Scene();
    const views = createStructureViews(scene, game.sim, createLabels(document.createElement('div'), new THREE.PerspectiveCamera()));
    views.sync(0);
    const live = track(scene);
    expect(live.size).toBeGreaterThan(10);
    for (const s of [...game.sim.structures]) game.sim.commands.sell(s.pos.x, s.pos.z);
    views.sync(0);
    expect(scene.children.length).toBe(0);
    expect(live.size).toBe(0);
  });

  it('when the ground changes, including instanced trees and houses', () => {
    const scene = new THREE.Scene();
    const shared = new THREE.MeshStandardMaterial();
    const world = buildWorldView(scene, terrainState.data, shared);
    const instanced = [];
    world.group.traverse((o) => { if (o.isInstancedMesh) instanced.push(o); });
    expect(instanced.length).toBeGreaterThan(1);
    let freed = 0;
    for (const m of instanced) m.addEventListener('dispose', () => { freed++; });
    let sharedFreed = false;
    shared.addEventListener('dispose', () => { sharedFreed = true; });
    world.dispose();
    expect(freed).toBe(instanced.length);
    expect(sharedFreed).toBe(false); // the site material outlives the ground
  });

  it('when a reviewed run is reset, and its group leaves the scene when not reviewing', () => {
    const scene = new THREE.Scene(), labels = createLabels(document.createElement('div'), new THREE.PerspectiveCamera());
    const frame = { t: 0, drones: [{ u: 1, type: 'fpv', x: 0, y: 1, z: 0, ry: 0, tracked: true }], tracks: [], missiles: [], structs: [] };
    const replay = createReplay({
      scene, rec: { frames: [frame] }, droneTemplate, makeLabel: labels.make, placeLabel: labels.place, trackColour: () => 0xffffff,
      getStructures: () => [], labelOf: () => null, hideLive: () => {}, getLastSpeed: () => 1, setPaused: () => {}, resume: () => {},
    });
    expect(scene.children.length).toBe(0);
    replay.enter(0);
    replay.update(0, new THREE.PerspectiveCamera());
    expect(scene.children.length).toBe(1);
    const live = track(scene);
    expect(live.size).toBeGreaterThan(0);
    const own = [...live].filter((res) => res.isSpriteMaterial || res.isBufferGeometry && res.attributes.position.count === 4);
    expect(own.length).toBeGreaterThan(0);
    replay.reset();
    expect(scene.children.length).toBe(0);
    for (const res of own) expect(live.has(res)).toBe(false); // the sprite's own; the models share their template's
  });
});

describe('labels', () => {
  it('are rewritten only when their text changes', () => {
    const el = document.createElement('div');
    setText(el, 'T1 · Multirotor');
    const node = el.firstChild;
    setText(el, 'T1 · Multirotor');
    expect(el.firstChild).toBe(node); // the same text node: nothing was replaced
    setText(el, 'T1 · Fixed wing');
    expect(el.textContent).toBe('T1 · Fixed wing');
  });
});
