// Plays one design on one seed with no browser, and records every wave. One simulation per call site: the sim keeps its random
// streams and settings at module level, so two runs in one thread must go one after another. The pool in pool.mjs gives each
// thread its own copy.

import { createSimulation, SIM_STEP } from '../../src/sim/simulation.js';
import { ECONOMY, BUILD, SITE, GAME_VERSION } from '../../src/sim/config/index.js';
import { enemyCost } from '../../src/sim/economy.js';
import { OFFS, problem } from './model.mjs';

const MAX_WAVE_SECONDS = 3000; // game seconds a wave may run before it is cut off, as the balance tool does (60000 steps of 0.05 s)

export function createRunner() {
  const sim = createSimulation();
  BUILD.spacing = 4; // systems on one vehicle sit metres apart; problem() enforces the real gap between separate sites

  // Puts a design on the ground, wired to Starlink, before any wave. Returns { error } or { capex, tags, retag, expected }.
  function build(design, seed, budget) {
    const bad = problem(design);
    if (bad) return { error: bad };
    ECONOMY.budget = budget;
    sim.state.seed = String(seed); sim.commands.reset('clear'); sim.state.started = true;
    if (design.attack?.length) { const refused = sim.commands.setAttack(design.attack); if (refused) return { error: refused }; } // which drones the waves send; the default is the four generic types
    const tags = new Map(), keyOf = (st) => `${st.def.id}@${Math.round(st.pos.x * 20)},${Math.round(st.pos.z * 20)}`;
    const retag = () => { for (const st of sim.structures) { const t = tags.get(keyOf(st)); if (t != null) st.platform = t; } }; // the first wave rebuilds the laydown and drops our tags
    let expected = 0;
    for (const [i, v] of design.vehicles.entries()) {
      const [x, z] = v.at;
      for (const [k, [id, settings]] of v.sys.entries()) {
        const p = sim.commands.place(id, (x + OFFS[k][0]) / 20, (z + OFFS[k][1]) / 20, settings);
        if (p) return { error: `vehicle ${i} ${id}: ${p}` };
        const s0 = sim.structures[sim.structures.length - 1]; s0.platform = i; tags.set(keyOf(s0), i); expected++;
      }
      const r = Math.hypot(x, z), b = design.bunker ?? 15; // the crew's bunker, on the station side of the vehicle
      const pp = sim.commands.placePeople((x - (x / r) * b) / 20, (z - (z / r) * b) / 20, 4, 'bunker', 'military');
      if (pp) return { error: `bunker ${i}: ${pp}` };
    }
    for (const [id, x, z, settings] of design.remote || []) {
      const p = sim.commands.place(id, x / 20, z / 20, settings);
      if (p) return { error: `remote ${id} at ${x},${z}: ${p}` };
    }
    // Starlink on every node: with jammers about, cellular is jammed by our own jammers (868 and 915 MHz overlap cellular band 8).
    for (const st of sim.structures) sim.commands.wireNode(st, 'starlink');
    sim.commands.wireFusion('starlink', true);
    sim.state.warnedWire = true;
    return { capex: ECONOMY.budget - sim.state.budget, retag, expected };
  }

  // The design as the game's own saved laydown, ready to load in the browser (Saved tab, Import). Nothing is played.
  function exportLaydown(design, name, { seed = 1, budget = 7_000_000 } = {}) {
    const b = build(design, seed, budget);
    if (b.error) return { error: b.error };
    return { name, world: '1', game_version: GAME_VERSION, spec: JSON.parse(JSON.stringify(sim.currentLaydown())), seed: String(seed), capex: b.capex };
  }

  // opts: maxWaves (stop here if the site still stands), budget, dt (game seconds per step)
  function evaluate(design, seed, { maxWaves = 45, budget = 7_000_000, dt = SIM_STEP } = {}) {
    const t0 = Date.now();
    const b = build(design, seed, budget);
    if (b.error) return { invalid: b.error };
    const { capex, retag, expected } = b;

    const alive = () => new Set(sim.structures.filter((s) => s.platform != null).map((s) => s.platform)).size;
    const perWave = [];
    let firstVehicleLost = null, steps = 0, prevLeaks = {}, prevKills = 0;
    const cap = Math.ceil(MAX_WAVE_SECONDS / dt);
    while (!sim.state.over && sim.state.wave < maxWaves) {
      sim.commands.startWave(); retag();
      if (sim.state.wave === 1) {
        if (sim.structures.filter((st) => st.platform != null).length !== expected) return { invalid: 'systems lost in the first rebuild' };
        if (sim.people.length !== design.vehicles.length) return { invalid: 'bunkers lost in the first rebuild' };
      }
      for (let n = 0; sim.state.waveActive && !sim.state.over && n < cap; n++) { sim.step(dt); steps++; }
      const leaked = { ...sim.ledger.leaked }, leaks = {};
      for (const [t, c] of Object.entries(leaked)) if (c - (prevLeaks[t] || 0)) leaks[t] = c - (prevLeaks[t] || 0);
      perWave.push({
        wave: sim.state.wave, health: Math.max(0, sim.state.health), leaks, kills: sim.state.kills - prevKills, spent: ECONOMY.budget - sim.state.budget,
        systems: sim.structures.length, vehicles: alive(),
      });
      prevLeaks = leaked; prevKills = sim.state.kills;
      if (firstVehicleLost == null && alive() < design.vehicles.length) firstVehicleLost = sim.state.wave;
      if (!sim.state.over) sim.commands.resupply();
    }
    return {
      seed: String(seed), wave: sim.state.wave, over: sim.state.over, capex, spent: ECONOMY.budget - sim.state.budget,
      destroyed: enemyCost(sim.ledger.killed), // what the enemy drones stopped were worth, in the game's own prices
      health: Math.max(0, sim.state.health) / SITE.maxHealth, killed: sim.state.killed, injured: sim.state.injured,
      vehiclesLeft: alive(), firstVehicleLost, leaked: { ...sim.ledger.leaked }, perWave, steps, ms: Date.now() - t0,
    };
  }
  return { evaluate, exportLaydown, sim };
}
