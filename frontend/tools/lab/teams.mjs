// The team sheet: reference defences that differ only in how they sense, each scored on the fixed raids (raids.mjs) by day, at night
// and in rain and haze. Use it to see what a sensing mode adds, and to test a change to every team at once on the same seeds.
//
//   node tools/lab/teams.mjs [--seeds 16] [--teams radar,rf] [--raids russia,fpv] [--conditions day,night] [--workers 12]
//   node tools/lab/teams.mjs --add camera_podview:4            each team as it is, and with 4 PodViews on its vehicles
//   node tools/lab/teams.mjs --add acoustic_l:8:remote         ... with 8 large acoustic sensors out on their own
//   node tools/lab/teams.mjs --remove radar_s:2                ... with 2 of its small radars taken off (all of them with no count)
//   node tools/lab/teams.mjs --cue 60                          ... with its radars silent until a passive sensor heard a track in the last 60 s
//
// Every team keeps the same effectors, V11's (model.mjs): a heavy machine gun on each of 10 vehicles on a 450 m ring, P1 interceptors
// on 3 of them and 12 networked jammers, all on Starlink. Only the sensors change, and each team spends about £300k on them: one mode
// spends it all, two modes about half each, and so on, so a difference between teams is what the sensing is worth for the money.
// Up to two sensors share a vehicle. Writes lab-results/teams.json and the page lab-results/teams.html (teams-change.* with a change).

import { STRUCTURES } from '../../src/sim/config/index.js';
import { CONDITIONS } from '../../src/sim/conditions.js';
import { fromParams, V11, RULES, problem } from './model.mjs';
import { parseArgs, save, fmt } from './lab.mjs';
import { RAIDS, raidQueue, raidCost, scoreGame, summarise, pooled, protectionChange } from './raids.mjs';
import { mean, ci } from './stats.mjs';

export const EFFECTORS = 'A heavy machine gun on each of 10 vehicles on a 450 m ring, P1 interceptors on 3 of them, 12 networked jammers on two outer rings, all on Starlink';
export const SENSOR_BUDGET_GBP = 300000;
const RADAR = (n) => ({ id: 'radar_s', n, settings: { panels: 3 } }), RF = (n) => ({ id: 'rf', n, remote: 1.6 });
const POD = (n) => ({ id: 'camera_podview', n }), MIC = (n) => ({ id: 'acoustic', n, remote: 1.15 });
// sensors: [{ id, n, settings?, remote? }]. remote: out on its own, on a ring this many times the vehicle ring's radius.
export const TEAMS = [
  { id: 'none', name: 'Effectors only', modes: [], sensors: [] },
  { id: 'radar', name: 'Radar', modes: ['radar'], sensors: [RADAR(9)] },
  { id: 'rf', name: 'RF', modes: ['rf'], sensors: [RF(10)] },
  { id: 'eo', name: 'Electro-optic', modes: ['eo'], sensors: [{ id: 'camera_skyspyke', n: 1 }] },
  { id: 'acoustic', name: 'Acoustic', modes: ['acoustic'], sensors: [MIC(8)] },
  { id: 'radar-rf', name: 'Radar + RF', modes: ['radar', 'rf'], sensors: [RADAR(4), RF(5)] },
  { id: 'radar-eo', name: 'Radar + EO', modes: ['radar', 'eo'], sensors: [RADAR(4), POD(5)] },
  { id: 'radar-rf-eo', name: 'Radar + RF + EO', modes: ['radar', 'rf', 'eo'], sensors: [RADAR(3), RF(3), POD(3)] },
  { id: 'all', name: 'All four', modes: ['radar', 'rf', 'eo', 'acoustic'], sensors: [RADAR(2), RF(3), POD(2), MIC(2)] },
];
export const sensorText = (sensors) => sensors.map((s) => `${s.n} ${STRUCTURES[s.id].name}${s.remote ? ' (on their own)' : ''}`).join(', ') || 'none';
export const sensorGbp = (sensors) => sensors.reduce((sum, s) => sum + STRUCTURES[s.id].cost * s.n * 0.75, 0);

