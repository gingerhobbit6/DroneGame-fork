// Probabilistic sensor models: what each sensor can detect, the reports it sends, and how cameras aim.

import * as S from '../sapient.js';
import { SENSING } from '../config/index.js';
import { rand, gauss } from '../rng.js';
import { terrainState } from '../terrain.js';
import { errorScale, inClutter, reachFor, reachOnPath } from '../site-range.js';
import { blindSpeed, classifiesAt, coverArc, elevationBand, inCover, outwardFrom } from '../sensor-model.js';
import { IDENTIFY_PX, airframeConfidence, hasZoom, pixelsOn } from '../camera-model.js';
import { LIBRARIES, bandGhz, covers, heardBand, libraryKnows } from '../rf-model.js';
import { deafAt } from '../jamming.js';
import { logSeen } from '../flight-log.js';
import { RB_UNITS, rbDatum, round, clamp } from './core.js';

export { reachFor };

const STARE_LOOKS = 3; // looks a camera takes at each height while it searches for a track with none
const SOUND_SPEED = 343; // m/s, in air at 20 °C

// Sound takes time to arrive: what an acoustic sensor hears now left the drone `metres` / 343 s ago, so it points to where the drone was
// then, 3 s and about 150 m behind a Shahed a kilometre off. Its velocity (per second, in the units of pos), taken back that long,
// stands in for its path.
export const heardAt = (pos, vel, metres) => { const late = metres / SOUND_SPEED; return { x: pos.x - vel.x * late, y: pos.y - vel.y * late, z: pos.z - vel.z * late }; };

