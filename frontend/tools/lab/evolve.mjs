// An overnight search for ways to counter an attack, that keeps many different answers rather than one.
//
// The method is MAP-Elites: the layouts are sorted into cells by what kind they are (how many vehicle sites, which kind of weapon holds
// most of the money, how much it costs). Each cell keeps only the best layout found for it. New layouts are made by changing a random
// kept one slightly, and replace a cell's keeper only if they do better. So the search does not collapse onto one design: it fills
// out a map of what works, from a few sites to many and from guns to missiles. Cells that nobody has filled show where nothing was found.
//
// A new layout is first played on 2 seeds. Only if that is close to its cell's keeper does it get 3 more (a race: poor layouts cost
// two short runs and no more). Kept layouts have always been played on the same 5 seeds, so they compare fairly. At the end the best of
// each cell are played on 5 seeds the search never saw, and those are the numbers to believe.
//
// Convergence: the quality-diversity score (the sum of every cell's best) rises while the search finds better or new kinds of layout
// and levels off when it has stopped. It is saved after every batch, so it can be plotted and an interrupted search resumed.

import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPool } from './pool.mjs';
import { random, mutate, toDesign, seeds as startGenomes, mainFamily, describeGenome, keyOfGenome, repair } from './genome.mjs';
import { mean, ci } from './stats.mjs';
import { RULES } from './model.mjs';
import { OUT_DIR, scoreOf, fmt, attackFrom, interceptStats } from './lab.mjs';

const GUIDE = [1, 7, 42, 3, 99];            // the seeds the search learns from; the first two are the quick look
const HELD_OUT = [123, 2026, 11, 12, 13];   // seeds only the final check uses
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const bucketOf = (capex) => (capex < 2_500_000 ? 'low' : capex < 4_500_000 ? 'mid' : 'high');
const hms = (s) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;

function writeAtomic(file, data) { const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(data)); renameSync(tmp, file); }

