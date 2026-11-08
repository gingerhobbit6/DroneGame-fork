// 3D models for the systems and the drones: the shapes are in system-parts.js, sensor-models.js, effector-models.js and drone-models.js.

import * as THREE from 'three';
import { DRONES } from '../sim/config/index.js';
import { buildDrone, kit } from './drone-models.js';
import { MAX_K, systemMats } from './system-parts.js';
import { modelMat, paintOf } from './paint.js';
import { radar, rf, camera, acoustic, jammer } from './sensor-models.js';
import { interceptor, missile, laser } from './effector-models.js';
import { gun } from './gun-models.js';
import { VEHICLES } from './vehicle-models.js';
import { SYSTEM_UNIT_M } from '../sim/config/index.js';

// A system's model: what it stands on, a head that the view turns to aim (or spins, for a rotating radar), and for a sensor
// or jammer the mast or legs it is raised on. parts.raise(k) sets those for a system drawn k times larger than life. One riding
// in a patrol (def.vehicle) sits on its vehicle instead, a sensor on a pole to its mast height.
const SYSTEM_SHAPES = { radar, rf, camera, acoustic, jammer, interceptor, missile, gun, laser };
export function buildModel(def) {
  const base = kit(), head = kit(), riser = kit(), mats = systemMats(def), carrier = VEHICLES[def.vehicle];
  const own = carrier ? [kit(), kit()] : [base, riser]; // a mounted system's own stand is not drawn
  let { headY = 0, headZ = 0, spin = false, rise } = SYSTEM_SHAPES[def.kind](own[0], head, def, own[1]);
  if (carrier) {
    ({ roof: headY, z: headZ } = carrier(base));
    if (rise) { riser.cyl('metal', 0.08, 1, 0, 0.5, 0, { r2: 0.06 }); rise = { y0: headY, height: def.mount / SYSTEM_UNIT_M - headY, min: 0.3 }; }
  }
  const g = base.finish(mats), h = head.finish(mats), r = riser.finish(mats);
  h.position.set(0, headY, headZ); r.position.set(0, rise?.y0 ?? 0, headZ);
  g.add(h, r);
  const raise = (k) => {
    if (!rise) return;
    const m = Math.max(rise.min, rise.height / Math.sqrt(k));
    r.scale.y = m; h.position.y = rise.y0 + m;
  };
  raise(MAX_K);
  g.add(foot(g, def.color));
  g.traverse((o) => { if (o.isMesh) o.castShadow = !o.material.transparent; }); // a see-through part would cast a solid shadow
  return { group: g, parts: { head: h, spin: spin ? h : null, raise } };
}

// A thin ring in the system's map colour round the foot of its model, so its kind still shows now the model wears real paint.
function foot(g, color) {
  const box = new THREE.Box3().setFromObject(g), r = Math.max(0.5, Math.hypot(Math.max(-box.min.x, box.max.x), Math.max(-box.min.z, box.max.z))) + 0.1;
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.1, r, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  ring.position.y = 0.04; ring.name = 'foot';
  return ring;
}

const rotorMat = new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });
let darkMat = null; // made with the first drone, after game-view.js has made the models' reflection
const unseenMat = new THREE.MeshBasicMaterial({ color: 0x8a94a3, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });

// One shared model per drone type, plus a grey copy for drones that no sensor has (shown when the truth overlay is on).
const droneTemplates = {};
export function droneTemplate(type, unseen) {
  const key = type + (unseen ? ':unseen' : '');
  if (droneTemplates[key]) return droneTemplates[key];
  const def = DRONES[type];
  darkMat ??= modelMat(0x26282c, 0.6, 0.2); // carbon frames, motors and blades
  const body = unseen ? unseenMat : modelMat(paintOf(def), 0.5);
  const g = buildDrone(def, unseen ? { body, dark: body, spin: body } : { body, dark: darkMat, spin: rotorMat });
  if (!unseen) g.traverse((o) => { if (o.isMesh) o.castShadow = !o.material.transparent; });
  droneTemplates[key] = g;
  return g;
}
