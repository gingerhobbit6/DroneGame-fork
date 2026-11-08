// Lines a few pixels wide, which plain WebGL lines never are: three's own wide line shader, with fixed buffers so nothing is
// made per frame. Each segment fades from its head colour to its tail colour; with additive blending a black tail fades out.

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const materials = new Set(); // the shader turns pixels into screen space, so each is told the drawing size
const size = new THREE.Vector2(globalThis.innerWidth || 1024, globalThis.innerHeight || 768);
export function sizeWideLines(w, h) { size.set(w, h); for (const m of materials) m.resolution.copy(size); }

// count: the most segments shown at once. width: in pixels.
export function wideLines(count, { width, opacity = 1, additive = true, name = '' }) {
  const geo = new LineSegmentsGeometry();
  geo.setPositions(new Float32Array(count * 6));
  geo.setColors(new Float32Array(count * 6));
  geo.instanceCount = 0;
  const material = new LineMaterial({ linewidth: width, vertexColors: true, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  material.resolution.copy(size);
  materials.add(material);
  const lines = new LineSegments2(geo, material);
  lines.name = name;
  lines.frustumCulled = false; // its bounds are worked out once, when it is empty
  const pos = geo.attributes.instanceStart.data, col = geo.attributes.instanceColorStart.data;
  return {
    lines,
    // segment i from a (head) to b (tail), as vectors
    set(i, a, b, head, tail = head) {
      a.toArray(pos.array, i * 6); b.toArray(pos.array, i * 6 + 3);
      head.toArray(col.array, i * 6); tail.toArray(col.array, i * 6 + 3);
    },
    show(n) { geo.instanceCount = n; pos.needsUpdate = col.needsUpdate = true; },
    dispose() { materials.delete(material); geo.dispose(); material.dispose(); },
  };
}
