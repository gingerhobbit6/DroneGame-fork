// The ground view: the camera at the top of one placed system's mast (view.eye), looking where it would: at the drone it is
// engaging, else the nearest drone your sensors have, else out over the area. A drag looks round, and it eases back on release.

import * as THREE from 'three';
import { antennaHeight } from '../sim/site-range.js';
import { u } from '../sim/units.js';
import { view } from './view.js';

const EYE_ABOVE_MAST = 2; // metres: just above its own antennas, so the model does not fill the view
const FOLLOW = 4, SETTLE = 1.5; // how quickly it turns to a new target, and back after a look round, per second
const OUT = 3000, OUT_UP = 150; // metres: with nothing to watch it looks this far out over the area, and this high

export function createEyeView(camera, controls, sim, canvas) {
  let eye = null, before = null, last = performance.now();
  const look = new THREE.Vector3(), want = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const turn = { yaw: 0, pitch: 0, drag: null };

  // A drag looks round from the mast; only while in the ground view, so map dragging is untouched.
  canvas.addEventListener('pointerdown', (e) => { if (eye && e.button === 0) turn.drag = { x: e.clientX, y: e.clientY }; });
  addEventListener('pointermove', (e) => {
    if (!turn.drag) return;
    turn.yaw -= (e.clientX - turn.drag.x) * 0.004; turn.pitch = Math.max(-1.2, Math.min(1.2, turn.pitch - (e.clientY - turn.drag.y) * 0.004));
    turn.drag = { x: e.clientX, y: e.clientY };
  });
  addEventListener('pointerup', () => { turn.drag = null; });

  // What it is watching: what it engages, else the nearest drone a sensor has within its reach, else a point out over the area.
  function target(s) {
    if (s.task && !s.task.drone.dead) return want.copy(s.task.drone.pos);
    let best = null, bd = u(s.def.range * 1.5);
    for (const d of sim.drones) { if (d.dead || !d.detected) continue; const dd = d.pos.distanceTo(s.pos); if (dd < bd) { bd = dd; best = d; } }
    if (best) return want.copy(best.pos);
    const c = sim.state.zoneCentre ?? { x: 0, z: 0 };
    let dx = s.pos.x - c.x, dz = s.pos.z - c.z;
    if (Math.hypot(dx, dz) < 1) { dx = 0; dz = -1; } // at the centre itself: north
    const k = u(OUT) / Math.hypot(dx, dz);
    return want.set(s.pos.x + dx * k, s.pos.y + u(OUT_UP), s.pos.z + dz * k);
  }

  // Each frame: false when it is off, and the map's own camera runs.
  function update() {
    const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const s = view.eye && sim.structures.includes(view.eye) ? view.eye : null;
    if (!s && view.eye) view.eye = null; // sold, destroyed or cleared away
    if (s !== eye) {
      if (s && !eye) before = { position: camera.position.clone(), target: controls.target.clone() };
      if (!s && before) { camera.position.copy(before.position); controls.target.copy(before.target); before = null; camera.up.copy(up); }
      if (s) { look.copy(target(s)); turn.yaw = turn.pitch = 0; }
      eye = s;
      controls.enabled = !s;
    }
    if (!eye) return false;
    camera.position.set(eye.pos.x, eye.pos.y + u(antennaHeight(eye.def) + EYE_ABOVE_MAST), eye.pos.z);
    look.lerp(target(eye), 1 - Math.exp(-FOLLOW * dt));
    if (!turn.drag) { const k = Math.exp(-SETTLE * dt); turn.yaw *= k; turn.pitch *= k; }
    dir.subVectors(look, camera.position).applyAxisAngle(up, turn.yaw);
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    dir.applyAxisAngle(side, turn.pitch);
    camera.lookAt(dir.add(camera.position));
    return true;
  }

  return { update, watching: () => eye };
}
