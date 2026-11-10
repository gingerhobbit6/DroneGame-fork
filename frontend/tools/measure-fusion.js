// Measures the fusion node's picture and its tasking on the reference runs, and prints the tables of docs/FUSION_AND_TARGETING.md
// ("Measured performance", which defines each number). It plays every run as runReferences does, one step at a time, and only looks,
// so each reference run must end on its recorded digest. Run with: npm run measure

import { readFileSync } from 'node:fs';
import { createSimulation } from '../src/sim/simulation.js';
import { DRONES, FUSION, STRUCTURES, WORLD } from '../src/sim/config/index.js';
import { MIXED, SCENARIOS, setUp } from '../tests/support/scenarios.js';

const want = JSON.parse(readFileSync(new URL('../tests/support/reference-digests.json', import.meta.url), 'utf8'));
const RUNS = [...SCENARIOS, ...['2', '3', '4'].map((seed) => ({ name: `mixed-seed${seed}`, seed, laydown: MIXED, waves: 6 }))];
const TYPES = ['fo', 'fpv', 'fw', 'spotter'], BEARING_ONLY = ['rf', 'camera', 'acoustic'];
const M = WORLD.metresPerUnit, GBP = 0.75; // pounds to a dollar, as economy.js shows money

const kindOf = (id) => STRUCTURES[id]?.kind ?? id;
const isFalseAlarm = (src) => src.cls?.[0]?.type === 'Unknown' && src.cls[0].confidence === 0.4; // what a sensor says of nothing (network/sensors.js)
const sorted = (xs) => [...xs].sort((a, b) => a - b);
const at = (xs, p) => (xs.length ? sorted(xs)[Math.round(p * (xs.length - 1))] : NaN); // a percentile: the nearest value, never one between two
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (n, of) => (of ? `${Math.round((100 * n) / of)}%` : 'none');
const fix = (x, n = 0) => (Number.isFinite(x) ? x.toFixed(n) : 'none');
const metres = (x) => (Number.isFinite(x) ? `${Math.round(x).toLocaleString('en-GB')} m` : 'none');
const pounds = (usd) => `£${Math.round(usd * GBP).toLocaleString('en-GB')}`;
const tally = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const row = (...cells) => console.log(`| ${cells.join(' | ')} |`);

// Play one run and write down what the picture and the tasking did, without changing either.
function measure(sim, sc) {
  setUp(sim, sc);
  const s = sim.state, net = sim.net;
  const tracks = new Map(), drones = new Map(), tasks = new Map(), nodeKind = new Map();
  const time = { held: 0, unlinked: 0, after: 0 }, engage = { linked: 0, dead: 0, watched: 0, drifted: 0, never: 0 }, errors = {};
  let notConfirmed = 0;

  const onBus = (entry) => {
    const { task, task_ack: ack, alert } = entry.msg;
    if (task?.command?.request === 'Engage') {
      const tr = net.tracks.get(task.command.command_parameter), seen = tracks.get(tr?.id);
      const where = tr?.drone ? 'linked' : !seen?.last ? 'never' : seen.last.dead ? 'dead' : 'drifted';
      engage[where]++;
      if (where === 'dead' && tr.killWatch) engage.watched++;
      tasks.set(task.task_id, { entry, first: null, last: null });
    } else if (ack && tasks.has(ack.task_id)) {
      const t = tasks.get(ack.task_id), said = `${ack.task_status.replace('TASK_STATUS_', '').toLowerCase()}: ${ack.reason?.[0] ?? ''}`;
      if (t.first) t.last = said; else t.first = said;
    } else if (alert?.description.startsWith('Kill NOT confirmed')) notConfirmed++;
  };

  function look(second) {
    for (const [id, n] of net.nodes) nodeKind.set(id, n.def.kind ?? n.def.id);
    for (const d of sim.drones) {
      if (!drones.has(d.uid)) drones.set(d.uid, { confirmed: null, ids: new Set() });
      if (d.track) drones.get(d.uid).confirmed ??= s.time;
    }
    for (const tr of net.tracks.values()) {
      if (!tracks.has(tr.id)) tracks.set(tr.id, { held: false, linked: false, last: null, near: false, fedBy: '', falseAlarm: false });
      const r = tracks.get(tr.id), held = tr.status !== 'tentative', d = tr.drone;
      if (held) {
        r.held = true;
        r.fedBy = [...new Set([...tr.nodes].map((id) => nodeKind.get(id)))].sort().join(' + ');
        r.falseAlarm = [...tr.sources.values()].some(isFalseAlarm);
        time.held++;
        if (!d) { time.unlinked++; if (r.linked) time.after++; }
        if (!d && !r.near) r.near = sim.drones.some((x) => Math.hypot(tr.est.east - x.pos.x * M, tr.est.north + x.pos.z * M) < FUSION.acquireRadius);
      }
      if (!d || !held) continue; // a link counts only once the track is confirmed
      r.linked = true; r.last = d;
      drones.get(d.uid).ids.add(tr.id);
      if (!second) continue;
      const e = (errors[d.type] ||= { ground: [], solid: [], claimed: [] });
      const east = tr.est.east - d.pos.x * M, north = tr.est.north + d.pos.z * M, ground = Math.hypot(east, north);
      e.ground.push(ground); e.claimed.push(ground / tr.estErr);
      if (!tr.flat) e.solid.push(Math.hypot(ground, tr.est.up - d.pos.y * M));
    }
  }

  sim.bus.listeners.add(onBus);
  s.warnedWire = true;
  let steps = 0;
  for (let w = 0; w < sc.waves && !s.over; w++) { // as playWave does: the wave is checked every 200 steps
    sim.commands.startWave();
    for (let n = 0; s.waveActive && !s.over && n < 60000; n += 200) for (let i = 0; i < 200 && !s.over; i++) { sim.step(); look(++steps % 20 === 0); } // errors once a simulated second, on the second
  }
  sim.bus.listeners.delete(onBus);

  const digest = sim.digest();
  if (want[sc.name] && want[sc.name].digest !== digest) throw new Error(`${sc.name} ended on ${digest}, not the recorded ${want[sc.name].digest}: looking changed the run, or the digests are stale`);
  const flights = sim.ledger.flights.map((f) => ({ ...f, ...drones.get(f.uid) }));
  const falseAlarms = Object.values(sim.ledger.falseAlarms).reduce((sum, wave) => sum + Object.values(wave).reduce((a, b) => a + b, 0), 0);
  return {
    name: sc.name, digest, flights, errors, time, engage, notConfirmed, falseAlarms, tracks: [...tracks.values()].filter((r) => r.held), tasks: [...tasks.values()],
    wave: s.wave, over: s.over, kills: s.kills, health: s.health, spent: sim.ledger.consumables,
  };
}

