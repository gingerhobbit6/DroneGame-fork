import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PATROL, resetAllFigures } from '../src/sim/config/index.js';
import { createSimulation } from '../src/sim/simulation.js';
import { placeIn, soldierSpot } from '../src/sim/formation.js';
import { pickTarget } from '../src/sim/targeting.js';
import { addRoutePoint } from '../src/patrol-draw.js';
import { u } from '../src/sim/units.js';
import { setUp } from './support/scenarios.js';

const ROUTE = [[10, 10], [30, 10], [30, 30]]; // open, flat ground near the station on terrain 1, 800 m long
const SHORT = [[10, 10], [12, 10]]; // 40 m
let sim;
beforeEach(() => { sim = createSimulation(); setUp(sim, { seed: '1', laydown: [] }); });
afterEach(() => resetAllFigures());

const stepUntil = (done, max = 20000) => { for (let n = 0; n < max && !done(); n++) sim.step(); return done(); };

describe('out and back', () => {
  it('walks to the end, waits there, walks back, and holds at the start until the next wave', () => {
    sim.commands.setFigure('patrol', 'foot', 'endDelay', 10);
    sim.commands.setPatrol(SHORT);
    sim.commands.startWave();
    const p = sim.getPatrol();
    expect(stepUntil(() => p.phase === 'end')).toBe(true);
    expect(p.dist).toBe(p.ends.at(-1));
    const reached = sim.state.time;
    expect(stepUntil(() => p.phase === 'back')).toBe(true);
    expect(sim.state.time - reached).toBeCloseTo(10, 1);
    expect(stepUntil(() => p.phase === 'home')).toBe(true);
    expect([p.dist, p.trips]).toEqual([0, 1]);
    sim.run(200);
    expect(p.phase).toBe('home');
    sim.state.wave++; // the next wave
    sim.step();
    expect(p.phase).toBe('out');
    expect(sim.rec.events.filter((e) => e.type === 'patrol').map((e) => e.text)).toEqual(['Patrol set out', 'Patrol reached the end', 'Patrol heading back', 'Patrol back at the start', 'Patrol set out']);
  });

  it('keeps ahead and right the way it faces, walking back', () => {
    sim.commands.setPatrol(SHORT, [{ vehicle: 'hilux', system: 'rf', gap: 10, side: 10 }]);
    const p = sim.getPatrol();
    p.dist = u(20); p.dir = 1;
    const out = placeIn(p, 10, 10);
    p.dir = -1;
    const back = placeIn(p, 10, 10);
    expect([out.x - 11, out.z - 10]).toEqual([0.5, 0.5]); // ahead is east, right is south
    expect([back.x - 11, back.z - 10]).toEqual([-0.5, -0.5]);
  });
});

describe('the formation', () => {
  it('lays soldiers out in a file, a staggered column or a wedge behind the lead', () => {
    expect([1, 2].map((i) => soldierSpot('file', i, 5))).toEqual([{ along: -5, across: 0 }, { along: -10, across: 0 }]);
    expect([1, 2].map((i) => soldierSpot('staggered', i, 5))).toEqual([{ along: -2.5, across: 2.5 }, { along: -5, across: -2.5 }]);
    expect([1, 2, 3].map((i) => soldierSpot('wedge', i, 5))).toEqual([{ along: -5, across: 5 }, { along: -5, across: -5 }, { along: -10, across: 10 }]);
  });

  it('keeps its shape as it walks, and bends round a turn', () => {
    sim.commands.setPatrol(ROUTE, undefined, { width: 200, formation: 'wedge' });
    sim.commands.startWave(); // the first wave rebuilds the patrol
    const p = sim.getPatrol(), { spots } = p.group;
    p.dist = u(100); sim.step();
    expect([spots[2] - p.group.x, spots[3] - p.group.z].map((v) => +v.toFixed(3))).toEqual([-0.25, 0.25]); // behind and to the right
    p.dist = u(410); sim.step(); // the lead is past the corner, the soldiers behind are not
    expect(spots[2]).toBeCloseTo(29.75, 2); expect(spots[3]).toBeCloseTo(10.25, 2); // soldier 1 has turned the corner: right is now west
    expect(spots[22]).toBeCloseTo(29, 2); expect(spots[23]).toBeCloseTo(11.5, 5); // the last, 30 m back and 30 m right, is still on the first leg
  });

  it('refuses a corridor too narrow or wide, or a formation it does not know', () => {
    expect(sim.commands.setPatrol(ROUTE, undefined, { width: 5, formation: 'file' })).toMatch(/20 to 1000 m/);
    expect(sim.commands.setPatrol(ROUTE, undefined, { width: 200, formation: 'toString' })).toMatch(/formation/);
    expect(sim.getPatrol()).toBeNull();
  });
});

