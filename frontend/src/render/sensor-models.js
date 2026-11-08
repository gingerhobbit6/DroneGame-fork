// Models of the sensors and jammers, after the real products' photos. Each takes the kit for what stands still, the kit for
// the head, which the view turns (or spins), and the kit for the mast or legs, and returns stand()'s riser (system-parts.js).

import * as THREE from 'three';
import { SYSTEM_UNIT_M } from '../sim/config/index.js';
import { soldierFigure } from './figures.js';
import { stand } from './system-parts.js';

const { PI } = Math;

// A flat antenna facing +z, tilted by rx, turned by ry and set at x, y, z: its face, a dark frame round it and the box behind.
function panel(h, w, ht, x, y, z, { rx = 0, ry = 0 } = {}) {
  const part = (key, pw, ph, d, px, py, pz) => h.geo(key, new THREE.BoxGeometry(pw, ph, d).translate(px, py, pz).rotateX(rx).rotateY(ry), x, y, z);
  part('body', w, ht, 0.08, 0, 0, 0);
  for (const side of [-1, 1]) { part('dark', w + 0.06, 0.04, 0.11, 0, (side * ht) / 2, 0); part('dark', 0.04, ht, 0.11, (side * w) / 2, 0, 0); }
  part('body', w * 0.6, ht * 0.6, ht * 0.25, 0, 0, -0.04 - ht * 0.125);
}

// A radar with no arc turns all round, so its one panel spins. Fixed panels sit side by side, each turned by the panel arc and
// centred on the way it faces (+z here; a turn clockwise seen from above is towards -x).
export function radar(b, h, def, r) {
  const at = stand(b, r, def);
  h.cyl('metal', 0.16, 0.3, 0, 0.15, 0);
  if (def.id === 'radar_giraffe') { // Saab Giraffe 1X: a rounded radome turning on top of its mast
    h.post('metal', 0.08, 0.5, 0, 0.5, 0);
    h.geo('body', new THREE.SphereGeometry(1, 16, 10).scale(0.75, 0.62, 0.3), 0, 1.3, 0);
    h.box('dark', 0.5, 0.4, 0.25, 0, 1.3, -0.3);
    return { ...at, spin: true };
  }
  if (def.arc == null) {
    panel(h, 2.2, 1.0, 0, 0.8, 0);
    return { ...at, spin: true };
  }
  const n = def.panels ?? 1, arc = (def.arc * PI) / 180, w = def.size === 'L' ? 1.2 : def.size === 'S' ? 0.6 : 0.9;
  const out = n > 1 ? (w / 2) / Math.tan(arc / 2) + 0.05 : 0.1; // how far each panel sits from the mast
  for (let i = 0; i < n; i++) {
    const a = (i - (n - 1) / 2) * arc;
    panel(h, w, w * 0.8, -Math.sin(a) * out, 0.3 + w * 0.4, Math.cos(a) * out, { ry: -a });
  }
  return at;
}

export function rf(b, h, def, r) {
  const at = stand(b, r, def);
  switch (def.id) {
    case 'rf_s': // MyDefence Wingman: a small receiver with two short whips
      h.box('body', 0.4, 0.25, 0.2, 0, 0.12, 0);
      for (const x of [-0.12, 0.12]) h.post('dark', 0.02, 0.6, x, 0.55, 0);
      break;
    case 'rf_l': // Aaronia AARTOS: a ring of direction-finding antennas
      h.post('dark', 0.15, 0.4, 0, 0.2, 0);
      for (let i = 0; i < 6; i++) { const a = (i * PI) / 3; h.box('body', 0.35, 0.5, 0.08, Math.sin(a) * 0.4, 0.35, Math.cos(a) * 0.4, { rx: -0.3, ry: a }); }
      break;
    case 'rf_elysion': // Hensoldt Elysion: a flat radome over its direction-finding array
      h.cyl('body', 0.6, 0.3, 0, 0.15, 0, { r2: 0.45, seg: 16 });
      h.cyl('dark', 0.45, 0.06, 0, 0.33, 0, { seg: 16 });
      break;
    case 'rf_airfence': // Airfence: whip antennas spread on a frame over its receiver
      h.box('body', 0.6, 0.4, 0.4, 0, 0.2, 0);
      for (const x of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) { h.strut('metal', [0, 0.4, 0], [x, 0.45, z], 0.04); h.post('dark', 0.025, 1.0, x, 0.95, z); }
      break;
    default: // Dedrone RF-360: a white cylinder radome
      h.cyl('body', 0.3, 0.9, 0, 0.45, 0, { r2: 0.26 });
      h.cyl('dark', 0.27, 0.05, 0, 0.92, 0);
  }
  return at;
}

