// What a drone does when a jammer cuts its links: one flown by hand comes down, one that flies itself turns for home (or drifts down
// without its satellite navigation), a homing module carries it through the last 500 m, anti-jam antennas cut its drift, and a
// reactive jammer cannot follow a link that hops frequency.

import { Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { DRONES, WORLD, resetAllFigures } from '../src/sim/config/index.js';
import { jamming } from '../src/sim/jamming.js';
import { createSimulation } from '../src/sim/simulation.js';
import { terrainState } from '../src/sim/terrain.js';
import { u } from '../src/sim/units.js';
import { setUp } from './support/scenarios.js';

const m = () => WORLD.metresPerUnit;
let sim;
beforeEach(() => {
  resetAllFigures();
  sim = createSimulation({ seed: '1', terrainSeed: '1' });
  setUp(sim, { seed: '1', laydown: [] });
  sim.state.budget = 1e9; sim.state.sandbox = true; sim.state.started = true;
});

// A 3 km site jammer by the middle, switched on by hand, on its usual bands and any others given.
function jammerOn(extra = []) {
  const s = sim.addStructure('jammer_l', 0, u(100));
  expect(sim.commands.configureUnit(s, 'trigger', 'manual')).toBeNull();
  for (const b of extra) sim.commands.toggleJamBand(s, b, true);
  sim.commands.setJamming(s, true);
  return s;
}
// A drone of this type this far east of the jammer, 100 m up, launched 5 km further out.
function eastOf(s, type, metres) {
  const z = s.pos.z * m(), at = (xm) => new Vector3(xm / m(), (terrainState.data.groundAt(xm, z) + 100) / m(), z / m());
  return { def: DRONES[type], pos: at(s.pos.x * m() + metres), launch: at(s.pos.x * m() + metres + 5000) };
}
function flying(s, type, metres) {
  const d = sim.spawnDrone(type, 0, { jitter: 0, altFrac: 0.5 }), at = eastOf(s, type, metres);
  d.pos.copy(at.pos); d.launch = at.launch;
  return d;
}
const until = (done, seconds) => { for (let t = 0; t < seconds && !done(); t += 0.05) sim.step(); };

describe('a drone whose links are jammed', () => {
  it('comes down if it is flown by hand', () => {
    const d = flying(jammerOn(), 'fpv7inch', 1500);
    until(() => d.dead, 30);
    expect(sim.ledger.killedBy.jammer?.fpv7inch).toBe(1);
  });

  it('turns for home if it flies itself, and leaves without being a kill', () => {
    const d = flying(jammerOn(), 'mavic3', 1500);
    until(() => d.mode === 'home', 30);
    expect(d.mode).toBe('home');
    expect(sim.ledger.turned.mavic3).toBe(1);
    const out = d.pos.distanceTo(sim.state.zoneCentre);
    sim.run(200);
    expect(d.pos.distanceTo(sim.state.zoneCentre)).toBeGreaterThan(out); // going away, not on to the site
    until(() => d.dead, 900);
    expect(sim.ledger.escaped.mavic3).toBe(1);
    expect(sim.ledger.killed.mavic3 ?? 0).toBe(0);
  });

  it('drifts down instead if its satellite navigation is jammed too', () => {
    const d = flying(jammerOn(['gnss']), 'mavic3', 1500);
    until(() => d.dead, 30);
    expect(sim.ledger.killedBy.jammer?.mavic3).toBe(1);
    expect(sim.ledger.turned.mavic3 ?? 0).toBe(0);
  });

  it('is only blinded if it flies itself and loses just its video', () => {
    const d = flying(jammerOn(), 'spotter', 1500); // its control link is on 900 MHz, which this jammer leaves alone
    sim.run(600);
    expect(d.dead).toBe(false);
    expect(d.videoJammed).toBe(true);
  });

  it('flies on by itself over the last 500 m with a homing module', () => {
    const s = jammerOn();
    const plain = flying(s, 'fpv7inch', 450);
    until(() => plain.dead, 30);
    expect(sim.ledger.killedBy.jammer?.fpv7inch).toBe(1); // without one, it is still brought down this close
    const homing = flying(s, 'fpvlastmile', 450);
    until(() => homing.dead, 60);
    expect(sim.ledger.killedBy.jammer?.fpvlastmile ?? 0).toBe(0);
    expect(homing.targetStructure ?? sim.ledger.leaked.fpvlastmile).toBeTruthy(); // it got through
  });

  it('drifts less with anti-jam antennas, and not at all with perfect ones', () => {
    const s = jammerOn(['gnss']);
    const plain = flying(s, 'shahed136', 2000), shielded = flying(s, 'shahed136', 2000);
    plain.jamResist = 0; shielded.jamResist = 1;
    sim.run(100);
    expect(plain.nav).not.toBe(0);
    expect(shielded.nav).toBe(0);
  });
});

describe('a reactive jammer', () => {
  it('cannot follow a link that hops frequency, which a barrage still jams', () => {
    const s = jammerOn();
    for (const [k, v] of [['receiver', 'full'], ['technique', 'reactive']]) expect(sim.commands.configureUnit(s, k, v)).toBeNull();
    expect(DRONES.molniya2.hops).toBe(true);
    expect(jamming(s, eastOf(s, 'fpv', 800), sim.structures)).not.toBeNull();
    expect(jamming(s, eastOf(s, 'molniya2', 800), sim.structures)).toBeNull();
    sim.commands.configureUnit(s, 'technique', 'barrage');
    expect(jamming(s, eastOf(s, 'molniya2', 800), sim.structures)).not.toBeNull();
  });
});
