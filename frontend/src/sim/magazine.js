// Rounds ready to fire, rounds in storage, and the wait to move one to the other. These limit firing on top of the budget,
// which still pays for every shot. A laser's magazine is seconds of stored beam: it has no storage and recharges instead.

import { STRUCTURES } from './config/index.js';
import { money } from './economy.js';

const isBeam = (def) => def.fire === 'beam';

// A large system (NASAMS, Skynex, Gepard) reloads from its storage only once the fighting stops: in the field that takes a
// reload vehicle and its crew. A small or medium one, such as a GPMG or a launcher with its rounds beside it, reloads as it fights.
export const reloadsInFight = (def) => isBeam(def) || (def.size ?? STRUCTURES[def.variantOf]?.size) !== 'L';
// A wave, or an attack launched in the sandbox, still under way.
const fighting = (w) => w.state.waveActive || (w.state.sandbox && (w.drones.length > 0 || w.state.sbQueue.length > 0));

export function fillMagazine(s) {
  s.fired = 0; s.reload = 0; s.prepaid = 0;
  if (s.def.magazine) { s.rounds = s.def.magazine; s.storage = s.def.storage || 0; }
}

// Nothing without a magazine runs out.
export const canFire = (s) => !s.def.magazine || (s.reload === 0 && s.rounds > 0);

// In words. def is passed separately because a moment being reviewed does not carry one.
export function magazineWord(now, def) {
  if (now.reload > 0) return now.reloadHeld ? 'Reloads after the wave' : 'Reloading';
  if (now.rounds <= 0) return 'EMPTY';
  return now.rounds <= def.magazine * 0.25 ? 'LOW' : 'Ready';
}

export function useRound(w, s) {
  s.fired++;
  if (!s.def.magazine) return;
  s.rounds = Math.max(0, s.rounds - 1);
  if (s.rounds > 0) return;
  if (isBeam(s.def) || s.storage > 0) s.reload = s.def.reloadTime;
  else {
    w.rec.event('empty', `${s.short} is out of rounds`);
    w.emit('toast', `${s.short} is out of rounds, with none in storage`);
  }
}

// ---------- resupply ----------
// Rounds a launcher came with are paid for as they are fired. Rounds bought here are paid for now and marked prepaid, so firing
// them costs nothing more: a round is only ever paid for once. A laser recharges, so it never needs this.
const roundsMissing = (s) => (s.def.magazine && !isBeam(s.def) ? Math.max(0, s.def.magazine + s.def.storage - s.rounds - s.storage) : 0);

export const canResupply = ({ wave, waveActive, over, sandbox }) => sandbox || (wave > 0 && !waveActive && !over);

export const resupplyNeed = (structures) => ({
  rounds: structures.reduce((sum, s) => sum + roundsMissing(s), 0),
  cost: structures.reduce((sum, s) => sum + roundsMissing(s) * s.def.shotCost, 0),
});

// Fills the emptiest launchers first if the budget runs short. Rounds arrive at once, and a reload in progress is finished.
export function resupply(w) {
  const { state, ledger } = w;
  if (!canResupply(state)) { w.emit('toast', 'You can only resupply between waves'); return; }
  const share = (s) => (s.rounds + s.storage) / (s.def.magazine + s.def.storage);
  const launchers = w.structures.filter((s) => s.def.magazine && !isBeam(s.def)).sort((a, b) => share(a) - share(b));
  let bought = 0, spent = 0, short = 0;
  for (const s of launchers) {
    const missing = roundsMissing(s);
    const n = state.sandbox || state.packed ? missing : Math.min(missing, Math.floor(state.budget / s.def.shotCost));
    if (!state.sandbox) {
      const cost = n * s.def.shotCost;
      state.budget -= cost; ledger.consumables += cost; spent += cost;
      s.prepaid += n;
    }
    bought += n; short += missing - n;
    const total = s.rounds + s.storage + n;
    s.rounds = Math.min(s.def.magazine, total);
    s.storage = total - s.rounds;
    s.reload = 0;
  }
  if (!bought && !short) return;
  w.emit('toast', `Resupplied ${bought} round${bought === 1 ? '' : 's'}${state.sandbox ? ', free in the sandbox' : ` for ${money(spent)}`}${short ? `. The budget could not cover another ${short}` : ''}`);
}

export function updateMagazine(w, s, dt) {
  const def = s.def;
  if (!def.magazine) return;
  if (s.reload > 0) {
    s.reloadHeld = !reloadsInFight(def) && fighting(w);
    if (s.reloadHeld) return;
    s.reload = Math.max(0, s.reload - dt);
    if (s.reload === 0) {
      s.rounds = isBeam(def) ? def.magazine : Math.min(def.magazine, s.storage);
      if (!isBeam(def) && !w.state.sandbox) s.storage -= s.rounds; // the sandbox tests depth without using it up
    }
  } else if (isBeam(def) && !s.beamOn) s.rounds = Math.min(def.magazine, s.rounds + (def.magazine / def.reloadTime) * dt);
}
