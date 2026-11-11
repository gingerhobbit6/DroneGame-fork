import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIGURE_FIELDS, PATROL, PEOPLE_LIMITS, PATROL_VEHICLES, RESEARCHED, exportFigures, resetAllFigures } from '../src/sim/config/index.js';
import { createSimulation } from '../src/sim/simulation.js';
import { columnProblem, routeProblem } from '../src/sim/patrol.js';
import { inCorridor, nearest, pointAt } from '../src/sim/route.js';
import { placeIn } from '../src/sim/formation.js';
import { pickTarget } from '../src/sim/targeting.js';
import { u } from '../src/sim/units.js';
import { play, setUp } from './support/scenarios.js';

// Scene units on terrain 1: three sides of a 400 m square of open, flat ground near the station, walked from the first corner to the
// last, and one that runs into water.
const square = (cx, cz, r) => [[cx - r, cz - r], [cx + r, cz - r], [cx + r, cz + r], [cx - r, cz + r]];
const ROUTE = square(20, 20, 10);
const WET = square(40, 40, 10);
const FOOT = PATROL.foot;

let sim;
beforeEach(() => { sim = createSimulation(); setUp(sim, { seed: '1', laydown: [] }); });
afterEach(() => resetAllFigures());

describe('the route', () => {
  it('accepts a route on open ground', () => expect(routeProblem(ROUTE)).toBeNull());
  it('refuses water, the edge of the map and malformed waypoints', () => {
    expect(routeProblem(WET)).toMatch(/water/);
    expect(routeProblem(square(130, 0, 10)) ?? '').not.toMatch(/station|build zone/); // fine, or refused for the ground, never the distance
    expect(routeProblem(square(1370, 0, 10))).toMatch(/off the map/);
    expect(routeProblem([[1, 1]])).toMatch(/2 to 32/);
    expect(routeProblem([[1, 1], [2, 'x']])).toMatch(/2 to 32/);
    expect(routeProblem([[1, 1], [1, 1]])).toMatch(/no length/);
    expect(routeProblem('nonsense')).toMatch(/2 to 32/);
  });
  it('runs from its start to its end, and no further either way', () => {
    const p = { route: ROUTE, ends: [0, 20, 40, 60], width: 200 };
    expect(pointAt(p, 0)).toMatchObject({ x: 10, z: 10, dx: 1, dz: 0 });
    expect(pointAt(p, 30)).toMatchObject({ x: 30, z: 20, dx: 0, dz: 1 });
    expect(pointAt(p, 999)).toMatchObject({ x: 10, z: 30 });
    expect(pointAt(p, -5)).toMatchObject({ x: 10, z: 10 });
    expect(nearest(p, 20, 12)).toEqual({ along: 10, off: 2 });
  });
  it('has a corridor of its width along it, and no further', () => {
    const p = { route: ROUTE, ends: [0, 20, 40, 60], width: 200 }; // 5 scene units each side
    expect(inCorridor(p, 20, 14.9)).toBe(true);
    expect(inCorridor(p, 20, 4)).toBe(false);
    expect(inCorridor(p, 20, 20)).toBe(false); // the open side of the square is not walked
  });
});

