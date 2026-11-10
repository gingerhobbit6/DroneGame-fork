// Rapid simulation runs on every core, and the studies that show a result has settled.
//
//   node tools/lab/lab.mjs eval     --preset v11 [--seeds 1,7,42] [--max 45]      play one design on several seeds side by side
//   node tools/lab/lab.mjs seeds    --preset v11 [--tol 1] [--max 45]             add seeds until the mean wave is known to +-tol
//   node tools/lab/lab.mjs timestep --preset v11 [--dts 0.1,0.05,0.025]           does a finer time step change the answer?
//   node tools/lab/lab.mjs search   --sites 3,4,5,6,8,10 [--quick]                fewest vehicle sites for the most waves (search.mjs)
//   node tools/lab/lab.mjs evolve   [--hours 7.5] [--attack russia]                an overnight search that keeps many different answers (evolve.mjs)
//   node tools/lab/lab.mjs export   --from evolve.json | --starting                 write layouts as game save files to open in the browser
//   node tools/lab/lab.mjs report   [--in lab-results/search.json]                the convergence report, as a web page
//
// A design comes from --preset v11, --params '{"R":450,...}' with --sites N, or --spec design.json. Results go to lab-results/.
// Common options: --workers N (default: cores minus two), --budget 7000000, --out file.json,
// --sensors N (how many sensors may share a vehicle; default 1, the brief's rule).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, defaultWorkers } from './pool.mjs';
import { fromParams, V11, describe } from './model.mjs';
import { mean, sd, ci, summary, gci } from './stats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = resolve(HERE, '../../lab-results');

export function parseArgs(argv) {
  const [cmd, ...rest] = argv, args = { _: cmd };
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue;
    const key = rest[i].slice(2), next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true; else { args[key] = next; i++; }
  }
  return args;
}
export const list = (s, f = Number) => String(s).split(',').filter(Boolean).map(f);
export const save = (file, data) => { mkdirSync(OUT_DIR, { recursive: true }); const p = resolve(OUT_DIR, file); writeFileSync(p, JSON.stringify(data)); return p; };
export const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

// How a result is ranked. A run that ends reports its wave; one still standing at the cap reports the cap plus the health it has left,
// so that a short run can still tell two surviving designs apart.
export const scoreOf = (r, cap) => (r.invalid ? -1 : r.over ? r.wave : cap + r.health);

// What the money bought, from the finished games of one layout (invalid ones left out), as the game's Cost tab works it out: what was
// spent per £1 of enemy drones destroyed, counting the shots alone (perPoundShots) and the shots plus the systems (perPound). A game's
// spend is the build plus every round, missile and charge used. All are pooled over the games, so a long game weighs more.
export function interceptStats(results) {
  const ok = results.filter((r) => !r.invalid && r.perWave && r.destroyed != null);
  const kills = ok.reduce((s, r) => s + r.perWave.reduce((a, w) => a + w.kills, 0), 0);
  const spent = ok.reduce((s, r) => s + r.spent, 0), capex = ok.reduce((s, r) => s + r.capex, 0), destroyed = ok.reduce((s, r) => s + r.destroyed, 0);
  return { kills: ok.length ? kills / ok.length : null, destroyed: ok.length ? destroyed / ok.length : null, perPound: destroyed ? spent / destroyed : null, perPoundShots: destroyed ? (spent - capex) / destroyed : null };
}

// Which drones the waves send, from --attack: a group name (russia, iran, china, cots), or drone ids separated by commas. Default: the four generic types.
export async function attackFrom(arg) {
  if (!arg || arg === true) return null;
  const { THREAT_GROUPS, DRONES } = await import('../../src/sim/config/index.js');
  const group = THREAT_GROUPS.find((g) => g.name.toLowerCase().startsWith(String(arg).toLowerCase()) || (arg === 'cots' && /commercial/i.test(g.name)));
  if (group) return group.drones.map((d) => d.id);
  const ids = list(arg, String);
  const unknown = ids.filter((id) => !Object.hasOwn(DRONES, id));
  if (unknown.length) throw new Error(`Unknown drone(s): ${unknown.join(', ')}. Groups: ${THREAT_GROUPS.map((g) => g.name).join(', ')}`);
  return ids;
}

