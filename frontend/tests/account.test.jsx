// @vitest-environment jsdom
// The login page, the login gate and the profile hub, against an in-memory server.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { ApiError, SIGNED_OUT, createApi } from '../src/api/client.js';
import { resetAllFigures } from '../src/sim/config/index.js';
import { view } from '../src/render/view.js';
import { AuthScreen } from '../src/ui/account/AuthScreen.jsx';
import { Root } from '../src/ui/account/Root.jsx';
import { passwordStrength } from '../src/ui/account/parts.jsx';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

const $ = (sel) => document.querySelector(sel);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const type = (label, value) => fireEvent.change(screen.getByLabelText(label, { exact: false, selector: 'input' }), { target: { value } });
const press = (text) => fireEvent.click(screen.getByRole('button', { name: text }));
const USER = { id: 1, username: 'operator', display_name: 'Sgt Alex Smith', rank: '', organisation: '', created_at: '2026-11-07T10:00:00+00:00', last_sign_in: null };
const CODE = 'AAAAAA-BBBBBB-CCCCCC-DDDDDD';

let api;
function fakeApi() {
  const base = createFakeApi();
  base.auth = {
    health: vi.fn(async () => ({ status: 'ok' })),
    me: vi.fn(async () => { throw new ApiError('Sign in first', true, 401); }),
    signIn: vi.fn(async () => USER),
    signOut: vi.fn(async () => null),
    register: vi.fn(async () => ({ user: USER, recovery_code: CODE })),
    reset: vi.fn(async () => ({ recovery_code: 'NEWNEW-CODE22-333333-444444' })),
    updateProfile: vi.fn(async (body) => ({ ...USER, ...body })),
    changePassword: vi.fn(async () => null),
    newRecoveryCode: vi.fn(async () => ({ recovery_code: 'FRESH2-FRESH3-FRESH4-FRESH5' })),
    deleteAccount: vi.fn(async () => null),
  };
  return base;
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  api = fakeApi();
  view.wizard = 'closed';
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('password strength', () => {
  it.each([
    ['', 0], ['short', 1], ['aaaaaaaaaaaa', 1], ['operator-password', 1], ['abcdefghij', 2], ['Abcdefgh12', 3], ['four words make it strong', 4],
  ])('rates %j as %i', (password, score) => {
    expect(passwordStrength(password, 'operator').score).toBe(score);
  });
});

describe('the login gate', { timeout: 120000 }, () => {
  let game;
  const gate = (storage = createFakeStorage()) => {
    game = createGame({ seed: '1', terrainSeed: '1', api, storage });
    game.attach = vi.fn();
    vi.spyOn(game.saver, 'flush');
    render(<Root game={game} />);
  };
  const PACK = { name: '1 Troop', echelon: 'troop', callsign: '', assets: { systems: [{ id: 'radar_a800', count: 1 }], vehicles: [], people: [] } };
  const DEPLOYED = 'site-guard.deployed-pack';

  it('shows the login page until someone signs in, then their profile, and saves runs kept meanwhile', async () => {
    gate();
    await settle();
    expect($('.acct-login')).not.toBeNull();
    expect(game.saver.flush).not.toHaveBeenCalled();
    type('Username', 'operator');
    type('Password', 'correct horse battery');
    press('Sign in');
    await settle();
    expect(screen.getByRole('heading', { name: 'Welcome, Sgt Alex Smith' })).not.toBeNull();
    expect(game.saver.flush).toHaveBeenCalled();
    expect($('#toolbar')).toBeNull(); // the game is not mounted until entered
  });

  it('goes into the game and back to the profile, keeping the game as it was', async () => {
    api.auth.me.mockResolvedValueOnce(USER);
    gate();
    await settle();
    fireEvent.click($('#enter-game'));
    expect($('#toolbar')).not.toBeNull();
    expect($('.acct-hub')).toBeNull();
    fireEvent.click($('#acct-chip'));
    expect($('.acct-hub')).not.toBeNull();
    expect($('#toolbar')).not.toBeNull();
    expect($('#enter-game').textContent).toBe('Back to the game');
    expect(game.attach).toHaveBeenCalledTimes(1);
  });

  it('pauses a wave in progress while the profile is open', async () => {
    api.auth.me.mockResolvedValueOnce(USER);
    gate();
    await settle();
    fireEvent.click($('#enter-game'));
    game.sim.state.waveActive = true;
    fireEvent.click($('#acct-chip'));
    expect(game.clock.speed).toBe(0);
  });

  const inGame = async () => { api.auth.me.mockResolvedValueOnce(USER); gate(); await settle(); fireEvent.click($('#enter-game')); };
  const signBackIn = async () => { type('Username', 'operator'); type('Password', 'correct horse battery'); press('Sign in'); await settle(); };

  it('brings the login page back over the game when the session runs out, then goes back in for the same person', async () => {
    await inGame();
    game.sim.state.waveActive = true;
    act(() => { dispatchEvent(new Event(SIGNED_OUT)); });
    expect($('.acct-login')).not.toBeNull();
    expect($('#toolbar')).not.toBeNull(); // the game waits underneath, paused
    expect(game.clock.speed).toBe(0);
    await signBackIn();
    expect($('.acct-login')).toBeNull();
    expect($('#acct-chip')).not.toBeNull();
    expect(game.attach).toHaveBeenCalledTimes(1);
  });

  const deployFirstPack = async () => {
    await api.units.create(PACK);
    await inGame();
    fireEvent.click($('#acct-chip'));
    await settle();
    press('Deploy');
    expect($('[data-catalogue="unit"]')).not.toBeNull();
  };

  it('gives the game, but not the pack, to someone else who signs in after a session runs out', async () => {
    await deployFirstPack();
    act(() => { dispatchEvent(new Event(SIGNED_OUT)); });
    api.auth.signIn.mockResolvedValueOnce({ ...USER, id: 2, username: 'someone', display_name: 'Cpl Jo Bloggs' });
    await signBackIn();
    expect(screen.getByRole('heading', { name: 'Welcome, Cpl Jo Bloggs' })).not.toBeNull(); // their profile first
    expect($('#enter-game').textContent).toBe('Back to the game');
    expect($('[data-catalogue="unit"]')).toBeNull();
    expect(game.attach).toHaveBeenCalledTimes(1); // the same game, never reloaded
  });

  it('restores the same account\'s pack after its session lapses', async () => {
    await deployFirstPack();
    act(() => { dispatchEvent(new Event(SIGNED_OUT)); });
    expect(game.sim.state.packed).toBe(false);
    await signBackIn();
    await settle();
    expect(game.sim.state.packed).toBe(true);
    expect(game.sim.state.kit).toEqual({ radar_a800: 1 });
  });

  it('keeps the hidden game\'s hotkeys off under the profile', async () => {
    await inGame();
    fireEvent.click($('#acct-chip'));
    fireEvent.keyDown(window, { key: '1' });
    expect(game.getTool()).toBeNull();
    fireEvent.click($('#enter-game'));
    fireEvent.keyDown(window, { key: '1' });
    expect(game.getTool()).toBe('radar');
  });

  it('signs out without a reload, keeping the game but not the pack', async () => {
    await deployFirstPack();
    fireEvent.click($('#acct-chip'));
    press('Sign out');
    await settle();
    expect(api.auth.signOut).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('You are signed out.');
    expect(game.storage.getItem(DEPLOYED)).toBeNull();
    await signBackIn();
    expect($('#enter-game').textContent).toBe('Back to the game');
    expect(screen.getByText(/Build a deployment pack/)).not.toBeNull();
    expect(game.attach).toHaveBeenCalledTimes(1);
  });

  it('keeps the account open and reports a failed sign-out', async () => {
    api.auth.me.mockResolvedValueOnce(USER);
    gate();
    await screen.findByRole('heading', { name: 'Welcome, Sgt Alex Smith' });
    api.auth.signOut.mockRejectedValueOnce(new ApiError('The save server is not running.', true));
    press('Sign out');
    expect((await screen.findByRole('alert')).textContent).toMatch(/sign out.*not complete/i);
    expect($('.acct-hub')).not.toBeNull();
    expect($('.acct-login')).toBeNull();
    expect(api.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('discards a private pack response that arrives after another account signs in', async () => {
    const storage = createFakeStorage();
    storage.setItem(DEPLOYED, JSON.stringify({ ownerId: USER.id, id: 99 }));
    let resolvePack;
    api.units.get = vi.fn(() => new Promise((resolve) => { resolvePack = resolve; }));
    api.auth.me.mockResolvedValueOnce(USER);
    gate(storage);
    await screen.findByRole('heading', { name: 'Welcome, Sgt Alex Smith' });
    await waitFor(() => expect(api.units.get).toHaveBeenCalledWith(99));
    press('Sign out');
    await screen.findByRole('heading', { name: 'Welcome back' });
    api.auth.signIn.mockResolvedValueOnce({ ...USER, id: 2, username: 'someone', display_name: 'Cpl Jo Bloggs' });
    type('Username', 'operator'); type('Password', 'correct horse battery'); press('Sign in');
    await screen.findByRole('heading', { name: 'Welcome, Cpl Jo Bloggs' });
    await act(async () => { resolvePack({ ...PACK, id: 99 }); });
    expect(screen.getByRole('heading', { name: 'Welcome, Cpl Jo Bloggs' })).not.toBeNull();
    expect(screen.queryByText(/Deployed:/)).toBeNull();
    expect(game.sim.state.packed).toBe(false);
  });

  it('discards an old profile response after another account signs in', async () => {
    let resolveProfile;
    api.auth.updateProfile.mockImplementationOnce(() => new Promise((resolve) => { resolveProfile = resolve; }));
    api.auth.me.mockResolvedValueOnce(USER);
    gate();
    await screen.findByRole('heading', { name: 'Welcome, Sgt Alex Smith' });
    press('Edit');
    type('Name', 'Old account edited');
    press('Save');
    act(() => { dispatchEvent(new Event(SIGNED_OUT)); });
    api.auth.signIn.mockResolvedValueOnce({ ...USER, id: 2, username: 'someone', display_name: 'Cpl Jo Bloggs' });
    type('Username', 'operator'); type('Password', 'correct horse battery'); press('Sign in');
    await screen.findByRole('heading', { name: 'Welcome, Cpl Jo Bloggs' });
    await act(async () => { resolveProfile({ ...USER, display_name: 'Old account edited' }); });
    expect(screen.getByRole('heading', { name: 'Welcome, Cpl Jo Bloggs' })).not.toBeNull();
  });

  it('limits the game to the deployed pack through the whole login path, and lifts it when the pack is withdrawn', async () => {
    await deployFirstPack();
    expect(game.sim.state).toMatchObject({ packed: true, kit: { radar_a800: 1 } });
    game.sim.commands.deploy('1', '1');
    expect(game.sim.commands.place('radar', 30, 0)).toMatch(/not in your deployment pack/);
    const storage = game.storage;
    cleanup();
    api.auth.me.mockResolvedValueOnce(USER);
    gate(storage); // the page loaded again, with the pack kept
    await settle();
    expect(game.sim.state.kit).toEqual({ radar_a800: 1 });
  });

  it('keeps the deployed pack across a reload, for its owner only', async () => {
    await deployFirstPack();
    expect(JSON.parse(game.storage.getItem(DEPLOYED))).toEqual({ ownerId: USER.id, id: 1 });
    const storage = game.storage;
    cleanup();
    api.auth.me.mockResolvedValueOnce(USER);
    gate(storage); // the page loaded again
    await settle();
    expect(screen.getByText('Deployed: 1 Troop. Its kit waits in the pack tray in the game.')).not.toBeNull();
    cleanup();
    api.auth.me.mockResolvedValueOnce({ ...USER, id: 2 }); // even a re-created username is a different account
    gate(storage);
    await settle();
    expect(screen.queryByText(/Deployed:/)).toBeNull();
    expect(storage.getItem(DEPLOYED)).toBeNull();
  });

  it('drops old username-only deployment records because they cannot prove ownership', async () => {
    const storage = createFakeStorage();
    storage.setItem(DEPLOYED, JSON.stringify({ username: 'operator', id: 1 }));
    const get = vi.spyOn(api.units, 'get');
    api.auth.me.mockResolvedValueOnce(USER);
    gate(storage);
    await settle();
    expect(get).not.toHaveBeenCalled();
    expect(storage.getItem(DEPLOYED)).toBeNull();
  });

  it('forgets a kept pack that was deleted meanwhile', async () => {
    const storage = createFakeStorage();
    storage.setItem(DEPLOYED, JSON.stringify({ ownerId: USER.id, id: 99 }));
    api.auth.me.mockResolvedValueOnce(USER);
    gate(storage);
    await settle();
    expect(screen.queryByText(/Deployed:/)).toBeNull();
    expect(storage.getItem(DEPLOYED)).toBeNull();
  });

  it('deletes the account only with the password, then shows the login page', async () => {
    await deployFirstPack();
    fireEvent.click($('#acct-chip'));
    press('Delete account');
    expect(screen.getByText(/cannot be undone/)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Delete my account' }).disabled).toBe(true);
    api.auth.deleteAccount.mockRejectedValueOnce(new ApiError('Wrong username, password or recovery code', false, 401));
    type('Current password', 'wrong one');
    press('Delete my account');
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Wrong username, password or recovery code');
    expect($('.acct-login')).toBeNull();
    type('Current password', 'correct horse battery');
    press('Delete my account');
    await settle();
    expect(api.auth.deleteAccount).toHaveBeenLastCalledWith({ password: 'correct horse battery' });
    expect(screen.getByRole('status').textContent).toBe('Your account and its deployment packs were deleted.');
    expect(game.storage.getItem(DEPLOYED)).toBeNull();
  });
});

describe('the API client', () => {
  const reply = (status, body) => ({ status, ok: status < 400, json: async () => body });
  afterEach(() => vi.unstubAllGlobals());

  it('reaches every account and pack route, sending writes as JSON', async () => {
    const f = vi.fn(async () => reply(200, {}));
    vi.stubGlobal('fetch', f);
    const { auth, units } = createApi();
    await auth.health(); await auth.me(); await auth.register({}); await auth.signIn({}); await auth.signOut(); await auth.reset({});
    await auth.updateProfile({}); await auth.changePassword({}); await auth.newRecoveryCode({}); await auth.deleteAccount({});
    await units.list(); await units.get(2); await units.create({}); await units.replace(2, {}); await units.remove(2);
    expect(f.mock.calls.map(([url, o]) => `${o.method} ${url}`)).toEqual([
      'GET /api/v1/health', 'GET /api/v1/auth/me', 'POST /api/v1/auth/register', 'POST /api/v1/auth/sign-in', 'POST /api/v1/auth/sign-out',
      'POST /api/v1/auth/reset', 'PUT /api/v1/auth/me', 'POST /api/v1/auth/password', 'POST /api/v1/auth/recovery-code', 'POST /api/v1/auth/delete-account',
      'GET /api/v1/units', 'GET /api/v1/units/2', 'POST /api/v1/units', 'PUT /api/v1/units/2', 'DELETE /api/v1/units/2',
    ]);
    expect(f.mock.calls[4][1]).toMatchObject({ headers: { 'Content-Type': 'application/json' }, body: '{}' }); // the server only takes JSON writes
  });

  it('says the session has gone on a 401 from a record or the profile, but not on a wrong password', async () => {
    const heard = vi.fn();
    addEventListener(SIGNED_OUT, heard);
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { detail: 'Sign in first' })));
    const { runs, auth } = createApi();
    await auth.signIn({}).catch(() => null);
    await auth.changePassword({}).catch(() => null);
    expect(heard).not.toHaveBeenCalled();
    await runs.list().catch(() => null);
    await auth.me().catch(() => null);
    expect(heard).toHaveBeenCalledTimes(2);
    removeEventListener(SIGNED_OUT, heard);
  });

  it('shows the server\'s words for a refusal, and keeps a run while signed out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { detail: 'Sign in first' })));
    await expect(createApi().runs.create({})).rejects.toMatchObject({ retryable: true, status: 401, message: 'Sign in first' });
    vi.stubGlobal('fetch', vi.fn(async () => reply(409, { detail: [{ loc: ['x'], msg: 'y' }] })));
    await expect(createApi().units.create({})).rejects.toMatchObject({ retryable: false, message: 'The server refused that (409).' });
  });
});