// The team's design: V11's effectors with no radars, then its sensors, spread round the vehicles or out on their own ring.
export function teamDesign(sensors, conditions = 'day') {
  const d = fromParams({ ...V11, radars: 0 }, 10), R = V11.R, k = d.vehicles.length;
  const isSensor = (id) => STRUCTURES[id].role === 'sensor';
  for (const s of sensors) {
    if (s.remote) {
      for (let j = 0; j < s.n; j++) {
        const a = ((j + 0.25) / s.n) * Math.PI * 2;
        d.remote.push([s.id, Math.round(Math.cos(a) * R * s.remote), Math.round(Math.sin(a) * R * s.remote), s.settings]);
      }
      continue;
    }
    for (let j = 0; j < s.n; j++) {
      let i = Math.round((j * k) / s.n) % k, tries = 0;
      const full = (v) => v.sys.length >= RULES.maxPerVehicle || v.sys.filter(([id]) => isSensor(id)).length >= RULES.maxSensors;
      while (full(d.vehicles[i]) && tries++ < k) i = (i + 1) % k;
      if (tries > k) throw new Error(`no room on the vehicles for ${s.id}`);
      d.vehicles[i].sys.push(s.settings ? [s.id, s.settings] : [s.id]);
    }
  }
  return { ...d, conditions };
}

// A change to every team, from --add id:n[:remote] or --remove id[:n]
function changed(sensors, add, remove) {
  let out = sensors.map((s) => ({ ...s }));
  if (remove) {
    const [id, n] = remove.split(':'), s = out.find((x) => x.id === id);
    if (s) { s.n = n ? Math.max(0, s.n - Number(n)) : 0; out = out.filter((x) => x.n > 0); }
  }
  if (add) {
    const [id, n, where] = add.split(':');
    if (!STRUCTURES[id]) throw new Error(`unknown system ${id}`);
    out.push({ id, n: Number(n || 1), ...(where === 'remote' ? { remote: 1.4 } : {}), ...(id === 'radar_s' ? { settings: { panels: 3 } } : {}) });
  }
  return out;
}

const pick = (arg, all, key = (x) => x.id) => (arg ? all.filter((x) => String(arg).split(',').includes(key(x))) : all);

