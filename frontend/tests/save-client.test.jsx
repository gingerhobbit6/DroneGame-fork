// @vitest-environment jsdom
// The API client, the run saver and how the game hands runs to it, with the backend up, refusing and down.

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, cleanSeed } from '../src/game.js';
import { ApiError, createApi } from '../src/api/client.js';
import { createRunSaver } from '../src/api/run-saver.js';
import { GAME_VERSION, resetAllFigures } from '../src/sim/config/index.js';
import { GameContext } from '../src/ui/hooks.js';
import { Overlay } from '../src/ui/Overlay.jsx';
import { MIXED, setUp } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

const $ = (q) => document.querySelector(q);
const text = (q) => $(q) && $(q).textContent;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const SAVE_KEY = 'site-guard.unsaved-runs';

let game, api, storage;
const show = (ui) => render(<GameContext.Provider value={game}>{ui}</GameContext.Provider>);
const armed = () => { setUp(game.sim, { seed: '1', laydown: MIXED }); game.sim.state.warnedWire = true; };

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  api = createFakeApi(); storage = createFakeStorage();
  game = createGame({ seed: '1', terrainSeed: '1', api, storage });
});
afterEach(() => { cleanup(); resetAllFigures(); vi.unstubAllGlobals(); });

describe('API client', () => {
  const stub = (impl) => { const f = vi.fn(impl); vi.stubGlobal('fetch', f); return f; };
  const reply = (status, body) => ({ status, ok: status < 400, json: async () => body });

  it('sends JSON and reads it back, on the same origin', async () => {
    const f = stub(async () => reply(201, { id: 3 }));
    expect(await createApi().laydowns.create({ name: 'a' })).toEqual({ id: 3 });
    expect(f).toHaveBeenCalledWith('/api/v1/laydowns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"a"}' });
  });
  it('covers every route', async () => {
    const f = stub(async () => reply(200, []));
    const a = createApi();
    await a.laydowns.list(); await a.laydowns.get(1); await a.laydowns.replace(1, {}); await a.figureSets.list(); await a.runs.page(20, 40);
    expect(f.mock.calls.map(([url, o]) => `${o.method} ${url}`)).toEqual(['GET /api/v1/laydowns', 'GET /api/v1/laydowns/1', 'PUT /api/v1/laydowns/1', 'GET /api/v1/figure-sets', 'GET /api/v1/runs?limit=20&offset=40']);
  });
  it('treats delete as having no body', async () => {
    stub(async () => reply(204));
    expect(await createApi().runs.remove(1)).toBeNull();
  });
  it('says the server is down when it cannot be reached, or the proxy answers for it', async () => {
    stub(async () => { throw new TypeError('network'); });
    await expect(createApi().runs.list()).rejects.toMatchObject({ retryable: true, message: expect.stringMatching(/not running/) });
    stub(async () => reply(502));
    await expect(createApi().runs.list()).rejects.toMatchObject({ retryable: true });
  });
  it('keeps a run when the connection drops while its answer is arriving', async () => {
    stub(async () => ({ status: 201, ok: true, json: async () => { throw new TypeError('network'); } }));
    await expect(createApi().runs.create({})).rejects.toMatchObject({ retryable: true });
    const saver = createRunSaver({ api: createApi(), storage, notify: () => {}, onChange: () => {} });
    await saver.save({ digest: 'abc' });
    expect(saver.pending()).toBe(1);
  });
  it('says when a request is refused, which retrying will not help', async () => {
    for (const [status, msg] of [[404, /no longer exists/], [413, /too large/], [422, /invalid/], [415, /415/]]) {
      stub(async () => reply(status));
      await expect(createApi().runs.create({})).rejects.toMatchObject({ retryable: false, message: expect.stringMatching(msg) });
    }
  });
});