export function createSensors(core, feed) {
  const { ctx, mpu, T, nodes, tracker, fusion, send, deliver, antennaM, rel, bearingOf } = core;

  // A camera's view now: its track view on a cue, and its search view again once half its dwell there has found nothing.
  function viewOf(s) {
    const def = s.def, c = s.cue;
    if (!c || !hasZoom(def)) return def.fov;
    const tr = tracker.tracks.get(c.trackId), seen = (tr?.heard.get(s.nodeId)?.t ?? -Infinity) >= c.from;
    return seen || c.onAt == null || T() < c.onAt + def.dwell / 2 ? def.trackFov : def.fov;
  }
  const zoomOf = (s) => (s.def.fov ? s.def.fov / viewOf(s) : 1); // how much further a camera reaches in its view now

  // Is the target inside the camera's current field of view?
  function inView(s, r) {
    const b = bearingOf(r), half = viewOf(s) / 2;
    const daz = Math.abs(((b.az - s.point.az + 540) % 360) - 180), del = Math.abs(b.el - s.point.el);
    return daz <= half && del <= half;
  }

  const bandOn = (s, d) => heardBand(s.def, d.def, deafAt(s, nodes.values())); // the band a detector hears this drone on now, not through your own jamming, or null

  // How far this sensor reaches along the real path to this drone. A radio detector works it out on the band it hears it on.
  function reachTo(s, d) {
    const m = mpu(), band = s.def.kind === 'rf' && bandOn(s, d);
    if (band === null) return 0;
    return reachOnPath(s.def, d.def, terrainState.data, { x: s.pos.x * m, y: antennaM(s), z: s.pos.z * m }, { x: d.pos.x * m, y: d.pos.y * m, z: d.pos.z * m }, band && bandGhz(band));
  }

  // The chance that this sensor detects this drone on one scan. It depends on:
  //  - how far away it is compared with the sensor's range for a small reference drone, scaled by how big the target
  //    looks (radar cross-section for radar, physical size for the camera, link power for RF)
  //  - ground clutter hiding low flyers from radar, and what the real path costs it (site-range.js)
  //  - for a camera, whether it is pointing at the target (it has a narrow field of view and has to be cued)
  // `pointing: false` ignores the camera's aim, for coverage maps (assume it has been cued).
  function pd(s, d, { pointing = true } = {}) {
    const def = s.def;
    const r = rel(s, d);
    if (def.senses === 'perimeter') return r.hr < def.range ? 0.98 : 0;
    const zoom = pointing ? zoomOf(s) : 1; // coverage maps assume a camera's search view
    const open = reachFor(def, d.def) * zoom;
    if (!open || r.rng > open * SENSING.rangeCap) return 0;
    const b = bearingOf(r);
    if (!inCover(def, b.az, b.el)) return 0; // outside a radar's arc, or above or below its beam
    const T3 = terrainState.data, m = mpu();
    const dxm = d.pos.x * m, dzm = d.pos.z * m, dym = d.pos.y * m;
    const speed = d.vel ? Math.hypot(d.vel.x, d.vel.y, d.vel.z) * m : d.def.speed; // a coverage probe has no velocity: its type's speed
    const p = inClutter(def, T3, dxm, dzm, dym - T3.groundAt(dxm, dzm), r.hr, speed) ? SENSING.clutterPenalty : 1; // lost in clutter
    const blind = blindSpeed(def);
    if (blind && d.vel && Math.abs((d.vel.x * r.east - d.vel.z * r.north + d.vel.y * r.up) * m) < blind * r.rng) return 0; // too slow, or crossing, for its clutter filter
    const reach = reachTo(s, d) * zoom;
    if (!reach) return 0;
    if (pointing && def.fov && !inView(s, r)) return 0;
    return p / (1 + Math.pow(r.rng / (reach * SENSING.pdEdge), SENSING.pdSlope));
  }

  // How many sensors would see a drone of this type at this spot (at least half the time)? Used for coverage maps.
  function coverageAt(xm, zm, aglM, droneDef) {
    const m = mpu(), T3 = terrainState.data;
    const probe = { pos: { x: xm / m, y: (T3.groundAt(xm, zm) + aglM) / m, z: zm / m }, def: droneDef };
    let n = 0;
    for (const s of nodes.values()) if (s.def.role === 'sensor' && s.def.id !== 'perimeter' && pd(s, probe, { pointing: false }) >= 0.5) n++;
    return n;
  }

  function classification(s, d, rng, reach) {
    const id = s.def.kind || s.def.id;
    const sub = (type, c, level, inner) => ({ type, confidence: round(c, 2), level, ...(inner ? { sub_class: [inner] } : {}) });
    if (!d) return [{ type: 'Unknown', confidence: 0.4 }]; // a false alarm doesn't look like anything in particular
    if (id === 'camera') { // it names the airframe once the drone covers enough pixels, and identified, its model (camera-model.js)
      const px = pixelsOn(reach, rng), named = airframeConfidence(px), model = px >= IDENTIFY_PX ? sub(d.def.label ?? d.def.name, 0.9, 3) : null;
      return [{ type: 'Air Vehicle', confidence: 0.95, sub_class: [sub('UAV', 0.9, 1, named ? sub(d.def.airframe, named, 2, model) : null)] }];
    }
    if (id === 'acoustic') return [{ type: 'Air Vehicle', confidence: 0.7, sub_class: [sub('UAV', 0.6, 1)] }]; // it sounds like a drone, not which one
    if (id === 'rf') { // its library names the airframe of a link it knows, and takes any other moving emitter for a drone; with none, it is energy
      if (!LIBRARIES[s.def.library].knows) return [{ type: 'Unknown', confidence: 0.5 }];
      const model = d.def.protocol === 'commercial' ? sub(d.def.label ?? d.def.name, 0.9, 3) : null; // a DJI or Autel link says what the drone is
      return [{ type: 'Air Vehicle', confidence: 0.85, sub_class: [sub('UAV', 0.8, 1, libraryKnows(s.def, d.def) ? sub(d.def.airframe, 0.9, 2, model) : null)] }];
    }
    if (classifiesAt(s.def, rng, reach)) return [{ type: 'Air Vehicle', confidence: 0.8, sub_class: [sub('UAV', 0.7, 1, sub(d.def.airframe, 0.6, 2))] }]; // rotors or wings, by micro-Doppler
    return [{ type: 'Air Vehicle', confidence: 0.7, sub_class: [sub('UAV', 0.55, 1)] }];
  }

  // Where a false alarm appears: random direction and range inside what the sensor covers (a camera only inside its view).
  // null when it falls in a radar's blanking arc, so blanking takes away false alarms in step with the share it blanks.
  function falseGeometry(s) {
    const def = s.def;
    const arc = coverArc(def), band = elevationBand(def); // a radar's false alarms come from where it looks, low in its beam
    const view = def.fov ? viewOf(s) : 0;
    const azD = def.fov ? s.point.az + (rand() - 0.5) * view : arc < 360 ? def.facing + (rand() - 0.5) * arc : rand() * 360;
    const lo = band ? Math.max(band[0], -2) : -2, hi = band ? Math.max(Math.min(band[1], 10), lo) : 10;
    const elD = def.fov ? s.point.el + (rand() - 0.5) * view : lo + rand() * (hi - lo);
    const rng = def.range * (0.15 + 0.85 * rand());
    if (!inCover(def, (azD + 360) % 360, elD)) return null;
    const az = (azD * Math.PI) / 180, el = (elD * Math.PI) / 180;
    const hr = rng * Math.cos(el);
    return { east: hr * Math.sin(az), north: hr * Math.cos(az), up: rng * Math.sin(el), hr, rng };
  }

  // Where an acoustic sensor hears a drone: where it was when the sound left it (heardAt).
  const heardFrom = (s, d) => { const now = rel(s, d); return d.vel ? rel(s, { pos: heardAt(d.pos, d.vel, now.rng) }) : now; };

  // Build one detection (a real drone `d`, or a false alarm when d is null), send the SAPIENT DetectionReport, and return
  // what the fusion node's tracker needs.
  function measure(s, d) {
    const def = s.def, n = def.sapient.noise || {};
    const r = d ? (def.kind === 'acoustic' ? heardFrom(s, d) : rel(s, d)) : falseGeometry(s);
    if (!r) return null;
    const b = bearingOf(r);
    const reach = (d ? reachTo(s, d) : def.range) * zoomOf(s), k = errorScale(def, r.rng, reach); // a weak signal gives a worse measurement, and the sensor knows it
    const errAz = n.az * k, errEl = n.el * k, errRange = n.range * k;
    const azM = (b.az + gauss() * (errAz || 0) + 360) % 360;
    const elM = b.el + gauss() * (errEl || 0);
    const rngM = r.rng + gauss() * (errRange || 0);

    const rb = {};
    if (n.el != null) rb.elevation = round(elM);
    rb.azimuth = round(azM);
    if (n.range != null) rb.range = round(rngM, 1);
    if (n.el != null) rb.elevation_error = round(errEl, 3);
    rb.azimuth_error = round(errAz, 3);
    if (n.range != null) rb.range_error = round(errRange, 2);
    rb.coordinate_system = RB_UNITS;
    rb.datum = rbDatum();

    const kind = def.kind || def.id;
    const conf = !d ? 0.3 + rand() * 0.2
      : kind === 'radar' ? clamp(0.55 + 0.4 * (1 - r.rng / reach), 0.3, 0.98)
      : kind === 'camera' ? 0.85 + rand() * 0.1
      : kind === 'rf' ? 0.75 + rand() * 0.15
      : kind === 'acoustic' ? 0.55 + rand() * 0.2 : 0.9;

    let objectId;
    if (d) { if (!s.objIds.has(d)) s.objIds.set(d, S.ulid()); objectId = s.objIds.get(d); } else objectId = S.ulid();
    const report = {
      report_id: S.ulid(), object_id: objectId,
      range_bearing: rb, detection_confidence: round(conf, 2),
      classification: classification(s, d, r.rng, reach),
    };
    if (def.sapient.signal) { // the band it heard the drone on, or for a false alarm any band it covers
      const bands = covers(def), band = d ? bandOn(s, d) : bands[Math.floor(rand() * bands.length)];
      report.signal = [{
        amplitude: round(-45 - 20 * Math.log10(Math.max(r.rng, 100) / 100) + gauss() * 2, 1),
        centre_frequency: Math.round(bandGhz(band) * 1e9),
      }];
    }
    let vel = null;
    if (d && def.sapient.velocity && d.vel) {
      const m = mpu();
      vel = { east_rate: round(d.vel.x * m + gauss() * 0.3, 2), north_rate: round(-d.vel.z * m + gauss() * 0.3, 2), up_rate: round(d.vel.y * m + gauss() * 0.3, 2), east_rate_error: 0.5, north_rate_error: 0.5, up_rate_error: 0.5 };
      report.enu_velocity = vel;
    }
    const sent = send(S.envelope(s.nodeId, 'detection_report', report), s.nodeId, fusion.nodeId);

    const rad = (x) => (x * Math.PI) / 180;
    const from = [s.pos.x * mpu(), -s.pos.z * mpu(), antennaM(s)];
    return {
      sent,
      meas: {
        node: s.nodeId, color: def.color, from, az: rad(azM), el: n.el != null ? rad(elM) : null, range: n.range != null ? rngM : null,
        sigAz: rad(errAz), sigEl: n.el != null ? rad(errEl) : null, sigRange: errRange || 0, t: T(), scan: s.scanId, every: def.sapient.interval, reach,
      },
      source: { name: s.name, objectId, ts: S.timestamp(), conf, rb, from: { east: from[0], north: from[1], up: from[2] }, color: def.color, vel, cls: report.classification, rangeErr: errRange, hasRange: n.range != null },
    };
  }

  // One scan of a sensor: each real drone is detected with probability pd, and false alarms appear at the sensor's own rate.
  function scan(s) {
    s.scanId = (s.scanId || 0) + 1;
    const found = [];
    const c = ctx.siteCentre(), m = mpu();
    for (const d of ctx.drones) {
      const p = pd(s, d);
      if (p > 0 && rand() < p) { found.push(measure(s, d)); logSeen(d, s.def.id, T(), rel(s, d).rng, Math.hypot(d.pos.x - c.x, d.pos.z - c.z) * m); }
    }
    if (s.def.falseAlarm && rand() < s.def.falseAlarm) { const f = measure(s, null); if (f) { found.push(f); ctx.onFalseAlarm?.(s.def.id); } }
    s.detections = (s.detections || 0) + found.length; // false alarms included: the sensor cannot tell them apart
    for (const f of found) deliver(f.sent, () => feed(s, f)); // the tracker only hears it when it arrives
  }

  // Turn a camera towards its cued track (or sweep when idle), at its slew rate.
  function aimCamera(s, dt) {
    const def = s.def;
    let tgtAz = s.point.az, tgtEl = s.point.el, rate = def.searchRate;
    const tr = s.cue && tracker.tracks.get(s.cue.trackId);
    if (tr && tr.est) {
      const m = mpu();
      const r = { east: tr.est.east - s.pos.x * m, north: tr.est.north + s.pos.z * m, up: tr.est.up - antennaM(s) };
      r.hr = Math.hypot(r.east, r.north);
      const b = bearingOf(r);
      tgtAz = b.az; tgtEl = b.el; rate = def.slewRate;
      if (tr.flat) { // no height from a 2D radar or crossing bearings: look at the guess, then step up a view at a time, a few looks at each
        const top = Math.min(45, (Math.atan2(500, Math.max(r.hr, 1)) * 180) / Math.PI);
        const st = s.stare?.trackId === tr.id ? s.stare : (s.stare = { trackId: tr.id, el: clamp(b.el, 0, top), from: null });
        if (Math.abs(s.point.el - st.el) < 0.5) {
          st.from ??= s.scanId;
          if (s.scanId - st.from >= STARE_LOOKS) { const step = viewOf(s); st.el = st.el + step > top ? 0 : st.el + step; st.from = null; }
        }
        tgtEl = st.el;
      }
    } else { // sweep, all round or back and forth across its search arc, facing away from what is defended
      const arc = def.searchArc ?? 360;
      if (arc >= 360) tgtAz = s.point.az + 1;
      else {
        const mid = outwardFrom(ctx.siteCentre(), s.pos), off = ((s.point.az - mid + 540) % 360) - 180;
        if (off >= arc / 2 - 0.5) s.sweepBack = true; else if (off <= 0.5 - arc / 2) s.sweepBack = false;
        tgtAz = mid + (s.sweepBack ? -arc : arc) / 2;
      }
      tgtEl = 3;
    }
    const dAz = ((tgtAz - s.point.az + 540) % 360) - 180;
    const step = rate * dt;
    s.point.az = (s.point.az + clamp(dAz, -step, step) + 360) % 360;
    s.point.el += clamp(tgtEl - s.point.el, -step, step);
    if (s.cue && s.cue.onAt == null && Math.abs(dAz) <= step && Math.abs(tgtEl - s.point.el) < 0.5) s.cue.onAt = T(); // on the cue: the zoomed hunt starts
    s.view = viewOf(s); // for the plan map
  }

  return { pd, coverageAt, scan, aimCamera };
}
