// Draws the systems: models, range rings that follow the ground, laser beams and jammer pulses. Views are created and
// removed to match the simulation's list each frame.

import * as THREE from 'three';
import { DRONES, SYSTEM_UNIT_M, WORLD } from '../sim/config/index.js';
import { coverArc, coverKey } from '../sim/sensor-model.js';
import { predictRange, usesPath } from '../sim/site-range.js';
import { terrainState } from '../sim/terrain.js';
import { u } from '../sim/units.js';
import { buildModel } from './models.js';
import { TRUE_UNIT, drawnUnit } from './system-parts.js';
import { drapedRing } from './terrain-view.js';
import { hexCss } from './labels.js';
import { view } from './view.js';

// A real map is bright and busy, so its rings are wider, stronger and darker than on generated ground, or they disappear.
const onRealMap = () => !!terrainState.data.geo;
export const ringThickness = (r) => (onRealMap() ? Math.max(1, r * 0.012) : Math.max(0.6, r * 0.009));
// How far above its system a name tag sits, in scene units: about the top of its model, whose mast is true height up close.
export function labelLift(def) {
  const b = drawnUnit(), mast = (def.mount ?? 0) / SYSTEM_UNIT_M / Math.sqrt(b / TRUE_UNIT);
  return b * (def.modelScale || 1) * Math.max(4.5, mast + 1.5);
}
const ringOpacity = () => (onRealMap() ? 0.8 : 0.55);
const SELECTED_RING_OPACITY = 0.95; // a selected system's ring stands out over the rest, shown even with the rings hidden
const ringColour = (def) => (onRealMap() ? new THREE.Color(def.color).multiplyScalar(0.7) : def.color);
const ringKey = (s) => `${s.def.range}|${s.def.mount}|${coverKey(s.def)}`; // a radar's facing follows what is defended
const _m = new THREE.Vector3();
const turn = (deg) => Math.PI - (deg * Math.PI) / 180; // a compass bearing as a turn of a head whose front is +z
// Where a head points: a camera where it looks, fixed panels the way they face, a weapon where it aims.
const headTurn = (s) => (s.point ? turn(s.point.az) : coverArc(s.def) < 360 ? turn(s.def.facing ?? 0) : s.aim);

