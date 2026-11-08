// Draws the drones: the real position when the truth overlay is on (colour if tracked, grey if nobody has it), as a model, or
// zoomed out a hostile air map symbol (symbols.js). When it is off, only the fused tracks (belief-view.js) are visible. Views
// are created and removed to match the simulation's list.

import * as THREE from 'three';
import { WORLD } from '../sim/config/index.js';
import { hereU } from '../sim/units.js';
import { droneTemplate } from './models.js';
import { drawScale } from './drone-models.js';
import { hexCss } from './labels.js';
import { SYMBOL_OVER, SYMBOL_PX, droneSymbol, setSymbol, symbolScale, symbolSprite } from './symbols.js';
import { view } from './view.js';
import { createTrail } from './trail.js';

const barGeo = new THREE.PlaneGeometry(2, 0.25).translate(1, 0, 0);
const dropGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0)]);

export function createDroneViews(scene, sim, labels, camera) {
  const views = new Map(); // drone -> view

  function create(d) {
    const def = d.def;
    const group = new THREE.Group();
    const model = droneTemplate(d.type, false).clone();
    const unseen = droneTemplate(d.type, true).clone();
    unseen.visible = false;
    const symbol = symbolSprite('hostile:uav', 16);
    group.add(model, unseen, symbol);
    const rotors = [...model.children, ...unseen.children].filter((c) => c.name === 'rotor');

    const bar = new THREE.Group(); // the models are in metres, so the bar sits and sizes by the drone's span
    bar.position.y = def.size * 0.5; bar.scale.setScalar(def.size * 0.3);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x66ff66, depthTest: false });
    const fill = new THREE.Mesh(barGeo, fillMat);
    fill.position.x = -1; fill.renderOrder = 10;
    bar.add(fill); group.add(bar);

    // thin line down to the ground so altitude is readable
    const dropMat = new THREE.LineBasicMaterial({ color: def.color, transparent: true, opacity: 0.35 });
    const drop = new THREE.Line(dropGeo, dropMat);
    drop.frustumCulled = false;
    group.add(drop);

    scene.add(group);

    // fibre-optic drones pay out a line from where they launched
    let fibre = null;
    if (def.fibre) {
      fibre = new THREE.Line(new THREE.BufferGeometry().setFromPoints([d.launch, d.launch]),
        new THREE.LineBasicMaterial({ color: 0xd7ccc8, transparent: true, opacity: 0.6 }));
      fibre.frustumCulled = false;
      scene.add(fibre);
    }
    const v = { group, model, unseen, symbol, top: 0, rotors, bar, fill, fillMat, drop, dropMat, fibre, trail: createTrail(scene, def.color), hp: d.hp, phase: (d.uid * 1.7) % 6, label: labels.make(def.label, hexCss(def.color), 'dlabel') };
    views.set(d, v);
    return v;
  }

  function dispose(d, v) {
    v.label.remove();
    scene.remove(v.group);
    if (v.fibre) { scene.remove(v.fibre); v.fibre.geometry.dispose(); v.fibre.material.dispose(); }
    v.fillMat.dispose(); v.dropMat.dispose(); v.trail.dispose(); v.symbol.material.dispose(); v.symbol.geometry.dispose();
    views.delete(d);
  }

  function sync(real) {
    const live = new Set(sim.drones);
    for (const [d, v] of views) if (!live.has(d)) dispose(d, v);
    for (const d of sim.drones) {
      const v = views.get(d) || create(d);
      const tracked = d.detected;
      const dist = camera.position.distanceTo(d.pos);
      const k = drawScale(d.def, view.eye ? dist : view.zoom); // it shrinks to true size as the camera closes in; from a mast, by its own distance
      const symbol = !view.eye && k * WORLD.metresPerUnit > SYMBOL_OVER; // never in the ground view
      v.group.visible = view.truth;
      v.trail.push(d.pos); // kept while hidden, so switching it on shows the whole flight
      v.trail.line.visible = view.trails && view.truth;
      v.model.visible = tracked && !symbol;
      v.unseen.visible = !tracked && !symbol;
      v.symbol.visible = symbol;
      v.bar.visible = tracked;
      if (symbol) {
        setSymbol(v.symbol, droneSymbol(d.def, tracked));
        v.symbol.material.opacity = tracked ? 1 : 0.6;
        v.symbol.scale.setScalar(symbolScale(SYMBOL_PX, k));
      }
      // the bar and the name tag clear the top of whatever is drawn
      v.bar.position.y = symbol ? symbolScale(SYMBOL_PX * 0.55, k) * dist : d.def.size * 0.5;
      v.top = symbol ? symbolScale(SYMBOL_PX * 0.75) * dist : d.def.size * k * 0.7;
      if (v.hp !== d.hp) { // health bar
        v.hp = d.hp;
        const k = Math.max(d.hp / d.def.hp, 0);
        v.fill.scale.x = k;
        v.fillMat.color.setHSL(k * 0.33, 1, 0.5);
      }
      v.dropMat.color.setHex(tracked ? d.def.color : 0x667080);
      for (const r of v.rotors) r.rotation[r.userData.axis || 'y'] += real * 50;
      v.group.scale.setScalar(k);
      v.group.position.copy(d.pos);
      v.group.position.y = d.pos.y + Math.sin(performance.now() / 300 + v.phase) * 0.01 * d.def.size * k;
      v.group.rotation.y = d.heading;
      if (d.def.bank) { v.model.rotation.z = d.bank; v.unseen.rotation.z = d.bank; }
      v.drop.scale.y = Math.max(d.pos.y - hereU(d.pos.x, d.pos.z), 0) / v.group.scale.y;
      v.bar.lookAt(camera.position);
      if (v.fibre) {
        v.fibre.visible = view.truth;
        const p = v.fibre.geometry.attributes.position;
        p.setXYZ(1, d.pos.x, d.pos.y, d.pos.z); p.needsUpdate = true;
      }
    }
  }

  return {
    sync,
    updateLabels() {
      for (const [d, v] of views) {
        v.label.style.opacity = d.detected ? '1' : '0.5';
        labels.place(v.label, d.pos.x, d.pos.y + Math.max(v.top, 0.004 * view.zoom), d.pos.z, view.labels && view.truth && view.replayT == null);
      }
    },
    hide() { for (const v of views.values()) { v.group.visible = false; v.trail.line.visible = false; if (v.fibre) v.fibre.visible = false; v.label.style.display = 'none'; } },
  };
}
