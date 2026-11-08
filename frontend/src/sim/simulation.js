// The simulation: rules only, with no rendering and no UI, so a full game can run in Node. It exposes three small surfaces:
//  - commands: everything that changes the game, logged by simulation step so a run can be reproduced
//  - state and collections: read by the rendering and the UI, which never change them
//  - on(event, fn): moments the rendering and UI need to hear about (explosion, toast, siteHit, gameOver, reset, terrain, sandbox...)

import { ADAPT, ECONOMY, FUSION, RESEARCHED, SITE, WAVES, WORLD, applyRangeScale, exportFigures, importFigures, resetAllFigures, resetFigure, setFigure } from './config/index.js';
import { hashSeed, seedAll } from './rng.js';
import { generateTerrain, terrainState } from './terrain.js';
import { cutWorld, parseWorldId, siteProblem } from './world-pack.js';
import { bus } from './sapient.js';
import { createNetwork } from './network/index.js';
import { createRecorder, takeSnapshot, SNAPSHOT_EVERY } from './recorder.js';
import { runRecord } from './run-record.js';
import { SITE_POS, u } from './units.js';
import { DEFAULT_MIX } from './attack-mix.js';
import { affordable, createLedger, resetLedger, tally } from './economy.js';
import * as laydown from './laydown.js';
import { designLocked } from './lock.js';
import { siteIsFree } from './attack-area.js';
import * as people from './people.js';
import { setPatrol, updatePatrol } from './patrol.js';
import { spawnDrone, removeDrone, updateDrones, spotterBonus } from './drones.js';
import { opticalLos, updateStructures, updateMissiles, enoughInAir } from './effectors.js';
import { canFire, resupply } from './magazine.js';
import { startWave, updateWaves } from './waves.js';
import { deploymentReport } from './report.js';
import { enterSandbox, launchSandboxWave, launchSandboxAttack, clearSandboxDrones } from './sandbox.js';

export const SIM_STEP = 0.05; // fixed simulation step in game seconds, so a run does not depend on frame rate

// shortcut: bus, clock, terrainState and the random streams are module-level singletons, so only one simulation can exist at a time. Pass them in if parallel runs are ever needed.
// What a run starts with, and a reset goes back to. The seeds, the start, the conditions and the pack stay across a reset.
const freshRun = () => ({
  health: SITE.maxHealth, budget: ECONOMY.budget, wave: 0, kills: 0, leaks: 0, hits: 0, casualties: 0, killed: 0, injured: 0, time: 0, warnedWire: false, over: false,
  waveActive: false, queue: [], waveTime: 0, autoTimer: -1, zone: null, zoneCentre: SITE_POS, attack: DEFAULT_MIX,
  sandbox: false, sbLevel: 1, sbQueue: [], sbTime: 0, sbSpent: 0, // sandbox: attacks without consequences, before the first wave
  ended: false, // the operator ended the deployment
});

