// How a person stands, walks and takes cover, and the matrix of each of their parts (figures.js) in that pose. A pose is a list
// of numbers, metres and radians: [drop of the waist, sway sideways, body pitch, torso pitch, torso roll, leg pitch left and
// right, leg roll left and right, arm pitch left and right, arm roll left and right]. Pitch forward is positive for the body
// and torso, and swings a leg or arm back. View-only: nothing here reads or changes the simulation.

import * as THREE from 'three';
import { HIP, SHOULDERS, WAIST } from './figures.js';

export const STEP = 1.57; // metres walked in one cycle of two steps: 0.9 m legs swinging 0.45 rad either way
const SWING = 0.45, ARM_SWING = 0.8; // radians of leg swing, and how far the arms follow it
export const REST = new Float32Array(13);
const COVER = {
  civilian: [-0.72, 0, Math.PI / 2, 0, 0, 0, 0, -0.08, 0.08, -2.8, -2.8, 0.3, -0.3], // face down, hands over the head: the legs have no knees to kneel on
  military: [-0.72, 0, Math.PI / 2, -0.35, 0, 0, 0, -0.12, 0.12, -1.57, 0, 0, 0], // prone, chest up on the elbows, rifle forward
};

const smooth = (x) => x * x * (3 - 2 * x);
const hash = (k, ph) => { const s = Math.sin(k * 12.9898 + ph * 78.233) * 43758.5453; return s - Math.floor(s); };

// Now and then a person turns slowly to look somewhere else, by up to half a radian either way, each on their own clock.
export function idleTurn(t, ph) {
  const at = t / 11 + ph, k = Math.floor(at), e = smooth(Math.min((at - k) * 4, 1));
  return (hash(k - 1, ph) + (hash(k, ph) - hash(k - 1, ph)) * e - 0.5);
}

// P: the pose to fill. t: seconds. ph: the person's own phase (radians), so no two are in step. walk: 0 standing to 1 walking,
// at step (radians) through the stride. cover: 0 up to 1 down in cover.
export function pose(P, role, t, ph, walk, step, cover) {
  const breathe = Math.sin(t * 1.5 + ph), shift = Math.sin(t * 0.7 + ph * 1.7) * (1 - walk), swing = SWING * walk * Math.sin(step + ph);
  P[0] = -WAIST * (1 - Math.cos(swing)) + 0.004 * breathe; // the legs are straight, so the hips drop as they open
  P[1] = 0.025 * shift; P[2] = 0; P[3] = 0.012 * breathe + 0.06 * walk; P[4] = 0.4 * P[1];
  P[5] = swing; P[6] = -swing; P[7] = P[8] = -P[1] / WAIST; // feet stay put as the weight shifts
  if (role === 'military') { P[9] = 0.01 * breathe + 0.03 * walk * Math.sin(2 * (step + ph)); P[10] = P[11] = P[12] = 0; } // hands stay on the rifle
  else { P[9] = -ARM_SWING * swing - 0.015 * breathe; P[10] = ARM_SWING * swing - 0.015 * breathe; P[11] = P[12] = 0; }
  const b = smooth(cover), C = COVER[role];
  if (b > 0) for (let k = 0; k < 13; k++) P[k] += (C[k] - P[k]) * (k ? b : b * b); // the waist drops late, so straight legs stay out of the ground
  return P;
}

const L = new THREE.Matrix4();
// out = parent x T(x, y, z) x Rx(pitch) x Rz(roll)
function joint(out, parent, x, y, z, pitch, roll) {
  const ca = Math.cos(pitch), sa = Math.sin(pitch), cb = Math.cos(roll), sb = Math.sin(roll);
  L.set(cb, -sb, 0, x, ca * sb, ca * cb, -sa, y, sa * sb, sa * cb, ca, z, 0, 0, 0, 1);
  return out.multiplyMatrices(parent, L);
}

export const partMatrices = () => ({ body: new THREE.Matrix4(), torso: new THREE.Matrix4(), leg: [new THREE.Matrix4(), new THREE.Matrix4()], arm: [new THREE.Matrix4(), new THREE.Matrix4()] });

// The matrix of each part (out, from partMatrices) of a person standing at root, in pose P.
export function placeParts(out, role, root, P) {
  const [sx, sy] = SHOULDERS[role];
  joint(out.body, root, P[1], WAIST + P[0], 0, P[2], 0);
  joint(out.torso, out.body, 0, 0, 0, P[3], P[4]);
  joint(out.leg[0], out.body, -HIP, 0, 0, P[5], P[7]); joint(out.leg[1], out.body, HIP, 0, 0, P[6], P[8]);
  joint(out.arm[0], out.torso, -sx, sy - WAIST, 0, P[9], P[11]);
  if (sx) joint(out.arm[1], out.torso, sx, sy - WAIST, 0, P[10], P[12]); // a soldier's arms are one part
  return out;
}
