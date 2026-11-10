// Low-poly models of each drone type, built in metres from its published span (`size`) and the outline in press photos: the
// shapes are approximate, never measured. The nose points along +z. Parts are merged into one mesh per material (the body
// in the drone's paint and the dark details), plus one group per propeller, named 'rotor', so the view can spin it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD } from '../sim/config/index.js';
import { clamp } from '../sim/units.js';
import { VIEW_HEIGHT, view } from './view.js';

// Scene units per metre. Close up a drone is drawn at true size. Farther out a 2.5 m Shahed's span keeps WORLD.droneOnScreen
// of the screen's height, other spans growing with the 0.4 power of the real one so a 20 m Wing Loong reads bigger without
// shrinking a 0.3 m quadcopter out of sight. With map symbols on it stops growing where its symbol takes over; with them off it
// keeps its size on the screen at every zoom, as nothing else would show it.
export const drawScale = (def, zoom = view.zoom) => clamp((WORLD.droneOnScreen * VIEW_HEIGHT * zoom * (def.size / 2.5) ** 0.4) / def.size,
  1 / WORLD.metresPerUnit, view.symbols ? WORLD.droneVisualScale * 3 * def.size ** -0.6 : Infinity);

// Builds a model from simple parts, each given the name of its material; finish() merges them into one mesh per material.
export function kit() {
  const geos = {}, props = [];
  const put = (key, g, x = 0, y = 0, z = 0) => { (geos[key] ??= []).push(g.translate(x, y, z)); };
  const shape = (pts) => new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
  return {
    // a body of revolution along z; profile is [[z, radius], ...] from tail to nose. squash flattens it top to bottom
    lathe(key, profile, { x = 0, y = 0, seg = 10, squash = 1 } = {}) {
      put(key, new THREE.LatheGeometry(profile.map(([z, r]) => new THREE.Vector2(r, z)), seg).rotateX(Math.PI / 2).scale(1, squash, 1), x, y);
    },
    // a flat surface lying level; outline is [[x, z], ...]
    wing(key, outline, thick, y = 0, x = 0) {
      put(key, new THREE.ExtrudeGeometry(shape(outline), { depth: thick, bevelEnabled: false }).rotateX(Math.PI / 2), x, y + thick / 2);
    },
    // a flat surface standing upright; outline is [[z, y], ...]
    fin(key, outline, thick, x = 0) {
      put(key, new THREE.ExtrudeGeometry(shape(outline), { depth: thick, bevelEnabled: false }).rotateY(-Math.PI / 2), x + thick / 2);
    },
    box(key, w, h, d, x, y, z, { rx = 0, ry = 0, rz = 0 } = {}) { put(key, new THREE.BoxGeometry(w, h, d).rotateX(rx).rotateZ(rz).rotateY(ry), x, y, z); },
    ball(key, r, x, y, z) { put(key, new THREE.SphereGeometry(r, 8, 6), x, y, z); },
    geo(key, g, x = 0, y = 0, z = 0) { put(key, g, x, y, z); }, // a ready-made geometry
    post(key, r, h, x, y, z) { put(key, new THREE.CylinderGeometry(r, r, h, 8), x, y, z); }, // upright cylinder
    // a cylinder turned from upright: rz: PI / 2 lays it along x, rx: PI / 2 along z. r2 tapers its top
    cyl(key, r, h, x, y, z, { r2 = r, rx = 0, ry = 0, rz = 0, seg = 10 } = {}) { put(key, new THREE.CylinderGeometry(r2, r, h, seg).rotateX(rx).rotateZ(rz).rotateY(ry), x, y, z); },
    // a beam from one point to another
    strut(key, [x1, y1, z1], [x2, y2, z2], w, h = w) {
      const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1, len = Math.hypot(dx, dy, dz);
      put(key, new THREE.BoxGeometry(w, h, len).rotateX(-Math.asin(dy / len)).rotateY(Math.atan2(dx, dz)), (x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    },
    // a propeller turning about y (lifting) or z (pushing or pulling): its pitched blades and the faint disc they blur into
    prop(len, x, y, z, axis = 'y', count = 2) {
      const turn = (g) => (axis === 'y' ? g : g.rotateX(Math.PI / 2));
      const blades = Array.from({ length: count }, (_, i) => new THREE.BoxGeometry(len / 2, len * 0.012, len * 0.08).rotateX(0.3).translate(len / 4, 0, 0).rotateY((i * 2 * Math.PI) / count));
      props.push({ blades: turn(mergeGeometries(blades)), disc: turn(new THREE.CircleGeometry(len / 2, 16).rotateX(-Math.PI / 2)), x, y, z, axis });
    },
    finish(mats) {
      const g = new THREE.Group();
      for (const [key, list] of Object.entries(geos)) {
        if (!list.length) continue;
        const merged = mergeGeometries(list.map((p) => { const q = p.index ? p.toNonIndexed() : p; q.deleteAttribute('uv'); return q; }));
        g.add(new THREE.Mesh(merged, mats[key]));
      }
      for (const p of props) {
        const r = new THREE.Group();
        r.add(new THREE.Mesh(p.blades, mats.dark), new THREE.Mesh(p.disc, mats.spin));
        r.position.set(p.x, p.y, p.z); r.name = 'rotor'; r.userData.axis = p.axis; g.add(r);
      }
      return g;
    },
  };
}

// Shahed-136 and its kind: a cropped delta with fins at the tips and a pusher propeller; the Geran-3 has a jet on its back.
// len is length over span; finAt is how far out the fins sit (the Harpy-like ASN-301 has them part way).
function delta(k, s, { len = 1.4, jet = false, finAt = 1 } = {}) {
  const L = s * len, n = L / 2, t = -L / 2, r = s * 0.07, h = s / 2;
  k.lathe('body', [[t, r * 0.5], [t + L * 0.1, r], [n - L * 0.16, r], [n - L * 0.06, r * 0.7], [n, 0]]);
  const te = t + L * 0.06, tipLE = t + L * 0.24;
  k.wing('body', [[0, n - L * 0.32], [h, tipLE], [h, te], [-h, te], [-h, tipLE]], s * 0.02, -r * 0.3);
  const fin = [[te, -0.08 * s], [tipLE, -0.08 * s], [te + L * 0.08, 0.16 * s], [te, 0.16 * s]];
  for (const side of [-1, 1]) k.fin('body', fin, s * 0.012, side * h * finAt);
  if (jet) { k.lathe('body', [[t + L * 0.04, r * 0.8], [t + L * 0.3, r * 0.9], [t + L * 0.36, r * 0.6]], { y: r * 1.6 }); k.lathe('dark', [[t + L * 0.02, r * 0.6], [t + L * 0.04, r * 0.8]], { y: r * 1.6 }); }
  else k.prop(s * 0.32, 0, 0, t - s * 0.01, 'z');
}

// Lancet-3: a slim body with two sets of four wings in an X, and a pusher propeller.
function xWing(k, s) {
  const L = s * 1.65, r = s * 0.08;
  k.lathe('body', [[-L / 2, r * 0.5], [-L * 0.4, r], [L * 0.35, r], [L / 2, 0]], { seg: 8 });
  for (const [z, chord] of [[L * 0.2, s * 0.12], [-L * 0.3, s * 0.14]]) {
    for (const rz of [Math.PI / 4, -Math.PI / 4]) k.box('body', s, s * 0.01, chord, 0, 0, z, { rz });
  }
  k.prop(s * 0.3, 0, 0, -L / 2 - s * 0.01, 'z');
}

// CH-901: a tube-launched round body with pop-out straight wings, a small cross tail and a pusher propeller.
function tube(k, s) {
  const L = s * 1.2, r = s * 0.06;
  k.lathe('body', [[-L / 2, r * 0.8], [L * 0.4, r], [L / 2, r * 0.4]]);
  k.ball('dark', r * 0.4, 0, 0, L / 2); // seeker window
  k.wing('body', [[-s / 2, L * 0.08], [s / 2, L * 0.08], [s / 2, L * 0.08 - s * 0.1], [-s / 2, L * 0.08 - s * 0.1]], s * 0.01, r);
  for (const rz of [Math.PI / 4, -Math.PI / 4]) k.box('body', s * 0.26, s * 0.008, s * 0.07, 0, 0, -L / 2 + s * 0.05, { rz });
  k.prop(s * 0.25, 0, 0, -L / 2 - s * 0.01, 'z');
}

// Orlan-10 and its kind: a pod and tail boom under a straight high wing, a conventional tail and a pulling propeller.
// slim is the Molniya-2's bare tube body, carrying its warhead under it instead of a camera.
function highWing(k, s, { len = 0.58, slim = false } = {}) {
  const L = s * len, h = s / 2, r = s * (slim ? 0.025 : 0.045), le = L * 0.22;
  k.lathe('body', [[-L / 2, s * 0.015], [-L * 0.05, r * 0.6], [L * 0.1, r], [L * 0.4, r], [L / 2, r * 0.4]]);
  k.wing('body', [[-h, le - s * 0.01], [0, le], [h, le - s * 0.01], [h, le - s * 0.08], [0, le - s * 0.1], [-h, le - s * 0.08]], s * 0.012, r);
  const tz = -L / 2;
  k.wing('body', [[-s * 0.15, tz + s * 0.07], [s * 0.15, tz + s * 0.07], [s * 0.15, tz + s * 0.01], [-s * 0.15, tz + s * 0.01]], s * 0.008, s * 0.015);
  k.fin('body', [[tz, s * 0.01], [tz + s * 0.08, s * 0.01], [tz + s * 0.02, s * 0.1], [tz, s * 0.1]], s * 0.008);
  k.prop(s * 0.2, 0, 0, L / 2 + s * 0.01, 'z');
  if (slim) k.lathe('dark', [[-s * 0.08, s * 0.04], [s * 0.12, s * 0.04], [s * 0.18, 0]], { y: -r - s * 0.04 });
  else k.ball('dark', s * 0.03, 0, -r, L * 0.15);
}

// Ababil-2: a round body with a small foreplane, a straight wing at the back with fins on its tips, and a pusher propeller.
function canard(k, s) {
  const L = s * 0.9, h = s / 2, r = s * 0.045, le = -L * 0.15;
  k.lathe('body', [[-L / 2, r * 0.6], [-L * 0.3, r], [L * 0.38, r], [L / 2, 0]]);
  k.wing('body', [[-h, le], [h, le], [h, le - s * 0.1], [-h, le - s * 0.12]], s * 0.012, r * 0.6);
  k.wing('body', [[-s * 0.16, L * 0.36], [s * 0.16, L * 0.36], [s * 0.16, L * 0.3], [-s * 0.16, L * 0.3]], s * 0.008, 0);
  for (const side of [-1, 1]) k.fin('body', [[le - s * 0.12, -s * 0.02], [le - s * 0.02, -s * 0.02], [le - s * 0.08, s * 0.12], [le - s * 0.12, s * 0.12]], s * 0.008, side * h);
  k.prop(s * 0.2, 0, 0, -L / 2 - s * 0.01, 'z');
}

// Mohajer-6 and ASN-209: a pod with a pusher propeller, a straight wing, two booms and a tail joining them.
function twinBoom(k, s) {
  const L = s * 0.57, h = s / 2, r = s * 0.045, le = L * 0.1, by = r * 0.5, bx = s * 0.16, tz = -L / 2;
  k.lathe('body', [[-L * 0.05, r * 0.5], [L * 0.05, r], [L * 0.38, r], [L / 2, r * 0.3]]);
  k.wing('body', [[-h, le - s * 0.005], [h, le - s * 0.005], [h, le - s * 0.07], [-h, le - s * 0.07], [0, le - s * 0.09]], s * 0.01, by);
  for (const side of [-1, 1]) {
    k.strut('body', [side * bx, by, le], [side * bx, by, tz + s * 0.02], s * 0.012);
    k.fin('body', [[tz, by], [tz + s * 0.07, by], [tz + s * 0.02, by + s * 0.1], [tz, by + s * 0.1]], s * 0.008, side * bx);
  }
  k.wing('body', [[-bx, tz + s * 0.05], [bx, tz + s * 0.05], [bx, tz], [-bx, tz]], s * 0.008, by + s * 0.1);
  k.ball('dark', s * 0.02, 0, -r, L * 0.4);
  k.prop(s * 0.16, 0, 0, -L * 0.05 - s * 0.01, 'z');
}

// Wing Loong II: a long body with a raised nose, a tapered wing, a V tail with a fin under it, a pusher propeller and missiles.
function male(k, s) {
  const L = s * 0.54, h = s / 2, le = L * 0.08;
  k.lathe('body', [[-L / 2, s * 0.008], [-L * 0.35, s * 0.022], [L * 0.2, s * 0.035], [L * 0.38, s * 0.042], [L * 0.47, s * 0.028], [L / 2, 0]], { seg: 12 });
  k.wing('body', [[0, le], [h, le - s * 0.02], [h, le - s * 0.055], [0, le - s * 0.08], [-h, le - s * 0.055], [-h, le - s * 0.02]], s * 0.008, -s * 0.01);
  for (const side of [-1, 1]) k.box('body', s * 0.18, s * 0.004, s * 0.05, side * s * 0.07, s * 0.06, -L * 0.44, { rz: side * 0.7 });
  k.fin('body', [[-L / 2, 0], [-L / 2 + s * 0.06, 0], [-L / 2 + s * 0.02, -s * 0.05], [-L / 2, -s * 0.05]], s * 0.004);
  k.ball('dark', s * 0.018, 0, -s * 0.035, L * 0.38);
  for (const side of [-1, 1]) k.lathe('dark', [[-s * 0.04, s * 0.006], [s * 0.04, s * 0.006], [s * 0.05, 0]], { x: side * s * 0.2, y: -s * 0.025, seg: 6 });
  k.prop(s * 0.13, 0, 0, -L / 2 - s * 0.005, 'z');
}

// Skywalker-type foam flying wing: a swept wing with a centre pod, winglets and a pusher propeller.
function flyingWing(k, s) {
  const h = s / 2;
  k.wing('body', [[0, s * 0.13], [h, -s * 0.1], [h, -s * 0.2], [0, -s * 0.11], [-h, -s * 0.2], [-h, -s * 0.1]], s * 0.02);
  k.lathe('body', [[-s * 0.1, s * 0.02], [s * 0.05, s * 0.04], [s * 0.18, 0]], { squash: 0.7 });
  for (const side of [-1, 1]) k.fin('body', [[-s * 0.2, 0], [-s * 0.1, 0], [-s * 0.17, s * 0.08], [-s * 0.2, s * 0.08]], s * 0.006, side * h);
  k.prop(s * 0.12, 0, 0, -s * 0.12, 'z');
}

const lift = (k, s, motors, propLen, motorH = 0.05, blades = 2) => {
  for (const [x, y, z] of motors) { k.post('dark', s * 0.035, s * motorH, x, y, z); k.prop(propLen, x, y + s * motorH, z, 'y', blades); }
};

// Mavic, Mini and EVO: a compact body with folding arms (the back pair lower), a camera under the nose, and a small
// munition under the body unless it only watches.
function foldQuad(k, s, _, def) {
  k.lathe('body', [[-s * 0.3, s * 0.08], [-s * 0.2, s * 0.12], [s * 0.2, s * 0.13], [s * 0.3, s * 0.07]], { seg: 8, squash: 0.6 });
  const motors = [[0.37, 0.02, 0.3], [-0.37, 0.02, 0.3], [0.33, -0.04, -0.35], [-0.33, -0.04, -0.35]].map(([x, y, z]) => [x * s, y * s, z * s]);
  for (const m of motors) k.strut('body', [Math.sign(m[0]) * s * 0.08, m[1] * 0.5, m[2] * 0.5], m, s * 0.04, s * 0.03);
  lift(k, s, motors, s * 0.6);
  k.box('dark', s * 0.1, s * 0.08, s * 0.08, 0, -s * 0.06, s * 0.3);
  if (def.role !== 'spotter') k.lathe('dark', [[-s * 0.1, s * 0.035], [s * 0.08, s * 0.035], [s * 0.12, 0]], { y: -s * 0.12, seg: 6 });
}

// Matrice 30T and 300: a box body with four straight arms in an X, landing legs, a camera under the front and a munition.
function proQuad(k, s) {
  k.box('body', s * 0.26, s * 0.14, s * 0.36, 0, 0, 0);
  const d = s * 0.354, motors = [[d, s * 0.06, d], [-d, s * 0.06, d], [d, s * 0.06, -d], [-d, s * 0.06, -d]];
  for (const m of motors) k.strut('body', [0, 0, 0], m, s * 0.04);
  lift(k, s, motors, s * 0.6);
  for (const side of [-1, 1]) {
    for (const z of [-0.12, 0.12]) k.strut('dark', [side * s * 0.1, -s * 0.05, z * s], [side * s * 0.16, -s * 0.3, z * s], s * 0.02);
    k.box('dark', s * 0.02, s * 0.02, s * 0.45, side * s * 0.16, -s * 0.3, 0);
  }
  k.ball('dark', s * 0.06, 0, -s * 0.12, s * 0.16);
  k.lathe('dark', [[-s * 0.1, s * 0.04], [s * 0.08, s * 0.04], [s * 0.12, 0]], { y: -s * 0.14, seg: 6 });
}

// Agras T30: six drooping arms round a spray tank, a landing frame, and bombs hung under it.
function hexa(k, s) {
  k.box('body', s * 0.22, s * 0.16, s * 0.3, 0, 0, 0);
  k.box('body', s * 0.2, s * 0.14, s * 0.2, 0, -s * 0.14, 0); // tank
  const motors = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + (i * Math.PI) / 3; return [Math.sin(a) * s / 2, -s * 0.02, Math.cos(a) * s / 2]; });
  for (const m of motors) k.strut('body', [0, s * 0.04, 0], m, s * 0.03);
  lift(k, s, motors, s * 0.46, 0.04);
  for (const side of [-1, 1]) {
    k.strut('dark', [side * s * 0.1, -s * 0.05, 0], [side * s * 0.18, -s * 0.3, 0], s * 0.02);
    k.box('dark', s * 0.02, s * 0.02, s * 0.4, side * s * 0.18, -s * 0.3, 0);
    k.lathe('dark', [[-s * 0.07, s * 0.025], [s * 0.05, s * 0.025], [s * 0.08, 0]], { x: side * s * 0.05, y: -s * 0.24, seg: 6 });
  }
}

