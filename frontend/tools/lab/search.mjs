// Fewest vehicle sites for the most waves.
//
// For each number of sites k the search looks for the best layout, then the results are laid side by side: waves survived against sites.
// All the sites run together so the cores stay busy.
//
//   1. Successive halving: many layouts are tried on short runs with 2 seeds, the best third get longer runs with more seeds, and so on.
//      Short runs cost a fraction of long ones (a run's time grows about with the square of the waves it plays).
//   2. Evolution: the best few are copied with small random changes and tried at full length, and the best survive. Each generation's
//      best score, and how spread out the survivors' numbers are, show whether the search has settled.
//   3. Confirmation: each k's best layout is played on every seed, including ones the search never saw.
//
// Every layout faces the same seeds in the same order, so a difference between two layouts is a difference in the layout, not in luck.

import { createPool } from './pool.mjs';
import { SPACE, NAMES, clampParam, fromParams, problem, V11, describe } from './model.mjs';
import { mean, sd, ci, spearman, paired } from './stats.mjs';
import { save, scoreOf, fmt, list } from './lab.mjs';

const ALL_SEEDS = [1, 7, 42, 3, 99, 123, 2026]; // the first ones guide the search; the last ones only confirm
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const PRESETS = {
  quick: { n0: 12, rounds: [{ cap: 8, seeds: 2 }, { cap: 14, seeds: 2 }], keep: 1 / 3, full: { cap: 20, seeds: 3 }, gens: 2, lambda: 4, mu: 2 },
  normal: { n0: 30, rounds: [{ cap: 12, seeds: 2 }, { cap: 22, seeds: 3 }], keep: 1 / 3, full: { cap: 45, seeds: 4 }, gens: 3, lambda: 6, mu: 3 },
  thorough: { n0: 60, rounds: [{ cap: 12, seeds: 2 }, { cap: 22, seeds: 3 }, { cap: 32, seeds: 4 }], keep: 1 / 3, full: { cap: 45, seeds: 5 }, gens: 6, lambda: 10, mu: 4 },
};

// Keep a layout inside what the rules allow: whole numbers where needed, never more radars than vehicles, and jammer rings clear of the vehicles.
function clean(p, k) {
  const q = {};
  for (const key of NAMES) q[key] = clampParam(key, p[key]);
  q.radars = Math.max(1, Math.min(q.radars, k)); q.p1 = Math.min(q.p1, k); q.hmg2 = Math.min(q.hmg2, k);
  q.rho1 = Math.max(q.rho1, 1 + 100 / q.R);
  q.rho2 = Math.max(q.rho2, q.rho1 + 100 / q.R);
  q.rho1 = +q.rho1.toFixed(3); q.rho2 = +q.rho2.toFixed(3); q.rot = +q.rot.toFixed(3);
  for (const key of ['rho1', 'rho2']) q[key] = Math.min(q[key], SPACE[key].max);
  // no vehicle may end up with more than three systems: take away second guns, then interceptors, until none does
  while (fromParams(q, k).vehicles.some((v) => v.sys.length > 3) && (q.hmg2 > 0 || q.p1 > 0)) { if (q.hmg2 > 0) q.hmg2--; else q.p1--; }
  return q;
}

function latin(n, k, rand) {
  const cols = NAMES.map(() => Array.from({ length: n }, (_, i) => (i + rand()) / n).sort(() => rand() - 0.5));
  return Array.from({ length: n }, (_, i) => {
    const p = {};
    NAMES.forEach((key, j) => { const s = SPACE[key]; p[key] = s.min + cols[j][i] * (s.max - s.min); });
    return clean(p, k);
  });
}

function mutate(parent, k, rand, scale) {
  const p = { ...parent };
  for (const key of NAMES) {
    if (rand() > 0.45) continue;
    const s = SPACE[key], g = Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand()); // normal
    p[key] = parent[key] + g * scale * (s.max - s.min);
  }
  return clean(p, k);
}

const keyOf = (p) => NAMES.map((n) => p[n]).join('|');

// The layouts every search starts from, for k vehicle sites: the brief's best scaled down, and the same with a second gun on every vehicle.
export const startingDesigns = (k) => [
  [`brief's best, ${k} sites`, clean({ ...V11, radars: Math.min(4, k), p1: Math.min(3, k) }, k)],
  [`brief's best with two guns each, ${k} sites`, clean({ ...V11, radars: Math.min(4, k), p1: Math.min(3, k), hmg2: k }, k)],
];