describe('the column', () => {
  const COLUMN = [{ vehicle: 'themis', system: 'gun_hmg', gap: 25, side: 0 }, { vehicle: 'hilux', system: 'rf', gap: -30, side: -20 }, { vehicle: 'patria', system: 'missile_paladin', gap: -60, side: 15 }];

  it('brings each vehicle with its system, at its place in the formation and on the vehicle mast', () => {
    expect(sim.commands.setPatrol(ROUTE, COLUMN)).toBeNull();
    const p = sim.getPatrol();
    expect(p.escorts.map(({ s }) => [s.def.id, s.def.vehicle])).toEqual([['gun_hmg', 'themis'], ['rf', 'hilux'], ['missile_paladin', 'patria']]);
    for (const { s, gap, side } of p.escorts) { const q = placeIn(p, gap, side); expect([s.pos.x, s.pos.z]).toEqual([q.x, q.z]); }
    expect(p.escorts[1].s.def.mount).toBe(PATROL_VEHICLES.hilux.mast);
  });

  it('keeps the column when the route is redrawn, and in a saved laydown', () => {
    sim.commands.setPatrol(ROUTE, COLUMN);
    sim.commands.setPatrol(square(20, 20, 8));
    expect(sim.getPatrol().column).toEqual(COLUMN);
    const spec = JSON.parse(JSON.stringify(sim.currentLaydown()));
    expect(spec.patrolColumn).toEqual(COLUMN);
    expect(sim.commands.loadLaydown(spec, '1')).toBeNull();
    expect(sim.getPatrol().escorts.map(({ s }) => s.def.id)).toEqual(['gun_hmg', 'rf', 'missile_paladin']);
  });

  it('refuses what a vehicle cannot carry, too many vehicles, and a vehicle too far out', () => {
    expect(columnProblem([{ vehicle: 'themis', system: 'missile_paladin', gap: 0 }])).toMatch(/cannot carry/);
    expect(columnProblem([{ vehicle: 'hilux', system: 'missile_skysabre', gap: 0 }])).toMatch(/cannot ride/);
    expect(columnProblem([{ vehicle: 'toString', system: 'rf', gap: 0 }])).toMatch(/Choose a vehicle/);
    expect(columnProblem([{ vehicle: 'hilux', system: 'rf', gap: 250 }])).toMatch(/within 200 m/);
    expect(columnProblem(Array(7).fill(COLUMN[0]))).toMatch(/6 vehicles at most/);
    expect(columnProblem([])).toBeNull(); // soldiers alone, carrying nothing
    expect(columnProblem([{ vehicle: 'hilux', system: 'rf', gap: 0, side: 120 }])).toMatch(/100 m to the side/);
    expect(sim.commands.setPatrol(ROUTE, [{ vehicle: 'themis', system: 'missile_paladin', gap: 0 }])).toMatch(/cannot carry/);
    expect(sim.getPatrol()).toBeNull();
  });
});

