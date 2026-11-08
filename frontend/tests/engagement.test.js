// The fusion node works from what its sensors report, and effectors engage only what is really at a track's position.

import { describe, expect, it } from 'vitest';
import { createSimulation } from '../src/sim/simulation.js';
import { STRUCTURES, TERRAIN } from '../src/sim/config/index.js';
import { terrainState } from '../src/sim/terrain.js';
import { MIXED, setUp } from './support/scenarios.js';

const sim = createSimulation();
const m = 20;
const LAY = 4; // seconds a laser takes to swing onto a new drone: fixed here, so dropping it makes the test fail
const SEEKER_LIMIT = 300; // a fixed number, not FUSION.acquireRadius, so widening the seeker makes these tests fail
const reports = (type) => sim.bus.entries.filter((e) => e.type === type).map((e) => e.msg[type]);
const start = (laydown, seed = '1') => {
  setUp(sim, { seed, laydown });
  sim.state.warnedWire = true;
  sim.commands.startWave();
};

describe('engagements', () => {
  it('only ever happen near a real drone', () => {
    start(MIXED);
    const seen = new Set();
    for (let n = 0; n < 40000 && !sim.state.over && seen.size <= 10; n++) {
      sim.step();
      if (!sim.state.waveActive) sim.commands.startWave();
      for (const s of sim.structures) {
        if (!s.task || seen.has(s.task.id)) continue;
        seen.add(s.task.id);
        const tr = sim.net.tracks.get(s.task.trackId), d = s.task.drone;
        const dist = Math.hypot(tr.est.east - d.pos.x * m, tr.est.north + d.pos.z * m, tr.est.up - d.pos.y * m);
        expect(dist).toBeLessThan(SEEKER_LIMIT + 50); // one step's movement after it was cued
      }
    }
    expect(seen.size).toBeGreaterThan(10);
  }, 60000);

  it('are refused when nothing is at the cued position', () => {
    start(MIXED);
    for (let n = 0; n < 13000; n++) { sim.step(); if (!sim.state.waveActive) sim.commands.startWave(); }
    const reasons = reports('task_ack').flatMap((a) => a.reason || []);
    expect(reasons).toContain('nothing found at the cued position');
  }, 60000);

  it('a refused track is not offered to that effector again straight away, and others still are', () => {
    start([['radar', 600, 0], ['rf', 900, 0], ['rf', -900, 0], ['camera', 378, 589], ['interceptor', 490, 99]]);
    const int = sim.structures.find((s) => s.def.id === 'interceptor');
    for (let n = 0; n < 13000 && int.rejected.size < 2; n++) sim.step();
    expect(int.rejected.size).toBeGreaterThan(1);
  }, 60000);
});

describe('engagement authority', () => {
  it('keeps an engagement going while a re-task to a more urgent drone waits for approval, one request at a time', () => {
    start(MIXED);
    sim.commands.setAuthority('all');
    let heldOn = 0;
    for (let n = 0; n < 12000 && !sim.state.over; n++) {
      sim.step();
      if (!sim.state.waveActive) sim.commands.startWave();
      const pending = [...sim.net.pendingRequests];
      for (const s of sim.structures) {
        const mine = pending.filter((p) => p.s === s);
        expect(mine.length).toBeLessThanOrEqual(1);
        if (mine.length && s.task) heldOn++;
      }
      // the first request each effector raises is approved, so later ones are re-tasks of a running engagement, left unanswered
      for (const req of pending) if (!req.s.task && !req.answered) { req.answered = true; sim.commands.decide(req.id, true); }
    }
    expect(heldOn).toBeGreaterThan(0);
    sim.commands.setAuthority('auto');
  }, 120000);
});

describe('tracks', () => {
  it('two bearing-only sensors cannot confirm a track, because their lines always cross somewhere', () => {
    start([['rf', 900, 0], ['rf', -900, 0], ['interceptor', 490, 99]]);
    sim.run(3000);
    expect(sim.state.kills).toBe(0);
    expect(reports('task').filter((t) => t.command && t.command.request === 'Engage').length).toBe(0);
  }, 30000);

  it('are drawn to a real drone only when one is at their position', () => {
    start(MIXED);
    let ghosts = 0;
    for (let n = 0; n < 6000; n++) {
      sim.step();
      if (n % 20) continue;
      for (const tr of sim.net.tracks.values()) {
        if (tr.est && !tr.drone) ghosts++;
        if (!tr.est || !tr.drone) continue;
        const d = tr.drone.pos;
        expect(Math.hypot(tr.est.east - d.x * m, tr.est.north + d.z * m, tr.est.up - d.y * m)).toBeLessThan(SEEKER_LIMIT);
      }
    }
    expect(ghosts).toBeGreaterThan(0);
  }, 60000);
});

