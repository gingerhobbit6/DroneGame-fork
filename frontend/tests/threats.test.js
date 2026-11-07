// The fusion node's threat library, and what it does with it: jam only what a jammer can touch, and leave a drone to a jammer that has
// time to break its link.

import { afterEach, describe, expect, it } from 'vitest';
import { FUSION, resetAllFigures } from '../src/sim/config/index.js';
import { threatLibrary } from '../src/sim/network/threats.js';
import { createSimulation } from '../src/sim/simulation.js';
import { setUp } from './support/scenarios.js';
import { terrainState } from '../src/sim/terrain.js';
import { makeWorld } from '../src/sim/world.js';

const realTerrain = terrainState.data;
afterEach(() => { terrainState.data = realTerrain; resetAllFigures(); });

// Open, flat ground with no trees, wide enough for every drone's run in, so every jammer's reach is its open-field range.
function openGround() {
  const R = 7000, cell = 50, N = Math.round((2 * R) / cell) + 1, zero = () => new Uint8Array(N * N);
  terrainState.data = makeWorld({ seed: 'open', N, cell, R, ground: new Float32Array(N * N), canopy: zero(), bldg: zero(), cover: zero(), buildings: [], lines: [], towers: [], station: [] });
}

describe('the threat library', () => {
  const believe = threatLibrary();

  it('knows a named model by its own figures', () => {
    const kvn = believe({ model: 'KVN', airframe: 'Multirotor' }), fpv = believe({ model: '7-inch quad', airframe: 'Multirotor' });
    expect(kvn.jammable).toBe(false); // fibre-optic: nothing to jam
    expect(fpv.breakable).toBe(true);
    expect([...fpv.bands].sort()).toEqual(['control24', 'video58']);
    expect(believe({ model: 'Shahed-136', airframe: 'Fixed wing' }).harm).toBeGreaterThan(believe({ model: 'Mavic 3', airframe: 'Multirotor' }).harm);
  });

  it('cannot count on jamming a drone it has only named the airframe of, or not at all', () => {
    const quad = believe({ airframe: 'Multirotor' }), unknown = believe({ airframe: 'Unknown' });
    expect(quad.breakable).toBe(false); // it might be fibre-optic
    expect(quad.jammable).toBe(true); // but it might not
    expect(unknown.jammable).toBe(true);
    expect(unknown.model).toBeUndefined();
  });
});

describe('the fusion node with its threat library', () => {
  const run = (laydown, attack, steps, seed = '1', open = false) => {
    const sim = createSimulation();
    if (open) openGround();
    setUp(sim, { seed, laydown });
    sim.state.warnedWire = true;
    sim.commands.setAttack(attack);
    sim.commands.startWave();
    return { sim, step: (fn) => { for (let n = 0; n < steps && !sim.state.over; n++) { sim.step(); if (!sim.state.waveActive) sim.commands.startWave(); fn?.(); } } };
  };
  const jammers = (sim) => sim.structures.filter((s) => s.def.kind === 'jammer');

  it('leaves a commercial drone to a jammer that has time on its way in, until it comes close or the jammer has had its chance', () => {
    // on open ground a 3 km jammer near the middle has every way in for far longer than it needs
    const { sim, step } = run([['radar', 600, 0], ['rf', 300, 0], ['jammer_l', 0, 100], ['interceptor', 200, 0], ['interceptor', -200, 0]], ['mavic3'], 30000, '1', true);
    let early = 0, engaged = 0;
    const seen = new Set();
    step(() => {
      for (const s of sim.structures) {
        if (s.def.kind !== 'interceptor' || !s.task || seen.has(s.task.id)) continue;
        seen.add(s.task.id); engaged++;
        const tr = sim.net.tracks.get(s.task.trackId);
        const given = tr.jamSince != null && sim.state.time - tr.jamSince >= FUSION.softKillWait - 1; // a jammer has had its chance
        if (tr.model === 'Mavic 3' && sim.net.siteDist(tr) >= FUSION.critZone && !given) early++;
      }
    });
    expect((sim.ledger.killedBy.jammer?.mavic3 ?? 0) + (sim.ledger.turned.mavic3 ?? 0)).toBeGreaterThan(0); // the jammers do the work: down, or turned for home
    expect(engaged).toBeGreaterThan(0);
    expect(early).toBe(0);
  }, 120000);

  it('keeps a jammer off for a drone it knows is fibre-optic', () => {
    const { sim, step } = run([['radar', 600, 0], ['camera', 300, 300], ['camera', -300, -300], ['jammer', 0, 300], ['jammer', 0, -300]], ['kvn', 'fpv7inch'], 30000, '7');
    let pointless = 0, fibreOnly = 0;
    const since = new Map(); // when each jammer last had only fibre-optic drones near it
    step(() => {
      for (const j of jammers(sim)) {
        const near = [...sim.net.tracks.values()].filter((tr) => tr.status === 'confirmed' && !tr.killWatch && sim.net.distToTrack(j, tr) <= j.def.range);
        if (!near.length || !near.every((tr) => tr.model === 'KVN')) { since.delete(j); continue; }
        if (!since.has(j)) since.set(j, sim.state.time);
        if (sim.state.time - since.get(j) < 3) continue; // a switch off takes a tasking pass and the network to arrive
        fibreOnly++;
        if (j.mode === 'Jam') pointless++;
      }
    });
    expect(fibreOnly).toBeGreaterThan(0); // there were times when only fibre-optic drones were near it
    expect(pointless).toBe(0);
  }, 120000);
});
