// Three.js scene objects for the terrain, the power station, trees, buildings and power lines, plus helpers that
// drape range rings over the ground and draw a hillshade for the plan map. The data comes from terrain.js.

import * as THREE from 'three';
import { WORLD, TERRAIN, COMMS } from '../sim/config/index.js';
import { terrainState } from '../sim/terrain.js';
import { clamp } from '../sim/world.js';
import { mulberry32, hashSeed } from '../sim/rng.js';

const MPU = () => WORLD.metresPerUnit;
const UP = new THREE.Vector3(0, 1, 0);
const u = (m) => m / MPU();

// ground height in scene units at a scene-unit position
export const groundU = (xu, zu) => terrainState.data.groundAt(xu * MPU(), zu * MPU()) / MPU();

export function buildWorldView(scene, data, siteMat) {
  const group = new THREE.Group();
  scene.add(group);
  const R = data.R;
  const vs = data.geo ? 1 : TERRAIN.visualScale; // on a real map, models are true to its scale

  // ---------- ground ----------
  // mesh vertex every few grid cells; the sim grid is finer. At most 540 segments a side keeps a 54 km world near 580,000 triangles
  const stride = Math.max(1, TERRAIN.meshStride, Math.ceil((data.N - 1) / 540));
  const seg = Math.floor((data.N - 1) / stride);
  const geo = new THREE.PlaneGeometry(u(2 * R), u(2 * R), seg, seg).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const low = new THREE.Color(0x3a5a2c), mid = new THREE.Color(0x5f6f3a), high = new THREE.Color(0x8a7d62);
  const rock = new THREE.Color(0x6f6a62), snow = new THREE.Color(0xeef3f7), forest = new THREE.Color(0x1f3a22), built = new THREE.Color(0x8a8c90);
  const gravel = new THREE.Color(0x77776f), water = new THREE.Color(0x1d6a96), shallow = new THREE.Color(0x3b8fb5), c = new THREE.Color();
  const e = data.cell * stride; // spacing for curvature
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v) * MPU(), z = pos.getZ(v) * MPU();
    const h = data.groundAt(x, z);
    pos.setY(v, u(h));
    const t = clamp(h / TERRAIN.relief, 0, 1);
    const cov = data.coverAt(x, z);
    if (cov === 4) { // water, a little lighter towards the banks
      const bank = clamp((data.groundAt(x + e, z) + data.groundAt(x - e, z) + data.groundAt(x, z + e) + data.groundAt(x, z - e)) / 4 - h, 0, 40) / 40;
      c.copy(water).lerp(shallow, bank);
    } else {
      c.copy(low).lerp(mid, clamp(t * 2.2, 0, 1)).lerp(high, clamp(t * 2.2 - 1, 0, 1));
      const slope = data.slope(x, z);
      c.lerp(rock, clamp((slope - 0.3) * 3, 0, 0.8));
      if (t > TERRAIN.snowLine) c.lerp(snow, clamp((t - TERRAIN.snowLine) * 8, 0, 1) * (1 - clamp((slope - 0.9) * 2, 0, 0.6)));
      if (cov === 1) c.lerp(forest, 0.65); else if (cov === 2) c.lerp(built, 0.7);
      if (Math.hypot(x, z) < 280) c.lerp(gravel, 0.8);
      // convex ground (ridges) catches the light, concave ground (valleys) is darker: cheap ambient occlusion
      const curv = h - (data.groundAt(x + e, z) + data.groundAt(x - e, z) + data.groundAt(x, z + e) + data.groundAt(x, z - e)) / 4;
      c.multiplyScalar(1 + clamp(curv * 0.006, -0.3, 0.25));
    }
    colours[v * 3] = c.r; colours[v * 3 + 1] = c.g; colours[v * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  group.add(mesh);

  // ---------- power station ----------
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.8 });
  for (const s of data.station) {
    if (s.kind === 'box') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(u(s.w), u(s.h), u(s.d)), siteMat);
      m.position.set(u(s.x), u(s.h) / 2, u(s.z)); group.add(m);
    } else if (s.kind === 'cyl') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(u(s.r * 0.7), u(s.r), u(s.h), 14), siteMat);
      m.position.set(u(s.x), u(s.h) / 2, u(s.z)); group.add(m);
    } else if (s.kind === 'tower') { // hyperbolic cooling tower
      const pts = [];
      for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push(new THREE.Vector2(u(s.r * (0.72 + 0.28 * Math.pow(Math.abs(t - 0.65) / 0.65, 2))), u(s.h) * t)); }
      const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), siteMat);
      m.position.set(u(s.x), 0, u(s.z)); group.add(m);
    } else if (s.kind === 'yard') { // gantry posts on a grid
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(u(2), u(14), u(2)).translate(0, u(7), 0), dark, 20);
      const mat4 = new THREE.Matrix4();
      let n = 0;
      for (let gx = 0; gx < 5; gx++) for (let gz = 0; gz < 4; gz++) {
        mat4.setPosition(u(s.x - s.w / 2 + gx * (s.w / 4)), 0, u(s.z - s.d / 2 + gz * (s.d / 3)));
        posts.setMatrixAt(n++, mat4);
      }
      group.add(posts);
    }
  }

  // ---------- trees ----------
  // On a real map, one tree fills each tree cell, centred on it, so the drawing shows exactly the grid the rules use.
  // Generated ground is invented anyway, so its trees are thinned and scattered to look natural.
  const scenery = [];
  const trng = mulberry32(hashSeed(`${data.seed}:trees`));
  const k = data.geo ? 1 : Math.max(1, Math.round(TERRAIN.treeStep / data.cell));
  const scatter = data.geo ? 0 : data.cell * k;
  const crown = data.geo ? data.cell / 2 : 5 * vs;
  const treeSpots = [];
  const treeR = 4500;
  for (let j = 0; j < data.N; j += k) {
    for (let i = 0; i < data.N; i += k) {
      const x = -R + i * data.cell, z = -R + j * data.cell;
      if (x * x + z * z > treeR * treeR) continue;
      const idx = j * data.N + i;
      if (data.cover[idx] !== 1 || !data.canopy[idx]) continue;
      treeSpots.push({ x: x + (trng() - 0.5) * scatter, z: z + (trng() - 0.5) * scatter, h: data.canopy[idx] });
    }
  }
  if (treeSpots.length) {
    const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0x24442a }), treeSpots.length);
    scenery.push(trees);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    treeSpots.forEach((t, n) => {
      p.set(u(t.x), u(data.groundAt(t.x, t.z)), u(t.z));
      sc.set(u(crown), u(t.h * vs), u(crown));
      m4.compose(p, q, sc);
      trees.setMatrixAt(n, m4);
    });
    group.add(trees);
  }

  // ---------- hamlet buildings ----------
  if (data.buildings.length) {
    const houses = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), data.buildings.length);
    scenery.push(houses);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    const palette = [0xc9c2b4, 0xb88a6a, 0xd8d4cc, 0x9aa3ad];
    data.buildings.forEach((b, n) => {
      p.set(u(b.x), u(data.groundAt(b.x, b.z)), u(b.z));
      sc.set(u(b.w * vs), u(b.h * vs), u(b.d * vs));
      q.setFromAxisAngle(UP, b.angle || 0);
      m4.compose(p, q, sc);
      houses.setMatrixAt(n, m4);
      houses.setColorAt(n, col.setHex(palette[n % palette.length]));
    });
    group.add(houses);
  }

  // ---------- power lines ----------
  const H = TERRAIN.pylonHeight * vs;
  const pylonList = [];
  for (const line of data.lines) line.forEach((p, i) => {
    const q = line[Math.min(i + 1, line.length - 1)], r = line[Math.max(i - 1, 0)];
    pylonList.push({ ...p, heading: Math.atan2(q.z - r.z, q.x - r.x) });
  });
  if (pylonList.length) {
    const bodies = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 4).translate(0, 0.5, 0), dark, pylonList.length);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), dark, pylonList.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    pylonList.forEach((pl, n) => {
      const g = data.groundAt(pl.x, pl.z);
      q.identity();
      p.set(u(pl.x), u(g), u(pl.z)); sc.set(u(5 * vs), u(H), u(5 * vs));
      m4.compose(p, q, sc); bodies.setMatrixAt(n, m4);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(pl.heading + Math.PI / 2));
      p.set(u(pl.x), u(g + H * 0.85), u(pl.z)); sc.set(u(22 * vs), u(1.5 * vs), u(1.5 * vs));
      m4.compose(p, q, sc); arms.setMatrixAt(n, m4);
    });
    group.add(bodies, arms);

    // conductors: three per span, sagging between the crossarms
    const pts = [];
    for (const line of data.lines) {
      for (let i = 1; i < line.length; i++) {
        const A = line[i - 1], B = line[i];
        const heading = Math.atan2(B.z - A.z, B.x - A.x) + Math.PI / 2;
        const gA = data.groundAt(A.x, A.z) + H * 0.85, gB = data.groundAt(B.x, B.z) + H * 0.85;
        const span = Math.hypot(B.x - A.x, B.z - A.z), sag = 0.025 * span;
        for (const off of [-9 * vs, 0, 9 * vs]) {
          let prev = null;
          for (let s = 0; s <= 10; s++) {
            const t = s / 10;
            const cur = [u(A.x + (B.x - A.x) * t + Math.cos(heading) * off), u(gA + (gB - gA) * t - sag * 4 * t * (1 - t)), u(A.z + (B.z - A.z) * t + Math.sin(heading) * off)];
            if (prev) pts.push(...prev, ...cur);
            prev = cur;
          }
        }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xaab4c4 })));
  }

  // ---------- cell towers ----------
  for (const t of data.towers) {
    const h = COMMS.towerHeight * vs;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(u(1.2 * vs), u(3 * vs), u(h), 6), new THREE.MeshStandardMaterial({ color: 0xff5252, roughness: 0.6 }));
    mast.position.set(u(t.x), u(t.ground + h / 2), u(t.z));
    const head = new THREE.Mesh(new THREE.BoxGeometry(u(8 * vs), u(3 * vs), u(8 * vs)), new THREE.MeshStandardMaterial({ color: 0xfafafa }));
    head.position.set(u(t.x), u(t.ground + h), u(t.z));
    group.add(mast, head);
  }

  function dispose() {
    scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== siteMat) o.material.dispose();
      if (o.isInstancedMesh) o.dispose();
    });
  }
  return { group, mesh, scenery, dispose };
}

