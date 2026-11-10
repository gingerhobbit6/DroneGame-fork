// Turning the mouse into a point on the ground, and the green or red preview of the system being placed.

import * as THREE from 'three';
import { DRONES, STRUCTURES, WORLD } from '../sim/config/index.js';
import { drawnUnit } from './system-parts.js';
import { BEARINGS, predictRange, usesPath } from '../sim/site-range.js';
import { standingAt } from '../sim/sensor-model.js';
import { terrainState } from '../sim/terrain.js';
import { u, hereU } from '../sim/units.js';
import { drapedRing } from './terrain-view.js';
import { view } from './view.js';
import { labelLift, ringThickness } from './structure-view.js';
import { DRAG_TYPE, readDrop } from '../drag.js';

const PICK_PX = 16;
const PEOPLE_MARKER = 0.006; // the placement marker's size per scene unit from the camera
const PREDICT_EVERY_MS = 120; // re-predicting costs milliseconds, so the preview does not do it on every mouse move
export const PLACING_PICK_PX = 8; // tighter while placing, so a click near a system can still place beside it
const _base = new THREE.Vector3(), _top = new THREE.Vector3();
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _level = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), _hit = new THREE.Vector3();

// How far to slide the camera over the ground so this point appears at this place on the screen, or null if the view never reaches it.
export function slideToShow(camera, x, y, z, px, py, width = innerWidth, height = innerHeight) {
  _ndc.set((px / width) * 2 - 1, -(py / height) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  _level.constant = -y;
  if (!_ray.ray.intersectPlane(_level, _hit)) return null;
  return { x: x - _hit.x, z: z - _hit.z };
}

// The system nearest a point on the screen, measured to the line from its base up to its name tag, or null if none is close.
// Measured on the screen, because at a low camera angle a ground point lands well behind a tall model.
export function pickStructure(structures, camera, px, py, width = innerWidth, height = innerHeight, tolerance = PICK_PX) {
  let best = null, bd = tolerance;
  for (const s of structures) {
    _base.copy(s.pos).project(camera);
    _top.copy(s.pos).setY(s.pos.y + labelLift(s.def)).project(camera);
    if (_base.z >= 1 || _top.z >= 1) continue; // behind the camera
    const ax = ((_base.x + 1) / 2) * width, ay = ((1 - _base.y) / 2) * height;
    const dx = ((_top.x + 1) / 2) * width - ax, dy = ((1 - _top.y) / 2) * height - ay;
    const along = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(px - (ax + along * dx), py - (ay + along * dy));
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

const DRONE_PICK_PX = 20; // a drone's map symbol is 36 pixels across

// The drone whose position on the screen is nearest a point, or null if none is within the tolerance.
export function pickDrone(drones, camera, px, py, width = innerWidth, height = innerHeight, tolerance = DRONE_PICK_PX) {
  let best = null, bd = tolerance;
  for (const d of drones) {
    _base.copy(d.pos).project(camera);
    if (_base.z >= 1) continue; // behind the camera
    const dist = Math.hypot(px - ((_base.x + 1) / 2) * width, py - ((1 - _base.y) / 2) * height);
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}

// What a left click selects, with null clearing the selection, or undefined if the click belongs to the tool. A system beats a
// placement tool: the ground behind a model can be far enough away to buy a second one. A click never selects with the Sell or zone tool.
export function selectionFrom(tool, tagged, pick) {
  if (!tool) return tagged || pick();
  return (STRUCTURES[tool] && (tagged || pick())) || undefined;
}

// getTool() is a structure id, 'sell', 'zone', 'people' or null. A left click first calls onSelect(screenX, screenY), which returns true if
// it dealt with the click. Otherwise it calls onGroundClick(x, z).
// Where a ray first meets the ground inside the world, or null: step out along it, each step a little longer, then halve the last one.
// Testing the ground mesh's 580,000 triangles instead took about 16 ms, on every mouse move.
export function groundHit(ray, far, out) {
  const { origin: o, direction: d } = ray, edge = terrainState.data.R / WORLD.metresPerUnit;
  const under = (t) => {
    const x = o.x + d.x * t, z = o.z + d.z * t;
    return Math.abs(x) <= edge && Math.abs(z) <= edge && o.y + d.y * t <= hereU(x, z);
  };
  for (let last = 0, step = u(5), t = step; t < far; last = t, step *= 1.02, t += step) {
    if (!under(t)) continue;
    for (let k = 0; k < 12; k++) { const mid = (last + t) / 2; if (under(mid)) t = mid; else last = mid; }
    return out.set(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
  }
  return null;
}

export function createPlacement({ scene, camera, canvas, sim, getTool, defFor = (tool) => STRUCTURES[tool], onGroundClick, onSelect, onDrop = () => {}, onDoubleClick = () => {} }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const mouseGround = new THREE.Vector3();
  let mouseOnGround = false, downPos = null;

  function updateMouse(e) {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    mouseOnGround = !!(groundHit(raycaster.ray, camera.far, mouseGround) || raycaster.ray.intersectPlane(groundPlane, mouseGround));
    if (mouseOnGround) mouseGround.y = hereU(mouseGround.x, mouseGround.z);
  }
  canvas.addEventListener('pointermove', updateMouse);
  // A card dragged from a list: the preview follows it, and letting go places it there
  canvas.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    updateMouse(e);
  });
  canvas.addEventListener('drop', (e) => {
    const item = readDrop(e.dataTransfer.getData(DRAG_TYPE));
    if (!item) return;
    e.preventDefault();
    updateMouse(e);
    if (mouseOnGround) onDrop(item, mouseGround.x, mouseGround.z);
  });
  canvas.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY, b: e.button }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!downPos || downPos.b !== 0) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved > 5) return;
    if (onSelect(e.clientX, e.clientY)) return;
    updateMouse(e);
    if (mouseOnGround) onGroundClick(mouseGround.x, mouseGround.z);
  });
  // With a tool picked each click is a placement, so only a double-click with nothing picked moves the camera
  canvas.addEventListener('dblclick', (e) => {
    if (getTool()) return;
    updateMouse(e);
    if (mouseOnGround) onDoubleClick(mouseGround.x, mouseGround.z);
  });

  const ghost = new THREE.Group();
  ghost.visible = false;
  scene.add(ghost);
  let ghostRing = null;
  let ghostAt = { x: NaN, z: NaN }, ghostRadii = null, predictedAt = 0;
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  const ghostMarker = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.5, 16), ghostMat);
  ghostMarker.scale.setScalar(drawnUnit());
  ghost.add(ghostMarker);

  function refresh() {
    if (ghostRing) { ghost.remove(ghostRing.mesh); ghostRing.mesh.geometry.dispose(); ghostRing = null; }
    const def = STRUCTURES[getTool()];
    if (def) {
      const r = u(def.range);
      ghostRadii = usesPath(def) ? new Array(BEARINGS).fill(r) : null;
      ghostRing = drapedRing(r, ringThickness(r) * 1.5, 0xffffff, 0.5, 160, ghostRadii);
      ghostRing.mesh.material.dispose();
      ghostRing.mesh.material = ghostMat; // shares the green/red placement colour
      ghost.add(ghostRing.mesh);
      ghostAt = { x: NaN, z: NaN };
    }
  }

  function update() {
    const tool = getTool();
    if (ghostRing || tool === 'sell' || tool === 'people') {
      ghost.visible = mouseOnGround && !!tool && sim.state.started;
      ghost.position.set(mouseGround.x, mouseGround.y + 0.1, mouseGround.z);
      ghostMarker.scale.setScalar(tool === 'people' ? camera.position.distanceTo(ghost.position) * PEOPLE_MARKER : drawnUnit()); // people are tiny, so it must not hide them up close
      if (ghostRing && mouseOnGround && (ghostAt.x !== mouseGround.x || ghostAt.z !== mouseGround.z)) {
        const now = performance.now(), predicting = ghostRadii && now - predictedAt > PREDICT_EVERY_MS;
        if (predicting) { // the preview shows the range this spot really gets
          predictedAt = now;
          const m = WORLD.metresPerUnit;
          const def = standingAt(defFor(tool), sim.state.zoneCentre, mouseGround); // facing as it will once placed
          predictRange(def, DRONES.fpv, terrainState.data, mouseGround.x * m, mouseGround.z * m).first.forEach((metres, i) => { ghostRadii[i] = u(metres); });
        }
        ghostRing.update(mouseGround.x, mouseGround.z); // re-drape the ring over the ground under the cursor
        if (!ghostRadii || predicting) ghostAt = { x: mouseGround.x, z: mouseGround.z }; // a spot skipped to throttle is predicted once the cursor rests
      }
      const ok = tool === 'sell' || (tool === 'people' ? sim.canPlacePeople(mouseGround.x, mouseGround.z, view.people.protection) : sim.canPlace(mouseGround.x, mouseGround.z, STRUCTURES[tool]));
      ghostMat.color.set(tool === 'sell' ? 0xff9800 : ok ? 0x66ff66 : 0xff5252);
    } else ghost.visible = false;
  }

  return { refresh, update, cursor: () => (mouseOnGround ? { x: mouseGround.x, z: mouseGround.z } : null) };
}
