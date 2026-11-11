// Effectors act only on tasks from the fusion node. Each one is looked up by how it fires: act(w, system, target, dt).

import { Vector3 } from 'three';
import { WORLD, muzzleHeight } from './config/index.js';
import { beamFactor, evasionFactor, hitChance, layTime } from './hit-chance.js';
import { rand } from './rng.js';
import { antennaHeight, usesPath } from './site-range.js';
import { terrainState } from './terrain.js';
import { clearSight } from './world.js';
import { u, hereU, hdist } from './units.js';
import { affordable, spend, tally } from './economy.js';
import { damageDrone } from './drones.js';
import { canFire, updateMagazine, useRound } from './magazine.js';
import { crewTask, crewed } from './crew.js';
import { logShot } from './flight-log.js';

const _v = new Vector3(), _m = new Vector3(), _from = new Vector3(), _near = new Vector3();
const MISS_COLOUR = 0x90a4ae;
const SALVO_ASSURANCE = 0.8; // a salvo stops once it is this likely that one of the rounds in the air will work: an assumption

// where a round leaves: muzzleY model units up, at true size (SYSTEM_UNIT_M metres each)
export const muzzle = (s, out = _m) => out.set(s.pos.x, s.pos.y + u(muzzleHeight(s.def)), s.pos.z);

// A laser, a gun and a beam-riding missile need a clear optical path; other guided weapons (interceptor drones, missiles) are cued over the terrain.
export function opticalLos(s, d) {
  if (!usesPath(s.def)) return true;
  const m = WORLD.metresPerUnit;
  const r = terrainState.data.los(s.pos.x * m, s.pos.y * m + antennaHeight(s.def), s.pos.z * m, d.pos.x * m, d.pos.y * m, d.pos.z * m);
  return clearSight(r);
}

const aimAt = (s, t) => { s.aim = Math.atan2(t.pos.x - s.pos.x, t.pos.z - s.pos.z); };

function launchMissile(w, s, t, shot) {
  const speed = u(s.def.missileSpeed), track = s.task && w.net.tracks.get(s.task.trackId);
  const pos = muzzle(s).clone();
  // a gun fires straight at its target; a missile or interceptor leaves its launcher climbing, then steers in
  const vel = s.def.kind === 'gun' ? new Vector3().subVectors(t.pos, pos).setLength(speed) : new Vector3(0, speed * 0.6, 0);
  w.missiles.push({
    def: s.def, pos, vel, target: t, life: (s.def.range / s.def.missileSpeed) * 1.5,
    from: s.pos.distanceTo(t.pos) * WORLD.metresPerUnit, cueError: track?.estErr ?? 0, // what its chance depends on, as it was fired
    src: s, shot, // for the statistics: who fired it, and the tally its hit counts in
  });
}

// Is it worth holding fire on this target? Shoot, look, shoot while there is time to see the result and fire again. When there is not, keep
// firing until the rounds in the air are likely enough to do it, as a crew would with a target about to arrive.
export function enoughInAir(w, s, t) {
  const flying = w.missiles.filter((m) => m.target === t);
  if (flying.reduce((sum, m) => sum + m.def.damage, 0) < t.hp) return false; // not enough to kill it even if they all hit
  const m = WORLD.metresPerUnit, flight = (s.pos.distanceTo(t.pos) * m) / s.def.missileSpeed;
  if ((hdist(t.pos, w.state.zoneCentre) * m) / t.def.speed > 2 * flight + s.def.cooldown) return true;
  const allMiss = flying.reduce((chance, r) => chance * (1 - hitChance(r.def, { speed: t.def.speed, evade: t.evade }, r.from, r.cueError)), 1);
  return 1 - allMiss >= SALVO_ASSURANCE;
}