const first = (f) => Object.entries(f.seen).reduce((best, [id, v]) => (!best || v.t < best.t ? { id, ...v } : best), null); // the earliest sighting
const ended = (fs, ...how) => fs.filter((f) => how.includes(f.end)).length;
const killedBy = (f) => (f.end !== 'killed' ? null : kindOf(f.by) === 'jammer' ? 'jam' : STRUCTURES[f.by]?.fire === 'beam' ? 'beam' : 'round');
const shotsAt = (fs, pick, what) => fs.reduce((sum, f) => sum + Object.entries(f.shots).filter(([id]) => pick(STRUCTURES[id])).reduce((a, [, v]) => a + v[what], 0), 0);

// The tracking and engagement figures for one type of drone over some runs.
function byType(runs, type) {
  const fs = runs.flatMap((r) => r.flights).filter((f) => f.type === type), seen = fs.filter((f) => first(f));
  const errs = (k) => runs.flatMap((r) => r.errors[type]?.[k] ?? []);
  const wait = (list) => list.filter((f) => f.confirmed != null).map((f) => f.confirmed - first(f).t);
  const kills = { round: 0, beam: 0, jam: 0 };
  for (const f of fs) if (killedBy(f)) kills[killedBy(f)]++;
  const tracked = fs.filter((f) => f.ids?.size);
  return {
    type, n: fs.length, detected: seen.length, confirmed: fs.filter((f) => f.confirmed != null).length,
    firstSite: at(seen.map((f) => first(f).site), 0.5), bearingOnly: seen.filter((f) => BEARING_ONLY.includes(kindOf(first(f).id))).length,
    wait: wait(seen), waitRadar: wait(seen.filter((f) => kindOf(first(f).id) === 'radar')),
    ground: errs('ground'), solid: errs('solid'), claimed: errs('claimed'), ids: tracked.length ? mean(tracked.map((f) => f.ids.size)) : NaN,
    toShot: seen.filter((f) => f.engaged != null).map((f) => f.engaged - first(f).t),
    kills, killed: ended(fs, 'killed'), through: ended(fs, 'leaked', 'struck'), left: ended(fs, 'left'), airborne: fs.filter((f) => !f.end).length,
    rounds: shotsAt(fs, (def) => def.fire === 'guided', 'n'), beam: shotsAt(fs, (def) => def.fire === 'beam', 'n'), cost: shotsAt(fs, () => true, 'cost'),
  };
}

