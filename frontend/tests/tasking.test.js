// How the fusion node shares its effectors out: nothing more for a track reported destroyed, one effector a track outside the
// critical zone even when one switches target, and a jammer left on through a gap in a track's updates.

import { afterEach, describe, expect, it } from 'vitest';
import { createSimulation } from '../src/sim/simulation.js';
import { FUSION } from '../src/sim/config/index.js';
import { hereU, u } from '../src/sim/units.js';
import { JAMMERS, LASERS, MIXED, setUp } from './support/scenarios.js';

const sim = createSimulation();
const CRIT = 800; // metres: fixed here, so moving FUSION.critZone makes these tests fail
const M = 20;

// Plays waves, calling onTask for each task the fusion node sends, at the moment it is sent.
function watch(laydown, seed, waves, onTask) {
  setUp(sim, { seed, laydown });
  sim.state.warnedWire = true;
  const listen = (e) => { if (e.type === 'task') onTask(e.msg.task, sim.net.nodes.get(e.msg.destination_id)); };
  sim.bus.listeners.add(listen);
  try {
    for (let w = 0; w < waves && !sim.state.over; w++) {
      sim.commands.startWave();
      for (let n = 0; sim.state.waveActive && !sim.state.over && n < 60000; n++) sim.step();
    }
  } finally { sim.bus.listeners.delete(listen); }
}
const engaged = (task) => task.command?.request === 'Engage' && sim.net.tracks.get(task.command.command_parameter);

describe('sharing out the effectors', () => {
  it('sends no effector at a track already reported destroyed', () => {
    let sent = 0;
    const late = [];
    watch(LASERS, '42', 3, (task) => {
      const tr = engaged(task);
      if (!tr) return;
      sent++;
      if (tr.killWatch) late.push(tr.short);
    });
    expect(sim.state.kills).toBeGreaterThan(10); // kills were reported, so tracks went on watch
    expect(sent).toBeGreaterThan(10);
    expect(late).toEqual([]);
  }, 120000);

  it('keeps to one effector a track outside the critical zone, also when one switches target', () => {
    let sent = 0;
    const doubled = [];
    watch(LASERS, '42', 3, (task, to) => {
      const tr = engaged(task);
      if (!tr) return;
      sent++;
      const far = Math.hypot(tr.est.east, tr.est.north) > CRIT + 50; // the station is the middle of the map
      if (far && sim.structures.some((s) => s !== to && s.task?.trackId === tr.id)) doubled.push(tr.short);
    });
    expect(sent).toBeGreaterThan(10);
    expect(doubled).toEqual([]);
  }, 120000);

  it('lets a refused effector try another track in the same pass, and leaves the refused track open', () => {
    const refusedAt = new Map(), second = [];
    let step = -1;
    setUp(sim, { seed: '1', laydown: MIXED });
    sim.state.warnedWire = true;
    const listen = (e) => {
      const now = sim.stepCount();
      if (now !== step) { step = now; refusedAt.clear(); }
      if (e.type === 'task_ack' && e.msg.task_ack.task_status === 'TASK_STATUS_REJECTED') refusedAt.set(e.msg.node_id, now);
      if (e.type === 'task' && e.msg.task.command?.request === 'Engage' && refusedAt.get(e.msg.destination_id) === now) second.push(now);
    };
    sim.bus.listeners.add(listen);
    try {
      for (let w = 0; w < 4 && !sim.state.over; w++) {
        sim.commands.startWave();
        for (let n = 0; sim.state.waveActive && !sim.state.over && n < 60000; n++) sim.step();
      }
    } finally { sim.bus.listeners.delete(listen); }
    expect(second.length).toBeGreaterThan(0); // before, a refusal cost the effector the whole pass
  }, 120000);
});

describe('a drone flying away', () => {
  it('is left alone when only the middle of the map lies ahead of it', () => {
    // The area is 6 km east of the middle of the map, where the fusion node and the perimeter sensor are. The radar and the laser are
    // east of the drone, which flies west: away from the area and from both of them, and towards the middle.
    setUp(sim, { seed: '1', laydown: [] });
    sim.commands.setZone([[275, -25], [325, -25], [325, 25], [275, 25]]);
    sim.addStructure('radar', 300, 0);
    sim.addStructure('laser', 302, 5);
    sim.commands.autoWire();
    sim.state.sandbox = true; // a drone put up by hand
    const d = sim.spawnDrone('fpv', Math.PI);
    d.pos.set(250, hereU(250, 0) + u(150), 0);
    d.mode = 'home'; // as one that lost its link and turned for home: straight away from the area
    let departing = 0;
    for (let n = 0; n < 1200 && !d.dead; n++) {
      sim.step();
      if (d.track?.status === 'confirmed' && d.track.closing < -FUSION.minClosing) departing++;
    }
    expect(sim.ledger.shots.laser).toBeUndefined(); // before, the laser burned it down: it was heading for 'one of your systems'
    expect(d.dead).toBe(false);
    expect(departing).toBeGreaterThan(400); // and it was tracked, and seen to be going, for most of the minute
  }, 60000);
});

describe('asking the operator', () => {
  afterEach(() => { FUSION.authority = 'auto'; });

  it('asks once for a track outside the critical zone, however many effectors could take it', () => {
    setUp(sim, { seed: '1', laydown: MIXED });
    sim.state.warnedWire = true;
    FUSION.authority = 'all';
    let asked = 0;
    const twice = [];
    const onAsk = () => { // raised as each request is made, with the track where the fusion node then believed it to be
      const pending = sim.net.pendingRequests, req = pending.at(-1);
      asked++;
      if (sim.net.siteDist(req.tr) >= CRIT && pending.some((p) => p !== req && p.tr.id === req.tr.id)) twice.push(`${req.tr.short} by ${req.s.short}`);
    };
    sim.on('approvalRequest', onAsk);
    try {
      for (let w = 0; w < 2 && !sim.state.over; w++) {
        sim.commands.startWave();
        for (let n = 0; sim.state.waveActive && !sim.state.over && n < 60000; n++) {
          sim.step();
          // answered after 3 s, as an operator would be: long enough for the next pass to offer the track again, and approvals bring re-tasks
          for (const req of [...sim.net.pendingRequests]) if (sim.state.time - req.t0 >= 3) sim.commands.decide(req.id, true);
        }
      }
    } finally { sim.off('approvalRequest', onAsk); }
    expect(asked).toBeGreaterThan(10);
    expect(twice).toEqual([]);
  }, 120000);
});

describe('a jammer the fusion node switches', () => {
  it('is not stood down while a track it was on is only coasting', () => {
    let standbys = 0;
    const early = [];
    watch(JAMMERS, '1', 1, (task, to) => { // wave 1 is all first-person-view drones, each with a link to break
      if (task.command?.mode_change !== 'Standby') return;
      standbys++;
      const near = [...sim.net.tracks.values()].filter((tr) => tr.status === 'coasting' && !tr.killWatch
        && Math.hypot(tr.est.east - to.pos.x * M, tr.est.north + to.pos.z * M) < to.def.range * 0.9);
      if (near.length) early.push(`${to.short} at ${sim.state.time.toFixed(1)} s`);
    });
    expect(sim.ledger.jamTime.jammer).toBeGreaterThan(0); // they were switched on
    expect(standbys).toBeGreaterThan(0); // and off again once the drones had gone
    expect(early).toEqual([]);
  }, 120000);
});
