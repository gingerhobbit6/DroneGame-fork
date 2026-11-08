// Plays each laydown on several seeds with no browser and prints how far it got. Run with: npm run balance

import { createSimulation } from '../src/sim/simulation.js';
import { JAMMERS, LASERS, MIXED, setUp, playWave } from '../tests/support/scenarios.js';

const ring = (id, n, r, off = 0) => Array.from({ length: n }, (_, i) => { const a = off + (i / n) * Math.PI * 2; return [id, Math.cos(a) * r, Math.sin(a) * r]; });
const LAYDOWNS = {
  'Empty': [],
  '6 jammers, 3 compact radars': JAMMERS,
  '8 interceptors, 3 compact radars': [...ring('radar_s', 3, 500, 1), ...ring('interceptor', 8, 500, 0.3)],
  'Mixed': MIXED,
  '3 lasers, radar': [['radar', 400, 0], ...ring('laser', 3, 450, 0.3)],
  'One of everything, 3 lasers': [['radar', 600, 0], ...ring('radar_s', 2, 600, 1), ...ring('rf', 3, 900), ...ring('camera', 2, 700, 1), ...ring('jammer', 4, 800, 0.5), ...ring('interceptor', 6, 500, 0.2), ['missile', -400, 300], ...ring('laser', 3, 450, 0.3)],
  '5 lasers, radar, 2 compact radars': LASERS,
  '5 lasers, radar, 2 all-round compact radars': LASERS,
};
// Unit settings by laydown. Three panels close the gaps in the compact radars' cover, which is what lasers otherwise leak through.
const SETTINGS = { '5 lasers, radar, 2 all-round compact radars': { radar_s: { panels: 3 } } };
const SEEDS = ['1', '7', '42'], MAX_WAVES = 30;

const sim = createSimulation();
const rows = [];
for (const [name, laydown] of Object.entries(LAYDOWNS)) {
  const waves = [], left = [];
  for (const seed of SEEDS) {
    setUp(sim, { seed, laydown });
    for (const [id, kv] of Object.entries(SETTINGS[name] ?? {})) for (const s of sim.structures.filter((u) => u.def.id === id)) for (const [k, v] of Object.entries(kv)) sim.commands.configureUnit(s, k, v);
    sim.state.warnedWire = true;
    while (!sim.state.over && sim.state.wave < MAX_WAVES) { playWave(sim); sim.commands.resupply(); } // as a player would
    waves.push(sim.state.over ? sim.state.wave : `${MAX_WAVES}+`);
    left.push(`$${(sim.state.budget / 1e6).toFixed(1)}M`);
  }
  rows.push({ laydown: name, 'wave lost': waves.join(' / '), 'budget left': left.join(' / ') });
}
console.table(rows);
