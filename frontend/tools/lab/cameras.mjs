// Cameras compared on the brief's V11 laydown: one SkySpyke (six Quell SPYKE heads, all round) against Overview PodViews, and none,
// on the same seeds.
// Every variant keeps V11's guns, radars, interceptors and jammers and adds cameras to its vehicles, so only the cameras differ.
//
//   node tools/lab/cameras.mjs [--seeds 12] [--max 45] [--workers 12]
// Writes lab-results/cameras.json and a laydown for each variant, with its result, for the game's Lab tab.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fromParams, V11 } from './model.mjs';
import { parseArgs, save, scoreOf, interceptStats, fmt, OUT_DIR } from './lab.mjs';
import { mean, ci } from './stats.mjs';

const args = parseArgs(['x', ...process.argv.slice(2)]);
process.env.LAB_MAX_SENSORS = '2'; // a camera may share a vehicle with a radar
const { createPool, defaultWorkers } = await import('./pool.mjs');
const { createRunner } = await import('./run.mjs');
const nSeeds = Number(args.seeds || 12), max = Number(args.max || 45), budget = 12_000_000, workers = Number(args.workers || defaultWorkers());
const seeds = Array.from({ length: nSeeds }, (_, i) => 1000 + i); // seeds the overnight search never used

// V11 with `n` of camera `id` on its vehicles, spread evenly round the ring
function withCameras(id, n) {
  const d = fromParams(V11, 10);
  for (let j = 0; j < n; j++) d.vehicles[Math.round((j * 10) / n) % 10].sys.push([id]);
  return d;
}
const GBP = 0.75;
const VARIANTS = [
  ['No cameras (V11)', withCameras('camera_skyspyke', 0), 0],
  ['1 SkySpyke, £300k', withCameras('camera_skyspyke', 1), 300000],
  ['1 PodView, £30k', withCameras('camera_podview', 1), 30000],
  ['4 PodViews, £120k', withCameras('camera_podview', 4), 120000],
  ['10 PodViews, £300k', withCameras('camera_podview', 10), 300000],
  ['1 SkySpyke and 4 PodViews, £420k', (() => { const d = withCameras('camera_podview', 4); d.vehicles.find((v) => v.sys.length < 3 && !v.sys.some(([id]) => id.startsWith('camera'))).sys.push(['camera_skyspyke']); return d; })(), 420000],
];

const pool = createPool(Math.min(workers, VARIANTS.length * seeds.length)), t0 = Date.now();
const jobs = VARIANTS.flatMap(([, design]) => seeds.map((seed) => ({ design, seed, opts: { maxWaves: max, budget } })));
console.log(`${VARIANTS.length} variants x ${seeds.length} seeds = ${jobs.length} games on ${pool.size} cores, up to wave ${max}`);
let done = 0;
const results = await pool.run(jobs, () => { if (++done % 12 === 0) console.log(`  ${done}/${jobs.length} games, ${((Date.now() - t0) / 60000).toFixed(1)} min`); });
await pool.close();

const rows = VARIANTS.map(([name, design, cameraGbp], i) => {
  const rs = results.slice(i * seeds.length, (i + 1) * seeds.length), ok = rs.filter((r) => !r.invalid);
  const waves = ok.map((r) => scoreOf(r, max));
  const leaks = ok.map((r) => Object.values(r.leaked || {}).reduce((a, b) => a + b, 0));
  return { name, design, cameraGbp, games: ok.length, invalid: rs.length - ok.length, firstInvalid: rs.find((r) => r.invalid)?.invalid ?? null,
    waves: mean(waves), ci: ci(waves), all: waves, leaks: mean(leaks), capex: mean(ok.map((r) => r.capex)), ...interceptStats(rs) };
});
const out = save('cameras.json', { kind: 'cameras', seeds, max, budget, rows, minutes: (Date.now() - t0) / 60000 });
for (const r of rows) console.log(`${r.name.padEnd(28)} waves ${fmt(r.waves)} +-${fmt(r.ci)}  leaks ${fmt(r.leaks)}  per £1 destroyed ${fmt(r.perPound, 3)}  ${r.invalid ? `(${r.invalid} invalid: ${r.firstInvalid})` : ''}`);
console.log('saved', out);

// each variant as a laydown the Lab tab lists, with its result
const runner = createRunner();
mkdirSync(resolve(OUT_DIR, 'laydowns'), { recursive: true });
for (const r of rows) {
  const lay = runner.exportLaydown(r.design, `cameras ${r.name}`, { budget });
  if (lay.error) { console.log(`  ${r.name}: not exported (${lay.error})`); continue; }
  const file = resolve(OUT_DIR, 'laydowns', `cameras-${r.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.json`);
  writeFileSync(file, JSON.stringify({ name: lay.name, world: lay.world, game_version: lay.game_version, spec: lay.spec,
    lab: { sites: 10, family: 'camera test', waves: +fmt(r.waves, 1), ci: +fmt(r.ci, 1), capex: Math.round(lay.capex), perPound: r.perPound == null ? null : +fmt(r.perPound, 3), perPoundShots: r.perPoundShots == null ? null : +fmt(r.perPoundShots, 3), what: `${r.name}: V11 plus cameras, ${r.games} unseen seeds` } }, null, 1));
}
console.log('laydowns written');
