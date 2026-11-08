// The SAPIENT network for the simulation: nodes (sensors, effectors, fusion, C2 GUI), probabilistic sensor
// models, track fusion (tracker.js), camera cueing, effector tasking and alerts. Everything the nodes say goes
// through sapient.js so it can be inspected in the dock.
//
// Simplifications:
//  - Detections come with Gaussian noise and a detection probability; the fusion node associates them to tracks by
//    gating (it does not know which drone a detection came from, so it can make mistakes, and can believe in ghosts).
//    An effector is cued to a track's estimated position and engages only a real drone it finds there.
//  - Registration `task` definitions are minimal.

import * as S from '../sapient.js';
import { FUSION, PERIMETER } from '../config/index.js';
import { idRand, EPOCH_MS } from '../rng.js';
import { createCore, RB_UNITS, rbDatum } from './core.js';
import { createSensors } from './sensors.js';
import { createRegistration } from './registration.js';
import { createAlerts, createAuthority } from './authority.js';
import { createFusion } from './fusion.js';
import { createTasking } from './tasking.js';

// ctx: { drones: Drone[], getTime(): sim seconds, acceptTask(structure, drone): {ok, reasons?} }
export function createNetwork(ctx) {
  const core = createCore(ctx);
  const { T, nodes, tracker, names, nameOf, fusion, gui, scheduled, comms, send } = core;
  const alerts = createAlerts(core);
  const { raiseAlert } = alerts;
  const registration = createRegistration(core, raiseAlert);
  const fused = createFusion(core, alerts);
  const sensors = createSensors(core, fused.feed);
  let authority = null;
  const tasks = createTasking(core, alerts, registration, () => authority, fused.confirmedTracks);
  authority = createAuthority(core, alerts, (s, tr) => tasks.assign(s, tr, true));
  let fusionT = 0;

  function update(dt) {
    S.clock.t = T();
    while (scheduled.length && scheduled[0].at <= T()) scheduled.shift().fn(); // messages that have now arrived
    for (const s of nodes.values()) {
      if (s.def.role === 'sensor') {
        if (s.def.fov) sensors.aimCamera(s, dt);
        s.reportT += dt;
        const iv = s.def.sapient.interval || 1;
        if (s.reportT >= iv) {
          s.reportT = Math.min(s.reportT - iv, iv);
          sensors.scan(s);
        }
      }
      s.statusT += dt;
      if (s.statusT >= FUSION.statusInterval) { s.statusT = 0; registration.sendStatus(s); }
    }
    tracker.prune(T());
    fused.refreshTracks();
    authority.expireRequests();
    fused.confirmKills();
    fused.trackAlerts();
    fused.sendFusedReports(dt);
    fusionT += dt;
    if (fusionT >= FUSION.taskInterval) { fusionT = 0; registration.checkContact(); tasks.tasking(); }
  }

  const isTracked = (d) => !!d.track;
  function onDroneRemoved(d) {
    d.track = null;
    for (const tr of tracker.tracks.values()) if (tr.drone === d) tr.drone = null; // the track outlives the drone briefly, then drops
  }

  // Demo of the middleware error path: a detection report missing its mandatory report_id.
  function injectFault() {
    const list = [...nodes.values()].filter((s) => s.def.role === 'sensor');
    const s = list[Math.floor(idRand() * list.length)];
    if (!s) return;
    const bad = { object_id: S.ulid(), range_bearing: { azimuth: 0, coordinate_system: RB_UNITS, datum: rbDatum() } };
    send(S.envelope(s.nodeId, 'detection_report', bad), s.nodeId, fusion.nodeId);
  }

  function init() {
    S.clock.epochMs = EPOCH_MS;
    S.clock.t = 0;
    S.clearBus();
    nodes.clear(); tracker.clear(); names.clear();
    registration.reset();
    tasks.reset(); // what the last run taught it about jammers must not shape this one
    fused.reset(); fusionT = 0; authority.pending.length = 0;
    scheduled.length = 0; comms.reset(); fusion.uplinks.clear(); fusion.cellBand = 'B8';
    fusion.nodeId = S.uuid(); gui.nodeId = S.uuid(); fusion.statusT = 0;
    names.set(fusion.nodeId, fusion.name);
    names.set(gui.nodeId, gui.name);
    registration.register(fusion);
    const p = { def: PERIMETER, pos: { x: 0, y: 0, z: 0 } };
    p.nodeId = S.uuid(); p.short = PERIMETER.short + '-01'; p.name = PERIMETER.name;
    p.mode = 'Detect'; p.reportT = 0; p.objIds = new Map(); p.task = null;
    names.set(p.nodeId, p.name);
    registration.register(p);
  }

  return {
    init, registerNode: registration.registerNode, renameNode: registration.renameNode, deregisterNode: registration.deregisterNode, update, isTracked, onDroneRemoved, raiseAlert, injectFault,
    comms, decide: authority.decide, pendingRequests: authority.pending, coverageAt: sensors.coverageAt, pd: sensors.pd, nameOf, nodes, tracks: tracker.tracks, bearingCandidates: () => tracker.candidates, fusion, gui, distToTrack: core.distToTrack, siteDist: core.siteDist,
  };
}
