// Short-lived things in the scene: missiles in flight and their smoke, gun tracer, and explosions with their fire, smoke, dust,
// debris and scorch marks. Particles come from fixed pools, the oldest reused, so a heavy wave costs no more than a light one.
// Sizes are true up close and from a mast (by distance from the camera there), and grown like the systems when zoomed out.

import * as THREE from 'three';
import { muzzle } from '../sim/effectors.js';
import { u } from '../sim/units.js';
import { SOFT_DOT, createParticles } from './particles.js';
import { TRUE_UNIT, drawnUnit } from './system-parts.js';
import { groundU } from './terrain-view.js';
import { view } from './view.js';
import { wideLines } from './wide-lines.js';

const missileGeo = new THREE.ConeGeometry(0.35, 1.8, 8).rotateX(Math.PI / 2);
const missileMat = new THREE.MeshBasicMaterial({ color: 0xffffff }), interceptorMat = new THREE.MeshBasicMaterial({ color: 0xffcdd2 });
const scorchGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
export const POOLS = { smoke: 4096, glow: 512, tracers: 256, heads: 256, marks: 32 };
const SCORCH_LIFE = 60; // seconds a scorch mark takes to fade
const STRIKE = 0xff5252; // the simulation's colour for a strike, which lands on the ground or a system
const UP = new THREE.Vector3(0, 1, 0), WHITE = new THREE.Color(0xffffff), HEAD = new THREE.Color(0xff5a2a), TAIL = new THREE.Color(0); // red tracer
const FLAME = new THREE.Color(0xffd9a0), DRONE_LIGHT = new THREE.Color(0x9fdcff); // a missile's motor, and a mark on an interceptor drone
const HEAD_PX = 9; // a missile or interceptor in flight is marked by a glow this many pixels across, so it can be followed to its target
const c = (hex) => new THREE.Color(hex);
// Each kind of particle at k = 1: life (s), diameter from and to, alpha, lift (upward acceleration), drag (1/s), colour (or the event's).
// Trail, launch, muzzle, gun and debris ones are in scene units at true size, k being how much larger than life they are drawn;
// core, fire, smoke and dust are in fireball diameters.
const LOOK = {
  trail: { life: 3, from: u(4), to: u(20), alpha: 0.4, lift: u(0.5), drag: 0.5, colour: c(0xe4e4e4) },
  launch: { life: 2.5, from: u(5), to: u(22), alpha: 0.55, lift: u(0.5), drag: 1.5, colour: c(0xd8d8d8) },
  launchFlash: { life: 0.15, from: u(5), to: u(8), alpha: 1, colour: c(0xffe6b0) },
  muzzle: { life: 0.06, from: u(2), to: u(3), alpha: 1, colour: c(0xffd27a) },
  burst: { life: 0.12, from: u(2), to: u(5), alpha: 0.9 },
  puff: { life: 1.2, from: u(1.5), to: u(6), alpha: 0.45, lift: u(0.5), drag: 1, colour: c(0x9a9a9a) },
  kick: { life: 1.5, from: u(1.5), to: u(6), alpha: 0.6, drag: 2, colour: c(0x8a7a64) },
  debris: { life: 2, from: u(1), to: u(1), alpha: 1, lift: -u(9.8), drag: 0.2, colour: c(0x1c1915) },
  core: { life: 0.15, from: 0.8, to: 1.4, alpha: 1 },
  fire: { life: 0.55, from: 0.4, to: 1.2, alpha: 0.85, drag: 2 },
  smoke: { life: 4, from: 0.5, to: 2.2, alpha: 0.6, lift: 0.08, drag: 0.6, colour: c(0x2a2622) },
  dust: { life: 5, from: 0.7, to: 3, alpha: 0.5, lift: 0.05, drag: 1.2, colour: c(0x8a7a64) },
};
const rnd = (s) => (Math.random() * 2 - 1) * s;
const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color(), _w = new THREE.Color();

