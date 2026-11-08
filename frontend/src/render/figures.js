// Human figures in metres, feet at the origin, facing +z, in vertex colours. people-view.js instances them: a civilian is three
// meshes (trousers and shoes, top and arms, and the skin of head and hands) coloured per person by instance; a soldier is a body
// in MultiCam with helmet, body armour, boots, daysack and rifle, coloured here, and the skin. The K-CEMA NEO's soldier is the
// same figure in one mesh (soldierFigure). Each figure also comes in parts to pose up close (poses.js): a leg, the torso with
// the head, and an arm (a soldier's arms and rifle are one), each about its own joint at the origin.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../sim/rng.js';

const MULTICAM = [0xb3a27e, 0x8f7b58, 0x6d6c45, 0x523f2c, 0xcfc29f]; // tan, light brown, olive, dark brown, cream
const COYOTE = 0x76664b, BLACK = 0x2a2a2a, BOOT = 0x4a3b2c;
const _c = new THREE.Color(), _q = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

// The joints, in metres: the torso and legs turn at the waist, the hips either side of it, and the arms at the shoulders
// (across, up). A soldier's arms turn together, as both hands are on the rifle.
export const WAIST = 0.9, HIP = 0.09;
export const SHOULDERS = { civilian: [0.235, 1.42], military: [0, 1.4] };

// Non-indexed with a colour on every vertex: a hex colour, a grey shade (0 to 1) for an instance colour to show through, or a
// function giving each triangle its own colour.
function paint(geo, colour) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    const v = typeof colour === 'function' ? colour() : colour;
    if (v <= 1) _c.setRGB(v, v, v); else _c.setHex(v);
    for (let j = i; j < i + 3; j++) { c[j * 3] = _c.r; c[j * 3 + 1] = _c.g; c[j * 3 + 2] = _c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const cyl = (r1, r2, len, x, y, z = 0, seg = 6) => new THREE.CylinderGeometry(r1, r2, len, seg, 2).translate(x, y, z);
// a limb from point a to point b
function limb(r1, r2, [ax, ay, az], [bx, by, bz]) {
  _a.set(ax, ay, az); _b.set(bx - ax, by - ay, bz - az);
  const len = _b.length();
  return new THREE.CylinderGeometry(r2, r1, len, 6, 2).applyQuaternion(_q.setFromUnitVectors(UP, _b.normalize())).translate(ax + (bx - ax) / 2, ay + (by - ay) / 2, az + (bz - az) / 2);
}
const leg = (x) => cyl(0.085, 0.06, 0.82, x, 0.49);
const foot = (x) => new THREE.BoxGeometry(0.11, 0.08, 0.26).translate(x, 0.04, 0.04);
const torso = () => new THREE.CylinderGeometry(0.19, 0.15, 0.6, 7, 2).scale(1, 1, 0.65).translate(0, 1.16, 0);
const neck = () => cyl(0.05, 0.055, 0.1, 0, 1.5);
const head = () => new THREE.SphereGeometry(0.11, 8, 6).translate(0, 1.62, 0);
const about = (g, x, y) => g.clone().translate(-x, -y, 0); // a part with its joint at the origin

export function civilianParts() {
  const face = paint(mergeGeometries([head(), neck()]), 1);
  const p = face.attributes.position, c = face.attributes.color;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 1.655) c.setXYZ(i, 0.25, 0.25, 0.25); // hair
  const [sx, sy] = SHOULDERS.civilian;
  const legs = [-HIP, HIP].map((x) => mergeGeometries([paint(leg(x), 1), paint(foot(x), 0.35)]));
  const body = paint(torso(), 1), arms = [-sx, sx].map((x) => paint(cyl(0.05, 0.04, 0.62, x, 1.13), 0.9));
  const hands = [-sx, sx].map((x) => paint(new THREE.SphereGeometry(0.045, 5, 4).translate(x, 0.8, 0), 1));
  return {
    trousers: mergeGeometries(legs), top: mergeGeometries([body, ...arms]), skin: mergeGeometries([face, ...hands]),
    leg: about(legs[1], HIP, WAIST), torso: about(body, 0, WAIST), arm: about(arms[1], sx, sy), head: about(face, 0, WAIST), hand: about(hands[1], sx, sy),
  };
}

// a rifle in the patrol carry: across the chest, muzzle forward and down
function rifle() {
  const parts = [
    new THREE.BoxGeometry(0.06, 0.1, 0.5).translate(0, 0, 0.05), // body
    new THREE.CylinderGeometry(0.013, 0.013, 0.3, 6).rotateX(Math.PI / 2).translate(0, 0.01, 0.45), // barrel
    new THREE.BoxGeometry(0.04, 0.15, 0.06).translate(0, -0.1, 0.1), // magazine
    new THREE.BoxGeometry(0.04, 0.05, 0.14).translate(0, 0.08, 0.08), // sight
  ];
  return paint(mergeGeometries(parts.map((g) => g.toNonIndexed())), BLACK).rotateX(0.35).rotateY(-0.3).translate(0.04, 1.05, 0.24);
}

export function soldierParts(seed = 1) {
  const rng = mulberry32(seed), camo = () => MULTICAM[Math.floor(rng() * MULTICAM.length)];
  const shoulder = (s) => [s * 0.22, 1.4, 0], elbow = (s) => [s * 0.24, 1.08, 0.08], hand = (s) => [s * 0.07, 1.06, 0.26];
  const legs = [-HIP, HIP].map((x) => mergeGeometries([paint(leg(x), camo), paint(foot(x), BOOT)]));
  const body = mergeGeometries([
    paint(torso(), camo),
    paint(new THREE.BoxGeometry(0.38, 0.4, 0.3).translate(0, 1.18, 0.01), COYOTE), // body armour
    ...[-0.1, 0, 0.1].map((x) => paint(new THREE.BoxGeometry(0.08, 0.1, 0.05).translate(x, 1.08, 0.18), 0x5f5240)), // pouches
    paint(new THREE.BoxGeometry(0.3, 0.36, 0.15).translate(0, 1.2, -0.23), COYOTE), // daysack
    paint(new THREE.SphereGeometry(0.135, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 1.05).translate(0, 1.63, 0), camo), // helmet
  ]);
  const arms = mergeGeometries([
    ...[-1, 1].flatMap((s) => [paint(limb(0.055, 0.05, shoulder(s), elbow(s)), camo), paint(limb(0.05, 0.042, elbow(s), hand(s)), camo)]), rifle(),
  ]);
  const face = paint(mergeGeometries([head(), neck()]), 1);
  const hands = paint(mergeGeometries([-1, 1].map((s) => new THREE.SphereGeometry(0.045, 5, 4).translate(...hand(s)))), 1);
  const sy = SHOULDERS.military[1];
  return {
    body: mergeGeometries([...legs, body, arms]), skin: mergeGeometries([face, hands]),
    leg: about(legs[1], HIP, WAIST), torso: about(body, 0, WAIST), arms: about(arms, 0, sy), head: about(face, 0, WAIST), hands: about(hands, 0, sy),
  };
}

// One soldier in one mesh, the skin coloured too.
export function soldierFigure(skin = 0xc69072) {
  const { body, skin: face } = soldierParts();
  const c = face.attributes.color;
  _c.setHex(skin);
  for (let i = 0; i < c.count; i++) c.setXYZ(i, _c.r, _c.g, _c.b);
  return mergeGeometries([body, face]);
}