export function createSimulation({ seed = '1', terrainSeed = '1' } = {}) {
  const listeners = new Map();
  const packs = new Map(); // real-world map packs the rules can cut from, by hash
  const emit = (event, payload) => { for (const fn of listeners.get(event) || []) fn(payload); };
  const on = (event, fn) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); };
  const off = (event, fn) => { listeners.get(event)?.delete(fn); };

  seedAll(seed);
  terrainState.data = generateTerrain(terrainSeed);

  const state = {
    seed, terrainSeed, ...freshRun(), started: false, autoStart: false, conditions: 'day',
    packed: false, kit: null, // packed: a deployment pack is in use, so the budget only counts; kit: how many of each system it holds
  };
  const w = { state, drones: [], structures: [], missiles: [], people: [], peopleUid: 0, peopleRev: 0, patrol: null, ledger: createLedger(), emit, droneUid: 0, startLaydown: null, startFigures: null, runEnded: false };
  laydown.applyConditions(w, 'day'); // the conditions are module state that physics reads: a new simulation starts on a clear day
  w.rec = createRecorder(() => state.time);
  w.net = createNetwork({
    drones: w.drones,
    getTime: () => state.time,
    siteCentre: () => state.zoneCentre,
    onFalseAlarm(id) { tally((w.ledger.falseAlarms[state.wave] ||= {}), id); },
    zone: () => state.zone, // the drawn area's outline, or null
    expected: () => state.attack, // the drones the waves send: what an unnamed track is judged to be
    monitoring: () => state.wave > 0 || state.sandbox, // the fusion node only chases lost contact once the attack has started
    onApprovalRequest() { emit('approvalRequest'); emit('toast', 'Engagement request: your decision is needed'); },
    onApprovalDecided() { emit('approvalDecided'); },
    onKillConfirmed(tr) { w.rec.event('confirmed', `Kill confirmed on ${tr.short}`); },
    roundsCover: (s, d) => !!d && !d.dead && enoughInAir(w, s, d), // enough on the way that this launcher can look for another target
    // An effector decides whether it can take a task from the fusion node.
    acceptTask(s, d) {
      if (!d || d.dead) return { ok: false, empty: true, reasons: ['nothing found at the cued position'] };
      if (s.pos.distanceTo(d.pos) > u(s.def.range)) return { ok: false, reasons: ['target outside effector range'] };
      if (!opticalLos(s, d)) return { ok: false, reasons: ['no line of sight to target'] };
      if (s.def.engages && !s.def.engages.includes(d.def.variantOf ?? d.type)) return { ok: false, permanent: true, reasons: ['target outside engagement envelope (too fast or too high for this interceptor)'] };
      if (!affordable(w, s)) return { ok: false, reasons: ['insufficient budget for this shot'] };
      if (!canFire(s)) return { ok: false, reasons: [s.reload > 0 ? 'reloading' : 'out of rounds'] };
      return { ok: true };
    },
  });
  w.net.init();

  let stepCount = 0;
  function step(dt = SIM_STEP) {
    state.time += dt;
    updateWaves(w, dt, beginRun);
    updatePatrol(w, dt);
    w.net.update(dt);
    updateStructures(w, dt);
    updateMissiles(w, dt);
    updateDrones(w, dt);
    if (++stepCount % SNAPSHOT_EVERY === 0) w.rec.push(takeSnapshot(w));
    if (state.over) endRun(); // the site falls during a step, so the record waits for it to finish and replays reach the same state
  }

  // Start the run again from the beginning, on the same seed. 'keep' rebuilds the laydown the run started with (or the
  // current one, before any wave); 'clear' starts empty; 'load' also starts empty, for a saved laydown about to be restored.
  function resetRun(mode = 'keep', begin = false) {
    endRun();
    const spec = mode === 'keep' ? w.startLaydown || laydown.captureLaydown(w) : null;
    w.startLaydown = null; w.runEnded = false;
    for (const s of w.structures.slice()) laydown.removeStructure(w, s);
    for (const d of w.drones.slice()) removeDrone(w, d);
    w.missiles.length = 0;
    people.clearPeople(w);
    w.patrol = null; // its escort and people went with the rest
    Object.assign(state, freshRun());
    laydown.applyConditions(w, 'day'); // a kept laydown brings its own back
    resetLedger(w.ledger);
    w.rec.clear(); stepCount = 0; w.droneUid = 0;
    log.length = 0;
    seedAll(state.seed);
    w.net.init();
    if (spec) laydown.restoreLaydown(w, spec);
    emit('reset', { kept: !!spec, begin, loading: mode === 'load' });
  }

  // The first wave starts from a clean rebuild, so time spent building (sensor sweeps, random draws, messages) cannot affect the run.
  // Time between later waves is an operator input: it changes the run's noise, and is captured by the command log.
  function beginRun() {
    resetRun('keep', true);
    state.warnedWire = true;
    w.startLaydown = laydown.captureLaydown(w);
    w.startFigures = exportFigures();
    // settings from before the rebuild that still apply, so the log alone can reproduce the run
    log.push({ step: 0, name: 'setAuthority', args: [FUSION.authority] }, { step: 0, name: 'setAutoStart', args: [state.autoStart] });
    if (state.packed) log.push({ step: 0, name: 'setPacked', args: [state.kit ?? true] });
  }

  // A run that has started is reported once, however it ends.
  function endRun() {
    if (state.wave === 0 || w.runEnded) return;
    w.runEnded = true;
    emit('runEnded', runRecord(w, log, stepCount, digest()));
  }

  // The operator stands the deployment down: the run ends as if lost, and the report shows.
  function endDeployment() {
    if (state.wave === 0 || state.over || state.sandbox) return;
    state.over = true; state.ended = true;
    endRun();
    emit('gameOver');
  }

  // Replace the current run with a saved laydown, on the ground it was made for. Returns the reason if it can't.
  function loadLaydown(spec, world) {
    const problem = worldProblem(world) || (state.packed ? null : laydown.costProblem(spec));
    if (problem) return problem;
    endRun();
    setWorld(world);
    resetRun('load');
    laydown.restoreLaydown(w, spec);
    return null;
  }
  function setWorld(terrainSeed) {
    if (terrainSeed === state.terrainSeed) return;
    state.terrainSeed = terrainSeed;
    const real = parseWorldId(terrainSeed);
    terrainState.data = real ? cutWorld(packs.get(real.hash), real.e0, real.n0, terrainSeed) : generateTerrain(terrainSeed);
    emit('terrain');
  }
  // Why this world can't be used, or null. Nothing has changed if it can't.
  function worldProblem(world) {
    const real = parseWorldId(world);
    if (!real) return null;
    const pack = packs.get(real.hash);
    return pack ? siteProblem(pack, real.e0, real.n0) : 'The map pack for this world is not loaded.';
  }

  // Nothing has happened yet, so re-seeding, restarting the network and rebuilding the ground are all safe.
  function deploy(newSeed, newTerrainSeed) {
    const problem = worldProblem(newTerrainSeed);
    if (problem) return problem;
    const realInvolved = !!parseWorldId(newTerrainSeed) || !!parseWorldId(state.terrainSeed);
    if (newSeed !== state.seed) { state.seed = newSeed; seedAll(newSeed); w.net.init(); }
    setWorld(newTerrainSeed);
    if (realInvolved) { seedAll(state.seed); w.net.init(); } // the nodes must register with this world's position and bearing datum
    state.started = true;
    return null;
  }

  // Back to the start screen. The world stays until the next deploy replaces it.
  function leave() { resetRun('load'); state.started = false; }

  // ---------- commands ----------
  const log = []; // [{ step, name, args }]: this run's operator inputs. Systems are logged by node id.
  const logged = (fns) => Object.fromEntries(Object.entries(fns).map(([name, fn]) => [name, (...args) => {
    const result = fn(...args);
    log.push({ step: stepCount, name, args: args.map((a) => (a && a.nodeId ? { node: a.nodeId } : a)) });
    return result;
  }]));
  const commands = logged({
    deploy,
    leave,
    setZone: (points) => laydown.setZone(w, points),
    setPatrol: (points, column, plan) => setPatrol(w, points, column, plan),
    setAttack: (ids) => laydown.setAttack(w, ids),
    setConditions: (name) => laydown.setConditions(w, name),
    place: (id, x, z, settings, vehicle) => laydown.place(w, id, x, z, settings, vehicle),
    sell: (x, z) => laydown.sell(w, x, z),
    placePeople: (x, z, count, protection, role) => people.placePeople(w, x, z, count, protection, role),
    removePeople: (id) => people.removePeople(w, id),
    resupply: () => resupply(w),
    startWave: () => startWave(w, beginRun),
    reset: (mode) => resetRun(mode),
    setAutoStart: (on) => { state.autoStart = on; },
    setPacked: (kit) => laydown.setPacked(w, kit),
    endDeployment,
    setAuthority: (mode) => { FUSION.authority = mode; },
    decide: (id, approve) => w.net.decide(id, approve),
    injectFault: () => w.net.injectFault(),
    clearMessages: () => { bus.entries.length = 0; },
    wireNode: (s, kind) => laydown.wireNode(w, s, kind),
    wireFusion: (kind, on) => laydown.wireFusion(w, kind, on),
    setCellBand: (s, band) => laydown.setCellBand(w, s, band),
    setFusionCellBand: (band) => laydown.setFusionCellBand(w, band),
    toggleJamBand: (s, band, on) => laydown.toggleJamBand(w, s, band, on),
    setJamming: (s, on) => laydown.setJamming(w, s, on),
    configureUnit: (s, key, value) => laydown.configureUnit(w, s, key, value),
    renameUnit: (s, name, callsign) => laydown.renameUnit(w, s, name, callsign),
    autoWire: () => laydown.autoWire(w),
    clearAll: () => laydown.clearWires(w),
    enterSandbox: () => enterSandbox(w),
    exitSandbox: () => { resetRun('keep'); emit('toast', 'Sandbox closed: run reset, laydown kept'); },
    setSandboxLevel: (n) => { state.sbLevel = n; },
    launchSandboxWave: () => launchSandboxWave(w),
    launchSandboxAttack: (attack) => launchSandboxAttack(w, attack),
    clearSandboxDrones: () => clearSandboxDrones(w),
    loadLaydown,
    // figures change results, so changing them is logged like any other input
    setFigure: (kind, id, key, value) => setFigure(kind, id, key, value),
    resetFigure: (kind, id, key) => resetFigure(kind, id, key),
    resetAllFigures: () => resetAllFigures(),
    applyFigures: (figures) => { resetAllFigures(); importFigures(figures); },
    importFigures: (figures) => importFigures(figures),
    setRangeScale: (v) => { WORLD.rangeScale = v; applyRangeScale(); },
    setFpvGap: (v) => { WAVES.fpvGap = v; },
    setAdapt: (key, v) => { if (Object.hasOwn(RESEARCHED.adapt, key)) ADAPT[key] = v; },
  });

  // FNV-1a over the messages still kept (the newest bus.max at most), plus the headline numbers: a fingerprint of a run.
  function digest() {
    const parts = bus.entries.map((e) => JSON.stringify(e.msg)), feed = (s) => parts.push(s);
    feed(JSON.stringify([state.kills, state.health, state.budget, state.leaks, state.time, bus.seq, { ...w.ledger, jamTime: undefined, flights: undefined, falseAlarms: undefined }])); // these came later: left out so recorded digests still match
    if (w.people.length) feed(JSON.stringify(w.people.map((g) => g.hits))); // with no people, a run's digest stays as it was
    if (w.patrol) feed(JSON.stringify([w.patrol.dist, w.patrol.phase, w.patrol.trips, w.patrol.fix]));
    return hashSeed(parts.join('')).toString(16); // one FNV-1a over everything, as feeding it piece by piece once did
  }

  return {
    registerPack(pack) { packs.set(pack.hash, pack); },
    getPatrol: () => w.patrol,
    siteIsFree: () => siteIsFree(w), // a drawn area or a patrol: the station's rings no longer apply
    state, drones: w.drones, structures: w.structures, missiles: w.missiles, people: w.people, peopleRev: () => w.peopleRev, ledger: w.ledger, net: w.net, rec: w.rec, bus,
    commands, log, on, off, step, digest, endRun, stepCount: () => stepCount,
    currentLaydown: () => w.startLaydown || laydown.captureLaydown(w),
    run(steps) { state.started = true; for (let i = 0; i < steps && !state.over; i++) step(); },
    canPlace: (x, z, def) => !laydown.placementProblem(w, x, z, def),
    canPlacePeople: (x, z, protection) => !people.peopleProblem(w, x, z, protection),
    designLocked: () => designLocked(w),
    unwired: () => laydown.unwired(w),
    spotterBonus: () => spotterBonus(w),
    report: () => deploymentReport(w),
    // for scripted experiments and tests: no budget or placement checks
    addStructure: (id, x, z) => laydown.addStructure(w, id, x, z),
    spawnDrone: (type, bearing, rolls) => spawnDrone(w, type, bearing, rolls),
  };
}
