// A pool of worker threads. Each run is independent (its own seed, its own copy of the sim), so they go side by side, one per core.
// A worker that crashes, or a run that never ends, costs only that run: the worker is replaced and the run is reported as invalid.
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

export const defaultWorkers = () => Math.max(1, cpus().length - 2); // leave two cores for the machine
const JOB_LIMIT_MS = 40 * 60 * 1000; // no single run should take longer than this

export function createPool(size = defaultWorkers()) {
  const file = fileURLToPath(new URL('./worker.mjs', import.meta.url));
  const slots = [];
  let nextId = 1, completed = 0, closed = false;
  const pending = []; // jobs waiting for a free worker
  const waiting = new Map(); // id -> resolve

  const finish = (id, result) => { const resolve = waiting.get(id); if (resolve) { waiting.delete(id); completed++; resolve(result); } };

  function spawn(slot) {
    slot.w = new Worker(file);
    slot.busy = false; slot.job = null;
    slot.w.on('message', (m) => {
      clearTimeout(slot.timer); slot.busy = false; slot.job = null;
      finish(m.id, m.result);
      dispatch();
    });
    const lost = (why) => {
      if (closed) return;
      clearTimeout(slot.timer);
      const job = slot.job; slot.job = null;
      if (job) finish(job.id, { invalid: why });
      slot.w.removeAllListeners(); slot.w.terminate().catch(() => {});
      spawn(slot); dispatch();
    };
    slot.w.on('error', (e) => lost(`worker error: ${e.message}`));
    slot.w.on('exit', () => lost('worker exited'));
    slot.lost = lost;
  }
  for (let i = 0; i < size; i++) { const slot = {}; slots.push(slot); spawn(slot); }

  function dispatch() {
    for (const slot of slots) {
      if (slot.busy || !pending.length) continue;
      const job = pending.shift();
      slot.busy = true; slot.job = job;
      slot.timer = setTimeout(() => slot.lost?.('run took too long'), JOB_LIMIT_MS);
      slot.w.postMessage(job);
    }
  }

  // jobs: [{ design, seed, opts, tag? }]. Resolves to the results in the same order. Longer runs go first, so the last core is not left alone.
  function run(jobs, onResult) {
    const order = jobs.map((j, i) => ({ j, i })).sort((a, b) => (b.j.opts?.maxWaves ?? 45) - (a.j.opts?.maxWaves ?? 45));
    const results = new Array(jobs.length);
    return new Promise((resolve) => {
      let left = jobs.length;
      if (!left) return resolve(results);
      for (const { j, i } of order) {
        const id = nextId++;
        waiting.set(id, (r) => { results[i] = r; onResult?.(r, i, jobs.length - left + 1); if (--left === 0) resolve(results); });
        pending.push({ id, design: j.design, seed: j.seed, opts: j.opts, tag: j.tag });
      }
      dispatch();
    });
  }
  return { run, size, close: () => { closed = true; return Promise.all(slots.map((s) => s.w.terminate())); }, get completed() { return completed; } };
}
