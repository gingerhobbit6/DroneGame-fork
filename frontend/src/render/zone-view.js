// The wizard's marks on the ground: the area to defend and a suggested spot, from the view settings, and a patrol's route, from the
// simulation once it is set or the view settings while it is drawn. A set route also shows its corridor, a peg at each end, and the
// enemy's last fix on the patrol, which is where its strikes are heading.

import * as THREE from 'three';
import { u, hereU } from '../sim/units.js';
import { drapedRing } from './terrain-view.js';
import { view } from './view.js';

const COLOUR = 0xc6ff00, ROUTE_COLOUR = 0x40c4ff, FIX_COLOUR = 0xff5252, SAMPLE = 4; // scene units: fine enough to follow the hills
// How wide (each side) and how high the marks are drawn, scene units: 20 m from afar, shrinking as the camera closes in so they
// do not cover a true-size patrol. Kept to steps, as the marks are rebuilt when it changes.
const markSize = () => 2 ** (Math.round(Math.log2(Math.min(1, Math.max(0.05, view.zoom * 0.004))) * 2) / 2);

function ribbon(points, closed, HALF_WIDTH, LIFT) {
  const positions = [], index = [];
  const edges = closed ? points.length : points.length - 1;
  for (let e = 0; e < edges; e++) {
    const [ax, az] = points[e], [bx, bz] = points[(e + 1) % points.length];
    const len = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(len / SAMPLE));
    if (!len) continue; // a saved zone can repeat a point
    const nx = ((az - bz) / len) * HALF_WIDTH, nz = ((bx - ax) / len) * HALF_WIDTH;
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps, z = az + ((bz - az) * s) / steps;
      for (const side of [1, -1]) positions.push(x + nx * side, hereU(x + nx * side, z + nz * side) + LIFT, z + nz * side);
      if (s < steps) { const a = positions.length / 3 - 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  return geo;
}

export function createZoneView(scene, sim) {
  const paint = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const mat = paint(COLOUR), routeMat = paint(ROUTE_COLOUR), corridorMat = paint(ROUTE_COLOUR);
  corridorMat.opacity = 0.18;
  const peg = new THREE.CylinderGeometry(3, 3, 1.5, 16);
  const marks = new THREE.Group(), routeMarks = new THREE.Group();
  const spot = drapedRing(u(150), 1.5, COLOUR, 0.95);
  const fix = drapedRing(u(40), 3, FIX_COLOUR, 0.9);
  spot.mesh.visible = fix.mesh.visible = false;
  scene.add(marks, routeMarks, spot.mesh, fix.mesh);
  let drawnFix = null;
  let drawnZone = null, drawnSpot = null, drawnRoute = null, drawnSize = 0;

  function outline(group, zone, material) {
    for (const m of group.children) if (m.geometry !== peg) m.geometry.dispose();
    group.clear();
    if (!zone) return;
    const size = markSize();
    if (zone.points.length > 1) { const line = new THREE.Mesh(ribbon(zone.points, zone.closed, size, size), material); line.frustumCulled = false; group.add(line); }
    if (zone.corridor) { const band = new THREE.Mesh(ribbon(zone.points, false, u(zone.corridor / 2), size * 0.5), corridorMat); band.frustumCulled = false; group.add(band); }
    if (!zone.closed) for (const [x, z] of zone.done ? [zone.points[0], zone.points.at(-1)] : zone.points) { const m = new THREE.Mesh(peg, material); m.position.set(x, hereU(x, z) + size, z); m.scale.setScalar(size); group.add(m); }
  }
  const drawZone = () => outline(marks, view.zone, mat);
  const route = () => view.route || (sim.getPatrol() ? { points: sim.getPatrol().route, done: true, corridor: sim.getPatrol().width } : null);
  // What the route drawn was made from. Routes and patrols are replaced, never changed in place, so comparing them by identity is enough
  // and nothing is stringified each frame.
  const routeKey = () => { const p = sim.getPatrol(); return [view.route, p, p?.route, p?.width]; };
  const drawRoute = () => outline(routeMarks, route(), routeMat);

  function drawSpot() {
    spot.mesh.visible = !!view.spot;
    if (view.spot) { const { x, z } = view.spot; spot.update(x, z); spot.mesh.position.set(x, hereU(x, z), z); }
  }

  return {
    sync() {
      const size = markSize();
      if (size !== drawnSize) { drawnSize = size; drawnZone = drawnRoute = null; } // rebuild both at the new size
      if (view.zone !== drawnZone) { drawnZone = view.zone; drawZone(); }
      if (view.spot !== drawnSpot) { drawnSpot = view.spot; drawSpot(); }
      const key = routeKey();
      if (!drawnRoute || key.some((x, i) => x !== drawnRoute[i])) { drawnRoute = key; drawRoute(); }
      const f = sim.getPatrol()?.fix ?? null;
      if (f !== drawnFix) { drawnFix = f; fix.mesh.visible = !!f; if (f) { fix.update(f.x, f.z); fix.mesh.position.set(f.x, hereU(f.x, f.z), f.z); } }
    },
    redraw() { drawZone(); drawSpot(); drawRoute(); }, // the ground has changed
  };
}
