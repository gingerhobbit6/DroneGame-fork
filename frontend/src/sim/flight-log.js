// What happened to each drone, for the statistics (stats.js): when and how far out each kind of sensor first saw it, the shots
// fired at it, and how and where it ended. It only writes things down, draws no random numbers and is left out of the run's
// fingerprint, so a run plays the same with it.

import { WORLD } from './config/index.js';
import { hdist } from './units.js';

const metres = (units) => Math.round(units * WORLD.metresPerUnit);

export function logLaunch(w, d) {
  d.log = { uid: d.uid, type: d.type, wave: w.state.wave, t0: w.state.time, seen: {}, shots: {}, engaged: null, end: null };
  w.ledger.flights.push(d.log);
}

// A sensor of this kind saw it: when, how far from the sensor (slant, metres) and how far from what is defended.
export function logSeen(d, id, t, range, fromSite) {
  if (d.log && !d.log.seen[id]) d.log.seen[id] = { t, range: Math.round(range), site: Math.round(fromSite) };
}

// One shot (a round, or a second of beam) at it. Returns the shot's tally, so a round in the air can count its hit.
export function logShot(w, d, def) {
  if (!d?.log) return null;
  d.log.engaged ??= w.state.time;
  const e = (d.log.shots[def.id] ||= { n: 0, cost: 0, hits: 0 });
  e.n++; e.cost += def.shotCost || 0;
  return e;
}

// end: 'killed', 'leaked' (reached the site), 'struck' (hit one of your systems) or 'left'. by: the system that downed it, at src.
export function logEnd(w, d, end, by = null, src = null) {
  const f = d.log;
  if (!f || f.end) return;
  Object.assign(f, { end, by, t1: w.state.time, site: metres(hdist(d.pos, w.state.zoneCentre)), from: src ? metres(d.pos.distanceTo(src.pos)) : null });
}
