// The enemy: launching drones, how they fly and get jammed, and what happens when they are destroyed or get through.

import { Vector3 } from 'three';
import { WORLD, SITE, DRONES, ADAPT } from './config/index.js';
import { jamming } from './jamming.js';
import { rand, gauss } from './rng.js';
import { u, hdist, clamp, groundM, hereU, onMap } from './units.js';
import { tally } from './economy.js';
import { chooseAim, pickTarget, hitStructure } from './targeting.js';
import { blastInAir, blastOnGround, blastOnSite } from './people.js';
import { launchDistance, launchPoint } from './attack-area.js';
import { logEnd, logLaunch } from './flight-log.js';

const _v = new Vector3();
const SPOTTER_CLEARANCE = 30; // metres

// In the sandbox the enemy adapts to the level chosen there instead of to the wave number.
const effWave = ({ state }) => (state.sandbox ? state.sbLevel : state.wave);

export function spawnDrone(w, type, bearing, rolls = {}) {
  const def = DRONES[type];
  tally(w.ledger.launched, type); // the attacker pays for every drone it launches
  // the enemy adapts: later waves spawn harder to hit and harder to jam
  const k = Math.max(effWave(w) - 1, 0) * (def.adapt ?? 1);
  const evade = Math.max(Math.min(ADAPT.evadeFloor, def.evade), def.evade * (1 - ADAPT.evadePerWave * k));
  const jamResist = Math.max(def.jamResist, Math.min(ADAPT.jamResistCap, def.jamResist + ADAPT.jamResistPerWave * k));

  // chance is pre-rolled by the wave's seeded stream; ad-hoc spawns (console, tests) draw from the sim stream
  const jitter = rolls.jitter ?? (rand() - 0.5) * 0.3;
  const altFrac = rolls.altFrac ?? rand();
  const dist = rolls.dist ?? rand(); // how far across its launch band it starts
  const a = bearing + jitter;
  const { x: sx, z: sz } = launchPoint(w.state.zoneCentre, a, launchDistance(def, dist));
  // metres above the ground at the spawn point: the roll picks one of its height bands, if it flies more than one, then a height in it
  const bands = def.altModes ?? [def.alt], b = Math.min(bands.length - 1, Math.floor(altFrac * bands.length)), [lo, hi] = bands[b];
  const agl = lo + (altFrac * bands.length - b) * (hi - lo);
  const y = hereU(sx, sz) + u(agl);
  const pos = new Vector3(sx, y, sz);
  const aim = w.state.zone && def.role !== 'spotter' ? chooseAim(w, rand) : null; // only a drawn area uses a random draw, so runs without one are unchanged
  const uid = ++w.droneUid;
  const d = {
    uid, def, type, pos, launch: pos.clone(),
    hp: def.hp, evade, jamResist, jamT: 0, detected: false, dead: false,
    agl0: agl, h0: aim ? Math.max(Math.hypot(sx - aim.x, sz - aim.z), 1) : Math.hypot(sx, sz), // launch height above ground and distance, for the descent
    mode: 'approach', angle: 0, orbitT: 0, bank: 0, heading: 0, // spotter state
    vel: new Vector3(), track: null, nav: 0, videoJammed: false, targetStructure: null, aim,
  };
  w.drones.push(d);
  logLaunch(w, d);
  w.rec.event('launch', `${def.name} launched`, d.uid);
  return d;
}

export function removeDrone(w, d) {
  d.dead = true;
  w.net.onDroneRemoved(d);
  const i = w.drones.indexOf(d);
  if (i >= 0) w.drones.splice(i, 1);
}

// `by` is the id of whatever did the damage ('laser', 'interceptor', 'missile', ...), for the cost ledger. src: the system that
// did it, if known, for the statistics.
function recordKill(w, d, by, src) {
  blastInAir(w, d);
  logEnd(w, d, 'killed', src?.def.id ?? by, src);
  w.rec.event('kill', `${d.def.name} destroyed by ${by}`, d.uid);
  w.state.kills++;
  tally(w.ledger.killed, d.type);
  w.ledger.killedBy[by] = w.ledger.killedBy[by] || {};
  tally(w.ledger.killedBy[by], d.type);
}
export function damageDrone(w, d, amount, by, src) {
  if (d.dead) return;
  d.hp -= amount;
  if (d.hp <= 0) {
    recordKill(w, d, by, src);
    w.emit('explosion', { pos: d.pos, r: u(80), color: 0xffcc66 });
    removeDrone(w, d);
  }
}

