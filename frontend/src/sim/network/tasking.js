// The fusion node deciding what each effector and camera should do, and telling it with SAPIENT Task messages.

import * as S from '../sapient.js';
import { FUSION, DRONES } from '../config/index.js';
import { canFire } from '../magazine.js';
import { coverArc, inArcOf } from '../sensor-model.js';
import { bandGhz } from '../rf-model.js';
import { antennaHeight, flies, reachOnPath, typicalAltitude } from '../site-range.js';
import { terrainState } from '../terrain.js';
import { canFollow, hears } from '../jamming.js';
import { burnTime, hitChance, meetTime } from '../hit-chance.js';
import { threatLibrary } from './threats.js';
import { cueCameras } from './cameras.js';

// s: a jammer on its own receiver that has heard nothing for this long stops to listen. It switches once a second, so a barrage, deaf to
// the bands it fills, jams 3 s in every 4: an assumption.
const LOOK = 2.5;
// Pairing: an effector is in the running for a track with at least this share of the best chance any free one has at it. A beam's cost
// is reckoned on a drone of this many hit points when the track has no model. Assumptions.
const FAIR = 0.5, BEAM_HP = 20;
// s: how long a kill is still credited to an engagement given up while its rounds may be in the air. Longer than a round flies.
const RELEASED_FOR = 30;
const DESTROYED = 'target destroyed or removed';

// Would this effector ever take this airframe? Unknown tracks are offered, and the effector can reject them.
const takesAirframe = (def, airframe) => !def.engages || !airframe || airframe === 'Unknown' || def.engages.some((t) => DRONES[t].airframe === airframe);

