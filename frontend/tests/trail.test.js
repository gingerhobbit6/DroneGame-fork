// Drone trails: a point every 50 m with the newest following the drone, the oldest dropped, and shown only when switched on,
// for the real drone with the truth overlay and for its track without.

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createTrail } from '../src/render/trail.js';
import { createDroneViews } from '../src/render/drone-view.js';
import { view } from '../src/render/view.js';
import { createSimulation } from '../src/sim/simulation.js';

const at = (x) => new THREE.Vector3(x, 0, 0); // scene units: 20 m each

afterEach(() => { Object.assign(view, { trails: false, truth: true }); });

describe('a trail', () => {
  it('moves its newest point with the drone, and fixes one every 50 m', () => {
    const scene = new THREE.Scene(), trail = createTrail(scene, 0xffffff);
    trail.push(at(0)); trail.push(at(1)); trail.push(at(2)); // 40 m: the head follows
    expect(trail.length).toBe(2);
    expect(trail.line.geometry.attributes.position.getX(1)).toBe(2);
    trail.push(at(3)); // 60 m from the start: a new point
    expect(trail.length).toBe(3);
    trail.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('drops its oldest points after 600', () => {
    const trail = createTrail(new THREE.Scene(), 0xffffff);
    for (let i = 0; i < 700; i++) trail.push(at(i * 3));
    expect(trail.length).toBe(600);
    expect(trail.line.geometry.attributes.position.getX(599)).toBe(699 * 3);
  });
});

describe('drone views', () => {
  it('draw a trail only when trails and the truth overlay are both on', () => {
    const sim = createSimulation(), scene = new THREE.Scene();
    sim.commands.deploy('1', '1');
    sim.spawnDrone('fpv', 0);
    const labels = { make: () => ({ style: {}, remove() {} }), place: () => {} };
    const views = createDroneViews(scene, sim, labels, new THREE.PerspectiveCamera());
    const trails = () => scene.children.filter((c) => c.isLine && c.material.opacity === 0.75);
    views.sync(0);
    expect(trails()).toHaveLength(1);
    expect(trails()[0].visible).toBe(false);
    view.trails = true;
    views.sync(0);
    expect(trails()[0].visible).toBe(true);
    view.truth = false;
    views.sync(0);
    expect(trails()[0].visible).toBe(false); // the track's trail shows instead: no truth leaks out
  }, 60000); // making the ground takes a few seconds
});
