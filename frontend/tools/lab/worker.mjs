// One worker thread: owns its own copy of the simulation and plays the jobs it is sent.
import { parentPort } from 'node:worker_threads';
import { createRunner } from './run.mjs';

const runner = createRunner();
parentPort.on('message', (job) => {
  if (job === 'stop') { process.exit(0); }
  let result;
  try { result = runner.evaluate(job.design, job.seed, job.opts); } catch (e) { result = { invalid: `error: ${e?.message || e}` }; }
  parentPort.postMessage({ id: job.id, tag: job.tag, result });
});