describe('the enemy search', () => {
  beforeEach(() => { sim.commands.setPatrol(ROUTE); sim.commands.startWave(); });

  it('finds the patrol with a spotter, then the fix goes stale once the spotter is gone', () => {
    const p = sim.getPatrol();
    expect(p.fix).toBeNull();
    const spotter = sim.spawnDrone('spotter', 0);
    expect(stepUntil(() => p.fix)).toBeTruthy();
    expect(spotter.found).toBe(true);
    expect(sim.rec.events.some((e) => e.text.endsWith('found the patrol'))).toBe(true);
    sim.drones.splice(sim.drones.indexOf(spotter), 1);
    const fixed = p.fix;
    sim.run(400);
    expect(p.fix).toBe(fixed); // nobody has seen it since
    expect(Math.hypot(p.group.x - fixed.x, p.group.z - fixed.z)).toBeGreaterThan(u(20));
    expect(pickTarget({ structures: sim.structures, patrol: p, state: sim.state }, sim.spawnDrone('fw', 0))).toMatchObject({ x: fixed.x, z: fixed.z });
  }, 30000);

  it('wastes a strike on a fix the patrol has walked away from', () => {
    const p = sim.getPatrol();
    p.fix = { x: p.group.x + u(200), z: p.group.z, t: 0 };
    const d = sim.spawnDrone('fw', 0);
    d.pos.set(p.fix.x + u(10), d.pos.y, p.fix.z);
    sim.step();
    expect(sim.drones).not.toContain(d);
    expect([sim.state.leaks, sim.state.health]).toEqual([0, 100]);
    expect(sim.rec.events.some((e) => e.type === 'miss')).toBe(true);
  });

  it('lets a strike with a camera see the patrol for itself when close', () => {
    const p = sim.getPatrol(), d = sim.spawnDrone('fpv', 0);
    d.pos.set(p.group.x + u(300), p.group.y + u(40), p.group.z);
    d.targetStructure = null;
    const aim = pickTarget({ structures: [], patrol: p, state: sim.state }, d);
    expect(aim).toMatchObject({ x: p.group.x, z: p.group.z, patrol: true });
  });

  it('sends a strike home once it has waited too long for a fix', () => {
    sim.commands.setFigure('patrol', 'enemy', 'holdTime', 20);
    const d = sim.spawnDrone('fw', 0);
    expect(stepUntil(() => !sim.drones.includes(d))).toBe(true);
    expect(sim.rec.events.some((e) => e.text.endsWith('gave up waiting for a fix'))).toBe(true);
  });
});

describe('drawing the route', () => {
  it('adds waypoints from the start, and finishes on a double-click at the end', () => {
    let r = addRoutePoint(null, 10, 10);
    r = addRoutePoint(r, 10.5, 10); // too close to count as a new point, and too short to finish
    expect(r).toEqual({ points: [[10, 10]], done: false });
    r = addRoutePoint(addRoutePoint(r, 20, 10), 20.5, 10);
    expect(r).toEqual({ points: [[10, 10], [20, 10]], done: true });
    expect(addRoutePoint(r, 40, 40)).toEqual({ points: [[40, 40]], done: false }); // a finished route starts again
  });
});

it('labels the enemy search figures as assumptions in the patrol figures', () => {
  expect(Object.keys(PATROL.enemy)).toEqual(expect.arrayContaining(['sightRange', 'strikeSight', 'holdRadius', 'holdTime']));
});