// each spotter on station makes every strike hit harder
export const spotterBonus = (w) => w.drones.reduce((sum, d) => sum + (d.mode === 'orbit' && !d.videoJammed ? d.def.spotBonus || 0 : 0), 0); // a spotter with jammed video can't help

// onPatrol: the patrol's spot, when that is what it reached. It lands among the people there, as a strike on a system lands on it.
function impact(w, d, onPatrol) {
  const { state, ledger, net } = w;
  w.rec.event('leak', `${d.def.name} hit the ${onPatrol ? 'patrol' : 'site'}`, d.uid);
  if (onPatrol) blastOnGround(w, d, onPatrol.x, onPatrol.z); else blastOnSite(w, d);
  state.leaks++; tally(ledger.leaked, d.type);
  logEnd(w, d, 'leaked');
  if (!state.sandbox) state.health = Math.max(state.health - d.def.damage * (1 + spotterBonus(w)), 0);
  w.emit('siteHit');
  net.raiseAlert('critical', `${onPatrol ? 'Patrol' : 'Site'} impact by ${d.def.name}: integrity ${Math.round(state.health)}%`, d.pos, 'DISCRETE_PRIORITY_HIGH');
  w.emit('explosion', { pos: d.pos, r: u(150), color: 0xff5252 });
  removeDrone(w, d);
  if (state.health <= 0 && !state.sandbox) { state.over = true; w.emit('gameOver'); }
}

// Spotter: flies out to its standoff radius, orbits for loiterTime, then leaves. Returns false if it was removed.
function moveSpotter(w, d, spd, dt) {
  const r = u(d.def.loiterDist), c = w.state.zoneCentre;
  d.pos.y = Math.max(d.pos.y, hereU(d.pos.x, d.pos.z) + u(SPOTTER_CLEARANCE)); // it holds one height, which real mountains can reach
  if (d.mode === 'approach') {
    if (hdist(d.pos, c) <= r) {
      d.mode = 'orbit'; d.angle = Math.atan2(d.pos.z - c.z, d.pos.x - c.x); d.orbitT = 0;
      w.rec.event('spotter', `${d.def.name} on station`, d.uid);
      w.emit('toast', `${d.def.name} on station: strikes +${Math.round(d.def.spotBonus * 100)}% damage`);
    } else {
      _v.set(c.x - d.pos.x, 0, c.z - d.pos.z).normalize().multiplyScalar(spd);
      d.pos.add(_v);
    }
  } else if (d.mode === 'orbit') {
    d.angle += spd / r;
    d.pos.set(c.x + Math.cos(d.angle) * r, d.pos.y, c.z + Math.sin(d.angle) * r);
    d.orbitT += dt;
    if (d.orbitT >= d.def.loiterTime) d.mode = 'egress';
  } else {
    _v.set(d.pos.x - c.x, 0, d.pos.z - c.z).normalize().multiplyScalar(spd);
    d.pos.add(_v);
    if (hdist(d.pos, c) > u(WORLD.spawnDist) || !onMap(d.pos.x, d.pos.z)) { tally(w.ledger.escaped, d.type); logEnd(w, d, 'left'); removeDrone(w, d); return false; }
  }
  return true;
}

