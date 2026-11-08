// How React components reach the game.

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export const GameContext = createContext(null);
export const useGame = () => useContext(GameContext);

const noSubscribe = () => () => {};
const zero = () => 0;

// Re-render on the game's panel refresh. A component that is not visible passes false and stops refreshing.
export function useTick(active = true) {
  const game = useGame();
  return useSyncExternalStore(active ? game.subscribe : noSubscribe, active ? game.getTick : zero);
}

// Run a drawing function on animation frames while `active`, at most once every minMs.
export function useAnimation(active, draw, minMs = 0) {
  const latest = useRef(draw);
  latest.current = draw;
  useEffect(() => {
    if (!active) return undefined;
    let id = 0, last = -Infinity;
    const loop = (t) => {
      if (t - last >= minMs) { last = t; latest.current(t); }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active, minMs]);
}

// Fetch while `active`, keeping the last good data if a later fetch fails. Only the newest request's answer counts.
export function useLoad(load, active, deps = []) {
  const latest = useRef(load);
  latest.current = load;
  const newest = useRef(0);
  const [state, setState] = useState({ data: null, error: null });
  const reload = useCallback(async () => {
    const request = ++newest.current;
    try {
      const data = await latest.current();
      if (request === newest.current) setState({ data, error: null });
    } catch (e) { if (request === newest.current) setState((s) => ({ data: s.data, error: e.message })); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (active) reload(); }, [active, reload, ...deps]);
  return { ...state, reload };
}

// Two clicks for anything that throws work away. confirm(key, fn) gives a click handler; armed is the key waiting for its second click.
export function useArmed(ms = 3000) {
  const [armed, setArmed] = useState(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const confirm = (key, fn) => () => {
    clearTimeout(timer.current);
    if (armed === key) { setArmed(null); fn(); return; }
    setArmed(key);
    timer.current = setTimeout(() => setArmed(null), ms);
  };
  return { armed, confirm };
}

export { hexCss as hex } from '../render/labels.js';
export const km = (metres, trim = false) => `${(metres / 1000).toFixed(1).replace(trim ? /\.0$/ : '', '')} km`; // trim: 3 km, not 3.0 km

// Run one request and show its outcome in a note, so a refusal or a dead server is never silent. done: the note, or one made from the result.
export const attemptWith = (setNote, reload) => async (fn, done) => {
  try {
    const result = await fn();
    setNote(typeof done === 'function' ? done(result) : done);
    await reload();
    return true;
  } catch (e) { setNote(e.message); return false; }
};
export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Offer a file to the player to save.
export function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