// A turret in a yoke with its lenses forward: two (day and thermal), one on the small camera, a long zoom on the large one.
export function camera(b, h, def, r) {
  const at = stand(b, r, def);
  h.box('dark', 0.9, 0.12, 0.5, 0, 0.06, 0);
  for (const x of [-0.42, 0.42]) h.box('dark', 0.08, 0.8, 0.35, x, 0.45, 0);
  h.box('body', 0.7, 0.6, 0.7, 0, 0.5, 0);
  if (def.id === 'camera_l') h.cyl('dark', 0.2, 1.2, 0, 0.5, 0.8, { r2: 0.24, rx: PI / 2 });
  else for (const [x, rad] of def.id === 'camera_s' ? [[0, 0.14]] : [[-0.16, 0.12], [0.16, 0.16]]) h.cyl('dark', rad, 0.3, x, 0.5, 0.45, { rx: PI / 2 });
  return at;
}

export function acoustic(b, h, def, r) {
  const at = stand(b, r, def);
  if (def.id === 'acoustic') { // Squarehead Discovair: a flat disc of microphones
    h.cyl('dark', 0.15, 0.2, 0, 0, 0);
    h.cyl('body', 0.75, 0.08, 0, 0.1, 0, { seg: 16 });
    for (let i = 0; i < 8; i++) { const a = (i * PI) / 4; h.cyl('dark', 0.05, 0.04, Math.sin(a) * 0.5, 0.16, Math.cos(a) * 0.5); }
  } else { // ZVOOK: microphone horns on short arms round a pole top, under a small solar panel
    for (let i = 0; i < 4; i++) {
      const a = (i * PI) / 2 + PI / 4, sx = Math.sin(a), cz = Math.cos(a);
      h.strut('metal', [0, 0.2, 0], [sx * 0.35, 0.2, cz * 0.35], 0.04);
      h.cyl('body', 0.06, 0.25, sx * 0.45, 0.2, cz * 0.45, { r2: 0.14, rx: PI / 2, ry: a });
    }
    h.box('dark', 0.7, 0.04, 0.5, 0, 0.55, 0, { rx: -0.5 });
  }
  return at;
}

export function jammer(b, h, def, r) {
  if (def.handheld) { // a jammer gun held by a soldier, who turns to point it at the drone
    const m = 1 / SYSTEM_UNIT_M;
    h.geo('figure', soldierFigure().scale(m, m, m));
    h.box('body', 0.1 * m, 0.16 * m, 0.55 * m, 0.05 * m, 1.18 * m, 0.4 * m);
    for (const x of [0, 0.1]) h.cyl('dark', 0.03 * m, 0.25 * m, x * m, 1.22 * m, 0.78 * m, { r2: 0.05 * m, rx: Math.PI / 2 });
    return { headY: 0 };
  }
  if (def.id === 'jammer_neo') { // Kirintec K-CEMA NEO: carried in a bergen on a soldier's back, its antennas up from the pack
    const m = 1 / SYSTEM_UNIT_M; // the soldier is in metres
    b.geo('figure', soldierFigure().scale(m, m, m));
    h.box('body', 0.42 * m, 0.62 * m, 0.3 * m, 0, 1.15 * m, -0.33 * m);
    for (const x of [-0.12, 0.12]) h.post('dark', 0.012, 0.9 * m, x * m, 1.9 * m, -0.38 * m);
    return { headY: 0 };
  }
  const at = stand(b, r, def);
  const whips = (pts, len, y) => { for (const [x, z] of pts) h.post('dark', 0.025, len, x, y + len / 2, z); };
  switch (def.id) {
    case 'jammer': case 'jammer_s': // a portable jammer on a tripod: its electronics box with two panel antennas angled apart
      h.box('dark', 0.4, 0.3, 0.3, 0, 0.15, 0);
      for (const a of [-0.35, 0.35]) panel(h, 0.36, 0.5, Math.sin(a) * 0.15, 0.6, 0.15 + Math.cos(a) * 0.05, { ry: a });
      break;
    case 'jammer_auds': // AUDS: a pan-and-tilt head carrying a large directional antenna
      h.box('dark', 0.5, 0.4, 0.4, 0, 0.2, 0);
      panel(h, 1.2, 0.9, 0, 0.75, 0.2, { rx: -0.15 });
      break;
    case 'jammer_jupiter': case 'jammer_sf': // vehicle jammers: a box of electronics under a cluster of whip antennas
      h.box('body', 0.8, 0.3, 0.8, 0, 0.15, 0);
      whips([[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], [0, 0]], 0.9, 0.3);
      break;
    default: // a fixed-site jammer: six sector antennas round the mast top, each on its bracket, with whips above
      for (let i = 0; i < 6; i++) {
        const a = (i * PI) / 3, sx = Math.sin(a), cz = Math.cos(a);
        h.cyl('body', 0.1, 1.0, sx * 0.4, 0.5, cz * 0.4, { seg: 8 });
        for (const y of [0.2, 0.8]) h.strut('metal', [0, y, 0], [sx * 0.33, y, cz * 0.33], 0.04);
      }
      whips([[-0.1, 0], [0.1, 0]], 0.6, 1.0);
  }
  return at;
}
