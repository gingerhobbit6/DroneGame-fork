// Scripted runs shared by the Node tests and the browser. Compare runReferences() with reference-digests.json: any
// difference means behaviour changed. To run them against the real page, in the browser console:
//   const r = await import('/tests/support/scenarios.js'); window.game.debug.frozen = true; r.runReferences(window.game.sim)

export const MIXED = [['radar', 600, 0], ['rf', 900, 0], ['rf', -900, 0], ['camera', 378, 589], ['camera', -378, -589], ['jammer', 702, 384], ['jammer', -702, -384],
  ['interceptor', 490, 99], ['interceptor', -331, 374], ['interceptor', -158, -474], ['missile', -400, 300]];
export const LASERS = [['radar', 400, 0], ['radar_s', 324, 505], ['radar_s', -324, -505], ['laser', 430, 133], ['laser', 7, 450], ['laser', -420, 146], ['laser', -267, -362], ['laser', 250, -374]];
export const JAMMERS = [['radar_s', 270, 421], ['radar_s', -500, 0], ['radar_s', 270, -421], ['jammer', 478, 148], ['jammer', 110, 487], ['jammer', -371, 335], ['jammer', -478, -148], ['jammer', -110, -487], ['jammer', 371, -335]];
export const GNSS_RING = [['radar', 600, 0], ['radar_s', 324, 505], ['radar_s', -324, -505], ['jammer', 1176, 238], ['jammer', -1176, -238], ['jammer', 238, 1176], ['jammer', -238, -1176], ['jammer', 900, -800], ['jammer', -900, 800]];

export const SCENARIOS = [
  { name: 'mixed-seed1', seed: '1', laydown: MIXED, waves: 6 },
  { name: 'mixed-seed7', seed: '7', laydown: MIXED, waves: 6 },
  { name: 'mixed-gnss-seed42', seed: '42', laydown: MIXED, waves: 4, gnss: true },
  { name: 'lasers-seed42', seed: '42', laydown: LASERS, waves: 8 },
  { name: 'jammers-seed1', seed: '1', laydown: JAMMERS, waves: 4 },
];

export function setUp(sim, { seed, laydown, gnss }) {
  sim.state.seed = seed;
  sim.commands.reset('clear');
  sim.state.started = true;
  for (const [id, xm, zm] of laydown) sim.addStructure(id, xm / 20, zm / 20);
  if (gnss) for (const s of sim.structures) if (s.jamBands) s.jamBands.add('gnss');
  sim.commands.autoWire();
}

export function playWave(sim) {
  const s = sim.state;
  sim.commands.startWave();
  for (let n = 0; s.waveActive && !s.over && n < 60000; n += 200) sim.run(200);
}

export function play(sim, waves) {
  sim.state.warnedWire = true;
  for (let w = 0; w < waves && !sim.state.over; w++) playWave(sim);
}

export function runReferences(sim, scenarios = SCENARIOS) {
  const out = {};
  for (const sc of scenarios) {
    setUp(sim, sc);
    play(sim, sc.waves);
    out[sc.name] = { digest: sim.digest(), wave: sim.state.wave, kills: sim.state.kills, leaks: sim.state.leaks, health: sim.state.health, budget: Math.round(sim.state.budget) };
  }
  sim.state.seed = '1';
  return out;
}
