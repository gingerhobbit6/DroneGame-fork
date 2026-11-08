// Models wear the real products' paint, not their map colour, with no glow; a system keeps its colour in a ring at its foot,
// drones keep spinning bladed rotors, and the sun casts shadows only up close.

import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { DRONES, STRUCTURES } from '../src/sim/config/index.js';
import { buildModel, droneTemplate } from '../src/render/models.js';
import { systemMats } from '../src/render/system-parts.js';
import { paintOf, setModelEnv } from '../src/render/paint.js';
import { SHADOW_ZOOM, shadowReach } from '../src/render/game-view.js';
import { u } from '../src/sim/units.js';

const lit = (o) => o.isMesh && o.material.isMeshStandardMaterial;
const glows = (m) => m.emissive.getHex() !== 0 && m.emissiveIntensity > 0;

describe('model paint', () => {
  afterEach(() => setModelEnv(null));

  it.each(Object.keys(STRUCTURES))('%s is painted, smooth, unlit by glow, and ringed in its map colour', (id) => {
    const def = STRUCTURES[id], { group } = buildModel(def);
    expect(paintOf(def)).not.toBe(def.color);
    const meshes = [];
    group.traverse((o) => { if (lit(o)) meshes.push(o); });
    expect(meshes.find((m) => m.material.name === 'body')?.material.color.getHex() ?? paintOf(def)).toBe(paintOf(def));
    for (const m of meshes) { expect(glows(m.material)).toBe(false); expect(m.material.flatShading).toBe(false); expect(m.castShadow).toBe(true); }
    const ring = group.children.find((c) => c.name === 'foot');
    expect(ring.material.type).toBe('MeshBasicMaterial');
    expect(ring.material.color.getHex()).toBe(def.color);
    expect(ring.castShadow).toBe(false);
  });

  it.each(Object.keys(DRONES))('%s is painted, with bladed rotors the view can spin', (type) => {
    const def = DRONES[type], g = droneTemplate(type, false);
    expect(paintOf(def)).not.toBe(def.color);
    const body = g.children.find((c) => c.isMesh && c.material.color.getHex() === paintOf(def));
    expect(body.material.flatShading).toBe(false);
    expect(glows(body.material)).toBe(false);
    for (const r of g.children.filter((c) => c.name === 'rotor')) {
      expect(r.isGroup).toBe(true);
      expect(['y', 'z']).toContain(r.userData.axis);
      expect(r.children.some((m) => m.castShadow && !m.material.transparent)).toBe(true); // the blades
      expect(r.children.reduce((n, m) => n + m.geometry.attributes.position.count, 0)).toBeLessThan(150);
    }
    const unseen = droneTemplate(type, true);
    unseen.traverse((o) => { if (o.isMesh) { expect(o.material.color.getHex()).toBe(0x8a94a3); expect(o.castShadow).toBe(false); } });
  });

  it('gives model materials the reflection once game-view has made one, and works without it', () => {
    expect(systemMats(STRUCTURES.radar).body.envMap).toBe(null);
    const tex = new THREE.Texture();
    setModelEnv(tex);
    const mats = systemMats(STRUCTURES.radar);
    expect(mats.body.envMap).toBe(tex);
    expect(mats.body.envMapIntensity).toBeLessThan(1);
  });

  it('casts sun shadows only up close or from a mast', () => {
    expect(shadowReach(u(50), null)).toBeGreaterThan(0);
    expect(shadowReach(SHADOW_ZOOM + 1, null)).toBe(0);
    expect(shadowReach(u(5000), {})).toBeGreaterThan(0);
  });
});