async function designFrom(args) {
  let design;
  if (args.spec) design = JSON.parse(readFileSync(args.spec, 'utf8'));
  else if (args.preset === 'v11') design = fromParams(V11, 10);
  else if (args.params) design = fromParams({ ...V11, ...JSON.parse(args.params) }, Number(args.sites || 10));
  else throw new Error('Give a design: --preset v11, --params {...} --sites N, or --spec file.json');
  const attack = await attackFrom(args.attack);
  return attack ? { ...design, attack } : design;
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.sensors) process.env.LAB_MAX_SENSORS = String(Number(args.sensors)); // before any worker starts, so they all follow the same rule
  const workers = args.workers ? Number(args.workers) : defaultWorkers();
  const budget = Number(args.budget || 7_000_000), max = Number(args.max || 45);
  const cmd = args._;

  if (cmd === 'eval') {
    const design = await designFrom(args), seeds = list(args.seeds || '1,7,42');
    console.log(`${describe(design)}\n${design.vehicles.length} vehicle sites, ${seeds.length} seeds on ${Math.min(workers, seeds.length)} cores`);
    const pool = createPool(Math.min(workers, seeds.length)), t0 = Date.now();
    const results = await pool.run(seeds.map((seed) => ({ design, seed, opts: { maxWaves: max, budget } })), (r, i) => console.log(`  seed ${seeds[i]}: ${r.invalid ? `invalid (${r.invalid})` : `wave ${r.over ? r.wave : `${max}+`} in ${(r.ms / 1000).toFixed(0)} s`}`));
    await pool.close();
    const waves = results.map((r) => scoreOf(r, max));
    console.log(`waves ${results.map((r) => (r.invalid ? 'x' : r.over ? r.wave : `${max}+`)).join(' / ')}   mean ${fmt(mean(waves))}   spent $${fmt(mean(results.map((r) => r.spent || 0)) / 1e6, 2)}M   (${((Date.now() - t0) / 1000).toFixed(0)} s on the wall clock, ${(results.reduce((s, r) => s + (r.ms || 0), 0) / 1000).toFixed(0)} s of run time)`);
    if (args.out) console.log('saved', save(args.out, { design, seeds, results }));
    return;
  }

  if (cmd === 'seeds') {
    const design = await designFrom(args), tol = Number(args.tol || 1), maxSeeds = Number(args.maxseeds || 40);
    const pool = createPool(workers), batch = Number(args.batch || pool.size), series = [], waves = [];
    console.log(`${describe(design)}\nadding seeds ${batch} at a time until the 95% interval on the mean wave is within +-${tol}`);
    let seed = 1;
    while (waves.length < maxSeeds) {
      const seeds = Array.from({ length: batch }, () => seed++);
      const results = await pool.run(seeds.map((s) => ({ design, seed: s, opts: { maxWaves: max, budget } })));
      for (const r of results) if (!r.invalid) waves.push(scoreOf(r, max));
      // the interval after each seed added, in order, so the plot shows it closing
      for (let n = Math.max(2, waves.length - results.length + 1); n <= waves.length; n++) series.push({ n, mean: mean(waves.slice(0, n)), ci: ci(waves.slice(0, n)) });
      const now = summary(waves);
      console.log(`  ${now.n} seeds: mean ${fmt(now.mean, 2)} +-${fmt(now.ci, 2)}  (sd ${fmt(now.sd, 2)})`);
      if (now.ci <= tol) break;
    }
    await pool.close();
    const s = summary(waves);
    console.log(s.ci <= tol ? `settled: ${fmt(s.mean, 1)} +-${fmt(s.ci, 1)} after ${s.n} seeds` : `not settled to +-${tol} after ${s.n} seeds`);
    console.log('saved', save(args.out || 'seeds.json', { kind: 'seeds', design, tol, waves, series }));
    return;
  }

  if (cmd === 'timestep') {
    const design = await designFrom(args), seeds = list(args.seeds || '1,7,42,3,99,123'), dts = list(args.dts || '0.1,0.05,0.025');
    const pool = createPool(workers), rows = [];
    console.log(`${describe(design)}\n${seeds.length} seeds at each of ${dts.join(', ')} s on ${pool.size} cores`);
    for (const dt of dts) {
      const t0 = Date.now();
      const results = await pool.run(seeds.map((seed) => ({ design, seed, opts: { maxWaves: max, budget, dt } })));
      const ok = results.filter((r) => !r.invalid);
      const waves = ok.map((r) => scoreOf(r, max));
      const leakRate = ok.map((r) => Object.values(r.leaked).reduce((a, b) => a + b, 0) / Math.max(1, r.wave));
      rows.push({ dt, waves, mean: mean(waves), ci: ci(waves), leakRate: mean(leakRate), runSeconds: ok.reduce((s, r) => s + r.ms, 0) / 1000, wall: (Date.now() - t0) / 1000 });
      console.log(`  dt ${dt}: waves ${waves.map((w) => fmt(w, 0)).join('/')}  mean ${fmt(mean(waves), 2)} +-${fmt(ci(waves), 2)}  leaks/wave ${fmt(rows.at(-1).leakRate, 3)}  ${rows.at(-1).runSeconds.toFixed(0)} s of run time`);
    }
    await pool.close();
    let g = null;
    if (rows.length === 3) { const [coarse, mid, fine] = [...rows].sort((a, b) => b.dt - a.dt); g = gci(fine.mean, mid.mean, coarse.mean, coarse.dt / mid.dt); console.log(`  grid convergence: order ${fmt(g.p, 2)}, extrapolated ${fmt(g.ext, 2)} waves, GCI of the finest ${fmt(100 * g.gciFine, 1)}%${g.note ? ` (${g.note})` : ''}`); }
    console.log('saved', save(args.out || 'timestep.json', { kind: 'timestep', design, seeds, rows, gci: g }));
    return;
  }

  if (cmd === 'export') {
    // Writes the design(s) as the game's own saved laydowns, to load in the browser and look at before spending hours of CPU on them.
    const { createRunner } = await import('./run.mjs'), { startingDesigns } = await import('./search.mjs');
    const runner = createRunner(), items = [];
    if (args.from) {
      const s = JSON.parse(readFileSync(resolve(OUT_DIR, args.from), 'utf8'));
      // `lab` is what the game's Lab tab shows beside each file: how it did on seeds the search never saw
      if (s.kind === 'evolve') for (const [i, f] of s.finalists.slice(0, Number(args.top || 12)).entries()) items.push([`lab ${i + 1} ${f.sites} sites ${f.family} ${fmt(f.heldOut, 0)} waves`, f.design, { sites: f.sites, family: f.family, waves: +fmt(f.heldOut, 1), ci: f.heldOutCi == null ? null : +fmt(f.heldOutCi, 1), capex: Math.round(f.capex), perPoundShots: f.perPoundShots == null ? null : +fmt(f.perPoundShots, 3), perPound: f.perPound == null ? null : +fmt(f.perPound, 3), what: f.what, attack: s.attack }]);
      else for (const b of s.byK) if (b.final) items.push([`lab best ${b.k} sites`, fromParams(b.final.params, b.k)]);
    } else if (args.starting) {
      items.push(['lab V11 10 sites', fromParams(V11, 10)]);
      for (const k of list(args.sites || '3,5,10')) for (const [label, p] of startingDesigns(k)) items.push([`lab ${label}`, fromParams(p, k)]);
    } else items.push([args.name || "lab design", await designFrom(args)]);
    mkdirSync(resolve(OUT_DIR, 'laydowns'), { recursive: true });
    for (const [name, design, lab] of items) {
      const lay = runner.exportLaydown(design, name, { budget });
      if (lay.error) { console.log(`  ${name}: not exported (${lay.error})`); continue; }
      const file = resolve(OUT_DIR, 'laydowns', `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.json`);
      writeFileSync(file, JSON.stringify({ name: lay.name, world: lay.world, game_version: lay.game_version, spec: lay.spec, ...(lab ? { lab: { ...lab, capex: lab.capex ?? Math.round(lay.capex) } } : {}) }, null, 1));
      console.log(`  ${name}: ${lay.spec.structures.length} systems, $${fmt(lay.capex / 1e6, 2)}M -> ${file}`);
    }
    return;
  }

  if (cmd === 'intercepts') {
    // Plays an overnight search's finalists again on the same unseen seeds, to add what each one spent per drone stopped. The games are
    // exact repeats, so the waves must come out the same; any that do not are reported.
    const file = resolve(OUT_DIR, args.in || 'overnight.json'), s = JSON.parse(readFileSync(file, 'utf8'));
    if (s.kind !== 'evolve') throw new Error('Give an overnight (evolve) result with --in.');
    const pool = createPool(workers), t0 = Date.now();
    const jobs = s.finalists.flatMap((f) => s.heldOutSeeds.map((seed) => ({ design: f.design, seed, opts: { maxWaves: s.cap, budget: s.budget } })));
    console.log(`playing ${s.finalists.length} finalists on ${s.heldOutSeeds.length} unseen seeds each (${jobs.length} games) on ${pool.size} cores`);
    let done = 0;
    const results = await pool.run(jobs, () => { if (++done % 20 === 0) console.log(`  ${done}/${jobs.length}, ${((Date.now() - t0) / 60000).toFixed(1)} min`); });
    await pool.close();
    let differ = 0;
    s.finalists.forEach((f, i) => {
      const rs = results.slice(i * s.heldOutSeeds.length, (i + 1) * s.heldOutSeeds.length);
      Object.assign(f, interceptStats(rs));
      if (rs.filter((r) => !r.invalid).map((r) => scoreOf(r, s.cap)).join() !== f.heldOutScores.join()) differ++;
    });
    writeFileSync(file, JSON.stringify(s));
    console.log(`${differ ? `${differ} finalists did not repeat exactly (the waves differ from the search's check)` : 'every finalist repeated its waves exactly'}; saved ${file} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    for (const f of s.finalists.slice(0, 12)) console.log(`  ${String(f.sites).padStart(2)} sites ${fmt(f.heldOut).padStart(5)} waves  ${fmt(f.kills, 0).padStart(4)} drones stopped  per £1 destroyed: ${fmt(f.perPoundShots, 3)} of shots, ${fmt(f.perPound, 3)} with the systems`);
    return;
  }

  if (cmd === 'evolve') { const { runEvolve } = await import('./evolve.mjs'); return runEvolve(args, { workers, budget }); }

  if (cmd === 'search') { const { runSearch } = await import('./search.mjs'); return runSearch(args, { workers, budget, max }); }
  if (cmd === 'report') { const { makeReport } = await import('./report.mjs'); return makeReport(args); }
  console.log('Commands: eval, seeds, timestep, search, evolve, export, report. See the top of tools/lab/lab.mjs.');
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().then(() => process.exit(0), (e) => { console.error(e.message || e); process.exit(1); });
