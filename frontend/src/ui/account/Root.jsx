// The login gate: the login page until someone signs in, then their profile hub, then the game. The game mounts once and stays,
// so going back to the profile and in again keeps the laydown, and so does signing out: saves are shared, so whoever signs in next
// finds the game as it was, but nothing that was the last account's own (its deployed pack and tray). If the session runs out
// during a game, the login page comes back over it, and the same person signing in again carries on where they were.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SIGNED_OUT } from '../../api/client.js';
import { App } from '../App.jsx';
import { AuthScreen } from './AuthScreen.jsx';
import { ProfileHub } from './ProfileHub.jsx';
import { AccountContext, kitOf } from './pack.js';
import { initials } from './parts.jsx';
import './account.css';

const DEPLOYED = 'site-guard.deployed-pack'; // { ownerId, id }, so a reload keeps the pack deployed, for its owner only

function kept(storage) {
  try { return JSON.parse(storage.getItem(DEPLOYED)); } catch { return null; }
}
function keep(storage, value) {
  try { if (value) storage.setItem(DEPLOYED, JSON.stringify(value)); else storage.removeItem(DEPLOYED); } catch { /* blocked storage only loses the convenience */ }
}
const validUser = (user) => Number.isSafeInteger(user?.id) && user.id > 0;

function AccountChip({ user, onOpen }) {
  return (
    <button id="acct-chip" title="Your profile and deployment packs" onClick={onOpen}>
      <i aria-hidden="true">{initials(user.display_name)}</i>{user.display_name}
    </button>
  );
}

export function Root({ game }) {
  const { api, storage } = game;
  const [user, setUser] = useState(undefined); // undefined while checking, null when signed out
  const [screen, setScreen] = useState('hub'); // hub | game
  const [entered, setEntered] = useState(false);
  const [activeUnit, setActiveUnit] = useState(null); // the pack whose kit the tray lists
  const [editActive, setEditActive] = useState(false); // the deployed pack is being edited from inside the game, which it goes back to
  const [notice, setNotice] = useState(null); // for the login page, after signing out or deleting the account
  const [signOutError, setSignOutError] = useState(null);
  const last = useRef(null); // account id, so a lapsed session can only be picked up by the same account
  const epoch = useRef(0); // invalidates callbacks started under an earlier session

  useEffect(() => {
    let live = true;
    const started = epoch.current;
    api.auth.me().then(
      (profile) => { if (live && started === epoch.current) setUser(validUser(profile) ? profile : null); },
      () => { if (live && started === epoch.current) setUser(null); },
    );
    return () => { live = false; };
  }, [api]);
  useEffect(() => {
    if (!validUser(user)) return;
    let live = true;
    const started = epoch.current;
    last.current = user.id;
    game.saver.flush(); // runs kept while signed out are saved now
    const pack = kept(storage);
    if (pack && pack.ownerId !== user.id) keep(storage, null); // old username-only records cannot prove ownership
    if (pack?.ownerId === user.id) {
      api.units.get(pack.id).then(
        (p) => { if (live && started === epoch.current) setActiveUnit((now) => now ?? p); },
        (e) => { if (live && started === epoch.current && !e.retryable) keep(storage, null); }, // deleted meanwhile
      );
    }
    return () => { live = false; };
  }, [user?.id, api, game, storage]);
  useEffect(() => { // with a pack, the budget only counts the cost and only the pack's kit can be placed, with its settings
    game.commands.setPacked(activeUnit ? kitOf(activeUnit.assets) : false);
    game.usePackLoadouts(activeUnit ? activeUnit.assets.systems : null); // withdrawn: its settings go too
  }, [game, activeUnit]);
  useEffect(() => {
    const lost = () => { // a wave waits under the login page; the same account can restore its pack after signing in again
      epoch.current++;
      if (game.sim.state.waveActive) game.setSpeed(0);
      setActiveUnit(null);
      setSignOutError(null);
      setUser(null);
    };
    addEventListener(SIGNED_OUT, lost);
    return () => removeEventListener(SIGNED_OUT, lost);
  }, [game]);

  const clear = useCallback(() => { // what was the account's own goes; the laydown stays
    setActiveUnit(null);
    keep(storage, null);
    if (game.catalogue() === 'unit') game.openCatalogue(null, false);
  }, [game, storage]);

  const account = useMemo(() => {
    const started = epoch.current;
    const current = () => validUser(user) && started === epoch.current;
    const leave = (said) => {
      if (!current()) return;
      epoch.current++;
      clear(); setNotice(said); setSignOutError(null); setUser(null);
    };
    return {
      user, setUser: (profile) => { if (current() && profile?.id === user.id) setUser(profile); }, activeUnit, leave, signOutError,
      covered: !user || screen === 'hub', // the game is out of sight, so its hotkeys stay off
      deploy: (pack) => {
        if (!current()) return;
        setActiveUnit(pack);
        keep(storage, pack && { ownerId: user.id, id: pack.id });
        if (pack) game.openCatalogue('unit', true); // the tray opens with it
      },
      openProfile: () => { if (!current()) return; if (game.sim.state.waveActive) game.setSpeed(0); setScreen('hub'); },
      editActive,
      editPack: () => { if (!current()) return; if (game.sim.state.waveActive) game.setSpeed(0); setEditActive(true); setScreen('hub'); },
      doneEditing: () => { if (!current()) return; setEditActive(false); setScreen('game'); },
      signOut: async () => {
        if (!current()) return;
        setSignOutError(null);
        try { await api.auth.signOut(); leave('You are signed out.'); }
        catch { if (current()) setSignOutError('Sign out did not complete. Your session may still be active. Please try again.'); }
      },
    };
  }, [user, screen, activeUnit, editActive, signOutError, api, game, storage, clear]);
  useEffect(() => { game.setCovered(account.covered); }, [game, account.covered]); // nothing is drawn under the profile screen

  if (user === undefined) return <main className="acct"><div className="acct-sky" aria-hidden="true" /></main>;
  const signedIn = (u) => {
    if (!validUser(u)) { setNotice('The save server must be updated before this account can be opened.'); setUser(null); return; }
    epoch.current++;
    if (last.current && last.current !== u.id) { clear(); setScreen('hub'); } // someone else, after a session ran out
    setSignOutError(null);
    setNotice(null);
    setUser(u);
  };
  const login = <AuthScreen api={api} onSignedIn={signedIn} notice={notice} />;
  if (user === null && !entered) return login;
  const enter = () => { setEntered(true); setScreen('game'); };
  return (
    <AccountContext.Provider value={account}>
      {entered && <div inert={account.covered}><App game={game} /></div>}{/* out of reach of focus and screen readers while covered */}
      {user && screen === 'game' && <AccountChip user={user} onOpen={account.openProfile} />}
      {user && screen === 'hub' && <ProfileHub api={api} account={account} inGame={entered} onEnter={enter} />}
      {!user && login}
    </AccountContext.Provider>
  );
}
