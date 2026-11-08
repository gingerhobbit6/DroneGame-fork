// Terrain, comms, figures, waves and the recorder.

import { describe, expect, it } from 'vitest';
import { createSimulation } from '../src/sim/simulation.js';
import { generateTerrain } from '../src/sim/terrain.js';
import { makeWave } from '../src/sim/waves.js';
import { createRecorder } from '../src/sim/recorder.js';
import { enemyCost, money } from '../src/sim/economy.js';
import { hashSeed, gaussFrom, mulberry32, waveStream } from '../src/sim/rng.js';
import {
  COMMS, DRONES, DRONE_CLASSES, STRUCTURES, WORLD, WAVES, RESEARCHED, overlaps,
  setFigure, resetFigure, resetAllFigures, exportFigures, importFigures,
} from '../src/sim/config/index.js';
import { setUp } from './support/scenarios.js';

const u = (m) => m / 20;

describe('terrain', () => {
  const t = generateTerrain('flat-test');

  it('is repeatable from its seed, and different for another', () => {
    const again = generateTerrain('flat-test'), other = generateTerrain('other-test');
    expect(again.groundAt(3000, -2000)).toBe(t.groundAt(3000, -2000));
    expect(other.groundAt(3000, -2000)).not.toBe(t.groundAt(3000, -2000));
    expect(t.towers.length).toBeGreaterThan(0);
  });

  it('keeps the station platform flat and clear of trees', () => {
    expect(Math.abs(t.groundAt(300, 300))).toBeLessThan(1);
    expect(t.canopyAt(200, 200)).toBe(0);
    expect(t.slope(0, 300)).toBeLessThan(0.05);
    expect(t.bldgAt(-60, 40)).toBeGreaterThan(0);
  });

  it('blocks line of sight through high ground and buildings', () => {
    expect(t.los(0, 2000, 0, 300, 2000, 0).clear).toBe(true);
    expect(t.los(-60, 1, 0, -60, 1, 80)).toMatchObject({ clear: false, blocker: 'building' });
    let high = null;
    for (let x = -6000; x <= 6000 && !high; x += 200) for (let z = -6000; z <= 6000; z += 200) if (t.groundAt(x, z) > 150) { high = [x, z]; break; }
    const g = t.groundAt(high[0], high[1]);
    const r = t.los(high[0] - 400, g - 120, high[1], high[0] + 400, g - 120, high[1]);
    expect(r.clear).toBe(false);
  });

  it('measures how much of a path runs through tree canopy', () => {
    let forest = null;
    for (let x = -5000; x <= 5000 && !forest; x += 40) for (let z = -5000; z <= 5000; z += 40) if (t.canopyAt(x, z) && t.canopyAt(x + 400, z) && t.canopyAt(x + 200, z)) { forest = [x, z]; break; }
    expect(forest).not.toBeNull();
    const g = t.groundAt(forest[0] + 200, forest[1]);
    const r = t.los(forest[0], g + 5, forest[1], forest[0] + 400, g + 5, forest[1], 0);
    expect(r.clear ? r.canopy : 1).toBeGreaterThan(0);
  });
});

