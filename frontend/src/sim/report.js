// The end-of-deployment report: how it ended, what it stopped, what got through, what it cost and who was hurt. Everything
// comes from the ledger and the state, so it reads the same for a fixed site and a patrol. Who shot what, and every other
// figure, is in the run's statistics (stats.js), which the end card shows under it.

import { SITE, STRUCTURES } from './config/index.js';
import { enemyCost } from './economy.js';
import { wavesCompleted } from './run-record.js';

const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

export function deploymentReport(w) {
  const { state, ledger } = w;
  const intercepted = sum(ledger.killed);
  const spent = ledger.capex + ledger.consumables;
  return {
    outcome: state.ended ? 'ended' : w.patrol ? 'patrol' : 'site',
    waves: wavesCompleted(state),
    launched: sum(ledger.launched), intercepted, leaked: sum(ledger.leaked), left: sum(ledger.escaped),
    cost: {
      systems: ledger.capex, munitions: ledger.consumables, lost: ledger.lostValue, spent,
      enemy: enemyCost(ledger.launched), destroyed: enemyCost(ledger.killed),
      perIntercept: intercepted ? ledger.consumables / intercepted : null,
    },
    lost: Object.entries(ledger.lost).map(([id, n]) => ({ name: STRUCTURES[id].name, n })),
    health: Math.max(state.health, 0) / SITE.maxHealth,
    killed: state.killed, injured: state.injured, people: w.people.reduce((n, g) => n + g.count, 0),
  };
}
