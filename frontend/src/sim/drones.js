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
// A spoofer drags a drone's course round by up to `turn` radians (120°, so it spirals away rather than in) at `rate` rad/s: ASSUMPTIONS.
const SPOOF = { turn: 2.1, rate: 0.15 };

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
// did it, if known, for the statistics. A drone landed whole does not go off.
function recordKill(w, d, by, src = null, text = `${d.def.name} destroyed by ${by}`, blast = true) {
  if (blast) blastInAir(w, d);
  logEnd(w, d, 'killed', src?.def.id ?? by, src);
  w.rec.event('kill', text, d.uid);
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

// Flies away from what is defended until it is off the map. Returns false once it has gone.
function leave(w, d, spd) {
  const c = w.state.zoneCentre;
  _v.set(d.pos.x - c.x, 0, d.pos.z - c.z).normalize().multiplyScalar(spd);
  d.pos.add(_v);
  if (hdist(d.pos, c) > u(WORLD.spawnDist) || !onMap(d.pos.x, d.pos.z)) { tally(w.ledger.escaped, d.type); logEnd(w, d, 'left'); removeDrone(w, d); return false; }
  return true;
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
  } else return leave(w, d, spd);
  return true;
}

// Strike: fly at the target, hugging the terrain. Returns false if it was removed.
function moveStrike(w, d, spd) {
  // GNSS drift can turn it away for good. Only a drifted drone is held to the circle: one from off the map can start at a corner, further out.
  if (!onMap(d.pos.x, d.pos.z) || (d.nav && hdist(d.pos, w.state.zoneCentre) > u(WORLD.radius))) { tally(w.ledger.escaped, d.type); logEnd(w, d, 'left'); w.rec.event('escaped', `${d.def.name} left the area`, d.uid); removeDrone(w, d); return false; }
  if (d.mode === 'home') return leave(w, d, spd);
  const tgt = pickTarget(w, d);
  const hrem = Math.hypot(tgt.x - d.pos.x, tgt.z - d.pos.z);
  d.toGo = hrem * WORLD.metresPerUnit; // for its own homing, next step
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

// Jamming. Each jammer that is on jams the links it reaches (jamming.js), and what that does depends on what the drone relies on and
// how it is flown (lostLink). Jammed GNSS makes a navigating drone drift off course, and the drift stays; anti-jam antennas
// (jamResist) cut the drift. A jammed control link slows it until, after the jammer's killTime, the link is lost:
//  - 'crash', the default: flown by hand, it comes down, as a first-person-view drone's flight controller drops it on losing its link
//  - 'home': it flies itself, so it gives up and turns for home, as DJI drones do on losing their controller; with its satellite
//    navigation jammed too it cannot find home and drifts down
// A jammed video link brings down a drone flown by hand, more slowly, as it is flying blind; one that flies itself is only blinded.
// Within `terminal` metres of its target a drone with a homing module flies on by itself, so jamming no longer touches it.
// A reactive jammer breaks a link sooner. Returns the speed multiplier, or null if the drone came down.
function applyJamming(w, d, dt) {
  if (d.toGo <= (d.def.terminal ?? 0)) { d.videoJammed = false; return 1; }
  let ctrl = false, vid = false, gnss = false, spoof = false, takeover = false, killTime = Infinity, ctrlSlow = 1, rate = 1, src = null;
  for (const s of w.structures) {
    if (s.def.kind !== 'jammer' || s.mode !== 'Jam') continue;
    const j = jamming(s, d, w.structures);
    if (!j) continue;
    if (j.control) { ctrl = true; ctrlSlow = Math.min(ctrlSlow, s.def.slow); }
    if (j.video) vid = true;
    if (j.gnss) gnss = true;
    if (j.spoof) spoof = true;
    if (j.takeover) takeover = true;
    if (s.def.killTime < killTime) { killTime = s.def.killTime; src = s; } // the quickest one gets the credit
    rate = Math.max(rate, j.rate);
  }
  const eff = 1 - d.jamResist, flown = d.def.lostLink !== 'home';
  if (takeover) { // taken over: once in, the jammer lands it
    d.takeT = (d.takeT ?? 0) + dt * eff;
    if (d.takeT >= killTime) { recordKill(w, d, 'jammer', src, `${d.def.name} taken over and landed`, false); removeDrone(w, d); return null; }
  }
  if (spoof) { const pull = SPOOF.turn - d.nav; d.nav += Math.sign(pull) * Math.min(Math.abs(pull), SPOOF.rate * eff * dt); } // anti-jam antennas resist it too
  let slow = 1;
  const jamRate = ctrl ? 1 : vid && flown ? 0.5 : 0;
  if (jamRate && eff > 0 && d.mode !== 'home' && d.mode !== 'egress') { // nothing more to do to one already leaving
    slow = 1 - (1 - (ctrl ? ctrlSlow : 0.7)) * eff;
    d.jamT += dt * eff * jamRate * rate;
    if (d.jamT >= killTime) {
      if (!flown && !gnss) { // it knows where home is
        d.mode = d.def.role === 'spotter' ? 'egress' : 'home';
        tally(w.ledger.turned, d.type);
        w.rec.event('jammed', `${d.def.name} lost its link and turned for home`, d.uid);
        w.emit('toast', `${d.def.name} lost its link and turned for home`);
      } else {
        recordKill(w, d, 'jammer', src);
        w.emit('explosion', { pos: d.pos, r: u(80), color: 0xba68c8 });
        removeDrone(w, d);
        return null;
      }
    }
  } else d.jamT = Math.max(0, d.jamT - dt * 0.5);
  d.videoJammed = vid;
  if (gnss) d.nav += gauss() * 0.08 * eff * Math.sqrt(dt);
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
