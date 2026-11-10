// Moving the camera without the mouse. Held keys slide, turn and zoom it; the rest are the sums for which way the view faces and
// how far out the camera must stand to frame the laydown. game-view.js does the gliding.

import * as THREE from 'three';
import { groundU } from './terrain-view.js';

const PAN = 0.8; // of the camera's distance from what it looks at, per second: most of a screen a second at any zoom
const TURN = Math.PI / 2; // a quarter turn a second
const ZOOM = 1.6; // the distance shrinks or grows by e^1.6, about five times, a second
const FIT_MARGIN = 1.25; // room around the laydown when framing it

// Physical keys, so W A S D sit under the left hand on any keyboard layout. Q turns the view left, E right.
const MOVES = {
  KeyW: { ahead: 1 }, KeyS: { ahead: -1 }, KeyA: { right: -1 }, KeyD: { right: 1 },
  KeyQ: { turn: 1 }, KeyE: { turn: -1 },
  Equal: { zoom: -1 }, NumpadAdd: { zoom: -1 }, Minus: { zoom: 1 }, NumpadSubtract: { zoom: 1 },
};
export const isCameraKey = (code) => Object.hasOwn(MOVES, code);

// Which way is ahead on the ground: the screen's up and the way the camera looks, both flattened. One of them always has some
// length, looking straight down or level, so their sum never vanishes.
export function groundAhead(camera, out = new THREE.Vector3()) {
  const e = camera.matrixWorld.elements;
  return out.set(e[4] - e[8], 0, e[6] - e[10]).normalize();
}

const _ahead = new THREE.Vector3();
// The compass bearing the view faces, in degrees from 0 to 360. North is -z in the scene and east +x.
export function headingOf(camera) {
  groundAhead(camera, _ahead);
  return (THREE.MathUtils.radToDeg(Math.atan2(_ahead.x, -_ahead.z)) + 360) % 360;
}

// controls: the OrbitControls, of which this reads target, minDistance, maxDistance and enableRotate.
export function createCameraKeys(camera, controls) {
  const held = new Set(), ahead = new THREE.Vector3(), right = new THREE.Vector3(), offset = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  return {
    press(code, down) {
      if (!isCameraKey(code)) return;
      if (down) held.add(code); else held.delete(code);
    },
    release() { held.clear(); }, // the window lost focus, so no key-up will come
    // Move for this frame's real seconds by whatever is held. Returns true if a key is held.
    step(real) {
      if (!held.size) return false;
      let a = 0, r = 0, t = 0, z = 0;
      for (const code of held) { const m = MOVES[code]; a += m.ahead ?? 0; r += m.right ?? 0; t += m.turn ?? 0; z += m.zoom ?? 0; }
      offset.subVectors(camera.position, controls.target);
      if (z) offset.setLength(THREE.MathUtils.clamp(offset.length() * Math.exp(z * ZOOM * real), controls.minDistance, controls.maxDistance));
      if (t && controls.enableRotate) offset.applyAxisAngle(up, t * TURN * real); // plan view stays north up, as with the mouse
      if (a || r) {
        groundAhead(camera, ahead);
        right.set(-ahead.z, 0, ahead.x);
        const step = PAN * offset.length() * real;
        controls.target.addScaledVector(ahead, a * step).addScaledVector(right, r * step);
        controls.target.y = groundU(controls.target.x, controls.target.z); // keep looking at the ground, over hills and valleys
      }
      camera.position.copy(controls.target).add(offset);
      return true;
    },
  };
}

// The circle that holds every point { x, z, r } (scene units, r its own radius): its middle and radius, or null for no points.
export function framing(points) {
  if (!points.length) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x - p.r); x1 = Math.max(x1, p.x + p.r); z0 = Math.min(z0, p.z - p.r); z1 = Math.max(z1, p.z + p.r); }
  const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
  return { x, z, radius: Math.max(...points.map((p) => Math.hypot(p.x - x, p.z - z) + p.r)) };
}

// How far out the camera must stand for a circle of this radius to fill the narrower side of the screen, with a margin.
export function fitDistance(radius, camera) {
  const half = THREE.MathUtils.degToRad(camera.fov) / 2;
  return (radius * FIT_MARGIN) / Math.sin(Math.min(half, Math.atan(Math.tan(half) * camera.aspect)));
}
