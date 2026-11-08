// The run's statistics, overall and per sensor, effector and drone type, for one wave or the whole run. Everything is read from
// the flight log (flight-log.js), the ledger and the systems placed, so the wizard, the SAPIENT dock and the end card all show
// the same figures. Costs stay in dollars here, as the figures are; the screen shows them in pounds (economy.js).

import { DRONES, PERIMETER, STRUCTURES } from './config/index.js';

export const RANGE_BINS = [0, 1000, 2000, 3000, 5000, 8000, 12000]; // metres from the site: where each bar of the kill-range chart starts

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const per = (a, b) => (b ? a / b : null);
const nameOf = (id) => STRUCTURES[id]?.name ?? (id === PERIMETER.id ? PERIMETER.name : id === 'jammer' ? 'Jamming' : id);
const ended = (fs, end) => fs.filter((f) => f.end === end).length;
export const firstSeen = (f) => Object.values(f.seen).reduce((a, s) => (!a || s.t < a.t ? s : a), null);

// Mean, standard deviation, least and most, or null for none.
export function spread(xs) {
  if (!xs.length) return null;
  const mean = sum(xs) / xs.length;
  return { n: xs.length, mean, sd: Math.sqrt(sum(xs.map((x) => (x - mean) ** 2)) / xs.length), min: Math.min(...xs), max: Math.max(...xs) };
}
const bins = (xs) => RANGE_BINS.map((lo, i) => xs.filter((x) => x >= lo && x < (RANGE_BINS[i + 1] ?? Infinity)).length);

// Shots at these flights by the systems kept: rounds (or beam seconds), hits, and what they cost.
function shotsAt(fs, keep = () => true) {
  const t = { n: 0, hits: 0, cost: 0 };
  for (const f of fs) for (const [id, e] of Object.entries(f.shots)) if (keep(id)) { t.n += e.n; t.hits += e.hits; t.cost += e.cost; }
  return t;
}
const fireOf = (id) => STRUCTURES[id]?.fire ?? 'jam';
const toEngage = (f, seen) => (seen && f.engaged != null && f.engaged >= seen.t ? f.engaged - seen.t : null); // a crew can fire at what no sensor reported
const known = (xs) => xs.filter((x) => x != null);

// The waves that launched anything, in order. 0 is the sandbox.
export const wavesFlown = (ledger) => [...new Set(ledger.flights.map((f) => f.wave))].sort((a, b) => a - b);

function effectorRows(fs, kills, structures, jamTime) {
  const placed = structures.filter((s) => s.def.role === 'effector');
  const ids = new Set([...placed.map((s) => s.def.id), ...fs.flatMap((f) => Object.keys(f.shots)), ...kills.map((f) => f.by)]);
  return [...ids].map((id) => {
    const def = STRUCTURES[id], mine = placed.filter((s) => s.def.id === id), k = kills.filter((f) => f.by === id), shots = shotsAt(fs, (x) => x === id);
    const rounds = def?.magazine && def.fire !== 'beam' && mine.length ? { left: sum(mine.map((s) => s.rounds + s.storage)), of: mine.length * (def.magazine + (def.storage || 0)) } : null;
    return {
      id, name: nameOf(id), fire: fireOf(id), placed: mine.length, shots: shots.n, hits: shots.hits, hitRate: fireOf(id) === 'guided' ? per(shots.hits, shots.n) : null,
      kills: k.length, cost: shots.cost, perKill: per(shots.cost, k.length), range: spread(k.map((f) => f.site)), reach: spread(known(k.map((f) => f.from))),
      rounds, jam: def?.kind === 'jammer' ? jamTime[id] || 0 : null,
    };
  }).sort((a, b) => b.kills - a.kills || b.shots - a.shots || a.name.localeCompare(b.name));
}

