// The fusion node's picture: feeding detections into the tracker, reports to the C2 GUI, kill confirmation and track alerts.

import * as S from '../sapient.js';
import { FUSION } from '../config/index.js';
import { round, classDepth } from './core.js';
import { slowestSensor } from '../tracker.js';

export function createFusion(core, { raiseAlert }) {
  const { ctx, mpu, T, tracker, fusion, gui, send, fromSite, siteDist } = core;
  let trackSeq = 0, fusedT = 0;

  function feed(s, f) {
    const tr = tracker.ingest(f.meas, f.meas.t); // at the moment it was measured: a report that queued on a busy link describes the past
    if (!tr) return;
    tr.sources.set(s.nodeId, { ...f.source, lastT: T() });
    if (!tr.cls || classDepth(f.source.cls) >= classDepth(tr.cls)) tr.cls = f.source.cls; // classification is remembered
  }

  const confirmedTracks = () => [...tracker.tracks.values()].filter((tr) => tr.status === 'confirmed' && !tr.killWatch);

  function refreshTracks() {
    for (const tr of tracker.tracks.values()) {
      const e = tracker.estimate(tr, T());
      tr.est = { east: e.east, north: e.north, up: e.up };
      tr.estErr = e.err;
      tr.speed = Math.hypot(e.vel[0], e.vel[1], e.vel[2]);
      const { east, north } = fromSite(tr), dist = Math.hypot(east, north);
      tr.closing = dist ? -(east * e.vel[0] + north * e.vel[1]) / dist : 0; // m/s towards the site over the ground; below 0 it is leaving
      const named = tr.cls && classDepth(tr.cls) >= 2 && tr.cls[0].sub_class[0].sub_class[0];
      tr.airframe = named ? named.type : 'Unknown';
      tr.model = named?.sub_class?.[0]?.type ?? null; // a camera that identified it names the drone's model
    }
    for (const d of ctx.drones) d.track = null;
    for (const tr of tracker.tracks.values()) {
      tr.drone = droneAt(tr);
      if (tr.status !== 'tentative' && tr.drone && !tr.drone.track) tr.drone.track = tr;
      tr.loiterSince = isCircling(tr) ? tr.loiterSince ?? T() : null;
    }
  }

  // The real drone a seeker or the truth overlay would find at a track's estimated position, if any. A ghost has none.
  // Never used to form the fusion node's picture: it only tells a seeker what is really there.
  function droneAt(tr) {
    const m = mpu();
    let best = null, bd = FUSION.acquireRadius;
    for (const d of ctx.drones) {
      const dist = Math.hypot(tr.est.east - d.pos.x * m, tr.est.north + d.pos.z * m, tr.flat ? 0 : tr.est.up - d.pos.y * m); // no measured height: compare across the ground
      if (dist < bd) { bd = dist; best = d; }
    }
    return best;
  }

  // Moving, but neither closing on the site nor leaving it: what a spotter on station looks like to the fusion node.
  function isCircling(tr) {
    if (!siteDist(tr) || tr.speed < FUSION.loiterMinSpeed) return false; // inside a drawn area is not circling it
    const e = tracker.estimate(tr, T());
    const { east, north } = fromSite(tr), dist = Math.hypot(east, north);
    const radial = (east * e.vel[0] + north * e.vel[1]) / dist;
    return Math.abs(radial) < FUSION.loiterRadial * tr.speed;
  }
  const isLoitering = (tr) => tr.loiterSince != null && T() - tr.loiterSince >= FUSION.loiterAfter;

  function fusedReport(tr) {
    const srcs = [...tr.sources.entries()].filter(([id, v]) => T() - v.lastT <= 3 * (tr.heard.get(id)?.slack ?? 1));
    const body = { report_id: S.ulid(), object_id: tr.id, state: tr.status };
    body.location = S.location(tr.est.east, tr.est.north, tr.est.up, Math.max(tr.estErr, 5));
    body.detection_confidence = round(Math.min(0.99, 0.4 + 0.12 * tr.hits), 2);
    if (tr.cls) body.classification = tr.cls;
    body.behaviour = [{ type: isLoitering(tr) ? 'Loitering' : 'Approaching', confidence: 0.7 }];
    if (srcs.length) body.derived_detection = srcs.map(([id, v]) => ({ timestamp: v.ts, node_id: id, object_id: v.objectId }));
    const e = tracker.estimate(tr, T());
    body.enu_velocity = { east_rate: round(e.vel[0], 2), north_rate: round(e.vel[1], 2), up_rate: round(e.vel[2], 2) };
    send(S.envelope(fusion.nodeId, 'detection_report', body), fusion.nodeId, gui.nodeId);
  }

  // Kill confirmation: the sensors must have lost the track.
  function confirmKills() {
    for (const tr of [...tracker.tracks.values()]) {
      if (!tr.killWatch || T() - tr.killWatch.t < FUSION.killConfirmDelay * slowestSensor(tr)) continue; // a slow radar gets time to look again
      if (tr.lastT <= tr.killWatch.lastT + 1e-6) {
        raiseAlert('information', `Kill confirmed: ${tr.short} (${tr.model ?? (tr.airframe === 'Unknown' ? 'unclassified' : tr.airframe)}), reported by ${tr.killWatch.by}`, null, 'DISCRETE_PRIORITY_LOW', tr);
        if (ctx.onKillConfirmed) ctx.onKillConfirmed(tr);
        tracker.tracks.delete(tr.id);
      } else {
        raiseAlert('warning', `Kill NOT confirmed: ${tr.short} is still being detected`, null, 'DISCRETE_PRIORITY_MEDIUM', tr);
        tr.killWatch = null;
      }
    }
  }

  function trackAlerts() {
    for (const tr of tracker.tracks.values()) {
      if (tr.justConfirmed) {
        tr.justConfirmed = false;
        tr.short = `T${++trackSeq}`;
        const first = [...tr.sources.values()][0];
        raiseAlert('information', `New track ${tr.short} confirmed (first detected by ${first ? first.name : 'a sensor'})`, null, 'DISCRETE_PRIORITY_LOW', tr);
      }
      if (tr.status === 'tentative') continue;
      const dist = siteDist(tr);
      if (!tr.warned && dist < FUSION.warnZone) { tr.warned = true; raiseAlert('warning', `Track ${tr.short} inside ${FUSION.warnZone} m of the site`, null, 'DISCRETE_PRIORITY_MEDIUM', tr); }
      if (!tr.crit && dist < FUSION.critZone) { tr.crit = true; raiseAlert('critical', `Track ${tr.short} inside ${FUSION.critZone} m of the site`, null, 'DISCRETE_PRIORITY_HIGH', tr); }
      if (!tr.loiterAlert && isLoitering(tr)) {
        tr.loiterAlert = true;
        raiseAlert('warning', `Track ${tr.short} loitering at standoff range: probable spotter`, null, 'DISCRETE_PRIORITY_MEDIUM', tr);
      }
    }
  }

  function sendFusedReports(dt) {
    fusedT += dt;
    if (fusedT >= FUSION.fusedInterval) { fusedT = 0; for (const tr of tracker.tracks.values()) if (tr.status !== 'tentative') fusedReport(tr); }
  }

  const reset = () => { trackSeq = 0; fusedT = 0; };

  return { feed, confirmedTracks, refreshTracks, confirmKills, trackAlerts, sendFusedReports, reset };
}
