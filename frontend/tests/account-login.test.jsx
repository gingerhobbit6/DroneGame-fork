// @vitest-environment jsdom
// The login page, the login gate and the profile hub, against an in-memory server.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { ApiError, SIGNED_OUT, createApi } from '../src/api/client.js';
import { resetAllFigures } from '../src/sim/config/index.js';
import { view } from '../src/render/view.js';
import { AuthScreen } from '../src/ui/account/AuthScreen.jsx';
import { Root } from '../src/ui/account/Root.jsx';
import { RecoveryCode, passwordStrength } from '../src/ui/account/parts.jsx';
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

describe('the login page', () => {
  const page = (onSignedIn = vi.fn()) => { render(<AuthScreen api={api} onSignedIn={onSignedIn} />); return onSignedIn; };

  it('signs in, and can keep the session for 30 days', async () => {
    const done = page();
    type('Username', ' operator ');
    type('Password', 'correct horse battery');
    fireEvent.click(screen.getByLabelText(/Keep me signed in/));
    press('Sign in');
    await settle();
    expect(api.auth.signIn).toHaveBeenCalledWith({ username: 'operator', password: 'correct horse battery', remember: true });
    expect(done).toHaveBeenCalledWith(USER);
  });

  it('shows why a sign-in was refused, in the server\'s words', async () => {
    api.auth.signIn.mockRejectedValueOnce(new ApiError('Too many failed attempts. Try again in 5 minutes.', false, 429));
    const done = page();
    type('Username', 'operator');
    type('Password', 'wrong');
    press('Sign in');
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/Try again in 5 minutes/);
    expect(done).not.toHaveBeenCalled();
  });

  it('says whether the server is running', async () => {
    api.auth.health.mockRejectedValueOnce(new ApiError('down', true));
    page();
    await settle();
    expect($('.acct-status').textContent).toMatch(/Server offline/);
  });

  it('shows and hides the password, and warns when Caps Lock is on', () => {
    page();
    const input = screen.getByLabelText('Password', { selector: 'input' });
    expect(input.type).toBe('password');
    press('Show the password');
    expect(input.type).toBe('text');
    fireEvent.keyDown(input, { key: 'A', modifierCapsLock: true });
    expect(screen.getByRole('status').textContent).toBe('Caps Lock is on');
  });

  it('creates an account, and goes on only once the recovery code is saved', async () => {
    const done = page();
    fireEvent.click(screen.getByRole('tab', { name: 'Create account' }));
    type('Your name', 'Sgt Alex Smith');
    type('Username', 'operator');
    type('New password', 'a long passphrase here');
    type('Type it again', 'a long passphrase here');
    expect($('.acct-meter').dataset.score).toBe('4');
    press('Create account');
    await settle();
    expect(api.auth.register).toHaveBeenCalledWith({ username: 'operator', display_name: 'Sgt Alex Smith', password: 'a long passphrase here' });
    expect($('#recovery-code').textContent).toBe(CODE);
    const go = screen.getByRole('button', { name: 'Continue to your profile' });
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I have saved it/));
    fireEvent.click(go);
    expect(done).toHaveBeenCalledWith(USER);
  });

  it.each([
    ['short', 'operator', 'too short', 'too short', /at least 10/],
    ['mismatched', 'operator', 'a long passphrase', 'a long passphrase!', /do not match/],
    ['the username', 'operator1234', 'operator1234', 'operator1234', /must not be your username/],
    ['a bad username', 'no spaces here', 'a long passphrase', 'a long passphrase', /Usernames are 3 to 32/],
  ])('refuses a %s password or name before asking the server', (_, username, password, again, why) => {
    page();
    fireEvent.click(screen.getByRole('tab', { name: 'Create account' }));
    type('Your name', 'Op');
    type('Username', username);
    type('New password', password);
    type('Type it again', again);
    press('Create account');
    expect(screen.getByRole('alert').textContent).toMatch(why);
    expect(api.auth.register).not.toHaveBeenCalled();
  });

  it('resets a forgotten password with the recovery code, and shows the next code', async () => {
    page();
    press('Forgotten password?');
    type('Username', 'operator');
    type('Recovery code', CODE.toLowerCase());
    type('New password', 'a brand new passphrase');
    type('Type it again', 'a brand new passphrase');
    press('Reset password');
    await settle();
    expect(api.auth.reset).toHaveBeenCalledWith({ username: 'operator', recovery_code: CODE.toLowerCase(), new_password: 'a brand new passphrase' });
    expect($('#recovery-code').textContent).toBe('NEWNEW-CODE22-333333-444444');
    fireEvent.click(screen.getByLabelText(/I have saved it/));
    press('Sign in');
    expect(screen.getByRole('status').textContent).toMatch(/Sign in with your new password/);
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeNull();
  });

  it('asks before the page is left while a recovery code is showing, and not once it has gone', () => {
    const leaving = () => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; };
    const { unmount } = render(<RecoveryCode code={CODE} title="Save your recovery code" doneLabel="Done" onDone={() => {}}>Shown once.</RecoveryCode>);
    expect(leaving()).toBe(true);
    unmount();
    expect(leaving()).toBe(false);
  });

  it('goes back from the reset form', () => {
    page();
    press('Forgotten password?');
    press('Back to sign in');
    expect(screen.getByRole('heading', { name: 'Welcome back' })).not.toBeNull();
  });
});
