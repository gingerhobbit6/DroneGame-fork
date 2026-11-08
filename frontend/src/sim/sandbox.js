// Try attacks against the laydown before committing to a real wave. The site and the systems cannot be damaged, shots are
// free, and the wave counter does not move, so the laydown stays editable. Leaving resets the run (the laydown and wiring are kept).

import { rand, waveStream } from './rng.js';
import { makeWave } from './waves.js';
import { removeDrone } from './drones.js';
import { tally } from './economy.js';
import { logEnd } from './flight-log.js';

const byTime = (a, b) => a.t - b.t;

export function enterSandbox(w) {
  const { state } = w;
  if (!state.started || state.over) return;
  if (state.wave > 0) { w.emit('toast', 'The sandbox is only available before the first wave'); return; }
  state.sandbox = true; state.sbQueue = []; state.sbTime = 0; state.sbSpent = 0;
  w.emit('sandbox', true);
}

// Launch the attack of the wave the enemy has adapted to.
export function launchSandboxWave(w) {
  const { state } = w;
  const lvl = state.sbLevel;
  for (const q of makeWave(lvl, waveStream(state.seed, lvl), state.attack)) state.sbQueue.push({ ...q, t: q.t + state.sbTime });
  state.sbQueue.sort(byTime);
}

// bearingDeg is a compass bearing, or 'rand'
export function launchSandboxAttack(w, { type, count, bearingDeg, gap }) {
  const { state } = w;
  const dist = rand(); // one launch area for a set bearing; random bearings each roll their own
  for (let i = 0; i < count; i++) {
    const bearing = (bearingDeg === 'rand' ? rand() * 360 : Number(bearingDeg)) * Math.PI / 180 - Math.PI / 2; // compass bearing to a scene angle
    state.sbQueue.push({ t: state.sbTime + i * gap, type, bearing, jitter: 0, altFrac: rand(), dist: bearingDeg === 'rand' ? rand() : dist });
  }
  state.sbQueue.sort(byTime);
}

export function clearSandboxDrones(w) {
  w.state.sbQueue.length = 0;
  for (const d of w.drones.slice()) { tally(w.ledger.escaped, d.type); logEnd(w, d, 'left'); removeDrone(w, d); } // cleared away, so none stays airborne in the figures
}
