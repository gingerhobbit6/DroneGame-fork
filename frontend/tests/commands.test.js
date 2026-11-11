// What players can do, through the command surface: placing, selling, wiring, the command log, sandbox and authority.

import { afterEach, describe, expect, it } from 'vitest';
import { createSimulation } from '../src/sim/simulation.js';
import { BUILD, COMMS, ECONOMY, FUSION, STRUCTURES, resetAllFigures } from '../src/sim/config/index.js';
import { MIXED, setUp, play } from './support/scenarios.js';

const sim = createSimulation();
const fresh = (laydown = []) => { setUp(sim, { seed: '1', laydown }); return sim; };
const u = (m) => m / 20;
afterEach(() => { FUSION.authority = 'auto'; });

// Put the operator's inputs back in at the same simulation steps.
function replayLog(log) {
  for (const { step, name, args } of log) {
    while (sim.stepCount() < step) sim.step();
    sim.commands[name](...args.map((a) => (a && a.node ? sim.net.nodes.get(a.node) : a)));
  }
}

describe('placing and selling', () => {
  it('charges the budget and refuses bad spots with a reason', () => {
    fresh();
    const before = sim.state.budget;
    expect(sim.commands.place('radar', u(500), 0)).toBeNull();
    expect(sim.state.budget).toBe(before - STRUCTURES.radar.cost);
    expect(sim.commands.place('radar', u(100), 0)).toMatch(/Too close to the station/);
    expect(sim.commands.place('radar', u(BUILD.maxDist + 100), 0)).toMatch(/Outside the build zone/);
    expect(sim.commands.place('rf', u(510), 0)).toMatch(/Too close to another/);
    expect(sim.canPlace(u(100), 0, STRUCTURES.radar)).toBe(false);
  });

  it('refuses a spot that is not a number, for systems and people', () => {
    fresh();
    const before = sim.state.budget;
    expect(sim.commands.place('radar', NaN, NaN)).toBe('Choose a spot on the map');
    expect(sim.commands.placePeople(u(500), Infinity, 10, 'open')).toBe('Choose a spot on the map');
    expect(sim.structures.length).toBe(0);
    expect(sim.people.length).toBe(0);
    expect(sim.state.budget).toBe(before);
  });

  it('refuses what cannot be afforded', () => {
    fresh();
    sim.state.budget = 10;
    expect(sim.commands.place('laser', u(500), 0)).toMatch(/Not enough budget/);
  });

  it('stops at as many systems as a save can hold', () => {
    fresh();
    sim.state.budget = 1e9;
    const free = [];
    for (let r = 300; free.length < BUILD.maxSystems + 1 && r < BUILD.maxDist; r += 70) {
      const n = Math.floor((2 * Math.PI * r) / 70); // evenly round the ring, so the last spot is as far from the first as any other
      for (let k = 0, a = 0; k < n; a = (2 * Math.PI * ++k) / n) if (sim.canPlace(u(r * Math.cos(a)), u(r * Math.sin(a)), STRUCTURES.acoustic_l)) free.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    for (const [x, z] of free.slice(0, BUILD.maxSystems)) expect(sim.commands.place('acoustic_l', u(x), u(z))).toBeNull();
    const [x, z] = free[BUILD.maxSystems];
    expect(sim.commands.place('acoustic_l', u(x), u(z))).toMatch(/No more than 200 systems/);
  });

  it('refunds a sale, including the terminal, and ignores a click on nothing', () => {
    fresh();
    sim.commands.place('radar', u(500), 0);
    sim.commands.wireNode(sim.structures[0], 'starlink');
    const after = sim.state.budget;
    sim.commands.sell(0, u(2000));
    expect(sim.structures.length).toBe(1);
    sim.commands.sell(u(500), 0);
    expect(sim.structures.length).toBe(0);
    expect(sim.state.budget).toBe(after + STRUCTURES.radar.cost + COMMS.starlink.cost);
  });

  it('locks the laydown and wiring once the first wave starts', () => {
    const toasts = [];
    sim.on('toast', (t) => toasts.push(t));
    fresh(MIXED);
    sim.state.warnedWire = true;
    sim.commands.startWave();
    expect(sim.designLocked()).toBe(true);
    expect(sim.commands.place('rf', u(1500), 0)).toMatch(/locked/);
    const n = sim.structures.length;
    sim.commands.sell(sim.structures[0].pos.x, sim.structures[0].pos.z);
    expect(sim.structures.length).toBe(n);
    expect(sim.commands.wireNode(sim.structures[0], null)).toBe(false);
    expect(sim.commands.wireFusion('starlink', false)).toBe(false);
    sim.commands.autoWire(); sim.commands.clearAll();
    sim.commands.setCellBand(sim.structures[0], 'n78');
    expect(sim.structures[0].cellBand).toBe('B8');
    expect(toasts.some((t) => /locked/.test(t))).toBe(true);
  });
});

describe('wiring', () => {
  it('charges and refunds terminals', () => {
    fresh();
    sim.addStructure('rf', u(800), 0);
    const s = sim.structures[0], before = sim.state.budget;
    expect(sim.unwired()).toContain(s);
    sim.commands.wireNode(s, 'cellular');
    expect(sim.state.budget).toBe(before - COMMS.cellular.cost);
    sim.commands.wireNode(s, 'starlink');
    expect(sim.state.budget).toBe(before - COMMS.starlink.cost);
    expect(sim.ledger.terminals).toMatchObject({ starlink: 2, cellular: 1 }); // the fusion node has one of each
    sim.commands.clearAll();
    expect(sim.state.budget).toBe(before + COMMS.starlink.cost + COMMS.cellular.cost);
    expect(sim.ledger.terminals).toEqual({ starlink: 0, cellular: 0 });
    expect(sim.unwired()).toContain(s);
  });

  it('refuses a terminal it cannot afford', () => {
    fresh();
    sim.addStructure('rf', u(800), 0);
    sim.commands.wireFusion('cellular', false);
    sim.state.budget = 1;
    expect(sim.commands.wireNode(sim.structures[0], 'starlink')).toBe(false);
    expect(sim.commands.wireFusion('cellular', true)).toBe(false);
  });

  it('warns once about unwired systems before starting', () => {
    fresh();
    sim.addStructure('rf', u(800), 0);
    sim.commands.clearAll();
    sim.state.warnedWire = false;
    sim.commands.startWave();
    expect(sim.state.wave).toBe(0);
    sim.commands.startWave();
    expect(sim.state.wave).toBe(1);
  });
});

describe('the command log', () => {
  it('reproduces a run with operator inputs during it', () => {
    fresh(MIXED);
    sim.state.warnedWire = true;
    sim.commands.startWave();
    sim.run(600);
    sim.commands.toggleJamBand(sim.structures.find((s) => s.jamBands), 'gnss', true);
    sim.commands.injectFault();
    sim.run(1500);
    const digest = sim.digest(), log = [...sim.log], steps = sim.stepCount();
    expect(log.map((e) => e.name)).toEqual(['setAuthority', 'setAutoStart', 'startWave', 'toggleJamBand', 'injectFault']);

    fresh(MIXED);
    sim.state.warnedWire = true;
    replayLog(log);
    while (sim.stepCount() < steps) sim.step();
    expect(sim.digest()).toBe(digest);
  }, 30000);

  it('time between later waves changes the run, and the log still reproduces it', () => {
    const run = (gap) => {
      fresh(MIXED);
      sim.state.warnedWire = true;
      sim.commands.startWave();
      sim.run(5000);
      sim.run(gap);
      sim.commands.startWave();
      sim.run(3000);
      return { digest: sim.digest(), log: [...sim.log], steps: sim.stepCount() };
    };
    const a = run(0), b = run(137);
    expect(a.digest).not.toBe(b.digest);
    fresh(MIXED);
    sim.state.warnedWire = true;
    replayLog(b.log);
    while (sim.stepCount() < b.steps) sim.step();
    expect(sim.digest()).toBe(b.digest);
  }, 60000);
});

describe('reset', () => {
  it('starts empty with clear, and restores wiring and bands with keep', () => {
    fresh(MIXED);
    const jammer = sim.structures.find((s) => s.jamBands);
    jammer.jamBands.add('gnss');
    const uplinks = sim.structures.map((s) => s.uplink).sort();
    sim.commands.reset('keep');
    expect(sim.structures.length).toBe(MIXED.length);
    expect(sim.structures.map((s) => s.uplink).sort()).toEqual(uplinks);
    expect(sim.structures.some((s) => s.jamBands && s.jamBands.has('gnss'))).toBe(true);
    sim.commands.reset('clear');
    expect(sim.structures.length).toBe(0);
    expect(sim.state.budget).toBe(ECONOMY.budget);
  });

  it('tells listeners when a run is rebuilt', () => {
    const events = [];
    sim.on('reset', (e) => events.push(e));
    fresh(MIXED);
    sim.state.warnedWire = true;
    events.length = 0;
    sim.commands.startWave();
    expect(events).toEqual([{ kept: true, begin: true, loading: false }]);
  });
});

describe('game over', () => {
  it('ends the run once, when the site is lost', () => {
    let overs = 0;
    sim.on('gameOver', () => { overs++; });
    fresh([['radar', 600, 0]]);
    play(sim, 8);
    expect(sim.state.over).toBe(true);
    expect(sim.state.health).toBe(0);
    expect(overs).toBe(1);
    const steps = sim.stepCount();
    sim.run(10);
    expect(sim.stepCount()).toBe(steps);
    const wave = sim.state.wave;
    sim.commands.startWave();
    expect(sim.state.wave).toBe(wave);
  }, 30000);
});

describe('auto-start', () => {
  it('starts the next wave by itself after a pause', () => {
    fresh(MIXED);
    sim.state.warnedWire = true;
    sim.commands.setAutoStart(true);
    sim.commands.startWave();
    for (let i = 0; i < 100 && sim.state.wave < 2; i++) sim.run(200);
    sim.commands.setAutoStart(false);
    expect(sim.state.wave).toBe(2);
  }, 30000);

  it('does not start it when unticked during the countdown', () => {
    fresh(MIXED);
    sim.state.warnedWire = true;
    sim.commands.setAutoStart(true);
    sim.commands.startWave();
    for (let i = 0; i < 100 && sim.state.waveActive; i++) sim.run(200);
    expect(sim.state.autoTimer).toBeGreaterThan(0); // counting down to wave 2
    sim.commands.setAutoStart(false);
    sim.run(400); // 20 s, well past the countdown
    expect(sim.state).toMatchObject({ wave: 1, waveActive: false });
  }, 30000);
});

describe('prices raised after buying', () => {
  afterEach(() => resetAllFigures());
  it('refuses the first wave while the laydown costs more than the budget, and says so', () => {
    fresh(MIXED);
    sim.state.warnedWire = true;
    const said = [], hear = (text) => said.push(text);
    sim.on('toast', hear);
    sim.commands.setFigure('structures', 'radar', 'cost', STRUCTURES.radar.cost * 30);
    sim.commands.startWave();
    sim.off('toast', hear);
    expect(sim.state.wave).toBe(0);
    expect(said.at(-1)).toMatch(/more than the .* budget at today's prices/);
    sim.commands.resetAllFigures();
    sim.commands.startWave();
    expect(sim.state).toMatchObject({ wave: 1, waveActive: true });
    expect(sim.state.budget).toBeGreaterThan(0);
  }, 30000);
});

describe('sandbox', () => {
  it('cannot damage the site or systems, and shots are free', () => {
    fresh([['radar', 600, 0], ['rf', 900, 0], ['missile', 490, 99]]); // a missile keeps to fixed-wing drones, so the small ones get through
    sim.commands.enterSandbox();
    expect(sim.state.sandbox).toBe(true);
    const budget = sim.state.budget;
    sim.commands.setSandboxLevel(4);
    sim.commands.launchSandboxWave();
    sim.commands.launchSandboxAttack({ type: 'fw', count: 8, bearingDeg: 'rand', gap: 0 }); // more than the missile's magazine, so some reach the site
    sim.commands.launchSandboxAttack({ type: 'fo', count: 2, bearingDeg: 90, gap: 0 });
    for (let n = 0; n < 30000 && (sim.drones.length || sim.state.sbQueue.length); n += 500) sim.run(500); // the fixed-wing come from the map edge
    expect(sim.state.health).toBe(100);
    expect(sim.structures.length).toBe(3);
    expect(sim.state.budget).toBe(budget);
    expect(sim.state.leaks).toBeGreaterThan(0);
    expect(sim.state.sbSpent).toBeGreaterThan(0);
    sim.commands.launchSandboxAttack({ type: 'fo', count: 2, bearingDeg: 90, gap: 0 });
    sim.run(40);
    expect(sim.drones.length).toBeGreaterThan(0);
    sim.commands.clearSandboxDrones();
    expect(sim.drones.length).toBe(0);
    expect(sim.ledger.flights.filter((f) => !f.end)).toHaveLength(0); // cleared away, so none stays airborne in the figures
    sim.commands.startWave();
    expect(sim.state.wave).toBe(0);
    sim.commands.exitSandbox();
    expect(sim.state.sandbox).toBe(false);
    expect(sim.structures.length).toBe(3);
  }, 30000);

  it('is only available before the first wave', () => {
    fresh(MIXED);
    sim.state.warnedWire = true;
    sim.commands.startWave();
    sim.commands.enterSandbox();
    expect(sim.state.sandbox).toBe(false);
  });
});

describe('engagement authority', () => {
  const pendingAfter = (steps) => {
    for (let i = 0; i < steps && !sim.net.pendingRequests.length; i++) sim.step();
    return sim.net.pendingRequests;
  };
  const armed = () => {
    fresh([['radar', 600, 0], ['rf', 900, 0], ['rf', -900, 0], ['interceptor', 490, 99], ['missile', -400, 300]]);
    sim.state.warnedWire = true;
    sim.commands.startWave();
  };

  it('asks before every engagement, and the answer is applied', () => {
    const asked = [];
    sim.on('approvalRequest', () => asked.push(1));
    FUSION.authority = 'all';
    armed();
    const list = pendingAfter(6000);
    expect(list.length).toBeGreaterThan(0);
    expect(asked.length).toBeGreaterThan(0);
    const req = list[0], effector = req.s, track = req.tr;
    sim.commands.decide(req.id, false);
    expect(effector.denied.has(track.id)).toBe(true);
    const next = pendingAfter(2000);
    if (next.length) sim.commands.decide(next[0].id, true);
    sim.commands.decide('no-such-request', true);
  }, 30000);

  it('only asks for costly shots in costly mode', () => {
    sim.commands.setAuthority('costly');
    expect(FUSION.authority).toBe('costly');
    armed();
    for (let i = 0; i < 5000; i++) {
      sim.step();
      for (const r of sim.net.pendingRequests) expect(r.s.def.shotCost).toBeGreaterThanOrEqual(FUSION.authorityThreshold);
    }
  }, 30000);

  it('does not act on an approval once the launcher can no longer take the shot', () => {
    FUSION.authority = 'all';
    armed();
    const req = pendingAfter(6000)[0], s = req.s;
    const engaged = () => sim.bus.entries.filter((e) => e.type === 'task' && e.to === s.nodeId && e.msg.task.command?.request === 'Engage').length;
    const before = engaged();
    expect(s.def.magazine).toBeGreaterThan(0);
    s.rounds = 0; // emptied while the operator decided
    sim.commands.decide(req.id, true);
    expect(engaged()).toBe(before);
    expect(s.task).toBeNull();
  }, 30000);

  it('does not act on an approval once another effector has the track, outside the critical zone', () => {
    FUSION.authority = 'all';
    armed();
    const req = pendingAfter(6000)[0], s = req.s, other = sim.structures.find((o) => o.def.role === 'effector' && o !== s);
    const engaged = () => sim.bus.entries.filter((e) => e.type === 'task' && e.to === s.nodeId && e.msg.task.command?.request === 'Engage').length;
    const before = engaged();
    expect(sim.net.siteDist(req.tr)).toBeGreaterThanOrEqual(FUSION.critZone);
    other.task = { id: 'taken', drone: req.tr.drone, trackId: req.tr.id, activeAt: 0 }; // it took the track while the operator decided
    sim.commands.decide(req.id, true);
    expect(engaged()).toBe(before);
    expect(s.task).toBeNull();
  }, 30000);

  it('lets an unanswered request lapse', () => {
    FUSION.authority = 'all';
    armed();
    const req = pendingAfter(6000)[0];
    sim.run(Math.ceil((FUSION.authorityTimeout + 1) / 0.05));
    expect(sim.net.pendingRequests).not.toContain(req);
  }, 30000);
});

describe('deploy', () => {
  it('reseeds and rebuilds the ground only when the seeds change', () => {
    const terrain = [];
    sim.on('terrain', () => terrain.push(sim.state.terrainSeed));
    fresh();
    sim.commands.deploy('1', sim.state.terrainSeed);
    expect(terrain).toEqual([]);
    sim.commands.deploy('2', 'other');
    expect(sim.state).toMatchObject({ seed: '2', terrainSeed: 'other', started: true });
    expect(terrain).toEqual(['other']);
    sim.commands.deploy('1', '1');
  });
});
