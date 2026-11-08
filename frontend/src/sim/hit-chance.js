// How likely a shot is to work, and how fast a beam burns. One place, so that the rolls in play and the odds in the panel cannot disagree.
// A system's `pk` is its chance against an easy, slow target close in, on a good track. Most are assumptions: each `ref` says which.

import { FUSION } from './config/index.js';

// Share of the chance lost at the weapon's limit, for the longer flight and lower energy: an assumption. A gun with no airburst round sets
// its own, larger rangeLoss, because its spread grows with distance until a burst passes round a small drone.
const RANGE_LOSS = 0.25;
// The faster the target against the round, the sharper the turn to lead it. With evasion and the track, a Sting takes about three rounds a
// Shahed in play, as Ukrainian crews report two to three interceptors a kill (the 68% Zelenskyy gave is per target, not per interceptor).
const LEAD_LOSS = 0.5;
const DODGE_SPEED = 3;    // a round up to this many times its target's speed feels every turn it makes; a faster one, less: an assumption
const MIN_LEAD = 0.1;     // a round slower than its target can still meet it head on
const BEAM_FULL = 0.25;   // a beam is at full strength out to this share of its range, because the spot has not yet spread

// Seconds until a round flying straight at `speed` meets a target `p` away moving at `v` (both [east, north, up], in metres and m/s),
// or Infinity if it never can: a round slower than its target only catches one coming its way. Solves |p + v t| = speed t.
export function meetTime(p, v, speed) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = dot(v, v) - speed * speed, b = 2 * dot(p, v), c = dot(p, p);
  if (Math.abs(a) < 1e-9) return b < 0 ? -c / b : Infinity;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const ts = [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)].filter((t) => t > 0);
  return ts.length ? Math.min(...ts) : Infinity;
}

// Evasion spoils a shot and a beam's dwell alike. 1 is no manoeuvre.
export const evasionFactor = (evade) => 0.5 + 0.5 * evade;
// What evasion leaves of a round's chance: a missile many times faster than a drone barely notices it turn.
const dodged = (def, target) => 1 - (1 - evasionFactor(target.evade)) * Math.min(1, (DODGE_SPEED * target.speed) / def.missileSpeed);

// The chance one round works, given how far it had to fly and how good the track was when it was fired.
export function hitChance(def, target, rangeM, cueErrorM = 0) {
  const lead = target.speed / def.missileSpeed;
  const speed = Math.max(MIN_LEAD, 1 - LEAD_LOSS * lead * lead);
  const far = Math.min(rangeM / def.range, 1);
  const cue = 1 / (1 + (cueErrorM / FUSION.acquireRadius) ** 2); // the seeker has to find it from where the track says it is
  return Math.min(1, (def.pk ?? 1) * dodged(def, target) * speed * (1 - (def.rangeLoss ?? RANGE_LOSS) * far * far) * cue);
}

// Share of a beam's damage rate left at this range. Dwell doubles when the range doubles, as ST Engineering publishes for its CDLE laser:
// 5 s at 0.5 km and 10 s at 1 km. shortcut: no rain or haze, which reduce it further. Add them with weather.
export const beamFactor = (def, rangeM) => Math.min(1, (BEAM_FULL * def.range) / Math.max(rangeM, 1));

// Seconds a laser takes to swing onto a new target and settle its tracker before the beam goes on. Raytheon's 15 kW laser downed three
// drones in 34 s with about 5 s of dwell on each, so about 6 s a drone went on finding and laying on the next: 4 s is an assumption below
// that. An RF weapon steers its beam electronically, so it has none.
export const layTime = (def) => (def.rfBeam ? 0 : 4);

// Seconds of beam to destroy this target at this range.
export const burnTime = (def, target, rangeM) => target.hp / (def.dps * evasionFactor(target.evade) * beamFactor(def, rangeM));