export function createTasking(core, { raiseAlert }, registration, authority, confirmedTracks) {
  const { ctx, mpu, T, nodes, tracker, fusion, send, deliver, distToTrack, siteDist } = core;
  const faces = (s, tr) => inArcOf(s.def, s.pos, { x: tr.est.east / mpu(), z: -tr.est.north / mpu() }); // a sector antenna only jams what it faces
  const { sendStatus } = registration;
  let believe = threatLibrary(ctx.expected?.()); // what the fusion node may believe about each track (threats.js), built again each pass
  // Seconds until a track arrives, for each point of harm it would do: the lower, the sooner it must be dealt with. By its speed, not how
  // fast it closes on the site: ranking by that lost the radar sooner (4 of 6 mixed runs let strikes through), as a velocity from
  // bearing-only sensors can point anywhere, and emitter-seeking drones go for systems further out.
  const urgency = (tr) => siteDist(tr) / Math.max(tr.speed ?? 0, FUSION.minClosing) / Math.max(believe(tr).harm, 1);
  // Is this track closing on the site, or on one of your systems as an emitter-seeking drone goes for a radar further out, faster than a
  // hovering drone drifts?
  function headingForAny(tr) {
    if (!tr.vel) return true;
    const m = mpu(), c = ctx.siteCentre();
    return [[c.x * m, -c.z * m], ...[...nodes.values()].map((s) => [s.pos.x * m, -s.pos.z * m])].some(([east, north]) => {
      const de = east - tr.est.east, dn = north - tr.est.north, dist = Math.hypot(de, dn);
      return !dist || (de * tr.vel[0] + dn * tr.vel[1]) / dist > FUSION.minClosing;
    });
  }
  // Flying away from the site and heading for none of your systems: turned for home, or a spotter going. Not worth a round.
  const leaving = (tr) => (tr.closing ?? 0) < -FUSION.minClosing && !headingForAny(tr);
  // How far a jammer reaches at full power towards a point (east, north, up in metres) on a band, over the ground in between. The fusion
  // node knows the map, as a planning tool does, so it judges a jammer's reach through the trees and hills, not in an open field.
  let reachMemo = new Map();
  function pathReach(j, east, north, up, band) {
    const key = `${j.nodeId}|${Math.round(east / 50)}|${Math.round(north / 50)}|${Math.round(up / 20)}|${band}`;
    if (!reachMemo.has(key)) {
      const m = mpu(), a = { x: j.pos.x * m, y: j.pos.y * m + antennaHeight(j.def), z: j.pos.z * m };
      reachMemo.set(key, reachOnPath(j.def, DRONES.fpv, terrainState.data, a, { x: east, y: up, z: -north }, bandGhz(band)));
    }
    return reachMemo.get(key);
  }
  // A track's height for judging a jammer's reach. Far out a measured height can be well out, so a named drone is held to the heights it
  // flies at. A track with no measured height (bearings only), or an unnamed one below the ground, is taken 60 m up.
  function heightOf(tr) {
    const ground = terrainState.data.groundAt(tr.est.east, -tr.est.north), model = believe(tr).model;
    if (model) return tr.flat ? ground + typicalAltitude(model) : Math.min(ground + model.alt[1], Math.max(ground + model.alt[0], tr.est.up));
    return tr.flat || tr.est.up < ground ? ground + 60 : tr.est.up;
  }
  const reachesTrack = (j, tr, band) => distToTrack(j, tr) <= pathReach(j, tr.est.east, tr.est.north, heightOf(tr), band);

  // The jammers that could break this track's link: it is known to have one, on a band they jam, and they can follow it if reactive.
  // Its control link, which it receives where it flies; its video is received by its operator, out of a site jammer's reach.
  function breakers(tr) {
    const b = believe(tr), links = b.breakable && b.model ? [b.model.links.control].filter(Boolean) : [];
    if (!links.length) return [];
    return [...nodes.values()].filter((j) => j.def.kind === 'jammer' && !j.offline && j.def.networked !== false && (!['receiver', 'manual'].includes(j.def.trigger) || j.mode === 'Jam')
      && links.some((band) => j.jamBands.has(band)) && canFollow(j.def, b.model));
  }
  // How holding fire for a jammer has gone against each model: a model that keeps outlasting the jammers is not waited for again,
  // as a crew would learn. Drones grow harder to jam each wave, so this matters more as the attack goes on.
  const softKill = new Map();
  function record(tr, what) {
    if (tr[what]) return;
    tr[what] = true;
    const r = softKill.get(tr.model) ?? { held: 0, failed: 0 };
    r[what]++;
    softKill.set(tr.model, r);
  }
  const jammingFails = (model) => { const r = softKill.get(model); return !!r && r.held >= 3 && r.failed / r.held > 0.5; };

  // Soft kill first: a drone known to have a link to break, whose way in passes through such a jammer's reach, is left to the jammer,
  // unless it has come close, or a jammer has had it for FUSION.softKillWait seconds and it still flies.
  function leaveToJammer(tr) {
    const js = breakers(tr), b = believe(tr), band = (j) => [b.model.links.control].find((x) => x && j.jamBands.has(x));
    if (!js.length || siteDist(tr) < FUSION.critZone || jammingFails(tr.model)) return false;
    if (js.some((j) => j.mode === 'Jam' && faces(j, tr) && reachesTrack(j, tr, band(j)))) tr.jamSince ??= T();
    if (tr.jamSince != null && T() - tr.jamSince > FUSION.softKillWait) { record(tr, 'failed'); return false; }
    // Only worth it if its way in spends long enough inside a jammer's reach before it comes close: otherwise holding fire just lets
    // drones bunch up near the site.
    const c = ctx.siteCentre(), m = mpu(), ax = tr.est.east, an = tr.est.north, dx = c.x * m - ax, dn = -c.z * m - an, len = Math.hypot(dx, dn) || 1;
    const close = Math.max(0, 1 - FUSION.critZone / len), speed = Math.max(tr.speed ?? 0, FUSION.minClosing); // the share of its way in before it is close
    return js.some((j) => {
      const t = Math.min(1, Math.max(0, ((j.pos.x * m - ax) * dx + (-j.pos.z * m - an) * dn) / (len * len))), px = ax + dx * t, pn = an + dn * t;
      const up = heightOf(tr), across = Math.hypot(j.pos.x * m - px, -j.pos.z * m - pn), r = Math.min(j.def.range, pathReach(j, px, pn, up, band(j)));
      if (across >= r || !inArcOf(j.def, j.pos, { x: px / m, z: -pn / m })) return false; // its nearest point is out of reach, or behind a sector
      const half = Math.sqrt(r * r - across * across) / len, from = Math.max(0, t - half), to = Math.min(close, t + half); // inside its reach
      return ((to - from) * len) / speed >= FUSION.softKillWait;
    }) && (record(tr, 'held'), true);
  }

  function sendTask(s, task, name, description) {
    const id = S.ulid();
    const body = { task_id: id, task_name: name, task_description: description, task_start_time: S.timestamp(), ...task };
    const res = send(S.envelope(fusion.nodeId, 'task', body, s.nodeId), fusion.nodeId, s.nodeId);
    return { id, res }; // res says how long the task takes to arrive, or that it was lost
  }
  function sendTaskAck(s, taskId, status, reasons) {
    const body = { task_id: taskId, task_status: status };
    if (reasons && reasons.length) body.reason = reasons;
    send(S.envelope(s.nodeId, 'task_ack', body), s.nodeId, fusion.nodeId);
  }

  // Engagements given up (a re-task, a launcher that has just fired its last) while rounds may still be flying at them: a kill they
  // make is still reported, so the fusion node waits for the sensors rather than cueing others at a dead track.
  let released = [];
  function watchKill(trackId, by) {
    const tr = tracker.tracks.get(trackId);
    if (!tr || tr.killWatch) return;
    tr.killWatch = { t: T(), lastT: tr.lastT, by };
    raiseAlert('information', `Kill reported by ${by} on ${tr.short}: waiting for sensors to confirm`, null, 'DISCRETE_PRIORITY_LOW', tr);
  }

  function completeTask(s, status, reasons) {
    if (!s.task) return;
    if (reasons?.[0] !== DESTROYED) released.push({ drone: s.task.drone, trackId: s.task.trackId, by: s.name, until: T() + RELEASED_FOR });
    sendTaskAck(s, s.task.id, status, reasons);
    s.task = null;
    sendStatus(s);
  }

  function assign(s, tr, approved = false) {
    if (!approved && authority().needsApproval(s)) { if (!authority().isPending(s, tr)) authority().requestApproval(s, tr); return; }
    if (s.task?.trackId === tr.id) return; // already on it
    if (s.task) { // a re-task: the engagement it replaces stops only once the new one may go ahead
      const cur = tracker.tracks.get(s.task.trackId);
      sendTask(s, { control: 'CONTROL_STOP' }, `Stop ${cur ? cur.short : 'task'}`, 'Re-tasked to a more urgent threat');
      completeTask(s, 'TASK_STATUS_COMPLETED', ['re-tasked']);
    }
    const { id, res: sent } = sendTask(s, {
      control: 'CONTROL_START',
      command: { request: 'Engage', command_parameter: tr.id },
    }, `Engage ${tr.short}`, `Engage track ${tr.short} (${tr.airframe || 'unclassified'})`);
    if (sent.dropped) { s.rejected.set(tr.id, T() + FUSION.rejectBackoff); return; } // the task never arrived
    // the effector acquires whatever real target is at the track; a false or mis-placed track has none
    const res = ctx.acceptTask(s, tr.drone);
    if (res.ok) {
      s.task = { id, drone: tr.drone, trackId: tr.id, activeAt: T() + sent.delay }; // it can act once the task has arrived
      sendTaskAck(s, id, 'TASK_STATUS_ACCEPTED');
      sendStatus(s);
    } else {
      sendTaskAck(s, id, 'TASK_STATUS_REJECTED', res.reasons);
      if (res.permanent) s.denied.add(tr.id); // it can never take this track; don't ask again
      else s.rejected.set(tr.id, T() + FUSION.rejectBackoff); // try a different target next time
      if (res.empty) tr.emptyUntil = T() + FUSION.emptyHold; // it looked and saw nothing there: no effector is sent there for a while
    }
  }

  // Is the track between this effector's minimum range (a missile's, to arm and turn onto it) and its reach?
  const inEnvelope = (s, tr) => { const r = distToTrack(s, tr); return r <= s.def.range && r >= (s.def.minRange ?? 0); };

  // Can a round from this launcher meet the track within its reach, flying at where the track will be? A slow interceptor drone cannot
  // chase down a faster drone going past or away. A track with no velocity yet is given the benefit of the doubt.
  function canMeet(s, tr) {
    if (!flies(s.def) || !tr.vel) return true;
    const m = mpu(), p = [tr.est.east - s.pos.x * m, tr.est.north + s.pos.z * m, tr.flat ? 0 : tr.est.up - s.pos.y * m];
    return meetTime(p, tr.flat ? [tr.vel[0], tr.vel[1], 0] : tr.vel, s.def.missileSpeed) * s.def.missileSpeed <= s.def.range;
  }

  // Should the fusion node offer this track to this effector? Keeps expensive rounds for the targets that need them.
  function eligible(s, tr) {
    const def = s.def;
    if (!canMeet(s, tr)) return false; // its rounds could not catch it
    if (s.denied.has(tr.id) || authority().pending.some((p) => p.s === s)) return false; // one request at a time for each effector
    if (T() < (s.rejected.get(tr.id) ?? 0) || T() < (tr.emptyUntil ?? 0)) return false;
    if (!takesAirframe(def, tr.airframe)) return false; // already known to be beyond this effector
    if (flies(def) && leaveToJammer(tr)) return false; // soft kill first
    if (def.engagePolicy === 'fixed-wing' && tr.airframe !== 'Fixed wing') {
      if (tr.airframe === 'Multirotor') return false; // a known quadcopter is never worth the round
      // last ditch only: something unidentified that has got close and that nothing else is on
      const taken = [...nodes.values()].some((o) => o !== s && o.task && o.task.trackId === tr.id);
      if (siteDist(tr) >= FUSION.critZone || taken) return false;
    }
    return true;
  }

  // Does this jammer's own receiver hear a drone it would jam? Through its own barrage it hears nothing on the bands it fills, so having
  // heard nothing for LOOK seconds it switches off to listen, and back on at once if something is still there.
  function hearsThreat(s) {
    const all = [...nodes.values()];
    if (ctx.drones.some((d) => canFollow(s.def, d.def) && hears(s, d, all))) s.heardAt = T();
    return T() - (s.heardAt ?? -Infinity) < LOOK;
  }

  // A jammer is switched on by the fusion node for a track it reaches and faces, by its own receiver, or by hand. The last two need no
  // link to the fusion node, and report the change when they can.
  function switchJammer(s, live) {
    const by = s.def.trigger;
    if (by === 'receiver' || by === 'manual') {
      const want = (by === 'manual' ? s.jamOn : hearsThreat(s)) ? 'Jam' : 'Standby';
      if (s.mode !== want) { s.mode = want; s.modePending = null; sendStatus(s, true); }
      return;
    }
    if (s.offline) return; // a jammer we have lost contact with can't be switched
    // A jammer on a pan-and-tilt head with a sector antenna is turned onto the most urgent drone it could jam.
    // shortcut: it turns at once, without a SAPIENT task of its own; send it one if the delay on the turn ever matters.
    if (s.def.slews && coverArc(s.def) < 360) {
      const m = mpu(), aim = live.filter((tr) => distToTrack(s, tr) <= s.def.range && [...believe(tr).bands].some((b) => s.jamBands.has(b))).sort((a, b) => urgency(a) - urgency(b))[0];
      if (aim) s.slewTo = Math.round(((Math.atan2(aim.est.east - s.pos.x * m, aim.est.north + s.pos.z * m) * 180) / Math.PI + 360) % 360);
    }
    // only for a drone it could do something to, on a band it jams, as far as the fusion node knows (threats.js)
    const want = live.some((tr) => distToTrack(s, tr) <= s.def.range && faces(s, tr) && [...believe(tr).bands].some((b) => s.jamBands.has(b))) ? 'Jam' : 'Standby';
    if (s.mode !== want && s.modePending !== want) {
      const { id, res } = sendTask(s, { control: 'CONTROL_START', command: { mode_change: want } }, `Mode ${want}`, `Switch ${s.name} to ${want}`);
      if (!res.dropped) {
        s.modePending = want;
        deliver(res, () => { s.mode = want; s.modePending = null; sendTaskAck(s, id, 'TASK_STATUS_ACCEPTED'); sendStatus(s, true); });
      }
    }
  }

  function tasking() {
    const live = confirmedTracks();
    believe = threatLibrary(ctx.expected?.());
    reachMemo = new Map();
    released = released.filter((r) => { if (r.drone?.dead) { watchKill(r.trackId, r.by); return false; } return T() < r.until; });
    // what each node remembers about tracks that have gone: a track id never comes back, so it is only clutter
    for (const s of nodes.values()) for (const seen of [s.lookedAt, s.rejected, s.denied]) for (const id of seen?.keys() ?? []) if (!tracker.tracks.has(id)) seen.delete(id);
    cueCameras(core, live, { sendTask, sendTaskAck, sendStatus });
    const free = [];
    for (const s of nodes.values()) {
      if (s.def.networked === false) continue; // its crew works it by hand (crew.js)
      if (s.def.kind === 'jammer') { switchJammer(s, live); continue; }
      if (s.def.role !== 'effector' || s.offline) continue; // an effector we have lost contact with can't be tasked
      // Out of rounds or reloading: give the target up so another launcher can take it, and offer this one nothing for now.
      // shortcut: the fusion node reads the magazine directly. Report it in SAPIENT status if a lost launcher should be able to look armed.
      if (!canFire(s)) {
        completeTask(s, 'TASK_STATUS_FAILED', [s.reload > 0 ? 'reloading' : 'out of rounds']);
        continue;
      }
      // finish a task that has run its course
      if (s.task) {
        const d = s.task.drone, tr = tracker.tracks.get(s.task.trackId);
        if (d.dead) { // the effector reports the target gone; the fusion node then waits for the sensors to agree
          completeTask(s, 'TASK_STATUS_COMPLETED', [DESTROYED]);
          if (tr) watchKill(tr.id, s.name);
        }
        else if (!tr) completeTask(s, 'TASK_STATUS_FAILED', ['track lost']);
        else if (!inEnvelope(s, tr)) {
          sendTask(s, { control: 'CONTROL_STOP' }, `Stop ${tr.short}`, 'Target left engagement envelope');
          completeTask(s, 'TASK_STATUS_COMPLETED', ['target left engagement envelope']);
        } else if (leaving(tr)) {
          sendTask(s, { control: 'CONTROL_STOP' }, `Stop ${tr.short}`, 'Target is leaving');
          completeTask(s, 'TASK_STATUS_COMPLETED', ['target is leaving']);
        }
      }
      if (!s.task) { free.push(s); continue; } // paired below
      // an engaged effector: the most urgent track it can reach, for the harm it would do and how soon it arrives (skipping one it just rejected)
      let best = null, bd = Infinity;
      for (const tr of live) {
        if (!takes(s, tr)) continue;
        const dd = urgency(tr);
        if (dd < bd) { bd = dd; best = tr; }
      }
      if (!best || s.task.trackId === best.id) continue;
      const cur = tracker.tracks.get(s.task.trackId);
      if (cur && !ctx.roundsCover(s, cur.drone) && bd > urgency(cur) * (1 - FUSION.retaskGain)) continue;
      if (!authority().pending.some((p) => p.s === s)) assign(s, best); // keeps the current engagement while a re-task waits for approval
    }
    pair(free, live);
  }

  const takes = (s, tr) => inEnvelope(s, tr) && !leaving(tr) && eligible(s, tr) && !ctx.roundsCover(s, tr.drone);
  // What a kill would cost this effector, as far as the fusion node can tell: a round's price over its chance, with the track's evasion
  // unknown, or a beam's price per second over the seconds a typical drone takes to burn.
  function costPerKill(s, tr) {
    const def = s.def, rangeM = distToTrack(s, tr);
    if (def.fire === 'beam') return (def.shotCost ?? 0) * burnTime(def, { hp: believe(tr).model?.hp ?? BEAM_HP, evade: 1 }, rangeM);
    return (def.shotCost ?? 0) / Math.max(hitChance(def, { speed: tr.speed ?? 0, evade: 1 }, rangeM, tr.estErr ?? 0), 0.01);
  }
  const chanceOf = (s, tr) => (s.def.fire === 'beam' ? 1 : hitChance(s.def, { speed: tr.speed ?? 0, evade: 1 }, distToTrack(s, tr), tr.estErr ?? 0));
  // Free effectors are paired with tracks, most urgent first. Each track goes to the free effector with the lowest cost per kill among
  // those with at least FAIR of the best chance at it, so a gun or laser takes a quadcopter before a missile does. A track already being
  // engaged is left to that engagement, unless it is inside the critical zone, where every effector that can takes it on.
  function pair(free, live) {
    const tracks = live.filter((tr) => !leaving(tr)).sort((a, b) => urgency(a) - urgency(b));
    const engaged = new Set([...nodes.values()].filter((s) => s.task).map((s) => s.task.trackId));
    for (let made = true; made && free.length;) {
      made = false;
      for (const tr of tracks) {
        if (engaged.has(tr.id) && siteDist(tr) >= FUSION.critZone) continue;
        const can = free.filter((s) => takes(s, tr));
        if (!can.length) continue;
        const top = Math.max(...can.map((s) => chanceOf(s, tr)));
        const pick = can.filter((s) => chanceOf(s, tr) >= top * FAIR).sort((a, b) => costPerKill(a, tr) - costPerKill(b, tr))[0];
        free.splice(free.indexOf(pick), 1);
        assign(pick, tr);
        engaged.add(tr.id);
        made = true;
        if (!free.length) break;
      }
    }
  }

  // An operator's approval goes ahead only if the engagement still makes sense: while they decided, the track may have come inside the
  // launcher's minimum range or turned away, or the launcher may have emptied or lost contact.
  const approve = (s, tr) => { if (!s.offline && canFire(s) && takes(s, tr)) assign(s, tr, true); };

  return { assign, approve, tasking, reset: () => { softKill.clear(); released = []; } };
}