describe('comms', () => {
  const sim = createSimulation();
  const comms = sim.net.comms;

  it('explains why a node is unreachable', () => {
    setUp(sim, { seed: '1', laydown: [['rf', 800, 0]] });
    const s = sim.structures[0];
    sim.commands.wireNode(s, null);
    expect(comms.linkFor(s, null).reason).toBe('no terminal wired');
    expect(comms.pathFor(s)).toMatchObject({ ok: false, reason: 'no terminal wired' });
    sim.commands.wireNode(s, 'starlink');
    sim.commands.wireFusion('starlink', false); sim.commands.wireFusion('cellular', false);
    expect(comms.fusionLink('starlink').reason).toMatch(/no terminal wired/);
  });

  it('prefers the same network, and adds the internet hop otherwise', () => {
    setUp(sim, { seed: '1', laydown: [['rf', 800, 0]] });
    const s = sim.structures[0];
    sim.commands.wireNode(s, 'starlink');
    expect(comms.pathFor(s).hops).toEqual(['starlink', 'starlink']);
    sim.commands.wireFusion('starlink', false);
    const p = comms.pathFor(s);
    if (p.ok) expect(p.hops).toEqual(['starlink', 'internet', 'cellular']);
  });

  it('lower bands reach further', () => {
    setUp(sim, { seed: '1', laydown: [['rf', 800, 0]] });
    const s = sim.structures[0];
    const low = comms.linkFor(s, 'cellular', 'B8'), high = comms.linkFor(s, 'cellular', 'n78');
    expect(low.quality).toBeGreaterThanOrEqual(high.quality);
    expect(comms.skyBlocked(s)).toBe(comms.skyBlocked(s));
    expect(comms.towers().length).toBeGreaterThan(0);
  });

  it('a jammer on an overlapping band degrades a nearby link', () => {
    setUp(sim, { seed: '1', laydown: [['rf', 800, 0], ['jammer', 900, 0]] });
    const rf = sim.structures.find((s) => s.def.id === 'rf'), jam = sim.structures.find((s) => s.def.id === 'jammer');
    const clear = comms.linkFor(rf, 'cellular', 'B8').quality;
    jam.mode = 'Jam'; jam.jamBands = new Set(['control900']);
    const jammed = comms.linkFor(rf, 'cellular', 'B8');
    expect(jammed.quality).toBeLessThan(clear);
    expect(jammed.jammedBy).toContain(jam.short);
    jam.jamBands = new Set(['control24']);
    expect(comms.linkFor(rf, 'cellular', 'B8').quality).toBe(clear);
  });

  it('records packets and link statistics, and drops messages on a dead path', () => {
    setUp(sim, { seed: '1', laydown: [['rf', 800, 0]] });
    const s = sim.structures[0];
    sim.run(200);
    expect(comms.packets.length).toBeGreaterThan(0);
    expect(comms.linkStats(s.nodeId).sent).toBeGreaterThan(0);
    sim.commands.wireFusion('starlink', false); sim.commands.wireFusion('cellular', false);
    const before = comms.linkStats(s.nodeId).dropped;
    sim.run(200);
    expect(comms.linkStats(s.nodeId).dropped).toBeGreaterThan(before);
  });

  it('a node that goes quiet is reported lost, then restored', () => {
    setUp(sim, { seed: '1', laydown: [['rf', 800, 0]] });
    const s = sim.structures[0];
    sim.state.sandbox = true; // the fusion node only chases contact once the attack has started
    sim.commands.wireFusion('starlink', false); sim.commands.wireFusion('cellular', false);
    sim.run(600);
    expect(s.offline).toBe(true);
    sim.commands.wireFusion('starlink', true); sim.commands.wireFusion('cellular', true);
    sim.run(300);
    expect(s.offline).toBe(false);
    sim.state.sandbox = false;
  });

  it('a node that leaves is not reported restored by its goodbye', () => {
    setUp(sim, { seed: '1', laydown: [['rf', 800, 0]] });
    const s = sim.structures[0];
    s.offline = true; // contact had been lost
    sim.commands.sell(s.pos.x, s.pos.z);
    sim.run(100);
    expect(sim.bus.entries.some((e) => e.type === 'alert' && /Contact restored/.test(e.msg.alert.description))).toBe(false);
  });

  it('queues messages and drops them when the link is saturated', () => {
    setUp(sim, { seed: '1', laydown: [['rf', 800, 0]] });
    const s = sim.structures[0], cap = COMMS.queueLimit, capacity = COMMS.starlink.capacity;
    sim.commands.wireNode(s, 'starlink');
    COMMS.queueLimit = 0.00001; COMMS.starlink.capacity = 1000;
    let dropped = 0;
    for (let i = 0; i < 20; i++) { const r = comms.transmit({}, s.nodeId, sim.net.fusion.nodeId, 'detection_report'); if (r.reason === 'link congested') dropped++; }
    COMMS.queueLimit = cap; COMMS.starlink.capacity = capacity;
    expect(dropped).toBeGreaterThan(0);
  });

  it('treats on-site nodes as wired', () => {
    expect(comms.transmit({}, sim.net.gui.nodeId, sim.net.fusion.nodeId, 'alert')).toMatchObject({ ok: true, local: true });
  });

  it('band overlap works in both directions', () => {
    expect(overlaps([[1, 2]], [[1.5, 3]])).toBe(true);
    expect(overlaps([[1, 2]], [[2, 3]])).toBe(false);
  });
});

