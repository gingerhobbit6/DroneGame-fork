// The simulation's findings from the November performance audit: figures that follow their edits, messages built from the figures,
// and work done once instead of every step without changing what happens.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DRONES, FUSION, resetAllFigures } from '../src/sim/config/index.js';
import { blast } from '../src/sim/config/real-drones.js';
import { bus } from '../src/sim/sapient.js';
import { createSimulation } from '../src/sim/simulation.js';
import { placeIn } from '../src/sim/formation.js';
import { u } from '../src/sim/units.js';
import { setUp } from './support/scenarios.js';

let sim;
beforeEach(() => { sim = createSimulation(); setUp(sim, { seed: '1', laydown: [] }); sim.state.budget = 1e9; });
afterEach(() => resetAllFigures());

describe("a drone's damage", () => {
  it('follows a warhead edit in the Sources tab or a figures file, and goes back with it', () => {
    expect([DRONES.spotter.damage, DRONES.fpv.damage, DRONES.fw.damage]).toEqual([0, 12, 30]);
    sim.commands.setFigure('drones', 'fpv', 'warhead', 16);
    expect(DRONES.fpv.damage).toBe(blast(16));
    sim.commands.importFigures({ drones: { shahed136: { warhead: 90 } } });
    expect(DRONES.shahed136.damage).toBe(blast(90));
    sim.commands.resetAllFigures();
    expect([DRONES.fpv.damage, DRONES.shahed136.damage]).toEqual([12, blast(DRONES.shahed136.warhead)]);
  });
});

describe("a radar's clutter status", () => {
  const statusOf = (s) => bus.entries.filter((e) => e.msg.node_id === s.nodeId && e.msg.status_report).at(-1).msg.status_report.status;
  const clutterSaid = (s) => statusOf(s).find((x) => x.status_type === 'STATUS_TYPE_CLUTTER')?.status_value;
  const nextStatus = () => sim.run(Math.ceil(FUSION.statusInterval / 0.05) + 1);

  it('says the clutter range as set on the radar and edited in the Sources tab', () => {
    const s = sim.addStructure('radar', u(800), 0);
    expect(clutterSaid(s)).toBe('Targets below 40 m masked beyond 500 m');
    expect(sim.commands.configureUnit(s, 'clutter', 'high')).toBeNull();
    nextStatus();
    expect(clutterSaid(s)).toBe('Targets below 40 m masked beyond 350 m');
    sim.commands.setFigure('structures', 'radar', 'lowRange', 1000);
    nextStatus();
    expect(clutterSaid(s)).toBe('Targets below 40 m masked beyond 700 m');
  });
  it('is not sent by a system with no clutter range', () => {
    expect(statusOf(sim.addStructure('camera', u(800), 0)).map((x) => x.status_type)).toEqual(['STATUS_TYPE_ILLUMINATION', 'STATUS_TYPE_WEATHER']);
  });
});

describe('a patrol', () => {
  const square = (cx, cz, r) => [[cx - r, cz - r], [cx + r, cz - r], [cx + r, cz + r], [cx - r, cz + r]];

  it('is placed again only when it moves or turns round', () => {
    expect(sim.commands.setPatrol(square(20, 20, 10))).toBeNull();
    sim.commands.startWave();
    const p = sim.getPatrol();
    Object.assign(p, { dist: p.ends.at(-1), phase: 'end', wait: 100 }); // at the end, waiting
    sim.step();
    const rev = sim.peopleRev();
    sim.run(20);
    expect(sim.peopleRev()).toBe(rev);
    p.wait = 0;
    sim.step(); // it turns for home, still where it was
    expect(p.dir).toBe(-1);
    expect(sim.peopleRev()).toBeGreaterThan(rev);
    expect(p.group.x).toBeCloseTo(placeIn(p, 0, 0).x);
    expect(sim.state.zoneCentre).toEqual(placeIn(p, 0, 0));
  });
});

describe('the replay record', () => {
  it('shares a system entry between snapshots while nothing about it changes', () => {
    const s = sim.addStructure('radar', u(800), 0);
    sim.run(20);
    const [a, b] = sim.rec.frames.slice(-2).map((f) => f.structs[0]);
    expect(b).toBe(a);
    s.health = 10;
    sim.run(10);
    const c = sim.rec.frames.at(-1).structs[0];
    expect(c).not.toBe(a);
    expect(c.health).toBe(10);
    expect(a.health).toBe(30);
  });
});
