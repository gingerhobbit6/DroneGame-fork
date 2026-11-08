// The cost ledger: what the defence has bought and fired, and what the attack has cost the enemy.
// Tallies are per drone type (launched, destroyed, leaked through to the site, left on their own) and per effector.

import { COMMS, DRONES } from './config/index.js';

const freshLedger = () => ({
  capex: 0,                  // spent on buying systems
  consumables: 0,            // spent on shots (interceptors, missiles, laser), including rounds bought in a resupply and not yet fired
  shots: {},                 // effector id -> { n, cost }: only what has been fired
  launched: {}, killed: {}, leaked: {}, escaped: {},   // drone type -> count
  turned: {},                // drone type -> count jammed into turning for home, which then also left (escaped)
  killedBy: {},              // effector id (or 'jammer') -> { drone type -> count }
  terminals: { starlink: 0, cellular: 0 }, // network terminals bought (counted in capex)
  lost: {}, lostValue: 0,    // systems the enemy destroyed (id -> count) and what they were worth
  jamTime: {},               // jammer id -> seconds switched on, for the deployment report
  flights: [],               // one record per drone launched (flight-log.js), for the statistics
  falseAlarms: {},           // wave -> sensor id -> false alarms it reported
});
export const createLedger = freshLedger;
export const resetLedger = (ledger) => Object.assign(ledger, freshLedger());

export const tally = (obj, key, n = 1) => { obj[key] = (obj[key] || 0) + n; };
export const enemyCost = (counts) => Object.entries(counts).reduce((sum, [type, n]) => sum + n * DRONES[type].cost, 0);
// Prices are kept in US dollars, as their sources give them, and shown in pounds at this one rate.
// ASSUMPTION: about the rate through 2025. The Sources tab keeps the dollars each figure was quoted in.
const GBP_PER_USD = 0.75;
export const pounds = (usd) => `£${Math.round(usd * GBP_PER_USD).toLocaleString('en-GB')}`;
export const money = (usd) => {
  const v = usd * GBP_PER_USD;
  return v >= 1e6 ? `£${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M` : v >= 1e4 ? `£${Math.round(v / 1e3)}k` : pounds(usd);
};

// In the sandbox shots are free, and a round bought in a resupply is already paid for. With a deployment pack the budget
// is no limit (the pack and the magazines are): it only counts the cost, so it can go below zero.
export const affordable = (w, s) => w.state.sandbox || w.state.packed || s.prepaid > 0 || w.state.budget >= (s.def.shotCost || 0);

// Pay for a shot out of the budget and record it in the ledger.
export function spend(w, s) {
  const { state, ledger } = w;
  const def = s.def, cost = def.shotCost || 0;
  if (state.sandbox) state.sbSpent += cost; // free in the sandbox
  else if (s.prepaid > 0) s.prepaid--; // charged when it was bought
  else { state.budget -= cost; ledger.consumables += cost; }
  const e = ledger.shots[def.id] = ledger.shots[def.id] || { n: 0, cost: 0 };
  e.n++; e.cost += cost;
}

// Charge or refund the difference between two network terminals; false if it can't be afforded.
export function buyTerminal(w, oldKind, newKind) {
  const { state, ledger } = w;
  const delta = (newKind ? COMMS[newKind].cost : 0) - (oldKind ? COMMS[oldKind].cost : 0);
  if (!state.packed && delta > state.budget) { w.emit('toast', `Not enough budget for a ${COMMS[newKind].name} terminal (${money(COMMS[newKind].cost)})`); return false; }
  state.budget -= delta; ledger.capex += delta;
  if (oldKind) ledger.terminals[oldKind]--;
  if (newKind) ledger.terminals[newKind]++;
  return true;
}