const FIRE = {
  beam(w, s, t, dt) {
    if (t && !opticalLos(s, t)) t = null; // terrain or trees in the way
    const def = s.def;
    const on = t ? t.uid : null;
    if (on !== s.laidOn) { s.laidOn = on; s.layT = 0; } // a new target, or one lost from view: swing onto it and settle before firing
    if (t) { aimAt(s, t); s.layT += dt; }
    const firing = !!t && s.layT >= layTime(def) && affordable(w, s) && canFire(s);
    s.beamTarget = firing ? t : null;
    if (firing && !s.beamOn) { spend(w, s); useRound(w, s); logShot(w, t, def); s.beamT = 0; } // a shot is charged when the beam starts, then every second it stays on
    s.beamOn = firing;
    if (!firing) return;
    s.beamT = (s.beamT || 0) + dt; // a "shot" is a second of beam time
    while (s.beamT >= 1) { s.beamT -= 1; spend(w, s); useRound(w, s); logShot(w, t, def); }
    const rate = def.dps * evasionFactor(t.evade) * beamFactor(def, s.pos.distanceTo(t.pos) * WORLD.metresPerUnit); // evasion and distance spoil its dwell
    damageDrone(w, t, rate * dt, def.id, s);
  },
  guided(w, s, t) {
    if (t && s.cd <= 0 && !opticalLos(s, t)) t = null;
    if (!t) return;
    aimAt(s, t);
    const def = s.def;
    if (s.cd > 0 || !affordable(w, s) || !canFire(s)) return;
    s.cd = def.cooldown;
    if (enoughInAir(w, s, t)) { s.cd = 0.3; return; }
    spend(w, s);
    useRound(w, s);
    launchMissile(w, s, t, logShot(w, t, def));
  },
  // a jammer's effect is applied to each drone it covers (see drones.js), and its time on is counted below
  jam() {},
};
export const FIRE_MODES = Object.keys(FIRE);

export function updateStructures(w, dt) {
  const { state } = w;
  for (const s of w.structures) {
    const def = s.def;
    s.cd = Math.max(0, s.cd - dt);
    if (def.role === 'sensor') continue;
    updateMagazine(w, s, dt);
    if (crewed(def)) crewTask(w, s, dt); // off the network, its crew picks its own target
    if (def.kind === 'jammer' && s.mode === 'Jam') { s.jamTime = (s.jamTime || 0) + dt; tally(w.ledger.jamTime, def.id, dt); } // this unit's, and its type's
    const near = s.task && s.pos.distanceTo(s.task.drone.pos);
    const t = s.task && state.time >= (s.task.activeAt || 0) && !s.task.drone.dead && near <= u(def.range) && near >= u(def.minRange ?? 0) ? s.task.drone : null; // acts once its task has arrived
    FIRE[def.fire](w, s, t, dt);
  }
}

// How close the path from a to b comes to p, with that point in out.
export function closestOnPath(a, b, p, out) {
  out.subVectors(b, a);
  const len2 = out.lengthSq(), t = len2 ? Math.min(1, Math.max(0, _v.subVectors(p, a).dot(out) / len2)) : 0;
  out.multiplyScalar(t).add(a);
  return out.distanceTo(p);
}

export function updateMissiles(w, dt) {
  const { missiles, drones } = w;
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    m.life -= dt;
    if (!m.target || m.target.dead) {
      m.target = null;
      let bd = u(1500);
      for (const d of drones) { if (!d.detected) continue; const dd = d.pos.distanceTo(m.pos); if (dd < bd) { bd = dd; m.target = d; } }
    }
    if (m.target) {
      _v.subVectors(m.target.pos, m.pos).normalize().multiplyScalar(u(m.def.missileSpeed));
      m.vel.lerp(_v, 1 - Math.exp(-4 * dt));
    }
    _from.copy(m.pos);
    m.pos.addScaledVector(m.vel, dt);
    const r = u(m.def.fuze);
    let fuzed = !!m.target && m.pos.distanceTo(m.target.pos) < r;
    // A fast round flies further in a step than its fuze reaches, so it could pass clean through its target between checks:
    // look along the path it just flew too, and burst where it came closest.
    if (m.target && !fuzed && closestOnPath(_from, m.pos, m.target.pos, _near) < r) { m.pos.copy(_near); fuzed = true; }
    // a gun's muzzle is lower than the 4 m margin, and its round flies straight, so it is held only to the ground itself
    if (fuzed || m.life <= 0 || m.pos.y < hereU(m.pos.x, m.pos.z) + (m.def.kind === 'gun' ? 0 : 0.2)) {
      const hit = fuzed && (!m.def.beamRider || opticalLos(m.src, m.target)) && rand() < hitChance(m.def, { speed: m.target.def.speed, evade: m.target.evade }, m.from, m.cueError); // a beam-rider is lost once its launcher cannot see the target
      if (hit) { // it reaches its target, and its blast anything else close by. A miss costs the round and does nothing.
        if (m.shot) m.shot.hits++;
        const r = u(m.def.splash);
        for (const d of drones.slice()) if (d === m.target || d.pos.distanceTo(m.pos) < r) damageDrone(w, d, m.def.damage, m.def.id, m.src);
      }
      w.emit('explosion', { pos: m.pos, r: u(m.def.splash) * (hit ? 1 : 0.5), color: hit ? 0xff8844 : MISS_COLOUR });
      missiles.splice(i, 1);
    }
  }
}