describe('run saver', () => {
  const make = () => {
    const notes = [];
    return { notes, saver: createRunSaver({ api, storage, notify: (m) => notes.push(m), onChange: () => {} }) };
  };
  it('saves straight away when the server is up', async () => {
    const { saver, notes } = make();
    await saver.save({ kills: 1 });
    expect(api.runs.rows.size).toBe(1);
    expect(saver.pending()).toBe(0);
    expect(saver.saved()).toBe(1);
    expect(notes).toEqual([]);
    expect(saver.message()).toMatch(/saved to your history/);
  });
  it('keeps a run when the server is down, says so, and saves it later', async () => {
    const { saver, notes } = make();
    api.state.down = true;
    await saver.save({ kills: 1 });
    await saver.save({ kills: 2 });
    expect(saver.pending()).toBe(2);
    expect(notes[0]).toMatch(/kept in this browser/);
    expect(await saver.flush()).toBe(0);
    expect(saver.pending()).toBe(2);
    api.state.down = false;
    expect(await saver.flush()).toBe(2);
    expect(saver.pending()).toBe(0);
    expect([...api.runs.rows.values()].map((r) => r.kills)).toEqual([1, 2]);
    expect(notes.at(-1)).toMatch(/2 kept runs saved/);
  });
  it('saves the kept runs as soon as a later run reaches the server', async () => {
    const { saver } = make();
    api.state.down = true;
    await saver.save({ kills: 1 });
    api.state.down = false;
    await saver.save({ kills: 2 });
    expect(saver.pending()).toBe(0);
    expect([...api.runs.rows.values()].map((r) => r.kills).sort()).toEqual([1, 2]);
  });
  it('keeps a run while signed out, and says to sign in', async () => {
    const { saver, notes } = make();
    api.runs.create = async () => { throw new ApiError('Sign in first', true, 401); };
    await saver.save({ kills: 1 });
    expect(saver.pending()).toBe(1);
    expect(notes[0]).toMatch(/signed out.*saved when you sign in again/);
  });
  it('reports a run the server refuses, instead of retrying it for ever', async () => {
    const { saver, notes } = make();
    api.state.refuse = true;
    await saver.save({ kills: 1 });
    expect(saver.pending()).toBe(0);
    expect(notes[0]).toMatch(/could not be saved/);
    saver.keep({ kills: 2 });
    await saver.flush();
    expect(saver.pending()).toBe(0);
    expect(notes.at(-1)).toMatch(/kept run could not be saved/);
  });
  it('says so when storage is full too, so nothing is lost silently', async () => {
    const { saver, notes } = make();
    api.state.down = true;
    storage.full = true;
    await saver.save({ kills: 1 });
    expect(notes[0]).toMatch(/could not be saved or kept/);
  });
  it('copes with blocked or corrupt storage, and caps what it keeps', async () => {
    const { saver } = make();
    storage.setItem(SAVE_KEY, '{not json');
    expect(saver.pending()).toBe(0);
    for (let i = 0; i < 55; i++) saver.keep({ i });
    expect(saver.pending()).toBe(50);
    expect(JSON.parse(storage.getItem(SAVE_KEY))[0].run.i).toBe(5);
    const blocked = createRunSaver({ api, storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} }, notify: () => {}, onChange: () => {} });
    expect(blocked.pending()).toBe(0);
    blocked.keep({});
  });
  it('does not run two flushes at once', async () => {
    const { saver } = make();
    saver.keep({ kills: 1 });
    const [a, b] = await Promise.all([saver.flush(), saver.flush()]);
    expect(a + b).toBe(1);
    expect(api.runs.rows.size).toBe(1);
  });
});

describe('the game saves runs', () => {
  it('sends a finished run to the server', async () => {
    armed();
    game.sim.commands.startWave();
    game.sim.run(50);
    await act(async () => { game.commands.reset('keep'); });
    await settle();
    expect(api.runs.rows.size).toBe(1);
    expect(api.runs.rows.get(1).game_version).toBe(GAME_VERSION);
  });
  it('keeps a run in progress when the page closes, rather than racing the close', () => {
    armed();
    game.sim.commands.startWave();
    game.sim.run(50);
    game.pageClosing();
    expect(api.state.calls).not.toContain('runs.create');
    expect(game.saver.pending()).toBe(1);
  });
  it('shows on the game over card whether it was saved', async () => {
    setUp(game.sim, { seed: '1', laydown: [['rf', 900, 0]] });
    game.sim.state.warnedWire = true;
    show(<Overlay />);
    await act(async () => { while (!game.sim.state.over) { if (!game.sim.state.waveActive) game.sim.commands.startWave(); game.sim.run(200); } game.bump(); });
    await settle();
    expect(text('#save-status')).toMatch(/saved to your history/);
  }, 30000);
  it('cleans seeds to what can be saved', () => {
    expect(cleanSeed('a\nb\x00c')).toBe('abc');
    expect(cleanSeed('x'.repeat(100)).length).toBe(64);
    expect(cleanSeed('')).toBe('1');
    expect(cleanSeed(null)).toBe('1');
    expect(cleanSeed('\n')).toBe('1');
  });
});

describe('ApiError', () => {
  it('carries whether retrying can help', () => {
    expect(new ApiError('x', true).retryable).toBe(true);
    expect(new ApiError('x', false).message).toBe('x');
  });
});
