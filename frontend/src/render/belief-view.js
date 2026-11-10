// What the fusion node believes. Each track is drawn where the fusion node thinks the drone is, with a circle for its
// position error. Bearings that no track claims (RF, camera) are drawn as rays from the sensor; where two cross, the
// tracker may start a track there, which can be a ghost if the rays came from different drones. With the truth overlay
// on, a line joins each track to the real drone at its position; a ghost has none.
//
// A track is an APP-6 air track symbol (symbols.js) for what the fusion node thinks it is: a yellow unknown frame until a
// camera names the airframe, then a red hostile frame with a UAV mark, under a rotor for a multirotor. A tentative track (it
// might be a false alarm) has a dashed pending frame; coasting tracks are drawn dimmer. Tracks are drawn faint so they do not
// crowd the view; "Highlight tracks" draws them solid and colours their error rings by class.

import * as THREE from 'three';
import { WORLD } from '../sim/config/index.js';
import { u } from '../sim/units.js';
import { styleTrack, symbolSprite, trackTagOpacity, trackTagShown } from './symbols.js';
import { view } from './view.js';
import { createTrail } from './trail.js';
import { setStyle, setText } from './labels.js';

const CLASS_COLOUR = { Unknown: 0xffffff, Multirotor: 0xff5a3c, 'Fixed wing': 0xe040fb };
const CLASS_DIM = { Unknown: 0x9aa4b4, Multirotor: 0xa8938e, 'Fixed wing': 0x9d93aa };
export const trackColour = (tr) => {
  const hi = view.trackHi;
  if (tr.status === 'tentative') return hi ? 0x8a94a3 : 0x5f6978;
  const c = new THREE.Color((hi ? CLASS_COLOUR : CLASS_DIM)[tr.airframe] ?? (hi ? 0xffffff : 0x9aa4b4));
  return tr.status === 'coasting' ? c.multiplyScalar(0.55).getHex() : c.getHex();
};

const ringUnit = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 49 }, (_, i) => new THREE.Vector3(Math.cos((i / 48) * Math.PI * 2), 0, Math.sin((i / 48) * Math.PI * 2))));
const _p = new THREE.Vector3();

export function createBeliefViews(scene, net, labels) {
  const beliefs = new Map(); // track id -> markers
  const rayPool = [];

  function makeBelief() {
    const group = new THREE.Group();
    const symbol = symbolSprite('unknown:uav', 20);
    const ring = new THREE.LineLoop(ringUnit, new THREE.LineBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.7 }));
    const link = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x8a94a3, transparent: true, opacity: 0.6 }));
    link.frustumCulled = false;
    group.add(symbol, ring);
    scene.add(group, link);
    const label = labels.make('', '', 'tlabel');
    return { group, symbol, ring, link, label, trail: createTrail(scene, 0x9aa4b4), pos: new THREE.Vector3(), placed: false };
  }

  function disposeBelief(b) {
    scene.remove(b.group, b.link);
    b.symbol.material.dispose(); b.symbol.geometry.dispose(); b.ring.material.dispose(); b.link.geometry.dispose(); b.link.material.dispose();
    b.label.remove();
    b.trail.dispose();
  }

  function update() {
    const m = WORLD.metresPerUnit, trackHi = view.trackHi;
    for (const [id, b] of beliefs) if (!net.tracks.has(id)) { disposeBelief(b); beliefs.delete(id); }
    for (const tr of net.tracks.values()) {
      if (!tr.est) continue;
      let b = beliefs.get(tr.id);
      if (!b) { b = makeBelief(); beliefs.set(tr.id, b); }
      _p.set(tr.est.east / m, tr.est.up / m, -tr.est.north / m);
      if (!b.placed) { b.pos.copy(_p); b.placed = true; } else b.pos.lerp(_p, 0.5);
      styleTrack(b.symbol, tr, trackHi);
      b.ring.material.color.setHex(trackColour(tr));
      b.ring.material.opacity = trackHi ? 0.7 : 0.25; b.link.material.opacity = trackHi ? 0.6 : 0.2;
      b.group.position.copy(b.pos);
      b.group.visible = true;
      b.trail.push(b.pos); // what the fusion node believes it has flown
      b.trail.line.visible = view.trails && !view.truth;
      b.trail.line.material.color.setHex(trackColour(tr));
      const errU = Math.max(u(tr.estErr || 0), 0.001);
      b.ring.scale.set(errU, 1, errU);
      b.link.visible = view.truth && !!tr.drone;
      if (b.link.visible) {
        const p = b.link.geometry.attributes.position;
        p.setXYZ(0, b.pos.x, b.pos.y, b.pos.z); p.setXYZ(1, tr.drone.pos.x, tr.drone.pos.y, tr.drone.pos.z); p.needsUpdate = true;
      }
      const show = trackTagShown(tr, trackHi);
      labels.place(b.label, b.pos.x, b.pos.y, b.pos.z, show, 8); // clear of the symbol, wider than the diamond it replaced
      setStyle(b.label, 'opacity', trackTagOpacity(tr, trackHi));
      if (show) {
        const cls = tr.model ?? (tr.airframe && tr.airframe !== 'Unknown' ? tr.airframe : 'UAV');
        const err = `±${Math.round(tr.estErr || 0)} m`;
        setText(b.label, tr.status === 'tentative' ? `tentative ${err}` : `${tr.short} · ${cls} ${err}${tr.status === 'coasting' ? ' · coasting' : ''}`);
      }
    }
    // bearing candidates: rays from the sensor, coloured by sensor type
    const cands = net.bearingCandidates();
    while (rayPool.length < cands.length) {
      const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 }));
      ray.frustumCulled = false; scene.add(ray); rayPool.push(ray);
    }
    rayPool.forEach((ray, i) => {
      const c = cands[i];
      ray.visible = !!c;
      if (!c) return;
      const el = c.el ?? 0, len = 3500;
      const p = ray.geometry.attributes.position;
      p.setXYZ(0, c.from[0] / m, c.from[2] / m, -c.from[1] / m);
      p.setXYZ(1, (c.from[0] + len * Math.cos(el) * Math.sin(c.az)) / m, (c.from[2] + len * Math.sin(el)) / m, -(c.from[1] + len * Math.cos(el) * Math.cos(c.az)) / m);
      p.needsUpdate = true;
      ray.material.color.setHex(c.color);
      ray.material.opacity = trackHi ? 0.6 : 0.22;
    });
  }

  return {
    update,
    clear() { for (const b of beliefs.values()) disposeBelief(b); beliefs.clear(); },
    hide() {
      for (const b of beliefs.values()) { b.group.visible = false; b.link.visible = false; b.trail.line.visible = false; b.label.style.display = 'none'; }
      for (const r of rayPool) r.visible = false;
    },
  };
}