describe('setting a patrol', () => {
  it('caps its people as any group is, whatever the figure says, and a bad figures file changes nothing', () => {
    expect(() => sim.commands.importFigures({ patrol: { foot: { groupSize: 1e9 } }, structures: { radar: { cost: 1 }, camera: null } })).toThrow();
    expect(FOOT.groupSize).toBe(RESEARCHED.patrol.foot.groupSize); // nothing applied, not even the parts before the bad one
    sim.commands.importFigures({ patrol: { foot: { groupSize: 1e9 } } });
    expect(sim.commands.setPatrol(ROUTE)).toBeNull();
    expect(sim.getPatrol().group.count).toBe(PEOPLE_LIMITS.perGroup);
  });
  it('adds the escort and the people, paid from the budget, and refunds them when cleared', () => {
    const before = sim.state.budget;
    expect(sim.commands.setPatrol(ROUTE)).toBeNull();
    const p = sim.getPatrol();
    expect(sim.structures.map((s) => s.def.id).sort()).toEqual(FOOT.column.map((e) => e.system).sort());
    expect(sim.structures.every((s) => s.escort && s.uplink === 'starlink')).toBe(true);
    expect(sim.people).toEqual([p.group]);
    expect(p.group.count).toBe(FOOT.groupSize);
    expect(p.group.role).toBe('military'); // drawn as soldiers
    expect(sim.state.budget).toBeLessThan(before);
    sim.commands.setPatrol(null);
    expect(sim.getPatrol()).toBeNull();
    expect(sim.structures).toHaveLength(0);
    expect(sim.people).toHaveLength(0);
    expect(sim.state.budget).toBe(before);
  });

  it('keeps the old route when a change is too dear, and a deployment pack only counts the cost', () => {
    const moved = square(22, 20, 10);
    expect(routeProblem(moved)).toBeNull();
    expect(sim.commands.setPatrol(ROUTE)).toBeNull();
    const dearer = [...FOOT.column, FOOT.column[0]];
    expect(columnProblem(dearer)).toBeNull();
    sim.state.budget = 0; // what is left once the escort is bought, so only the same escort is affordable
    expect(sim.commands.setPatrol(moved, dearer)).toMatch(/Not enough budget for the escort/);
    expect(sim.getPatrol().route).toEqual(ROUTE);
    sim.commands.setPacked(true);
    expect(sim.commands.setPatrol(moved, dearer)).toBeNull();
    expect(sim.getPatrol().route).toEqual(moved);
  });

  // on a vehicle's mast a system costs less (the default radar) or more (a small jammer on a Patria) than in the catalogue
  it.each([['the default column', FOOT.column], ['a jammer on a Patria', [{ vehicle: 'patria', system: 'jammer_s', gap: 40, side: 0 }]]])('checks %s at the price it is charged', (_, column) => {
    const full = sim.state.budget;
    expect(sim.commands.setPatrol(ROUTE, column)).toBeNull();
    const cost = full - sim.state.budget;
    sim.commands.setPatrol(null);
    sim.state.budget = cost;
    expect(sim.commands.setPatrol(ROUTE, column)).toBeNull();
    expect(sim.state.budget).toBe(0);
    expect(sim.structures.every((s) => s.def.networked === false || s.uplink === 'starlink')).toBe(true); // nothing left offline for want of a terminal
    sim.commands.setPatrol(null);
    sim.state.budget = cost - 1;
    expect(sim.commands.setPatrol(ROUTE, column)).toMatch(/Not enough budget for the escort/);
  });

  it('refuses a bad route, leaving nothing behind', () => {
    expect(sim.commands.setPatrol(WET)).toMatch(/water/);
    expect(sim.getPatrol()).toBeNull();
    expect(sim.structures).toHaveLength(0);
  });

  it('cannot be set beside a drawn area, or once the attack has started', () => {
    sim.commands.setZone(square(0, 0, 20));
    expect(sim.commands.setPatrol(ROUTE)).toMatch(/area to defend/);
    sim.commands.setZone(null);
    expect(sim.commands.setPatrol(ROUTE)).toBeNull();
    play(sim, 1);
    expect(sim.commands.setPatrol(null)).toMatch(/locked/);
    expect(sim.getPatrol()).not.toBeNull();
  });

  it('keeps its escort out of the sell tool', () => {
    sim.commands.setPatrol(ROUTE);
    const { s } = sim.getPatrol().escorts[0];
    sim.commands.sell(s.pos.x, s.pos.z);
    expect(sim.structures).toContain(s);
  });
});

describe('walking', () => {
  beforeEach(() => sim.commands.setPatrol(ROUTE));

  it('waits for the attack, then walks at its speed with the escort ahead and behind', () => {
    sim.run(100);
    expect(sim.getPatrol().dist).toBe(0);
    sim.commands.startWave();
    sim.run(200);
    const p = sim.getPatrol(), metres = p.dist * 20;
    expect(metres).toBeCloseTo(FOOT.walkSpeed * 200 * 0.05, 3);
    const at = placeIn(p, 0, 0);
    expect(p.group.x).toBeCloseTo(at.x); expect(p.group.z).toBeCloseTo(at.z);
    for (const { s, gap, side } of p.escorts) expect(s.pos.x).toBeCloseTo(placeIn(p, gap, side).x);
    expect(p.escorts.map((e) => e.gap)).toEqual([FOOT.escortGap, -FOOT.escortGap]); // one ahead, one behind
    expect(sim.state.zoneCentre).toEqual(at); // the fusion node measures from it
  });

  it('halts while its weapon is engaging', () => {
    sim.commands.startWave();
    const p = sim.getPatrol();
    sim.spawnDrone('fw', 0);
    const launcher = p.escorts[1].s;
    for (let n = 0; n < 20000 && !launcher.task; n++) sim.step(); // the Shahed class comes in from the edge, 27 km out
    expect(launcher.task).toBeTruthy();
    const held = p.dist;
    sim.step();
    expect(p.halted).toBe(true);
    expect(p.dist).toBe(held);
  });

  it('is what strike drones go for, once the enemy has a fix on it', () => {
    const fw = sim.spawnDrone('fw', 0), p = sim.getPatrol(), world = { structures: sim.structures, patrol: p, state: sim.state };
    expect(pickTarget(world, fw)).toMatchObject({ ...pointAt(p, p.ends.at(-1) / 2), hold: true }); // no fix: it waits mid-corridor
    p.fix = { x: 15, z: 11, t: 0 };
    expect(pickTarget(world, fw)).toMatchObject({ x: 15, z: 11, patrol: true });
  });
});