const main = async () => {
  const args = parseArgs(['x', ...process.argv.slice(2)]);
  process.env.LAB_MAX_SENSORS = '2'; // before any worker starts
  const { createPool, defaultWorkers } = await import('./pool.mjs');
  const nSeeds = Number(args.seeds || 16), workers = Number(args.workers || defaultWorkers()), budget = 12_000_000;
  const seeds = Array.from({ length: nSeeds }, (_, i) => 2000 + i);
  const teams = pick(args.teams, TEAMS), raids = pick(args.raids, RAIDS), conds = pick(args.conditions, ['day', 'night', 'rain'], (c) => c);
  const nations = raids.filter((r) => r.kind === 'nation');
  const change = args.add || args.remove || args.cue ? { add: args.add || null, remove: args.remove || null, cue: args.cue ? Number(args.cue) : null } : null;
  const label = change ? [change.remove && `without ${change.remove}`, change.add && `with ${change.add}`, change.cue && `radars silent until cued (${change.cue} s hold)`].filter(Boolean).join(', ') : null;
  const variants = teams.flatMap((t) => (change ? [{ team: t, sensors: t.sensors, changed: false }, { team: t, sensors: changed(t.sensors, change.add, change.remove), changed: true, cue: change.cue }] : [{ team: t, sensors: t.sensors, changed: false }]));
  for (const v of variants) { const bad = problem(teamDesign(v.sensors)); if (bad) throw new Error(`${v.team.name}${v.changed ? ` (${label})` : ''}: ${bad}`); }

  const queues = Object.fromEntries(raids.map((r) => [r.id, seeds.map((s) => raidQueue(r, s))]));
  const jobs = variants.flatMap((v, vi) => conds.flatMap((c) => { const design = { ...teamDesign(v.sensors, c), ...(v.cue ? { radarCue: v.cue } : {}) }; return raids.flatMap((r) => seeds.map((seed, si) => ({ design, seed, opts: { budget, raid: queues[r.id][si] }, tag: [vi, c, r.id, si] }))); }));
  const pool = createPool(Math.min(workers, jobs.length)), t0 = Date.now();
  console.log(`${variants.length} teams x ${conds.length} conditions x ${raids.length} raids x ${seeds.length} seeds = ${jobs.length} games on ${pool.size} cores`);
  let done = 0;
  const results = await pool.run(jobs, () => { if (++done % 200 === 0) console.log(`  ${done}/${jobs.length} games, ${((Date.now() - t0) / 60000).toFixed(1)} min`); });
  await pool.close();

  // games[vi][cond][raid][seed]
  const games = variants.map(() => Object.fromEntries(conds.map((c) => [c, Object.fromEntries(raids.map((r) => [r.id, []]))])));
  results.forEach((res, i) => { const [vi, c, rid, si] = jobs[i].tag; games[vi][c][rid][si] = scoreGame(res); });
  const firstInvalid = results.find((r) => r?.invalid)?.invalid ?? null;
  const threatSeeds = (vi, c) => seeds.map((_, si) => pooled(nations.map((r) => games[vi][c][r.id][si]))); // per seed, the nations pooled, null if any invalid
  const rows = variants.map((v, vi) => {
    const byCond = Object.fromEntries(conds.map((c) => {
      const t = threatSeeds(vi, c).filter((x) => x != null);
      return [c, { byRaid: Object.fromEntries(raids.map((r) => [r.id, summarise(games[vi][c][r.id])])), threat: nations.length ? mean(t) : null, ci: nations.length ? ci(t) : null }];
    }));
    return { id: v.team.id, name: v.team.name, modes: v.team.modes, changed: v.changed, sensors: v.sensors, sensorText: sensorText(v.sensors),
      sensorGbp: sensorGbp(v.sensors), capexGbp: mean(conds.flatMap((c) => raids.map((r) => byCond[c].byRaid[r.id].capexGbp))), byCond,
      threat: nations.length ? mean(conds.map((c) => byCond[c].threat)) : null };
  });
  const changes = change ? teams.map((t, ti) => {
    const a = ti * 2, b = ti * 2 + 1, per = (vi, c, rid) => games[vi][c][rid].map((g) => g?.protection ?? null);
    return { id: t.id, name: t.name, byCond: Object.fromEntries(conds.map((c) => [c, {
      threat: nations.length ? protectionChange(threatSeeds(a, c), threatSeeds(b, c)) : null,
      byRaid: Object.fromEntries(raids.map((r) => [r.id, protectionChange(per(a, c, r.id), per(b, c, r.id))])) }])) };
  }) : null;

  const pct = (x) => (x == null || !Number.isFinite(x) ? '  - ' : `${(100 * x).toFixed(0)}%`);
  for (const c of conds) {
    console.log(`\n${CONDITIONS[c].label}: protection, the share of the warhead weight stopped (mean of ${seeds.length} seeds)`);
    console.log(`${'Team'.padEnd(32)}${raids.map((r) => r.id.slice(0, 7).padStart(8)).join('')}${nations.length ? '   threat-weighted' : ''}`);
    for (const r of rows) console.log(`${(r.name + (r.changed ? ` (${label})` : '')).slice(0, 31).padEnd(32)}${raids.map((x) => pct(r.byCond[c].byRaid[x.id].protection).padStart(8)).join('')}${nations.length ? `   ${pct(r.byCond[c].threat)} +-${fmt(100 * r.byCond[c].ci, 0)}` : ''}`);
    if (changes) {
      console.log(`Change ${label}, points (95% interval)`);
      for (const ch of changes) console.log(`${ch.name.padEnd(32)}${raids.map((x) => `${fmt(100 * ch.byCond[c].byRaid[x.id].mean, 0)}+-${fmt(100 * ch.byCond[c].byRaid[x.id].ci, 0)}`.padStart(8)).join('')}${ch.byCond[c].threat ? `   ${fmt(100 * ch.byCond[c].threat.mean, 1)} +-${fmt(100 * ch.byCond[c].threat.ci, 1)}` : ''}`);
    }
  }
  const invalid = rows.reduce((s, r) => s + conds.reduce((a, c) => a + raids.reduce((b, x) => b + r.byCond[c].byRaid[x.id].invalid, 0), 0), 0);
  if (invalid) console.log(`\n${invalid} invalid games, first: ${firstInvalid}`);
  const out = save(args.out || (change ? 'teams-change.json' : 'teams.json'), { kind: 'teams', effectors: EFFECTORS, budgetGbp: SENSOR_BUDGET_GBP, seeds, conditions: conds,
    raids: raids.map((r) => ({ ...r, costUsd: raidCost(r) })), rows, change, label, changes, invalid, firstInvalid, minutes: (Date.now() - t0) / 60000 });
  console.log('saved', out);
  const { writeTeamsPage } = await import('./teams-report.mjs');
  console.log('page', writeTeamsPage(out));
};

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/lab/teams.mjs')) main().catch((e) => { console.error(e); process.exit(1); });