// A ring that follows the ground: a flat ribbon whose vertices are raised to the terrain height. `update(cx, cz)` re-fits
// it around a new centre (scene units); the ring is built relative to its centre, so position its parent at the ground there.
// With radii, the ring follows one radius per bearing, clockwise from north, instead of a circle. It reads them on each update, so they can change.
const LIFT = 0.5; // scene units above the ground, so the ring is not lost in it
export function drapedRing(radiusU, thicknessU, color, opacity, segs = 160, radii = null) {
  if (radii) segs = radii.length;
  const positions = new Float32Array((segs + 1) * 2 * 3);
  const index = [];
  for (let i = 0; i < segs; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(index);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, fog: false })); // a 25 km ring lies deep in the fog
  mesh.frustumCulled = false;
  function update(cx, cz) {
    const y0 = groundU(cx, cz);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2 - (radii ? Math.PI / 2 : 0), cs = Math.cos(a), sn = Math.sin(a);
      const outer = Math.max(radii ? radii[i % segs] : radiusU, 0.01);
      for (let s = 0; s < 2; s++) {
        const r = s === 0 ? Math.max(outer - thicknessU, 0.01) : outer;
        const o = (i * 2 + s) * 3;
        positions[o] = cs * r; positions[o + 1] = groundU(cx + cs * r, cz + sn * r) - y0 + LIFT; positions[o + 2] = sn * r;
      }
    }
    geo.attributes.position.needsUpdate = true;
  }
  return { mesh, update, dispose() { geo.dispose(); mesh.material.dispose(); } };
}