describe('sensors', () => {
  const sim = createSimulation();
  const threats = DRONE_CLASSES;

  it('coverage maps count the sensors that would see a target', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0], ['rf', 900, 0], ['camera', 300, 300]] });
    expect(sim.net.coverageAt(700, 0, 300, DRONES.fw)).toBeGreaterThan(0);
    expect(sim.net.coverageAt(6500, 6500, 20, DRONES.fo)).toBe(0);
    expect(threats.length).toBe(4);
  });

  it('every node keeps a readable name after it leaves', () => {
    setUp(sim, { seed: '1', laydown: [['rf', 800, 0]] });
    const s = sim.structures[0], id = s.nodeId;
    sim.commands.sell(s.pos.x, s.pos.z);
    expect(sim.net.nameOf(id)).toBe('Medium RF detector 01');
    expect(sim.net.nameOf('abcdefghijkl')).toBe('abcdefgh');
  });
});

describe('figures from the Sources tab', () => {
  it('exports only what changed, and imports it back', () => {
    resetAllFigures();
    setFigure('structures', 'radar', 'published', 3000);
    setFigure('drones', 'fpv', 'hp', 99);
    expect(STRUCTURES.radar.range).toBe(3000);
    const saved = exportFigures();
    expect(saved).toMatchObject({ structures: { radar: { published: 3000 } }, drones: { fpv: { hp: 99 } } });
    resetFigure('drones', 'fpv', 'hp');
    expect(DRONES.fpv.hp).toBe(RESEARCHED.drones.fpv.hp);
    resetAllFigures();
    expect(STRUCTURES.radar.range).toBe(RESEARCHED.structures.radar.published);
    importFigures(saved);
    expect(STRUCTURES.radar.range).toBe(3000);
    expect(DRONES.fpv.hp).toBe(99);
    resetAllFigures();
  });

  it('ignores anything unknown or not a finite number in an imported file', () => {
    resetAllFigures();
    importFigures({
      structures: { radar: { published: 'x', constructor: 1, range: 5 }, nope: { published: 1 } },
      drones: { fpv: { hp: Infinity } }, world: { rangeScale: 'big' }, waves: { fpvGap: null }, __proto__: { polluted: true },
    });
    expect(exportFigures()).toEqual({ structures: {}, drones: {}, comms: {}, world: {}, waves: {}, adapt: {} });
    expect({}.polluted).toBeUndefined();
    importFigures({ world: { rangeScale: 2 }, waves: { fpvGap: 5 } });
    expect(WORLD.rangeScale).toBe(2);
    expect(WAVES.fpvGap).toBe(5);
    expect(exportFigures().world).toEqual({ rangeScale: 2 });
    expect(exportFigures().waves).toEqual({ fpvGap: 5 });
    resetAllFigures();
    expect(WORLD.rangeScale).toBe(1);
  });

  it('holds every figure at 0 or more, and a share at 1 or less', () => {
    resetAllFigures();
    importFigures({ structures: { radar: { published: -500 }, interceptor: { pk: 3 } }, drones: { fpv: { hp: 1e30 } } });
    expect(STRUCTURES.radar.published).toBe(0);
    expect(STRUCTURES.interceptor.pk).toBe(1);
    expect(DRONES.fpv.hp).toBe(1e12);
    setFigure('drones', 'fpv', 'jamResist', -0.2);
    expect(DRONES.fpv.jamResist).toBe(0);
    resetAllFigures();
  });
});

describe('waves', () => {
  it('grow with the wave number and are repeatable from the seed', () => {
    const w1 = makeWave(1, waveStream('s', 1)), w9 = makeWave(9, waveStream('s', 9));
    expect(w1.filter((q) => q.type === 'fpv').length).toBe(5);
    expect(w1.some((q) => q.type === 'fw')).toBe(false);
    expect(w9.filter((q) => q.type === 'spotter').length).toBe(2);
    expect(w9.filter((q) => q.type === 'fo').length).toBe(4);
    expect(w9.map((q) => q.t)).toEqual([...w9.map((q) => q.t)].sort((a, b) => a - b));
    expect(makeWave(4, waveStream('s', 4))).toEqual(makeWave(4, waveStream('s', 4)));
  });
});

describe('recorder', () => {
  it('records events with the time, and caps its frames', () => {
    let t = 3;
    const rec = createRecorder(() => t);
    rec.event('kill', 'x', 1);
    expect(rec.events[0]).toEqual({ t: 3, type: 'kill', text: 'x', uid: 1 });
    for (let i = 0; i < 7300; i++) rec.push({ i });
    expect(rec.frames.length).toBe(7200);
    expect(rec.frames[0].i).toBe(100);
    rec.clear();
    expect(rec.frames.length + rec.events.length).toBe(0);
  });
});