function typeTables(title, runs) {
  const rows = TYPES.map((t) => byType(runs, t)).filter((t) => t.n);
  console.log(`\n${title}: tracking\n`);
  row('Drone', 'Launched', 'Detected', 'Confirmed track', 'First seen, median distance from site', 'First detected bearing-only', 'Detect to confirm, median / 90th', 'Same, first seen by radar, median', 'Error across the ground, median / 90th', 'Error in 3D, median', 'Error / claimed', 'Track ids per drone');
  row(...Array(12).fill('---'));
  for (const t of rows) {
    row(DRONES[t.type].label, t.n, `${pct(t.detected, t.n)} (${t.detected})`, `${pct(t.confirmed, t.n)} (${t.confirmed})`, metres(t.firstSite), pct(t.bearingOnly, t.detected), `${fix(at(t.wait, 0.5), 1)} / ${fix(at(t.wait, 0.9), 1)} s`,
      `${fix(at(t.waitRadar, 0.5), 1)} s`, `${fix(at(t.ground, 0.5))} / ${fix(at(t.ground, 0.9))} m`, `${fix(at(t.solid, 0.5))} m`, fix(at(t.claimed, 0.5), 2), fix(t.ids, 2));
  }
  console.log(`\n${title}: engagement\n`);
  row('Drone', 'Detect to first shot, median', 'Killed', 'by rounds / beam / jamming', 'Leaked or struck', 'Left / airborne at the end', 'Rounds per round kill', 'Beam seconds per beam kill', 'Shot cost per kill');
  row(...Array(9).fill('---'));
  for (const t of rows) {
    row(DRONES[t.type].label, `${fix(at(t.toShot, 0.5), 1)} s`, `${t.killed} of ${t.n} (${pct(t.killed, t.n)})`, `${t.kills.round} / ${t.kills.beam} / ${t.kills.jam}`, t.through, `${t.left} / ${t.airborne}`,
      fix(t.rounds / t.kills.round, 2), fix(t.beam / t.kills.beam, 1), t.killed ? pounds(t.cost / t.killed) : 'none');
  }
}

const sim = createSimulation();
const runs = RUNS.map((sc) => { const t0 = Date.now(), r = measure(sim, sc); console.error(`${sc.name}: ${((Date.now() - t0) / 1000).toFixed(0)} s, digest ${r.digest}${want[sc.name] ? ', as recorded' : ''}`); return r; });
const named = (...names) => runs.filter((r) => names.some((n) => r.name.startsWith(n)));

console.log('Outcomes\n');
row('Scenario', 'Waves played', 'Launched', 'Killed', 'Leaked or struck', 'Site health at end', 'Spent on shots');
row(...Array(7).fill('---'));
for (const r of runs) row(r.name, `${r.wave}${r.over ? ' (site lost)' : ''}`, r.flights.length, r.kills, ended(r.flights, 'leaked', 'struck'), r.health, pounds(r.spent));

typeTables('MIXED (six runs pooled)', named('mixed'));
typeTables('LASERS (lasers-seed42)', named('lasers'));
typeTables('JAMMERS (jammers-seed1)', named('jammers'));

console.log('\nThe picture and the tasking, per run\n');
row('Scenario', 'Confirmed tracks', 'Ghosts', 'Ghosts with a false alarm among their latest reports', 'Ghosts with a drone within 300 m across the ground', 'Confirmed-track time with no drone linked', 'of which after a drone had been linked',
  'False alarms raised', 'Engage tasks', 'at a linked drone', 'at a dead drone\'s track (already under kill watch)', 'at a track that had drifted off its live drone', 'at a track never linked so far', 'Rejected: "nothing found"', '"Kill NOT confirmed" alerts');
row(...Array(15).fill('---'));
const fed = {}, answers = {}, endings = {};
let sent = 0, lost = 0;
for (const r of runs) {
  const ghosts = r.tracks.filter((t) => !t.linked), e = r.engage, total = e.linked + e.dead + e.drifted + e.never;
  for (const g of ghosts) tally(fed, g.fedBy);
  for (const t of r.tasks) {
    sent++;
    if (t.entry.net?.dropped) { lost++; continue; }
    tally(answers, t.first ?? 'no answer');
    if (t.first?.startsWith('accepted')) tally(endings, t.last ?? 'still engaged at the end');
  }
  row(r.name, r.tracks.length, `${ghosts.length} (${pct(ghosts.length, r.tracks.length)})`, ghosts.filter((g) => g.falseAlarm).length, ghosts.filter((g) => g.near).length, pct(r.time.unlinked, r.time.held), pct(r.time.after, r.time.held),
    r.falseAlarms.toLocaleString('en-GB'), total, e.linked, `${e.dead} (${e.watched})`, e.drifted, e.never, r.tasks.filter((t) => t.first?.includes('nothing found')).length, r.notConfirmed);
}
const list = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k.replace(/: $/, '')} ${n.toLocaleString('en-GB')}`).join('; ');
console.log(`\nSensors that fed the ghosts: ${list(fed)}`);
console.log(`Engage tasks: ${sent.toLocaleString('en-GB')} sent, ${lost} lost on the network. Answered: ${list(answers)}`);
console.log(`Accepted tasks ended as: ${list(endings)}`);
