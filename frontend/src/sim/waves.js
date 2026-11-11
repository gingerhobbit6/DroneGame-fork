// Building each wave's attack and launching it on schedule.

import { WAVES } from './config/index.js';
import { DEFAULT_MIX, slotsFor } from './attack-mix.js';
import { waveStream } from './rng.js';
import { spawnDrone } from './drones.js';
import { money } from './economy.js';
import { captureLaydown, costProblem, unwired } from './laydown.js';

// beginRun rebuilds the run when the first wave starts, so nothing from the build phase can affect it.
export function startWave(w, beginRun) {
  const { state, net } = w;
  if (state.waveActive || state.over || !state.started) return;
  if (state.sandbox) { w.emit('toast', 'Exit the sandbox first: it resets the run and keeps your laydown'); return; }
  if (state.wave === 0 && !state.packed) { // the first wave buys the laydown again at today's prices: one raised since would leave no money to fire with
    const dear = costProblem(captureLaydown(w));
    if (dear) { w.emit('toast', `${dear}. Sell something, or lower the price in Sources`); return; }
  }
  const loose = unwired(w).length;
  if ((loose || !net.fusion.uplinks.size) && !state.warnedWire) { // nodes with no link are offline: warn once
    state.warnedWire = true;
    w.emit('toast', loose ? `${loose} system${loose > 1 ? 's have' : ' has'} no network link and will be offline. Open SAPIENT > Network (Auto-wire), or press Start wave again to go anyway` : 'The fusion node has no network terminal, so it will hear nothing. Open SAPIENT > Network, or press Start wave again to go anyway');
    return;
  }
  if (state.wave === 0) beginRun();
  state.wave++;
  state.queue = makeWave(state.wave, waveStream(state.seed, state.wave), state.attack);
  state.waveTime = 0;
  state.waveActive = true;
  state.autoTimer = -1;
  w.emit('toast', state.wave > 1 ? `Wave ${state.wave} inbound: the enemy has adapted` : `Wave ${state.wave} inbound`);
}

export function updateWaves(w, dt, beginRun) {
  const { state, drones } = w;
  if (state.sandbox) {
    state.sbTime += dt;
    while (state.sbQueue.length && state.sbQueue[0].t <= state.sbTime) { const q = state.sbQueue.shift(); spawnDrone(w, q.type, q.bearing, q); }
  }
  if (state.waveActive) {
    state.waveTime += dt;
    while (state.queue.length && state.queue[0].t <= state.waveTime) {
      const q = state.queue.shift();
      spawnDrone(w, q.type, q.bearing, q);
    }
    if (!state.queue.length && !drones.some((d) => d.def.role !== 'spotter')) {
      for (const d of drones) d.mode = 'egress'; // spotters withdraw once the strike is over
      state.waveActive = false;
      w.emit('toast', `Wave ${state.wave} cleared. Budget left ${money(state.budget)}`);
      if (state.autoStart) state.autoTimer = 6;
    }
  } else if (state.autoTimer >= 0) {
    state.autoTimer -= dt;
    if (state.autoTimer < 0) startWave(w, beginRun);
  }
}

// Returns [{ t, type, bearing, dist, jitter, altFrac }] sorted by spawn time (seconds into the wave). `dist` is how far across its
// launch band (WORLD.launchBand) a drone starts. `rng` is the wave's own seeded stream (rng.js waveStream), so a wave looks the same
// however it is reached. `mix` is the drone types ticked (attack-mix.js): each slot's drones take turns, starting at a different one
// each wave so every one is seen.
export function makeWave(n, rng, mix = DEFAULT_MIX) {
  const slots = slotsFor(mix), take = (list, i) => list[(i + n) % list.length];
  const out = [];
  const plan = (spawn) => { const dist = rng(); out.push({ dist, ...spawn }); }; // a drone on its own starts where this roll puts it
  const groups = Math.min(1 + Math.floor(n / 3), 3);
  const sites = Array.from({ length: groups }, () => ({ bearing: rng() * Math.PI * 2, dist: rng() })); // launch areas: a group comes from one
  const add = (slot, count, start, span) => {
    const list = slots[slot];
    for (let i = 0; i < count && list.length; i++) {
      const { bearing, dist } = sites[i % groups];
      plan({ t: start + (span * i) / Math.max(count, 1), type: take(list, i), bearing, dist, jitter: (rng() - 0.5) * 0.3, altFrac: rng() });
    }
  };
  // first-person-view strikes, or what stands in for them, arrive one at a time, each from its own direction, WAVES.fpvGap seconds apart
  for (let i = 0; i < 3 + n * 2; i++) {
    plan({ t: i * WAVES.fpvGap, type: take(slots.fpv, i), bearing: rng() * Math.PI * 2, jitter: 0, altFrac: rng() });
  }
  if (n >= 2) add('fw', Math.ceil((n - 1) / 2), 4, 14);
  if (n >= 3) add('fo', Math.floor((n - 1) / 2), 2, 10);
  if (n >= 3) add('spotter', n >= 8 ? 2 : 1, 0, 1);
  return out.sort((a, b) => a.t - b.t);
}