export async function runEvolve(args, { workers, budget }) {
  const name = args.name || 'evolve';
  const stateFile = resolve(OUT_DIR, `${name}-state.json`), logFile = resolve(OUT_DIR, `${name}-log.jsonl`), finalFile = resolve(OUT_DIR, `${name}.json`);
  const seconds = args.minutes ? Number(args.minutes) * 60 : Number(args.hours || 7.5) * 3600;
  const cap = Number(args.cap || 50);
  const attack = await attackFrom(args.attack ?? 'russia');
  const rngSeed = Number(args.rng || Date.now() % 100000), rand = mulberry32(rngSeed);
  const pool = createPool(workers);
  const batchSize = Number(args.batch || pool.size * 2);
  const reserve = Math.min(seconds * 0.12, 1800); // time kept back for the final check on unseen seeds
  const t0 = Date.now(), elapsed = () => (Date.now() - t0) / 1000;
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log(`\n${sig}: finishing the batch, then saving`); stopping = true; });

  const cells = new Map(); // key -> keeper
  const seen = new Set();
  const history = [];
  let evals = 0, valid = 0, promoted = 0, replaced = 0, runs = 0, priorSeconds = 0;
  if (args.resume && existsSync(stateFile)) {
    const s = JSON.parse(readFileSync(stateFile, 'utf8'));
    for (const [k, v] of s.cells) { cells.set(k, v); seen.add(keyOfGenome(v.genome)); }
    history.push(...s.history); ({ evals, valid, promoted, replaced, runs } = s.counts); priorSeconds = s.seconds;
    console.log(`resumed: ${cells.size} cells, ${evals} layouts tried, ${hms(priorSeconds)} already spent`);
  }

  const play = async (genomes, seedList) => {
    const jobs = [];
    for (const g of genomes) for (const seed of seedList) jobs.push({ design: toDesign(g, attack), seed, opts: { maxWaves: cap, budget } });
    const results = await pool.run(jobs);
    runs += jobs.length;
    return genomes.map((g, i) => results.slice(i * seedList.length, (i + 1) * seedList.length));
  };
  // the number that ranks a layout: mean waves over the seeds, with a hair off for money spent so that, of two equal layouts, the cheaper wins
  const fitness = (rs) => mean(rs.map((r) => scoreOf(r, cap))) - mean(rs.map((r) => r.spent || 0)) / 1e8;
  const cellOf = (g, r) => `${g.veh.length}|${mainFamily(g)}|${bucketOf(r.capex)}`;

  function snapshot() {
    const scores = [...cells.values()].map((c) => c.score);
    const point = { t: priorSeconds + elapsed(), evals, valid, runs, cells: cells.size, best: Math.max(0, ...scores), mean: scores.length ? mean(scores) : 0, qd: scores.reduce((a, b) => a + b, 0), promoted, replaced };
    history.push(point);
    return point;
  }
  const checkpoint = () => writeAtomic(stateFile, { cells: [...cells], history, counts: { evals, valid, promoted, replaced, runs }, seconds: priorSeconds + elapsed(), cfg: { cap, attack, budget } });

  // ---- one round: make candidates, take a quick look, race the promising ones, and let the winners into their cells
  async function round(candidates) {
    candidates = candidates.filter((g) => { const k = keyOfGenome(g); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!candidates.length) return;
    evals += candidates.length;
    const quick = await play(candidates, GUIDE.slice(0, 2));
    const keep = [];
    candidates.forEach((g, i) => {
      const rs = quick[i];
      if (rs.some((r) => r.invalid)) return; // broke a rule, or could not be afforded: not a layout
      valid++;
      const s1 = fitness(rs), cell = cellOf(g, rs[0]), keeper = cells.get(cell);
      appendFileSync(logFile, JSON.stringify({ t: Math.round(priorSeconds + elapsed()), cell, s1: +s1.toFixed(2), keeper: keeper ? +keeper.score.toFixed(2) : null }) + '\n');
      if (s1 >= 4 && (!keeper || s1 >= keeper.score - 1.5)) keep.push({ g, cell, rs, s1 });
    });
    if (!keep.length) return;
    promoted += keep.length;
    const more = await play(keep.map((c) => c.g), GUIDE.slice(2));
    keep.forEach((c, i) => {
      const all = [...c.rs, ...more[i]];
      if (all.some((r) => r.invalid)) return;
      const score = fitness(all), keeper = cells.get(c.cell);
      if (!keeper || score > keeper.score + 0.05) {
        if (keeper) replaced++;
        cells.set(c.cell, { genome: c.g, score, scores: all.map((r) => scoreOf(r, cap)), capex: all[0].capex, spent: mean(all.map((r) => r.spent)), leaked: all[0].leaked, wave: all[0].wave, atCap: all.filter((r) => !r.over).length, found: Math.round(priorSeconds + elapsed()) });
      }
    });
  }

  console.log(`searching against ${attack ? attack.join(', ') : 'the generic drones'} on ${pool.size} cores for ${hms(seconds)} (waves capped at ${cap}, budget $${fmt(budget / 1e6, 1)}M, random seed ${rngSeed}; up to ${RULES.maxSensors} sensor${RULES.maxSensors > 1 ? 's' : ''} per vehicle)`);
  if (!cells.size) await round([...startGenomes(), ...Array.from({ length: batchSize }, () => random(rand))]);
  let last = snapshot();
  while (!stopping && elapsed() < seconds - reserve) {
    const entries = [...cells.values()];
    const kids = Array.from({ length: batchSize }, () => (entries.length && rand() > 0.12 ? mutate(entries[Math.floor(rand() * entries.length)].genome, rand) : random(rand)));
    await round(kids);
    last = snapshot(); checkpoint();
    console.log(`[${hms(priorSeconds + elapsed())}] tried ${evals} (${valid} legal), ${cells.size} kinds kept, best ${fmt(last.best)} waves, mean ${fmt(last.mean)}, quality-diversity ${fmt(last.qd, 0)}, ${replaced} improvements`);
  }

  // ---- the check on seeds the search never saw
  const ranked = [...cells].sort((a, b) => b[1].score - a[1].score).slice(0, 40);
  console.log(`\nchecking the best ${ranked.length} on ${HELD_OUT.length} unseen seeds`);
  const confirm = await play(ranked.map(([, v]) => v.genome), HELD_OUT);
  const finalists = ranked.map(([cell, v], i) => {
    const rs = confirm[i].filter((r) => !r.invalid), sc = rs.map((r) => scoreOf(r, cap));
    const [k, family, bucket] = cell.split('|');
    return { cell, sites: Number(k), family, bucket, genome: v.genome, design: toDesign(v.genome, attack), what: describeGenome(v.genome), guide: v.score, guideScores: v.scores, heldOut: sc.length ? mean(sc) : null, heldOutCi: sc.length > 1 ? ci(sc) : null, heldOutScores: sc, ...interceptStats(confirm[i]), capex: v.capex, spent: v.spent, leaked: v.leaked, found: v.found, atCap: v.atCap };
  }).sort((a, b) => (b.heldOut ?? -1) - (a.heldOut ?? -1));
  snapshot();
  const result = { kind: 'evolve', attack, cap, budget, maxSensors: RULES.maxSensors, workers: pool.size, seconds: priorSeconds + elapsed(), runs, evals, valid, guideSeeds: GUIDE, heldOutSeeds: HELD_OUT, history, finalists,
    cells: [...cells].map(([cell, v]) => ({ cell, score: v.score, capex: v.capex })) };
  writeAtomic(finalFile, result); checkpoint();

  console.log('\nbest layouts, played on seeds the search never saw:');
  console.log('sites  waves (unseen)     capex   what');
  for (const f of finalists.slice(0, 15)) console.log(`${String(f.sites).padStart(5)}  ${fmt(f.heldOut).padStart(5)} +-${fmt(f.heldOutCi).padEnd(5)}  $${fmt(f.capex / 1e6, 2).padStart(5)}M  ${f.what}`);
  const bySites = {};
  for (const f of finalists) if (f.heldOut != null && (!bySites[f.sites] || f.heldOut > bySites[f.sites].heldOut)) bySites[f.sites] = f;
  console.log('\nbest for each number of sites:');
  for (const k of Object.keys(bySites).sort((a, b) => a - b)) console.log(`  ${k} sites: ${fmt(bySites[k].heldOut)} waves  ${bySites[k].what}`);
  console.log(`\n${runs} runs, ${evals} layouts, ${hms(result.seconds)}; saved ${finalFile}`);
  await pool.close();
}