// Strike: fly at the target, hugging the terrain. Returns false if it was removed.
function moveStrike(w, d, spd) {
  // GNSS drift can turn it away for good. Only a drifted drone is held to the circle: one from off the map can start at a corner, further out.
  if (!onMap(d.pos.x, d.pos.z) || (d.nav && hdist(d.pos, w.state.zoneCentre) > u(WORLD.radius))) { tally(w.ledger.escaped, d.type); logEnd(w, d, 'left'); w.rec.event('escaped', `${d.def.name} left the area`, d.uid); removeDrone(w, d); return false; }
  const tgt = pickTarget(w, d);
  const hrem = Math.hypot(tgt.x - d.pos.x, tgt.z - d.pos.z);
  if (tgt.structure || d.aim || tgt.patrol ? hrem < u(30) : hrem < u(SITE.radius)) { if (tgt.structure) hitStructure(w, d, tgt.structure); else impact(w, d, tgt.patrol && tgt); return false; }
  // height above ground: a fixed-wing drone holds its cruise height until it can reach the target diving at SITE.diveAngle, then dives;
  // a multirotor eases down over its whole run, as an operator brings it in low. Never below the type's minimum until within 400 m,
  // and climbing early over rising ground
  let dirx = (tgt.x - d.pos.x) / hrem, dirz = (tgt.z - d.pos.z) / hrem;
  if (d.nav) { const c = Math.cos(d.nav), sn = Math.sin(d.nav); [dirx, dirz] = [dirx * c - dirz * sn, dirx * sn + dirz * c]; } // GNSS drift
  d.pos.x += dirx * spd; d.pos.z += dirz * spd;
  const dive = SITE.targetAlt + hrem * WORLD.metresPerUnit * Math.tan((SITE.diveAngle * Math.PI) / 180);
  const glide = d.agl0 + (SITE.targetAlt - d.agl0) * (1 - clamp(hrem / d.h0, 0, 1));
  const want = Math.max(d.def.airframe === 'Fixed wing' ? Math.min(d.agl0, dive) : glide, (d.def.minAgl || 0) * Math.min(1, hrem / u(400)));
  const ahead = Math.max(groundM(d.pos.x, d.pos.z), groundM(d.pos.x + dirx * u(150), d.pos.z + dirz * u(150)));
  d.pos.y += clamp(u(ahead + want) - d.pos.y, -spd * 1.2, spd * 0.8);
  d.pos.y = Math.max(d.pos.y, hereU(d.pos.x, d.pos.z) + u(3));
  return true;
}

// Jamming. Each jammer that is on jams the links it reaches (jamming.js), and what that does depends on what the drone relies on: a
// jammed control link slows it and eventually crashes it, a jammed video link does the same more slowly (it is flying blind), and
// jammed GNSS makes a navigating drone drift off course (and the drift stays). A reactive jammer breaks a link sooner.
// Returns the speed multiplier, or null if the drone crashed.
function applyJamming(w, d, dt) {
  let ctrl = false, vid = false, gnss = false, killTime = Infinity, ctrlSlow = 1, rate = 1, src = null;
  for (const s of w.structures) {
    if (s.def.kind !== 'jammer' || s.mode !== 'Jam') continue;
    const j = jamming(s, d, w.structures);
    if (!j) continue;
    if (j.control) { ctrl = true; ctrlSlow = Math.min(ctrlSlow, s.def.slow); }
    if (j.video) vid = true;
    if (j.gnss) gnss = true;
    if (s.def.killTime < killTime) { killTime = s.def.killTime; src = s; } // the quickest one gets the credit
    rate = Math.max(rate, j.rate);
  }
  const eff = 1 - d.jamResist;
  let slow = 1;
  const jamRate = ctrl ? 1 : vid ? 0.5 : 0;
  if (jamRate && eff > 0) {
    slow = 1 - (1 - (ctrl ? ctrlSlow : 0.7)) * eff;
    d.jamT += dt * eff * jamRate * rate;
    if (d.jamT >= killTime) {
      recordKill(w, d, 'jammer', src);
      w.emit('explosion', { pos: d.pos, r: u(80), color: 0xba68c8 });
      removeDrone(w, d);
      return null;
    }
  } else d.jamT = Math.max(0, d.jamT - dt * 0.5);
  d.videoJammed = vid;
  if (gnss) d.nav += gauss() * 0.08 * Math.sqrt(dt);
  return slow;
}

export function updateDrones(w, dt) {
  for (let i = w.drones.length - 1; i >= 0; i--) {
    const d = w.drones[i];
    d.detected = w.net.isTracked(d);
    const slow = applyJamming(w, d, dt);
    if (slow === null) continue;

    const px = d.pos.x, py = d.pos.y, pz = d.pos.z;
    const spd = u(d.def.speed) * slow * dt;
    if (!(d.def.role === 'spotter' ? moveSpotter(w, d, spd, dt) : moveStrike(w, d, spd))) continue;
    const dx = d.pos.x - px, dz = d.pos.z - pz;
    if (dt > 0) d.vel.set(dx, d.pos.y - py, dz).divideScalar(dt);
    if (dx || dz) d.heading = Math.atan2(dx, dz);
    if (d.def.bank) d.bank += ((d.mode === 'orbit' ? d.def.bank : 0) - d.bank) * Math.min(1, dt * 2); // fixed-wing banks into its orbit
  }
}
