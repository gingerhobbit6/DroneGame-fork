// The site-count search (tools/lab/search.mjs) with the simulation replaced by a made-up scorer: a site count where nothing is valid
// must not lose the night's other results, and no layout is played twice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ result: () => ({ invalid: 'unset' }), saved: [] }));
vi.mock('../tools/lab/pool.mjs', () => ({
  defaultWorkers: () => 1,
  createPool: () => ({ size: 1, run: async (jobs, onResult) => jobs.map((j, i) => { const r = fake.result(j); onResult?.(r, i); return r; }), close: async () => {} }),
}));
vi.mock('../tools/lab/lab.mjs', async (original) => ({ ...(await original()), save: (file, data) => { fake.saved.push({ file, data: JSON.parse(JSON.stringify(data)) }); return file; } }));

import { mulberry32 } from '../src/sim/rng.js';
import { fromParams, problem } from '../tools/lab/model.mjs';
import { breed, runSearch, startingDesigns } from '../tools/lab/search.mjs';

// A game that ends sooner with fewer vehicles and jammers: enough for layouts to differ and for the same layout to score the same.
const played = (j) => ({ over: true, wave: 4 + j.design.vehicles.length + (j.design.remote.length % 5) + (j.seed % 2), health: 0, spent: 2e6, capex: 1e6, firstVehicleLost: null, leaked: {}, perWave: [] });

beforeEach(() => { fake.saved.length = 0; vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(process.stdout, 'write').mockImplementation(() => true); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the starting layouts', () => {
  it('are legal for every site count the search uses by default', () => {
    for (const k of [3, 4, 5, 6, 8, 10]) for (const [label, p] of startingDesigns(k)) expect(problem(fromParams(p, k)), label).toBeNull();
  });
});

describe('a search where a site count has no valid layout', () => {
  it('leaves that site count out and still confirms and saves the others', async () => {
    // 3 sites: never valid. 5 sites: valid on the short rounds, never at full length (20 waves in the quick search).
    fake.result = (j) => (j.design.vehicles.length === 3 ? { invalid: 'no room' } : j.design.vehicles.length === 5 && j.opts.maxWaves === 20 ? { invalid: 'run took too long' } : played(j));
    await runSearch({ quick: true, sites: '3,4,5', rng: '1' }, { workers: 1, budget: 7e6 });
    const last = fake.saved.at(-1);
    expect(last.file).toBe('search-quick.json');
    expect(last.data.partial).toBe(false);
    expect(last.data.pareto.map((p) => p.k)).toEqual([4]);
    expect(last.data.knee).toBe(4);
    expect(last.data.byK.map((b) => [b.k, b.final !== null])).toEqual([[3, false], [4, true], [5, false]]);
    expect(last.data.byK[1].final.scores).toHaveLength(7); // confirmed on every seed
    expect(last.data.log.some((row) => row.k === 3 && row.why === 'no room')).toBe(true); // the reason is kept for the reader
  });

  it('still writes the results when no site count has one', async () => {
    fake.result = () => ({ invalid: 'no room' });
    await runSearch({ quick: true, sites: '3', rng: '1' }, { workers: 1, budget: 7e6 });
    expect(fake.saved.at(-1).data).toMatchObject({ partial: false, pareto: [], knee: null });
  });

  it('plays no layout twice at full length for one site count', async () => {
    fake.result = played;
    await runSearch({ quick: true, sites: '4', rng: '3' }, { workers: 1, budget: 7e6 });
    const keys = fake.saved.at(-1).data.log.filter((row) => row.stage.startsWith('full') || row.stage.startsWith('generation')).map((row) => JSON.stringify(row.params));
    expect(keys.length).toBeGreaterThan(4);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('new layouts for a generation', () => {
  const cfg = { lambda: 4, full: { cap: 20, seeds: 3 } }, best = startingDesigns(4)[0][1];
  const key = (p) => JSON.stringify(p);

  it('remembers what a site count has tried, from one generation to the next', () => {
    const state = { k: 4, seen: new Set() }, p = { state, pool: [{ params: best }], cands: [] };
    const unchanged = () => 0.9; // a draw that changes nothing: every new layout is a copy of its parent
    const first = breed(p, cfg, unchanged, 0.18);
    expect(first.map((c) => c.params)).toEqual([best]);
    expect(first[0]).toMatchObject({ state, cap: 20, seeds: 3 });
    // the copy is now a parent itself, and is not one of the layouts that came through the first rounds (p.cands)
    expect(breed({ ...p, pool: [first[0]] }, cfg, unchanged, 0.18)).toEqual([]);
  });

  it('are all different from each other and from what was tried, even when most changes round back to the parent', () => {
    const tried = startingDesigns(4).map(([, params]) => params), state = { k: 4, seen: new Set(tried.map((params) => Object.values(params).join('|'))) };
    const rand = mulberry32(5), all = [];
    let pool = tried.map((params) => ({ params }));
    for (let g = 0; g < 8; g++) {
      const kids = breed({ state, pool, cands: [] }, cfg, rand, 0.004); // changes this small mostly round away
      expect(kids.length).toBeLessThanOrEqual(cfg.lambda);
      all.push(...kids);
      pool = [...pool, ...kids].slice(-3);
    }
    const keys = all.map((c) => key(c.params));
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    for (const params of tried) expect(keys).not.toContain(key(params));
    for (const c of all) expect(problem(fromParams(c.params, 4))).toBeNull();
  });
});
