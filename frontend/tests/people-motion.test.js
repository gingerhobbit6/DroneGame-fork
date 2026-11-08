// @vitest-environment jsdom
// Up close, people are posed every frame from the simulation's state: in the open they get down while a drone is near and
// stand again once it has gone, and the patrol's people face the way they walk. The drawing never changes the simulation.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimulation } from '../src/sim/simulation.js';
import { WORLD } from '../src/sim/config/index.js';
import { u } from '../src/sim/units.js';
import { createPeopleViews } from '../src/render/people-view.js';
import { OPENING_ZOOM, view } from '../src/render/view.js';
import { setUp } from './support/scenarios.js';

const labels = { make: () => document.createElement('div'), place() {} };
const square = (cx, cz, r) => [[cx - r, cz - r], [cx + r, cz - r], [cx + r, cz + r], [cx - r, cz + r]];
let sim, scene, people, now;

beforeEach(() => {
  sim = createSimulation();
  setUp(sim, { seed: '1', laydown: [] });
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  view.zoom = u(50); // close in, where people are posed
  scene = new THREE.Scene();
  people = createPeopleViews(scene, sim, labels);
});
afterEach(() => { vi.restoreAllMocks(); view.zoom = OPENING_ZOOM; });

// Frames at 20 a second for this long, stepping the simulation with them if asked.
function frames(seconds, step = false) {
  for (let i = 0; i < seconds * 20; i++) { now += 50; if (step) sim.run(1); people.sync(); }
}

// Where each person's part is, and which way its head (up) and chest (forward) point.
function poses(name) {
  const mesh = scene.getObjectByName(name), m = new THREE.Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => {
    const up = new THREE.Vector3(), forward = new THREE.Vector3();
    mesh.getMatrixAt(i, m);
    m.extractBasis(new THREE.Vector3(), up, forward);
    return { y: m.elements[13] * WORLD.metresPerUnit, up: up.normalize(), forward: forward.normalize() };
  });
}

describe('people up close', () => {
  it('get down while a drone is near, and stand again once it has gone', () => {
    expect(sim.commands.placePeople(20, 20, 6, 'open', 'military')).toBeNull();
    expect(sim.commands.placePeople(25, 20, 6, 'open')).toBeNull();
    const state = () => JSON.stringify([sim.peopleRev(), sim.people.map((g) => [g.x, g.z, Array.from(g.spots), g.hits])]);
    const before = state();
    frames(1);
    const standing = poses('civilian torso');
    for (const p of [...standing, ...poses('military torso')]) expect(p.up.y).toBeGreaterThan(0.95);

    const d = sim.spawnDrone('fw', 0, { jitter: 0, altFrac: 0.5 });
    d.pos.set(22, d.pos.y, 20); // 40 m and 60 m from the groups
    frames(1);
    for (const p of poses('military torso')) { expect(Math.abs(p.up.y)).toBeLessThan(0.5); expect(p.forward.y).toBeLessThan(-0.8); } // prone, chest to the ground
    poses('civilian torso').forEach((p, i) => { expect(Math.abs(p.up.y)).toBeLessThan(0.5); expect(p.forward.y).toBeLessThan(-0.8); expect(p.y).toBeLessThan(standing[i].y - 0.5); }); // face down
    for (const p of poses('civilian arms')) expect(Math.abs(p.up.y)).toBeLessThan(0.5); // arms along the ground, over the head

    d.dead = true;
    frames(1.5);
    for (const p of [...poses('civilian torso'), ...poses('military torso')]) expect(p.up.y).toBeGreaterThan(0.95);
    expect(state()).toBe(before);
  });

  it("the patrol's people face the way they walk, legs swinging", () => {
    expect(sim.commands.setPatrol(square(20, 20, 10))).toBeNull();
    sim.commands.enterSandbox(); // the patrol walks once the attack starts, or in the sandbox
    const g = sim.getPatrol().group, from = { x: g.x, z: g.z };
    frames(2, true);
    const way = new THREE.Vector3(g.x - from.x, 0, g.z - from.z).normalize();
    expect(way.length()).toBeGreaterThan(0.9);
    let apart = 0;
    for (let i = 0; i < 20; i++) {
      frames(0.05, true);
      for (const p of poses('military torso')) expect(p.forward.dot(way)).toBeGreaterThan(0.9);
      const [left, right] = poses('military legs');
      apart = Math.max(apart, left.up.angleTo(right.up));
    }
    expect(apart).toBeGreaterThan(0.4);
  });
});
