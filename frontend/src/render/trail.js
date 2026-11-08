// A line behind something that moves, of where it has been: a point every STEP metres, with the newest one following it.
// shortcut: the oldest points drop off after POINTS (30 km of flight); a longer trail would need a bigger buffer.

import * as THREE from 'three';
import { u } from '../sim/units.js';

const POINTS = 600, STEP = 50; // metres

export function createTrail(scene, color) {
  const pos = new Float32Array(POINTS * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setDrawRange(0, 0);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 }));
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  let n = 0;
  const set = (i, p) => { pos[3 * i] = p.x; pos[3 * i + 1] = p.y; pos[3 * i + 2] = p.z; };
  const fromLastFixed = (p) => Math.hypot(p.x - pos[3 * n - 6], p.y - pos[3 * n - 5], p.z - pos[3 * n - 4]);
  return {
    line,
    get length() { return n; },
    push(p) {
      if (n >= 2 && fromLastFixed(p) < u(STEP)) set(n - 1, p); // the head follows it until it has gone a step
      else {
        if (n === POINTS) { pos.copyWithin(0, 3); n--; }
        set(n++, p);
      }
      geo.setDrawRange(0, n);
      geo.attributes.position.needsUpdate = true;
    },
    dispose() { scene.remove(line); geo.dispose(); line.material.dispose(); },
  };
}