// First-person-view quadcopter: a flat X frame, a battery on top, a camera at the front and a warhead strapped under it,
// pointing forward. Fibre-optic ones carry a spool at the back.
function fpvQuad(k, s, _, def) {
  for (const a of [Math.PI / 4, -Math.PI / 4]) k.box('dark', s * 0.06, s * 0.015, s, 0, 0, 0, { ry: a });
  const d = s * 0.354, motors = [[d, 0, d], [-d, 0, d], [d, 0, -d], [-d, 0, -d]];
  lift(k, s, motors, s * 0.56, 0.06, 3); // small FPV propellers have three blades
  k.box('body', s * 0.14, s * 0.09, s * 0.28, 0, s * 0.06, -s * 0.02); // battery
  k.box('dark', s * 0.07, s * 0.07, s * 0.06, 0, s * 0.03, s * 0.17, { rx: -0.4 }); // camera
  k.lathe('body', [[-s * 0.25, s * 0.05], [s * 0.15, s * 0.06], [s * 0.3, 0]], { y: -s * 0.07, seg: 8 });
  if (def.fibre) k.post('dark', s * 0.08, s * 0.08, 0, s * 0.1, -s * 0.2);
}

// Which shape each drone takes; a real drone not listed takes its type's.
const SHAPES = {
  fw: [delta], spotter: [highWing], fpv: [fpvQuad], fo: [fpvQuad],
  shahed131: [delta, { len: 1.18 }], gerbera: [delta, { len: 1.1 }], asn301: [delta, { len: 1.29, finAt: 0.6 }], geran3: [delta, { jet: true }],
  lancet3: [xWing], ch901: [tube], molniya2: [highWing, { len: 0.75, slim: true }], skywalker: [flyingWing],
  ababil2: [canard], mohajer6: [twinBoom], asn209: [twinBoom], wingloong2: [male],
  mavic3: [foldQuad], mavic3t: [foldQuad], mavic3pro: [foldQuad], mini4pro: [foldQuad], evomax4t: [foldQuad], evo2t: [foldQuad],
  matrice30t: [proQuad], matrice300: [proQuad], agrast30: [hexa],
};

// mats: { body, dark, spin } materials. Returns a group in metres.
export function buildDrone(def, mats) {
  const [make, opts] = SHAPES[def.id] ?? SHAPES[def.variantOf] ?? SHAPES[def.model === 'fw' ? 'fw' : 'fpv'];
  const k = kit();
  make(k, def.size, opts ?? {}, def);
  return k.finish(mats);
}