export function createStructureViews(scene, sim, labels) {
  const views = new Map(); // structure -> view

  function makeRing(s, v) {
    if (v.ringObj) { v.holder.remove(v.ringObj.mesh); v.ringObj.dispose(); }
    const r = u(s.def.range), m = WORLD.metresPerUnit;
    // What this spot really gets against a small drone, with line of sight over the ground, as the placing preview shows.
    const radii = usesPath(s.def) ? Array.from(predictRange(s.def, DRONES.fpv, terrainState.data, s.pos.x * m, s.pos.z * m).first, (metres) => u(metres)) : null;
    v.ringObj = drapedRing(r, ringThickness(r), ringColour(s.def), ringOpacity(), 160, 0.5, radii);
    v.ringObj.update(s.pos.x, s.pos.z); v.holder.add(v.ringObj.mesh);
    v.ringObj.mesh.visible = view.rings;
    v.ringKey = ringKey(s);
    v.ringAt = { x: s.pos.x, z: s.pos.z };
  }

  // the model shows the mast height and panels, so it is rebuilt when the unit is reconfigured
  function setModel(s, v) {
    if (v.model) { v.holder.remove(v.model); v.model.traverse((o) => { if (o.geometry) { o.geometry.dispose(); o.material.dispose(); } }); }
    const { group, parts } = buildModel(s.def);
    v.holder.add(group);
    v.model = group; v.parts = parts; v.unit = 0;
  }

  function create(s) {
    const def = s.def;
    const holder = new THREE.Group();
    holder.position.copy(s.pos);
    scene.add(holder);
    const v = { holder, model: null, parts: null, ringObj: null, beam: null, pulse: null, pulseT: (views.size * 0.37) % 1, label: labels.make(s.short, hexCss(def.color), 'slabel') };
    setModel(s, v);
    makeRing(s, v);
    if (def.fire === 'beam') {
      v.beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: def.color }));
      v.beam.frustumCulled = false; v.beam.visible = false; scene.add(v.beam);
    }
    if (def.fire === 'jam') {
      v.pulse = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: def.color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      v.pulse.position.y = 0.5; holder.add(v.pulse);
    }
    views.set(s, v);
    return v;
  }

  function dispose(s, v) {
    v.label.remove();
    scene.remove(v.holder);
    // the model, ring and pulse all sit under the holder, and buildModel makes new geometry and materials for each system
    v.holder.traverse((o) => { if (o.geometry) { o.geometry.dispose(); o.material.dispose(); } });
    if (v.beam) { scene.remove(v.beam); v.beam.geometry.dispose(); v.beam.material.dispose(); }
    views.delete(s);
  }

  function sync(real) {
    const unit = drawnUnit();
    const live = new Set(sim.structures);
    for (const [s, v] of views) if (!live.has(s)) dispose(s, v);
    for (const s of sim.structures) {
      const v = views.get(s) || create(s);
      if (s.escort) { // it moves with its patrol: the ring follows, and is re-predicted for the ground every 100 m
        v.holder.position.copy(s.pos);
        if (Math.hypot(s.pos.x - v.ringAt.x, s.pos.z - v.ringAt.z) > u(100)) makeRing(s, v);
      }
      if (v.ringKey !== ringKey(s)) { makeRing(s, v); setModel(s, v); } // this unit was reconfigured
      if (v.unit !== unit) { v.model.scale.setScalar(unit * (s.def.modelScale || 1)); v.parts.raise(unit / TRUE_UNIT); v.unit = unit; } // true size up close
      const selected = s === view.selected;
      v.model.visible = s !== view.eye; // watching from its mast, its own vehicle or tripod would fill the view
      v.ringObj.mesh.visible = view.rings || selected;
      v.ringObj.mesh.material.opacity = selected ? SELECTED_RING_OPACITY : ringOpacity(); // a real map loaded later needs its stronger rings
      v.label.classList.toggle('selected', selected);
      if (v.parts.spin) v.parts.spin.rotation.y += real * 2.2;
      else v.parts.head.rotation.y = headTurn(s);
      if (v.pulse) {
        const active = s.mode === 'Jam';
        v.pulse.visible = active;
        if (active) {
          v.pulseT = (v.pulseT + real * 0.5) % 1;
          const r = u(s.def.range) * v.pulseT;
          v.pulse.scale.set(r, 1, r);
          v.pulse.material.opacity = 0.6 * (1 - v.pulseT);
        }
      }
      if (v.beam) {
        const t = s.beamTarget;
        v.beam.visible = !!t;
        if (t) {
          const p = v.beam.geometry.attributes.position, m = _m.set(s.pos.x, s.pos.y + (s.def.muzzleY || 2) * unit * (s.def.modelScale || 1), s.pos.z); // from the drawn muzzle
          p.setXYZ(0, m.x, m.y, m.z); p.setXYZ(1, t.pos.x, t.pos.y, t.pos.z); p.needsUpdate = true;
        }
      }
    }
  }

  return {
    sync,
    labelOf: (s) => views.get(s)?.label,
    // The system whose name tag is under this point on the screen. The tags take no pointer events, so they are checked here.
    labelAt(x, y) {
      let hit = null; // the last one drawn is on top
      for (const [s, v] of views) {
        const r = v.label.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = s;
      }
      return hit;
    },
    setRingsVisible(on) { for (const v of views.values()) v.ringObj.mesh.visible = on; },
    remakeRings() { for (const [s, v] of views) makeRing(s, v); },
    updateLabels(net) {
      for (const [s, v] of views) {
        const target = s.task && net.tracks.get(s.task.trackId);
        v.label.textContent = `${s.short} · ${s.mode}${target ? ' ▸ ' + (target.short || '?') : ''}`;
        labels.place(v.label, s.pos.x, s.pos.y + labelLift(s.def), s.pos.z, view.labels);
      }
    },
    hideBeams() { for (const v of views.values()) if (v.beam) v.beam.visible = false; },
  };
}
