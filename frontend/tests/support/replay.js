// Putting a saved run back through the simulation, and the sample records the backend's tests use.
//
// To regenerate the backend fixtures after a deliberate change of shape:
//   node tests/support/write-fixtures.js

import { GAME_VERSION } from '../../src/sim/config/index.js';
import { MIXED, setUp } from './scenarios.js';

export function replayRun(sim, record) {
  sim.state.seed = record.scenario_seed;
  sim.commands.applyFigures(record.figures);
  // settings logged at step 0, such as a deployment pack that lifts the budget, must hold before the laydown loads
  for (const { step, name, args } of record.commands) if (step === 0 && name !== 'endRun') sim.commands[name](...args);
  sim.commands.loadLaydown(record.spec, record.world);
  sim.state.warnedWire = true; // the first press of Start wave only warned, and that is not in the log
  for (const { step, name, args } of record.commands) {
    while (sim.stepCount() < step) sim.step();
    if (name !== 'endRun') sim.commands[name](...args.map((a) => (a && a.node ? sim.net.nodes.get(a.node) : a)));
  }
}

const sample = (sim) => {
  setUp(sim, { seed: '1', laydown: MIXED });
  sim.structures.find((s) => s.jamBands).jamBands.add('gnss');
};

export function sampleLaydown(sim) {
  sample(sim);
  return { name: 'Sample laydown', world: sim.state.terrainSeed, spec: sim.currentLaydown(), game_version: GAME_VERSION };
}

export function sampleRun(sim) {
  sample(sim);
  sim.commands.setFigure('structures', 'radar', 'published', 2500);
  sim.commands.setFigure('comms', 'starlink', 'loss', 0.01);
  sim.commands.setFigure('drones', 'fpv', 'hp', 25);
  sim.commands.setRangeScale(1.1);
  sim.commands.setFpvGap(18);
  sim.commands.setAdapt('evadePerWave', 0.08);
  sim.state.warnedWire = true;
  sim.commands.startWave();
  sim.run(200);
  sim.commands.toggleJamBand(sim.structures.find((s) => s.jamBands), 'control900', true);
  sim.commands.launchSandboxAttack({ type: 'fpv', count: 1, bearingDeg: 'rand', gap: 0 });
  let run = null;
  const take = (r) => { run = r; };
  sim.on('runEnded', take);
  sim.endRun();
  sim.off('runEnded', take);
  sim.commands.resetAllFigures();
  sim.commands.reset('clear');
  return JSON.parse(JSON.stringify(run));
}