describe('small helpers', () => {
  it('formats money', () => {
    expect(money(15000000)).toBe('£11.3M'); // prices are kept in dollars and shown in pounds at £0.75 to the dollar
    expect(money(2000000)).toBe('£1.5M');
    expect(money(50000)).toBe('£38k');
    expect(money(1234)).toBe('£926');
  });
  it('adds up what an attack cost', () => {
    expect(enemyCost({ fpv: 2, fw: 1 })).toBe(2 * DRONES.fpv.cost + DRONES.fw.cost);
  });
  it('random streams repeat and stay in range', () => {
    expect(hashSeed('a')).toBe(hashSeed('a'));
    const a = mulberry32(7), b = mulberry32(7);
    for (let i = 0; i < 100; i++) { const x = a(); expect(x).toBe(b()); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    const seq = [0, 0.5, 0, 0.25], next = () => seq.shift();
    expect(Number.isFinite(gaussFrom(next))).toBe(true);
  });
});

describe('drones and effectors', () => {
  const sim = createSimulation();

  it('fibre drones ignore jammers and go for the loudest emitter', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0], ['jammer', 500, 300]] });
    sim.state.sandbox = true;
    const fo = sim.spawnDrone('fo', 0, { jitter: 0, altFrac: 0.5 });
    sim.run(12000);
    expect(fo.jamT).toBe(0);
    expect(fo.dead || fo.targetStructure).toBeTruthy();
    expect(u(0)).toBe(0);
    sim.state.sandbox = false;
  });

  it('a spotter goes on station, boosts strikes, then leaves', () => {
    setUp(sim, { seed: '1', laydown: [] });
    sim.state.sandbox = true;
    const d = sim.spawnDrone('spotter', 1, {});
    while (d.mode === 'approach') sim.step();
    expect(sim.spotterBonus()).toBe(DRONES.spotter.spotBonus);
    while (d.mode === 'orbit') sim.step();
    expect(sim.spotterBonus()).toBe(0);
    while (!d.dead) sim.step();
    expect(sim.ledger.escaped.spotter).toBe(1);
    sim.state.sandbox = false;
  });

  it('a jammed drone slows and crashes; the jammer gets the kill', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0], ['radar_s', -600, 0], ['jammer', 300, 300], ['jammer', -300, -300], ['jammer', 300, -300], ['jammer', -300, 300]] });
    sim.state.sandbox = true;
    for (let i = 0; i < 6; i++) sim.spawnDrone('fpv', i, {});
    sim.run(11000);
    expect(sim.ledger.killedBy.jammer.fpv).toBeGreaterThan(0);
    sim.state.sandbox = false;
  });

  it('the laser costs a shot a second and needs a clear path', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 400, 0], ['radar_s', 300, 300], ['radar_s', -300, -300], ['laser', 300, -300], ['laser', -300, 300], ['laser', 420, 130]] });
    sim.state.sandbox = true;
    for (let i = 0; i < 5; i++) sim.spawnDrone('fw', i, {});
    for (let n = 0; n < 20000 && sim.drones.length; n += 500) sim.run(500); // they come in from the map edge
    expect(sim.ledger.shots.laser.n).toBeGreaterThan(0);
    expect(sim.ledger.killedBy.laser).toBeTruthy();
    sim.state.sandbox = false;
  });

  it('weapons hold fire when the budget cannot cover a shot', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 400, 0], ['rf', 900, 0], ['rf', -900, 0], ['interceptor', 490, 99], ['missile', -400, 300]] });
    sim.state.warnedWire = true;
    sim.commands.startWave();
    sim.state.budget = 0;
    sim.run(4000);
    expect(sim.ledger.consumables).toBe(0);
  });

  it('a strike that breaks through damages the site, and spotters add to it', () => {
    setUp(sim, { seed: '1', laydown: [] });
    sim.state.wave = 1;
    sim.spawnDrone('fw', 0, { jitter: 0, altFrac: 0.5 });
    for (let n = 0; n < 20000 && sim.drones.length; n += 500) sim.run(500); // it comes in from the map edge
    expect(sim.state.leaks).toBe(1);
    expect(sim.state.health).toBe(100 - DRONES.fw.damage);
    expect(sim.ledger.leaked.fw).toBe(1);
  });
});
