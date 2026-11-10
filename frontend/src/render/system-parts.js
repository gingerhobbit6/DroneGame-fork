// What the systems' models stand on, and their materials. Systems are drawn in model units (STRUCT_SCALE turns them into
// scene units), far larger than life so they can be seen, with shapes after the real products' photos. The front is +z.

import * as THREE from 'three';
import { STRUCT_SCALE, SYSTEM_UNIT_M, WORLD } from '../sim/config/index.js';
import { clamp } from '../sim/units.js';
import { modelMat, paintOf, vehiclePaintOf } from './paint.js';
import { VIEW_HEIGHT, view } from './view.js';

const { PI } = Math;

// Scene units per model unit. Close up a system is true size; farther out its height (taken as 3 units) keeps
// WORLD.systemOnScreen of the screen: with map symbols on, up to STRUCT_SCALE, where its symbol takes over; with them off, at every
// zoom, as nothing else would show it. modelScale makes a large or small product bigger or smaller.
export const TRUE_UNIT = SYSTEM_UNIT_M / WORLD.metresPerUnit;
export const drawnUnit = (zoom = view.zoom) => clamp((WORLD.systemOnScreen * VIEW_HEIGHT * zoom) / 3, TRUE_UNIT, view.symbols ? STRUCT_SCALE : Infinity);
export const MAX_K = STRUCT_SCALE / TRUE_UNIT; // the most a system is drawn larger than life

// body is the product's own paint and drab its vehicle's, cases' and boxes' (paint.js), matt; glass is a laser's dark window, which glints.
export function systemMats(def) {
  const mats = {
    body: modelMat(paintOf(def), 0.55), metal: modelMat(0x7b828a, 0.4, 0.7), dark: modelMat(0x2a2d31, 0.75, 0.1),
    drab: modelMat(vehiclePaintOf(def), 0.85, 0.05), glass: modelMat(0x1d2830, 0.08, 0.8, 1),
    figure: new THREE.MeshLambertMaterial({ vertexColors: true }), // a person, coloured by figures.js
    spin: new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }),
  };
  for (const [key, m] of Object.entries(mats)) m.name = key;
  return mats;
}

// A tripod's legs and a fixed mast are built one unit tall in the riser kit r, which buildModel stretches: true height close
// up, growing only with the square root of how much larger than life the rest is drawn, so a 30 m mast does not tower.
export function tripodLegs(k, h, spread) {
  for (let i = 0; i < 3; i++) { const a = (i * 2 * PI) / 3; k.strut('metal', [0, h, 0], [Math.sin(a) * spread, 0, Math.cos(a) * spread], 0.06); }
}
function tripod(b, r) {
  tripodLegs(r, 1, 0.4);
  b.box('drab', 0.5, 0.3, 0.35, 0.5, 0.15, -0.4); // its case
}

// a fixed mast on a pad, with its equipment cabinet and guy lines
function mast(b, r) {
  b.box('dark', 2.2, 0.2, 2.2, 0, 0.1, 0);
  b.box('drab', 0.6, 0.6, 0.45, 0.6, 0.5, 0.6);
  r.cyl('metal', 0.2, 1, 0, 0.5, 0, { r2: 0.12 });
  for (const [x, z] of [[1, 1], [-1, 1], [0, -1.1]]) r.strut('metal', [0, 0.7, 0], [x, 0, z], 0.025);
}

// A four-wheeled truck. Returns the height of its load bed, which is behind the cab, centred near z = -0.5.
export function truck(k, len = 3.4) {
  const half = len / 2;
  for (const z of [half - 0.6, -half + 0.6]) for (const x of [-0.62, 0.62]) k.cyl('dark', 0.32, 0.24, x, 0.32, z, { rz: PI / 2 });
  k.box('drab', 1.3, 0.3, len, 0, 0.55, 0);
  k.box('drab', 1.3, 0.9, 1.0, 0, 1.1, half - 0.5);
  k.box('dark', 1.2, 0.35, 0.05, 0, 1.3, half);
  return 0.7;
}

// A tracked armoured hull. Returns the height of its roof.
export function tracked(k, len = 3.6) {
  for (const x of [-0.7, 0.7]) k.box('dark', 0.4, 0.6, len, x, 0.3, 0);
  k.box('drab', 1.2, 0.6, len * 0.9, 0, 0.75, -len * 0.05);
  k.box('drab', 1.2, 0.5, 0.7, 0, 0.7, len * 0.42, { rx: 0.6 }); // sloped front
  return 1.05;
}

// A two-wheeled trailer on its levelling legs. Returns the height of its deck.
export function trailer(k, len = 2.6) {
  for (const x of [-0.65, 0.65]) k.cyl('dark', 0.3, 0.2, x, 0.3, -0.2, { rz: PI / 2 });
  k.box('drab', 1.4, 0.2, len, 0, 0.6, 0);
  k.strut('metal', [0, 0.6, len / 2], [0, 0.35, len / 2 + 0.8], 0.08);
  for (const x of [-0.6, 0.6]) for (const z of [len / 2 - 0.2, -len / 2 + 0.2]) k.post('metal', 0.05, 0.5, x, 0.25, z);
  return 0.7;
}

// A shipping-container cabin. Returns the height of its roof.
export function cabin(k, len = 3.2) {
  k.box('drab', 1.8, 1.6, len, 0, 0.8, 0);
  for (const x of [-0.91, 0.91]) k.box('dark', 0.02, 1.2, 0.8, x, 0.7, -len / 4);
  return 1.6;
}

// What a sensor or jammer stands on: a tripod if carried by hand, a truck if on a vehicle, else a fixed mast. Returns its
// riser for buildModel: where it starts, its true height (from the real mast, `mount`, in metres) and the least it is drawn.
export function stand(b, r, def) {
  const height = (def.mount ?? 3) / SYSTEM_UNIT_M;
  if (def.mobile === 'manpack') { tripod(b, r); return { rise: { y0: 0, height, min: 0.5 } }; }
  if (def.mobile === 'vehicle') {
    const bed = truck(b);
    r.cyl('metal', 0.1, 1, 0, 0.5, 0, { r2: 0.07 });
    return { rise: { y0: bed, height: height - bed, min: 1.2 }, headZ: -0.9 }; // clear of the cab
  }
  mast(b, r);
  return { rise: { y0: 0.2, height: height - 0.2, min: 0.5 } };
}