export async function runSearch(args, { workers, budget }) {
  const preset = PRESETS[args.thorough ? 'thorough' : args.quick ? 'quick' : 'normal'];
  const cfg = { ...preset, full: { ...preset.full, cap: Number(args.max) && args.max !== true ? Number(args.max) : preset.full.cap } };
  const sites = list(args.sites || '3,4,5,6,8,10');
  const rand = mulberry32(Number(args.rng || 12345));
  const pool = createPool(workers);
  const out = args.out || (args.quick ? 'search-quick.json' : 'search.json');
  const log = []; // every layout tried: one row each
  let evalNo = 0, runs = 0;
  const t0 = Date.now(), clock = () => `${Math.round((Date.now() - t0) / 1000)} s`;

  const states = sites.map((k) => {
    const seedDesigns = startingDesigns(k).map(([, p]) => p);
    const pop = [...seedDesigns, ...latin(cfg.n0 - seedDesigns.length, k, rand)];
    return { k, pop, history: [], correlations: [], seen: new Set(), best: null, final: null };
  });

  console.log(`searching ${sites.join(', ')} vehicle sites on ${pool.size} cores (${args.thorough ? 'thorough' : args.quick ? 'quick' : 'normal'})`);
  console.log(`  start: ${cfg.n0} layouts per site count, short runs of ${cfg.rounds[0].cap} waves; end: runs of ${cfg.full.cap} waves on ${cfg.full.seeds} seeds`);

  // Plays every wanted layout on its seeds, all at once, and returns the layouts with their scores.
  async function evaluate(wants, label, round) {
    const jobs = [];
    for (const w of wants) for (const seed of ALL_SEEDS.slice(0, w.seeds)) jobs.push({ design: fromParams(w.params, w.state.k), seed, opts: { maxWaves: w.cap, budget }, w, seed });
    let done = 0;
    const results = await pool.run(jobs, () => { done++; if (done % 25 === 0 || done === jobs.length) process.stdout.write(`\r  ${label}: ${done}/${jobs.length} runs  ${clock()}   `); });
    process.stdout.write('\n');
    runs += jobs.length;
    const by = new Map(wants.map((w) => [w, []]));
    jobs.forEach((j, i) => by.get(j.w).push({ seed: j.seed, r: results[i] }));
    for (const w of wants) {
      const rs = by.get(w), valid = rs.filter((x) => !x.r.invalid);
      w.valid = valid.length === rs.length;
      w.scores = rs.map((x) => scoreOf(x.r, w.cap));
      w.score = w.valid ? mean(w.scores) : -1;
      w.spent = valid.length ? mean(valid.map((x) => x.r.spent)) : 0;
      w.capex = valid.length ? valid[0].r.capex : 0;
      w.firstLoss = valid.map((x) => x.r.firstVehicleLost);
      w.invalid = w.valid ? null : rs.find((x) => x.r.invalid).r.invalid;
      log.push({ no: ++evalNo, k: w.state.k, stage: label, round, params: w.params, cap: w.cap, seeds: rs.map((x) => x.seed), scores: w.scores, score: w.score, spent: w.spent, capex: w.capex, valid: w.valid, why: w.invalid, runs: valid.map((x) => ({ seed: x.seed, wave: x.r.wave, over: x.r.over, leaked: x.r.leaked, perWave: x.r.perWave })), });
    }
    return wants;
  }

  // ---- 1. successive halving, all site counts together
  let alive = states.map((s) => ({ state: s, cands: s.pop.map((params) => ({ state: s, params })) }));
  for (const [ri, round] of cfg.rounds.entries()) {
    const wants = alive.flatMap((a) => a.cands.map((c) => Object.assign(c, { cap: round.cap, seeds: round.seeds })));
    await evaluate(wants, `round ${ri + 1} (${round.cap} waves, ${round.seeds} seeds)`, ri + 1);
    for (const a of alive) {
      a.cands.forEach((c) => { (c.byRound ||= {})[ri] = c.score; });
      const ranked = a.cands.filter((c) => c.valid).sort((x, y) => y.score - x.score);
      a.state.history.push({ stage: `round ${ri + 1}`, evals: ranked.length, best: ranked[0]?.score ?? null, mean: mean(ranked.map((c) => c.score)), params: spreadOf(ranked.slice(0, Math.max(3, Math.ceil(ranked.length / 3)))) });
      a.cands = ranked.slice(0, Math.max(cfg.mu + 1, Math.ceil(ranked.length * cfg.keep)));
      console.log(`  k=${a.state.k}: best ${fmt(ranked[0]?.score)} -> keeping ${a.cands.length}`);
    }
  }

  // ---- 2. full length, then evolution
  let parents = alive.map((a) => ({ state: a.state, cands: a.cands }));
  const fullWants = parents.flatMap((p) => p.cands.map((c) => Object.assign(c, { cap: cfg.full.cap, seeds: cfg.full.seeds })));
  await evaluate(fullWants, `full length (${cfg.full.cap} waves, ${cfg.full.seeds} seeds)`, 'full');
  for (const p of parents) {
    p.cands.forEach((c) => { c.byRound[cfg.rounds.length] = c.score; });
    for (let r = 0; r < cfg.rounds.length; r++) {
      const both = p.cands.filter((c) => c.valid && c.byRound[r] != null);
      p.state.correlations.push({ from: `round ${r + 1}`, to: 'full length', rho: spearman(both.map((c) => c.byRound[r]), both.map((c) => c.byRound[cfg.rounds.length])), n: both.length });
    }
    p.pool = p.cands.filter((c) => c.valid).sort((x, y) => y.score - x.score).slice(0, cfg.mu);
    record(p.state, 'full length', p.pool, p.cands.length);
  }
  for (let g = 1; g <= cfg.gens; g++) {
    const scale = 0.18 * 0.7 ** (g - 1);
    const kids = [];
    for (const p of parents) {
      p.state.seen = new Set(p.cands.map((c) => keyOf(c.params)));
      for (let i = 0, tries = 0; i < cfg.lambda && tries < cfg.lambda * 6; tries++) {
        const parent = p.pool[Math.floor(rand() * p.pool.length)];
        const params = mutate(parent.params, p.state.k, rand, scale), key = keyOf(params);
        if (p.state.seen.has(key)) continue;
        p.state.seen.add(key); kids.push({ state: p.state, params, cap: cfg.full.cap, seeds: cfg.full.seeds }); i++;
      }
    }
    await evaluate(kids, `generation ${g} (${kids.length} new layouts)`, `gen${g}`);
    for (const p of parents) {
      const mine = kids.filter((c) => c.state === p.state && c.valid);
      p.pool = [...p.pool, ...mine].sort((x, y) => y.score - x.score).slice(0, cfg.mu);
      record(p.state, `generation ${g}`, p.pool, mine.length);
      console.log(`  k=${p.state.k}: best ${fmt(p.pool[0].score, 2)} waves  (${describe(fromParams(p.pool[0].params, p.state.k))})`);
    }
    save(out, assemble(true));
  }

  // ---- 3. confirm each site count's best on every seed
  const confirm = parents.map((p) => Object.assign({ state: p.state, params: p.pool[0].params }, { cap: cfg.full.cap, seeds: ALL_SEEDS.length }));
  await evaluate(confirm, `confirmation (all ${ALL_SEEDS.length} seeds)`, 'confirm');
  for (const c of confirm) {
    c.state.final = { params: c.params, design: fromParams(c.params, c.state.k), scores: c.scores, mean: mean(c.scores), ci: ci(c.scores), sd: sd(c.scores), spent: c.spent, capex: c.capex, seeds: ALL_SEEDS.slice(), guideScore: c.state.history.at(-1).best };
  }

  function record(state, stage, pop, tried) {
    state.history.push({ stage, evals: tried, best: pop[0].score, mean: mean(pop.map((c) => c.score)), params: spreadOf(pop), bestParams: pop[0].params, runsSoFar: runs });
  }
  function assemble(partial) {
    return { kind: 'search', partial, preset: args.thorough ? 'thorough' : args.quick ? 'quick' : 'normal', cfg, sites, seeds: ALL_SEEDS, budget, workers: pool.size, seconds: (Date.now() - t0) / 1000, runs,
      byK: states.map((s) => ({ k: s.k, history: s.history, correlations: s.correlations, final: s.final })), log };
  }

  // The smallest number of sites whose confirmed mean is within two waves of the best (or within the better one's interval).
  const done = states.filter((s) => s.final).sort((a, b) => a.k - b.k);
  const top = done.reduce((m, s) => (s.final.mean > m.final.mean ? s : m), done[0]);
  const knee = done.find((s) => s.final.mean >= top.final.mean - Math.max(2, top.final.ci));
  const result = assemble(false);
  result.pareto = done.map((s) => ({ k: s.k, mean: s.final.mean, ci: s.final.ci, capex: s.final.capex, spent: s.final.spent, params: s.final.params, what: describe(s.final.design) }));
  result.knee = knee ? knee.k : null;
  if (knee && top !== knee) { const d = paired(knee.final.scores, top.final.scores); result.kneeVsBest = d; }
  console.log('\nsites  waves (all seeds)        capex    layout');
  for (const s of done) console.log(`${String(s.k).padStart(5)}  ${fmt(s.final.mean).padStart(5)} +-${fmt(s.final.ci).padEnd(5)}  ${(`$${fmt(s.final.capex / 1e6, 2)}M`).padStart(9)}  ${describe(s.final.design)}`);
  if (knee) console.log(`\nfewest sites within ${fmt(Math.max(2, top.final.ci), 1)} waves of the best: ${knee.k}`);
  console.log(`${runs} runs in ${clock()}; saved ${save(out, result)}`);
  await pool.close();
}

// Mean and spread of each number across a set of layouts: how far the survivors have settled on one design.
function spreadOf(cands) {
  const out = {};
  for (const n of NAMES) { const v = cands.map((c) => c.params[n]), range = SPACE[n].max - SPACE[n].min; out[n] = { mean: mean(v), sd: v.length > 1 ? sd(v) : 0, rel: v.length > 1 ? sd(v) / range : 0 }; }
  return out;
}