function sensorRows(fs, structures, alarms) {
  const placed = structures.filter((s) => s.def.role === 'sensor');
  const ids = new Set([...placed.map((s) => s.def.id), ...fs.flatMap((f) => Object.keys(f.seen))]);
  return [...ids].map((id) => {
    const mine = fs.filter((f) => f.seen[id]), at = mine.map((f) => f.seen[id]);
    return {
      id, name: nameOf(id), placed: placed.filter((s) => s.def.id === id).length, seen: mine.length, share: per(mine.length, fs.length),
      first: fs.filter((f) => f.seen[id] && firstSeen(f) === f.seen[id]).length, range: spread(at.map((s) => s.range)), site: spread(at.map((s) => s.site)),
      toEngage: spread(known(mine.map((f) => toEngage(f, f.seen[id])))), falseAlarms: alarms(id),
    };
  }).sort((a, b) => b.seen - a.seen || a.name.localeCompare(b.name));
}

function typeRows(fs) {
  return [...new Set(fs.map((f) => f.type))].map((id) => {
    const def = DRONES[id], mine = fs.filter((f) => f.type === id), k = mine.filter((f) => f.end === 'killed'), seen = known(mine.map(firstSeen)), shots = shotsAt(mine);
    return {
      id, name: def.name, color: def.color, launched: mine.length, seen: seen.length, killed: k.length, leaked: ended(mine, 'leaked'), struck: ended(mine, 'struck'),
      left: ended(mine, 'left'), detect: spread(seen.map((s) => s.site)), kill: spread(k.map((f) => f.site)), shots: shots.n, spent: shots.cost, cost: mine.length * def.cost,
    };
  }).sort((a, b) => b.launched - a.launched || a.name.localeCompare(b.name));
}

// wave: a wave number, or null for the whole run. Systems bought, munitions bought and systems lost are for the whole run either way.
export function runStats({ ledger, structures }, wave = null) {
  const fs = ledger.flights.filter((f) => wave == null || f.wave === wave);
  const kills = fs.filter((f) => f.end === 'killed'), seen = fs.filter((f) => firstSeen(f)), killRange = kills.map((f) => f.site);
  const rounds = shotsAt(fs, (id) => fireOf(id) === 'guided'), fired = shotsAt(fs), destroyed = sum(kills.map((f) => DRONES[f.type].cost));
  const alarmMaps = wave == null ? Object.values(ledger.falseAlarms) : [ledger.falseAlarms[wave] || {}];
  const alarms = (id) => sum(alarmMaps.map((m) => m[id] || 0));
  return {
    wave,
    drones: {
      launched: fs.length, seen: seen.length, engaged: fs.filter((f) => f.engaged != null).length, killed: kills.length,
      leaked: ended(fs, 'leaked'), struck: ended(fs, 'struck'), left: ended(fs, 'left'), airborne: fs.filter((f) => !f.end).length,
    },
    fire: {
      rounds: rounds.n, hits: rounds.hits, hitRate: per(rounds.hits, rounds.n), roundsPerKill: per(rounds.n, kills.filter((f) => fireOf(f.by) === 'guided').length),
      beamSeconds: shotsAt(fs, (id) => fireOf(id) === 'beam').n, beamKills: kills.filter((f) => fireOf(f.by) === 'beam').length, jamKills: kills.filter((f) => fireOf(f.by) === 'jam').length,
      falseAlarms: sum(alarmMaps.flatMap(Object.values)),
    },
    range: { kill: spread(killRange), shooter: spread(known(kills.map((f) => f.from))), detect: spread(seen.map((f) => firstSeen(f).site)), bins: bins(killRange) },
    time: { toEngage: spread(known(fs.map((f) => toEngage(f, firstSeen(f))))), toKill: spread(known(kills.map((f) => (firstSeen(f) ? f.t1 - firstSeen(f).t : null)))) },
    cost: {
      fired: fired.cost, perKill: per(fired.cost, kills.length), enemy: sum(fs.map((f) => DRONES[f.type].cost)), destroyed, exchange: per(fired.cost, destroyed),
      systems: ledger.capex, bought: ledger.consumables, lost: ledger.lostValue,
    },
    effectors: effectorRows(fs, kills, structures, ledger.jamTime),
    sensors: sensorRows(fs, structures, alarms),
    types: typeRows(fs),
  };
}
