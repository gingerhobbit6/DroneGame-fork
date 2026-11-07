// Short-lived things in the scene: explosions, and missiles in flight.

import * as THREE from 'three';
import { drawnUnit } from './system-parts.js';
import { view } from './view.js';

const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
const missileGeo = new THREE.ConeGeometry(0.35, 1.8, 8).rotateX(Math.PI / 2);
const _v = new THREE.Vector3();

export function createEffects(scene, sim, camera) {
  const booms = [];
  const missiles = new Map(); // missile -> mesh

  sim.on('explosion', ({ pos, r, color }) => {
    r = Math.max(r, 3);
    const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    mesh.position.copy(pos); mesh.scale.setScalar(r * 0.3);
    scene.add(mesh);
    booms.push({ mesh, r, age: 0, life: 0.5 });
  });

  function disposeMissile(m, mesh) { scene.remove(mesh); mesh.material.dispose(); missiles.delete(m); }

  function update(real) {
    for (let i = booms.length - 1; i >= 0; i--) {
      const e = booms[i];
      e.age += real;
      const k = e.age / e.life;
      if (k >= 1) {
        scene.remove(e.mesh); e.mesh.material.dispose();
        booms.splice(i, 1);
        continue;
      }
      e.mesh.visible = true;
      e.mesh.scale.setScalar(e.r * (0.3 + 0.7 * k));
      e.mesh.material.opacity = 0.8 * (1 - k);
    }
    const live = new Set(sim.missiles);
    for (const [m, mesh] of missiles) if (!live.has(m)) disposeMissile(m, mesh);
    for (const m of sim.missiles) {
      let mesh = missiles.get(m);
      if (!mesh) {
        const small = m.def.kind === 'interceptor';
        mesh = new THREE.Mesh(missileGeo, new THREE.MeshBasicMaterial({ color: small ? 0xffcdd2 : 0xffffff }));
        scene.add(mesh);
        missiles.set(m, mesh);
      }
      mesh.visible = true;
      mesh.scale.setScalar((m.def.kind === 'interceptor' ? 0.6 : 1) * drawnUnit(view.eye ? camera.position.distanceTo(m.pos) : undefined)); // true size up close; seen from a mast, sized by its own distance
      mesh.position.copy(m.pos);
      mesh.lookAt(_v.copy(m.pos).add(m.vel));
    }
  }

  return {
    update,
    clear() {
      for (const e of booms) { scene.remove(e.mesh); e.mesh.material.dispose(); }
      booms.length = 0;
      for (const [m, mesh] of missiles) disposeMissile(m, mesh);
    },
    hide() { for (const e of booms) e.mesh.visible = false; for (const mesh of missiles.values()) mesh.visible = false; },
  };
}