describe('a whole run', () => {
  it('is struck, can cause casualties, and plays out the same every time', () => {
    const digests = [0, 1].map(() => {
      setUp(sim, { seed: '1', laydown: [] });
      sim.commands.setPatrol(ROUTE);
      play(sim, 4);
      return sim.digest();
    });
    expect(digests[0]).toBe(digests[1]);
    expect(sim.rec.events.some((e) => e.text.endsWith('hit the patrol'))).toBe(true);
    expect(sim.state.casualties).toBeGreaterThan(0);
  }, 60000);

  it('lands a small drone among the people, not where it was when it came within reach', () => {
    sim.commands.setPatrol(ROUTE);
    sim.commands.startWave();
    sim.commands.setFigure('drones', 'fw', 'warhead', 1); // a 25 m injury radius
    const p = sim.getPatrol(), { group } = p, d = sim.spawnDrone('fw', 0);
    p.fix = { x: group.x, z: group.z, t: 0 };
    d.pos.set(group.x + u(29), d.pos.y, group.z); // inside the 30 m strike distance, beyond its 25 m injury radius
    sim.step();
    expect(sim.state.leaks).toBe(1);
    expect(sim.state.casualties).toBeGreaterThan(0);
  });

  it('saves as its route, and is rebuilt from it', () => {
    sim.commands.setPatrol(ROUTE);
    const spec = sim.currentLaydown();
    expect(spec.patrol).toEqual(ROUTE);
    expect(spec.patrolPlan).toEqual({ width: 200, formation: 'file', type: 'mixed', spacing: 5 });
    expect(spec.structures).toEqual([]);
    expect(spec.people).toBeUndefined();
    sim.commands.reset('clear');
    sim.state.started = true;
    expect(sim.commands.loadLaydown(spec, '1')).toBeNull();
    expect(sim.getPatrol().route).toEqual(ROUTE);
    expect(sim.structures).toHaveLength(2);
    sim.commands.reset('keep');
    expect(sim.getPatrol().route).toEqual(ROUTE);
    expect(sim.people).toHaveLength(1);
  });

  it('leaves out a saved route that is no longer walkable', () => {
    const spec = { ...sim.currentLaydown(), patrol: WET };
    expect(sim.commands.loadLaydown(spec, '1')).toBeNull();
    expect(sim.getPatrol()).toBeNull();
  });
});

describe('figures', () => {
  it('labels every patrol figure as an assumption, and leaves saved sets as they were until one is edited', () => {
    for (const key of Object.keys(RESEARCHED.patrol.foot)) expect(FIGURE_FIELDS[key].basis).toBe('assumption');
    expect(exportFigures().patrol).toBeUndefined();
    sim.commands.setFigure('patrol', 'foot', 'walkSpeed', 2);
    expect(exportFigures().patrol).toEqual({ foot: { walkSpeed: 2 } });
  });
});

describe('a strike on a patrol', () => {
  it('plans its descent over its distance to the patrol, not to the station', () => {
    expect(sim.commands.setPatrol(ROUTE)).toBeNull();
    const c = sim.state.zoneCentre;
    expect(Math.hypot(c.x, c.z)).toBeGreaterThan(u(100)); // the patrol starts well away from the station
    const d = sim.spawnDrone('fpv', 0, { jitter: 0, altFrac: 0.5, dist: 0.5 });
    expect(d.h0).toBeCloseTo(Math.hypot(d.launch.x - c.x, d.launch.z - c.z), 6);
  });
});
