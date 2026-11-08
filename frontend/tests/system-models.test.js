// Every system gets a model with a head the view can turn, a rotating radar's head spins, and a taller mast draws taller.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MOUNTS, PATROL_VEHICLES, STRUCTURES, STRUCT_SCALE, WORLD } from '../src/sim/config/index.js';
import { buildModel } from '../src/render/models.js';
import { TRUE_UNIT, drawnUnit } from '../src/render/system-parts.js';

const height = (group) => new THREE.Box3().setFromObject(group).max.y;

describe('system models', () => {
  it.each(Object.keys(STRUCTURES))('%s builds with a head, cheaply', (id) => {
    const def = STRUCTURES[id];
    const { group, parts } = buildModel(def);
    expect(parts.head.parent).toBe(group);
    expect(parts.head.position.y).toBeGreaterThanOrEqual(0);
    expect(height(group)).toBeGreaterThan(0.5);
    expect(height(group)).toBeLessThan(5.5);
    let meshes = 0, tris = 0;
    group.traverse((o) => { if (o.isMesh) { meshes++; tris += o.geometry.attributes.position.count / 3; } });
    group.traverse((o) => { if (o.isMesh) expect(o.material.type === 'MeshBasicMaterial' && !o.material.transparent, `${id}: a part with no material`).toBe(false); });
    expect(meshes).toBeLessThanOrEqual(12);
    expect(tris).toBeLessThan(3000);
    expect(!!parts.spin).toBe(def.kind === 'radar' && def.arc == null); // only a radar that turns all round spins
  });

  it('draws one panel per fixed radar panel', () => {
    const panels = (n) => buildModel({ ...STRUCTURES.radar_a400, panels: n }).parts.head.children.find((m) => m.material.name === 'body').geometry.attributes.position.count;
    expect(panels(4)).toBe(panels(1) * 4);
  });

  it('is true size up close, its mast at its real height, and no bigger than before zoomed right out', () => {
    const { group, parts } = buildModel(STRUCTURES.radar); // Robin IRIS on a 25 m mast
    parts.raise(1);
    const metres = height(group) * TRUE_UNIT * WORLD.metresPerUnit;
    expect(metres).toBeGreaterThan(25);
    expect(metres).toBeLessThan(30);
    expect(drawnUnit(0.25)).toBe(TRUE_UNIT);
    expect(drawnUnit(1200)).toBe(STRUCT_SCALE);
  });

  it('puts each system that rides in a patrol on every vehicle that can carry it', () => {
    for (const [id, need] of Object.entries(MOUNTS)) {
      for (const [vehicle, v] of Object.entries(PATROL_VEHICLES)) {
        if (need > v.carries) continue;
        const def = { ...STRUCTURES[id], vehicle, mount: STRUCTURES[id].mount == null ? undefined : v.mast };
        const { group, parts } = buildModel(def);
        expect(parts.head.position.y, `${id} on a ${vehicle}`).toBeGreaterThan(0.4);
        expect(height(group)).toBeLessThan(5.5);
      }
    }
  });

  it('draws a taller mast taller', () => {
    expect(height(buildModel({ ...STRUCTURES.camera, mount: 25 }).group)).toBeGreaterThan(height(buildModel({ ...STRUCTURES.camera, mount: 6 }).group) + 1);
  });
});
