// Jammer tactics beyond a barrage: turning a directional antenna onto the drone, spoofing GNSS, and taking a commercial drone over.

import { beforeEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { DRONES, WORLD, resetAllFigures } from '../src/sim/config/index.js';
import { jamming, noiseBands } from '../src/sim/jamming.js';
import { terrainState } from '../src/sim/terrain.js';
import { unitCost } from '../src/sim/unit-config.js';
import { createSimulation } from '../src/sim/simulation.js';
import { hereU, u } from '../src/sim/units.js';
import { setUp } from './support/scenarios.js';

let sim;
beforeEach(() => {
  resetAllFigures();
  sim = createSimulation({ seed: '1', terrainSeed: '1' });
  sim.state.budget = 1e9;
});
const placed = (id) => sim.structures.find((s) => s.def.id === id);

// A drone of this type hovering this far east (m) and north (m) of the station, 120 m up.
function hover(type, east, north) {
  const d = sim.spawnDrone(type, 0, { jitter: 0, altFrac: 0.5 }), x = u(east), z = -u(north);
  d.def = { ...d.def, speed: 0 };
  d.pos.set(x, hereU(x, z) + u(120), z);
  return d;
}

describe('a jammer on a pan-and-tilt head', () => {
  it('is turned onto a drone outside where its sector faced, and jams it', () => {
    setUp(sim, { seed: '1', laydown: [['radar', -600, 0], ['jammer_auds', 0, 300]] }); // 300 m south of the station, facing south
    sim.state.sandbox = true;
    const jammer = placed('jammer_auds');
    expect(sim.commands.configureUnit(jammer, 'antenna', 'sector')).toBeNull();
    const before = jammer.def.facing;
    hover('fpv7inch', -1200, -300); // due west of it
    let jammed = false;
    for (let n = 0; n < 400; n++) { sim.step(); jammed ||= jammer.mode === 'Jam'; } // it stops to listen between bursts
    expect(before).toBe(180);
    expect(jammer.def.facing).toBeGreaterThan(260); expect(jammer.def.facing).toBeLessThan(280);
    expect(jammed).toBe(true);
  }, 60000);

  it('stays where it faced if it has no pan-and-tilt head', () => {
    setUp(sim, { seed: '1', laydown: [['radar', -600, 0], ['jammer_l', 0, 300]] });
    sim.state.sandbox = true;
    const jammer = placed('jammer_l');
    expect(sim.commands.configureUnit(jammer, 'antenna', 'sector')).toBeNull();
    hover('fpv7inch', -1200, -300);
    sim.run(400);
    expect(jammer.def.facing).toBe(180);
    expect(jammer.mode).toBe('Standby'); // the drone is outside its sector
  }, 60000);
});

// A 3 km site jammer by the middle, switched on by hand, with these settings and these extra bands.
function jammerOn(settings, extra = []) {
  setUp(sim, { seed: '1', laydown: [] });
  sim.state.sandbox = true;
  const s = sim.addStructure('jammer_l', 0, u(100));
  for (const [k, v] of Object.entries({ trigger: 'manual', ...settings })) expect(sim.commands.configureUnit(s, k, v)).toBeNull();
  for (const b of extra) sim.commands.toggleJamBand(s, b, true);
  sim.commands.setJamming(s, true);
  return s;
}
// A drone of this type this far east of the jammer, 100 m up, launched 5 km further out.
function flying(s, type, metres) {
  const m = WORLD.metresPerUnit, z = s.pos.z * m, at = (xm) => new Vector3(xm / m, (terrainState.data.groundAt(xm, z) + 100) / m, z / m);
  const d = sim.spawnDrone(type, 0, { jitter: 0, altFrac: 0.5 });
  d.pos.copy(at(s.pos.x * m + metres)); d.launch = at(s.pos.x * m + metres + 5000);
  return d;
}

describe('GNSS spoofing', () => {
  it('turns a navigating drone steadily off course, and less one with anti-jam antennas, without jamming any link', () => {
    const s = jammerOn({ technique: 'spoof' }, ['gnss']);
    expect([...noiseBands(s)]).toEqual(['gnss']); // it deafens nothing of yours but GNSS
    const plain = flying(s, 'shahed136', 2000), shielded = flying(s, 'shahed136', 2000);
    plain.jamResist = 0; shielded.jamResist = 1;
    sim.run(200);
    expect(plain.nav).toBeGreaterThan(1); // a steady turn, not a random drift
    expect(plain.dead).toBe(false);
    expect(shielded.nav).toBe(0);
    expect(jamming(s, flying(s, 'fpv7inch', 500), sim.structures)).toBeNull(); // no satellite navigation to spoof
  });
});

describe('taking a drone over', () => {
  it('lands a commercial drone its library knows, whole, and leaves the rest alone', () => {
    const s = jammerOn({ technique: 'takeover', receiver: 'commercial' });
    expect([...noiseBands(s)]).toEqual([]);
    const mavic = flying(s, 'mavic3', 1500);
    expect(jamming(s, flying(s, 'fpv7inch', 500), sim.structures)).toBeNull(); // a hobby link
    for (let t = 0; t < 30 && !mavic.dead; t += 0.05) sim.step();
    expect(sim.ledger.killedBy.jammer?.mavic3).toBe(1);
    expect(sim.rec.events.some((e) => e.text === `${DRONES.mavic3.name} taken over and landed`)).toBe(true);
  });

  it('needs a receiver whose library knows the link, and costs more than a barrage', () => {
    const s = jammerOn({ technique: 'takeover', receiver: 'hobby' });
    expect(jamming(s, flying(s, 'mavic3', 1500), sim.structures)).toBeNull();
    expect(unitCost('jammer_l', { technique: 'takeover' })).toBeGreaterThan(unitCost('jammer_l', { technique: 'barrage' }));
  });
});