export function createEffects(scene, sim, camera) {
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; // short effects and no debris
  const smoke = createParticles(scene, 'smoke', POOLS.smoke, THREE.NormalBlending, calm ? 0.4 : 1);
  const glow = createParticles(scene, 'glow', POOLS.glow, THREE.AdditiveBlending, calm ? 0.4 : 1);
  const unitAt = (p) => drawnUnit(view.eye ? camera.position.distanceTo(p) : undefined); // seen from a mast, sized by its own distance
  const grow = (p) => unitAt(p) / TRUE_UNIT;

  // Gun tracer: a red streak a few pixels wide for each round, bright at the head and fading to nothing at the tail.
  const tracer = wideLines(POOLS.tracers, { width: 2.5, name: 'tracers' }), tracers = tracer.lines;
  scene.add(tracers);

  // A glow on each missile and interceptor in flight, the same size on the screen however far off.
  const headPos = new Float32Array(POOLS.heads * 3), headCol = new Float32Array(POOLS.heads * 3), headGeo = new THREE.BufferGeometry();
  headGeo.setAttribute('position', new THREE.BufferAttribute(headPos, 3).setUsage(THREE.DynamicDrawUsage));
  headGeo.setAttribute('color', new THREE.BufferAttribute(headCol, 3).setUsage(THREE.DynamicDrawUsage));
  headGeo.setDrawRange(0, 0);
  const heads = new THREE.Points(headGeo, new THREE.PointsMaterial({ size: HEAD_PX * Math.min(globalThis.devicePixelRatio || 1, 2), sizeAttenuation: false, map: SOFT_DOT, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  heads.name = 'heads';
  heads.frustumCulled = false;
  scene.add(heads);

  // Scorch marks: a few flat dark spots laid on the ground, the oldest reused.
  const scorch = new THREE.Group();
  scorch.name = 'scorch';
  scene.add(scorch);
  const marks = Array.from({ length: POOLS.marks }, () => {
    const mesh = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({ map: SOFT_DOT, color: 0x15110d, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    mesh.visible = false;
    scorch.add(mesh);
    return { mesh, age: Infinity, size: 0 };
  });
  let nextMark = 0;
  function scorchAt(x, z, d) {
    const s = marks[nextMark], h = d / 2;
    nextMark = (nextMark + 1) % POOLS.marks;
    _n.set(groundU(x - h, z) - groundU(x + h, z), d, groundU(x, z - h) - groundU(x, z + h)).normalize(); // tilted to lie on a slope
    s.mesh.quaternion.setFromUnitVectors(UP, _n);
    s.mesh.position.set(x, groundU(x, z), z);
    s.age = 0; s.size = d;
  }

  // Rounds in flight, keyed by their position, which is also what a round's explosion passes.
  const shots = new Map();
  let frame = 0;
  function launch(m) {
    const kind = m.def.kind, gun = kind === 'gun', from = new THREE.Vector3();
    let best = null, bd = m.vel.lengthSq(); // its launcher is the nearest of its kind within a second's flight
    for (const s of sim.structures) if (s.def === m.def && s.pos.distanceToSquared(m.pos) < bd) { bd = s.pos.distanceToSquared(m.pos); best = s; }
    if (best) muzzle(best, from); else from.copy(m.pos);
    const st = { gun, smoky: !gun && kind !== 'interceptor', from, last: from.clone(), mesh: null, seen: 0 }, g = grow(from);
    if (gun) glow.spawn(LOOK.muzzle, from.x, from.y, from.z, 0, 0, 0, g);
    else if (st.smoky) {
      glow.spawn(LOOK.launchFlash, from.x, from.y, from.z, 0, 0, 0, g);
      for (let i = 0; i < 6; i++) smoke.spawn(LOOK.launch, from.x, from.y, from.z, rnd(u(8)), Math.random() * u(2), rnd(u(8)), g);
    }
    if (!gun) { st.mesh = new THREE.Mesh(missileGeo, st.smoky ? missileMat : interceptorMat); scene.add(st.mesh); }
    return st;
  }
  // A puff every few metres along the path flown since the last one.
  function trail(st, m, g) {
    const step = u(4) * g, d = _v.subVectors(m.pos, st.last).length();
    let n = Math.floor(d / step);
    if (n > 24) { st.last.addScaledVector(_v, 1 - (24 * step) / d); n = 24; } // after a long frame, smoke only the last stretch
    _v.setLength(step);
    for (let i = 0; i < n; i++) { st.last.add(_v); smoke.spawn(LOOK.trail, st.last.x, st.last.y, st.last.z, rnd(u(1)), rnd(u(1)), rnd(u(1)), g); }
  }
  const drop = (st, key) => { if (st.mesh) scene.remove(st.mesh); shots.delete(key); };
  const sweep = (st, key) => { if (st.seen !== frame) drop(st, key); };
  const hideMesh = (st) => { if (st.mesh) st.mesh.visible = false; };

  sim.on('explosion', ({ pos, r, color }) => {
    const round = shots.get(pos), ground = groundU(pos.x, pos.z), low = pos.y - ground < u(15) || color === STRIKE;
    const x = pos.x, y = low ? ground : pos.y, z = pos.z, g = grow(_p.set(x, y, z));
    _c.setHex(color); // the simulation's cue: a miss reads differently from a hit
    if (round ? round.gun : r < u(5)) { // a gun round: a flash, and a puff of smoke or a kick of dust
      glow.spawn(LOOK.burst, x, y, z, 0, 0, 0, g * (1 + r / u(10)), _c);
      if (low) for (let i = 0; i < 2; i++) smoke.spawn(LOOK.kick, x, y, z, rnd(u(2)), u(3), rnd(u(2)), g);
      else smoke.spawn(LOOK.puff, x, y, z, 0, 0, 0, g);
      return;
    }
    const d = 2 * Math.min(Math.max(r * 0.08, u(2.5)), u(12)), k = d * g, y0 = low ? y + 0.35 * k : y; // the fireball's diameter; on the ground it sits on it
    glow.spawn(LOOK.core, x, y0, z, 0, 0, 0, k, _w.copy(_c).lerp(WHITE, 0.6));
    for (let i = 0; i < 3; i++) glow.spawn(LOOK.fire, x, y0, z, rnd(0.5), rnd(0.5), rnd(0.5), k, _c);
    if (low) {
      for (let i = 0; i < 9; i++) { const a = (i / 9 + Math.random() * 0.1) * 2 * Math.PI; smoke.spawn(LOOK.dust, x, y, z, Math.sin(a), 0.3 + Math.random() * 0.4, Math.cos(a), k); }
      scorchAt(x, z, d * 0.6);
      return;
    }
    for (let i = 0; i < 6; i++) smoke.spawn(LOOK.smoke, x, y, z, rnd(0.3), 0.1 + rnd(0.2), rnd(0.3), k);
    if (!calm) for (let i = 0; i < 8; i++) smoke.spawn(LOOK.debris, x, y, z, rnd(u(25)), u(5) + Math.random() * u(25), rnd(u(25)), g);
  });

  function update(real) {
    frame++;
    let n = 0, h = 0;
    for (const m of sim.missiles) {
      let st = shots.get(m.pos);
      if (!st) shots.set(m.pos, (st = launch(m)));
      st.seen = frame;
      const unit = unitAt(m.pos);
      if (st.gun) {
        if (n === POOLS.tracers) continue;
        // the streak keeps a few pixels' width however far off, so it lengthens more gently than the models grow; never back past the muzzle
        const len = Math.min(m.vel.length() * 0.03 * (unit / TRUE_UNIT) ** 0.75, st.from.distanceTo(m.pos));
        tracer.set(n++, m.pos, _p.copy(m.pos).sub(_v.copy(m.vel).setLength(len)), HEAD, TAIL);
        continue;
      }
      if (h < POOLS.heads) { m.pos.toArray(headPos, h * 3); (st.smoky ? FLAME : DRONE_LIGHT).toArray(headCol, h * 3); h++; }
      st.mesh.visible = true;
      st.mesh.scale.setScalar((st.smoky ? 1 : 0.6) * unit); // true size up close
      st.mesh.position.copy(m.pos);
      st.mesh.lookAt(_v.copy(m.pos).add(m.vel));
      if (st.smoky) trail(st, m, unit / TRUE_UNIT);
    }
    tracer.show(n);
    headGeo.setDrawRange(0, h);
    headGeo.attributes.position.needsUpdate = headGeo.attributes.color.needsUpdate = true;
    shots.forEach(sweep);
    smoke.update(real);
    glow.update(real);
    for (const s of marks) {
      if (s.age >= SCORCH_LIFE) continue;
      s.age += real;
      s.mesh.visible = s.age < SCORCH_LIFE;
      s.mesh.material.opacity = 0.8 * (1 - s.age / SCORCH_LIFE);
      s.mesh.scale.setScalar(s.size * grow(s.mesh.position));
    }
    smoke.points.visible = glow.points.visible = tracers.visible = heads.visible = scorch.visible = true;
  }

  return {
    update,
    clear() {
      shots.forEach(drop);
      smoke.clear();
      glow.clear();
      tracer.show(0);
      headGeo.setDrawRange(0, 0);
      for (const s of marks) { s.age = Infinity; s.mesh.visible = false; }
    },
    hide() { smoke.points.visible = glow.points.visible = tracers.visible = heads.visible = scorch.visible = false; shots.forEach(hideMesh); },
  };
}