// Shaded relief for the plan map: north is up, covering the whole terrain.
export function makeHillshade(data, size = Math.round(data.R / 22)) { // about 44 m a pixel, whatever the world's size
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  const R = data.R, d = (2 * R) / size;
  const lo = [38, 58, 36], hi = [140, 128, 100];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = -R + (px + 0.5) * d, z = -R + (py + 0.5) * d;
      const h = data.groundAt(x, z);
      const gx = data.groundAt(x + d, z) - data.groundAt(x - d, z), gz = data.groundAt(x, z + d) - data.groundAt(x, z - d);
      const shade = clamp(0.62 - ((gx + gz) * 0.7) / (2 * d) * 2.2, 0.25, 1.1);
      const t = clamp(h / TERRAIN.relief, 0, 1);
      let r = lo[0] + (hi[0] - lo[0]) * t, gr = lo[1] + (hi[1] - lo[1]) * t, b = lo[2] + (hi[2] - lo[2]) * t;
      const cov = data.coverAt(x, z);
      if (cov === 1) { r *= 0.55; gr *= 0.8; b *= 0.55; } else if (cov === 2) { r = 150; gr = 150; b = 150; }
      else if (cov === 4) { r = 40; gr = 110; b = 160; }
      else if (t > TERRAIN.snowLine) { const s = clamp((t - TERRAIN.snowLine) * 8, 0, 1); r += (235 - r) * s; gr += (240 - gr) * s; b += (245 - b) * s; }
      const o = (py * size + px) * 4;
      img.data[o] = r * shade; img.data[o + 1] = gr * shade; img.data[o + 2] = b * shade; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}
