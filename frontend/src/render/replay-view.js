// Pause and rewind. The replay view redraws a snapshot from the recorder (sim/recorder.js) in the scene, and the timeline
// (ui/Timeline.jsx) scrubs through them. Rewinding is for looking: the live simulation is not rolled back, so
// "Live" returns to where the run had got to.

import * as THREE from 'three';
import { WORLD, DRONES } from '../sim/config/index.js';
import { view } from './view.js';
import { drawScale } from './drone-models.js';
import { droneTemplate } from './models.js';
import { trackColour } from './belief-view.js';
import { labelLift } from './structure-view.js';
import { hexCss, setText } from './labels.js';
import { SYMBOL_PX, asSymbol, droneSymbol, setSymbol, symbolScale, symbolSprite, trackSymbol } from './symbols.js';

// deps: what lives in the game: { scene, rec, labels, getStructures, labelOf, hideLive, getLastSpeed, setPaused, resume }
export function createReplay(deps) {
  const { scene, rec, labels } = deps;
  const review = { active: false, idx: 0, playing: false };
  const u = (m) => m / WORLD.metresPerUnit;

  // ---------- the view ----------
  const group = new THREE.Group(); // in the scene only while reviewing: three walks even a hidden group's children every frame
  group.visible = false;
  const droneObjs = new Map(); // uid -> { group, model, unseen, label }
  const trackObjs = [];        // pool of { mesh, label }
  const missileObjs = [];
  const lineObjs = [];
  const coneGeo = new THREE.ConeGeometry(0.35, 1.8, 8).rotateX(Math.PI / 2);

  function droneObj(d) {
    let o = droneObjs.get(d.u);
    if (o) return o;
    const def = DRONES[d.type];
    const g = new THREE.Group();
    const model = droneTemplate(d.type, false).clone();
    const unseen = droneTemplate(d.type, true).clone();
    const symbol = symbolSprite('hostile:uav', 16);
    g.add(model, unseen, symbol);
    group.add(g);
    o = { group: g, model, unseen, symbol, label: labels.make(def.label, hexCss(def.color), 'dlabel') };
    droneObjs.set(d.u, o);
    return o;
  }
  const pool = (arr, make, i) => arr[i] || (arr[i] = make());

  function show(f, camera) {
    group.visible = true;
    if (group.parent !== scene) scene.add(group);
    const seen = new Set();
    for (const d of f.drones) {
      seen.add(d.u);
      const o = droneObj(d);
      o.group.visible = view.truth;
      const def = DRONES[d.type], k = drawScale(def), symbol = asSymbol(k * WORLD.metresPerUnit);
      o.group.position.set(d.x, d.y, d.z); o.group.rotation.y = d.ry; o.group.scale.setScalar(k);
      o.model.visible = d.tracked && !symbol; o.unseen.visible = !d.tracked && !symbol; o.symbol.visible = symbol;
      if (symbol) { setSymbol(o.symbol, droneSymbol(def, d.tracked)); o.symbol.material.opacity = d.tracked ? 1 : 0.6; o.symbol.scale.setScalar(symbolScale(SYMBOL_PX, k)); }
      labels.place(o.label, d.x, d.y + Math.max(DRONES[d.type].size * o.group.scale.y * 0.7, 0.004 * view.zoom), d.z, view.truth && view.labels);
      o.label.style.opacity = d.tracked ? '1' : '0.5';
    }
    for (const [uid, o] of droneObjs) if (!seen.has(uid)) { o.group.visible = false; o.label.style.display = 'none'; }

    f.tracks.forEach((tr, i) => {
      const o = pool(trackObjs, () => {
        const mesh = symbolSprite('unknown:uav', 20); group.add(mesh);
        return { mesh, label: labels.make('', '#ffffff', 'dlabel') };
      }, i);
      o.mesh.visible = true;
      o.mesh.position.set(tr.x, tr.y, tr.z);
      setSymbol(o.mesh, trackSymbol(tr)); // the same symbol the live track had
      o.mesh.scale.setScalar(symbolScale(tr.status === 'tentative' ? SYMBOL_PX * 0.75 : SYMBOL_PX));
      o.mesh.material.color.setScalar(tr.status === 'coasting' ? 0.55 : 1);
      o.label.style.borderColor = hexCss(trackColour(tr));
      const cls = tr.airframe && tr.airframe !== 'Unknown' ? tr.airframe : 'UAV';
      setText(o.label, tr.status === 'tentative' ? 'tentative' : `${tr.short} · ${cls}${tr.kill ? ' · kill reported' : ''}`);
      labels.place(o.label, tr.x, tr.y, tr.z, view.labels);
    });
    for (let i = f.tracks.length; i < trackObjs.length; i++) { trackObjs[i].mesh.visible = false; trackObjs[i].label.style.display = 'none'; }

    f.missiles.forEach((m, i) => {
      const o = pool(missileObjs, () => { const mesh = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xffffff })); mesh.scale.setScalar(3); group.add(mesh); return mesh; }, i);
      o.visible = true; o.position.set(m.x, m.y, m.z);
    });
    for (let i = f.missiles.length; i < missileObjs.length; i++) missileObjs[i].visible = false;

    // what each system was doing: its label says its mode and target, and a line runs to the drone it was engaging
    const byUid = new Map(f.drones.map((d) => [d.u, d]));
    let li = 0;
    for (const s of deps.getStructures()) {
      const st = f.structs.find((x) => x.id === s.nodeId);
      const label = deps.labelOf(s);
      if (!st) { label.style.display = 'none'; continue; }
      setText(label, `${s.short} · ${st.mode}${st.trackShort ? ' ▸ ' + st.trackShort : ''}`);
      labels.place(label, s.pos.x, s.pos.y + labelLift(s.def), s.pos.z, view.labels);
      const tgt = st.target != null ? byUid.get(st.target) : null;
      if (tgt) {
        const line = pool(lineObjs, () => {
          const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 }));
          l.frustumCulled = false; group.add(l); return l;
        }, li++);
        line.visible = true;
        line.material.color.setHex(s.def.color);
        const p = line.geometry.attributes.position;
        p.setXYZ(0, s.pos.x, s.pos.y + 6, s.pos.z); p.setXYZ(1, tgt.x, tgt.y, tgt.z); p.needsUpdate = true;
      }
    }
    for (let i = li; i < lineObjs.length; i++) lineObjs[i].visible = false;
  }

  function hide() {
    if (!group.visible) return;
    group.visible = false;
    scene.remove(group);
    for (const o of droneObjs.values()) o.label.style.display = 'none';
    for (const o of trackObjs) o.label.style.display = 'none';
  }

  // ---------- reviewing ----------
  function enter(idx) {
    if (!rec.frames.length) return;
    if (!review.active) { review.active = true; deps.setPaused(true); }
    review.idx = Math.max(0, Math.min(idx, rec.frames.length - 1));
  }
  function exit() {
    if (!review.active) return;
    review.active = false; review.playing = false; view.replayT = null; view.replayCasualties = null;
    hide();
    deps.resume();
  }
  const stepBy = (d) => { review.playing = false; enter((review.active ? review.idx : rec.frames.length - 1) + d); };
  function togglePlay() {
    if (!review.active) return;
    review.playing = !review.playing;
    if (review.playing && review.idx >= rec.frames.length - 1) review.idx = 0;
  }
  const frameIndex = () => Math.max(0, Math.min(Math.floor(review.idx), rec.frames.length - 1));

  // called every frame with the real elapsed time and the camera
  function update(real, camera) {
    if (!review.active) return;
    const n = rec.frames.length;
    if (review.playing) {
      review.idx += (real * WORLD.timeScale * Math.max(deps.getLastSpeed() || 1, 1)) / 0.5;
      if (review.idx >= n - 1) { review.idx = n - 1; review.playing = false; }
    }
    const f = rec.frames[frameIndex()];
    view.replayT = f.t;
    view.replayCasualties = f.casualties ?? null;
    deps.hideLive();
    show(f, camera);
  }

  // forget the cached replay drones (uids restart from 1 after a reset, so they must not be reused)
  function reset() {
    exit();
    for (const o of droneObjs.values()) {
      group.remove(o.group); o.label.remove();
      o.symbol.material.dispose(); o.symbol.geometry.dispose(); // the models share their template's buffers; the sprite has its own
    }
    droneObjs.clear();
  }

  return { review, update, enter, exit, hide, reset, togglePlay, frameIndex, stepBack: () => stepBy(-1), stepForward: () => stepBy(1), active: () => review.active };
}
