// What a finished run looks like when it is saved: everything needed to reproduce it, and its headline results.

import { GAME_VERSION } from './config/index.js';
import { enemyCost } from './economy.js';

// A run lost or ended during a wave did not complete that wave; one ended between waves completed the last.
export const wavesCompleted = ({ wave, waveActive, over, ended }) => (waveActive || (over && !ended) ? Math.max(wave - 1, 0) : wave);

// The last entry marks where the run stopped, so replaying the log reaches the same digest.
export function runRecord(w, log, steps, digest) {
  const { state, ledger } = w;
  return {
    scenario_seed: state.seed,
    world: state.terrainSeed,
    spec: w.startLaydown,
    figures: w.startFigures,
    commands: [...log, { step: steps, name: 'endRun', args: [] }],
    game_version: GAME_VERSION,
    digest,
    waves_completed: wavesCompleted(state),
    kills: state.kills,
    leaks: state.leaks,
    health: state.health,
    budget_left: state.budget,
    capex: ledger.capex,
    consumables: ledger.consumables,
    enemy_cost: enemyCost(ledger.launched),
  };
}