describe('behaviour', () => {
  it('sensors no longer report what a target intends', () => {
    start(MIXED);
    sim.run(3000);
    const fromSensors = sim.bus.entries.filter((e) => e.type === 'detection_report' && e.from !== sim.net.fusion.nodeId);
    expect(fromSensors.length).toBeGreaterThan(0);
    for (const e of fromSensors) expect(e.msg.detection_report.behaviour).toBeUndefined();
  }, 30000);

  it('the fusion node recognises a spotter from how its track moves', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 2000, 0], ['radar', -2000, 0], ['radar', 0, 2000], ['radar', 0, -2000]] });
    sim.state.sandbox = true;
    const d = sim.spawnDrone('spotter', 0.7, {});
    let loiterAlert = false, loitering = false;
    while (d.mode !== 'egress' && !d.dead && !sim.state.over) {
      sim.step();
      loiterAlert ||= reports('alert').some((a) => /loitering/.test(a.description));
      loitering ||= reports('detection_report').some((r) => r.behaviour && r.behaviour[0].type === 'Loitering');
    }
    sim.state.sandbox = false;
    expect(loiterAlert).toBe(true);
    expect(loitering).toBe(true);
  }, 60000);

  it('a strike flying straight in is not called loitering', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 2000, 0], ['radar', -2000, 0], ['radar', 0, 2000], ['radar', 0, -2000]] });
    sim.state.sandbox = true;
    sim.spawnDrone('fw', 0.7, {});
    sim.run(14000); // from the map edge at this bearing it is 34 km out; this brings it to about 2 km
    sim.state.sandbox = false;
    expect(reports('alert').some((a) => /loitering/.test(a.description))).toBe(false);
    expect(reports('detection_report').some((r) => r.state && r.behaviour[0].type === 'Approaching')).toBe(true);
  }, 30000);
});

describe('radar over trees', () => {
  it('a radar mast clears the canopy that would otherwise block most low flyers', () => {
    expect(STRUCTURES.radar.mount).toBeGreaterThan(TERRAIN.canopyMax);
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0]] });
    const s = sim.structures[0], T3 = terrainState.data;
    let blocked = 0, total = 0;
    for (let a = 0; a < 72; a++) for (const r of [800, 1200, 1600]) {
      const x = s.pos.x * m + Math.cos(a * 0.087) * r, z = s.pos.z * m + Math.sin(a * 0.087) * r;
      const los = T3.los(s.pos.x * m, s.pos.y * m + STRUCTURES.radar.mount, s.pos.z * m, x, T3.groundAt(x, z) + 30, z);
      total++;
      if (los.canopy > TERRAIN.opticalCanopyTol) blocked++;
    }
    expect(blocked / total).toBeLessThan(0.25);
  });
});

describe('a beam weapon', () => {
  // Seconds from each new target to its beam going on, over the first few drones of a run.
  const waits = (id) => {
    start([['radar', 400, 0], [id, 430, 133]]);
    const s = sim.structures.find((u) => u.def.id === id), out = [];
    let on = null, since = null;
    for (let n = 0; n < 30000 && out.length < 3 && !sim.state.over; n++) {
      sim.step();
      if (s.laidOn !== on) { on = s.laidOn; since = on == null ? null : sim.state.time; }
      if (s.beamOn && since != null) { out.push(sim.state.time - since); since = null; }
    }
    return out;
  };

  it('swings onto each new drone before a laser fires, while an RF weapon fires at once', () => {
    const laser = waits('laser');
    expect(laser.length).toBe(3);
    for (const t of laser) expect(t).toBeGreaterThan(LAY - 0.05);
    const rf = waits('laser_rfdew');
    expect(rf.length).toBe(3);
    for (const t of rf) expect(t).toBe(0);
  });
});

describe('a track an effector found nothing at', () => {
  const HOLD = 10; // seconds: fixed here, so dropping the shared hold makes the test fail
  const stations = (n, r, off) => Array.from({ length: n }, (_, i) => { const a = off + (i / n) * Math.PI * 2; return ['acoustic_l', Math.cos(a) * r, Math.sin(a) * r]; });

  it('is offered to no effector for a while, so ghost tracks cannot tie up the launchers', () => {
    start([...MIXED, ...stations(6, 1200, 0.2), ...stations(6, 2200, 0.7)], '7'); // many bearing-only sensors make ghosts
    const trackOf = new Map(), sent = [], empty = [];
    const listen = (e) => {
      const task = e.type === 'task' && e.msg.task, ack = e.type === 'task_ack' && e.msg.task_ack;
      if (task?.command?.request === 'Engage') { trackOf.set(task.task_id, task.command.command_parameter); sent.push({ t: e.t, track: task.command.command_parameter }); }
      if (ack && (ack.reason || []).includes('nothing found at the cued position')) empty.push({ t: e.t, track: trackOf.get(ack.task_id) });
    };
    sim.bus.listeners.add(listen);
    try {
      for (let n = 0; n < 30000 && !sim.state.over; n++) { sim.step(); if (!sim.state.waveActive) sim.commands.startWave(); }
    } finally { sim.bus.listeners.delete(listen); }
    expect(empty.length).toBeGreaterThan(0);
    for (const e of empty) expect(sent.filter((x) => x.track === e.track && x.t > e.t && x.t < e.t + HOLD - 0.5)).toEqual([]);
  }, 120000);
});
