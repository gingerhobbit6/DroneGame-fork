// Moving the camera from the keyboard, which way the view faces, and framing the laydown.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCameraKeys, fitDistance, framing, headingOf, isCameraKey } from '../src/render/camera-moves.js';
import { terrainState } from '../src/sim/terrain.js';

let saved;
beforeEach(() => { saved = terrainState.data; terrainState.data = { groundAt: () => 0 }; }); // flat ground
afterEach(() => { terrainState.data = saved; });

// A camera standing `back` units from the origin, on the given compass bearing from it, looking at it from `up` units high.
function rig(bearingDeg = 180, back = 100, up = 100) {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.02, 8000);
  const b = THREE.MathUtils.degToRad(bearingDeg);
  camera.position.set(Math.sin(b) * back, up, -Math.cos(b) * back);
  const controls = { target: new THREE.Vector3(), minDistance: 0.25, maxDistance: 3000, enableRotate: true };
  camera.lookAt(controls.target); camera.updateMatrixWorld();
  return { camera, controls, keys: createCameraKeys(camera, controls) };
}
const step = ({ camera, controls, keys }, real) => { keys.step(real); camera.lookAt(controls.target); camera.updateMatrixWorld(); };

describe('which way the view faces', () => {
  it('reads north, east, south and west from where the camera stands', () => {
    expect(headingOf(rig(180).camera)).toBeCloseTo(0); // south of the point, looking north
    expect(headingOf(rig(270).camera)).toBeCloseTo(90);
    expect(headingOf(rig(0).camera)).toBeCloseTo(180);
    expect(headingOf(rig(90).camera)).toBeCloseTo(270);
  });

  it('still knows looking straight down, from the screen\'s up', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 8000);
    camera.position.set(0, 500, 0.01); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    expect(headingOf(camera)).toBeCloseTo(0);
  });
});

describe('the camera keys', () => {
  it('know their keys by position, and nothing else', () => {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']) expect(isCameraKey(code)).toBe(true);
    for (const code of ['KeyR', 'KeyN', 'Space', 'ArrowLeft', undefined, 'constructor']) expect(isCameraKey(code)).toBe(false);
  });

  it('W slides the view ahead over the ground, by a share of the distance, and keeps the angle', () => {
    const r = rig(180), before = r.camera.position.clone().sub(r.controls.target), dist = before.length();
    r.keys.press('KeyW', true);
    step(r, 0.5);
    expect(r.controls.target.x).toBeCloseTo(0);
    expect(r.controls.target.z).toBeCloseTo(-0.8 * dist * 0.5); // north is -z
    expect(r.camera.position.clone().sub(r.controls.target).distanceTo(before)).toBeCloseTo(0);
  });

  it('A and D slide sideways, relative to the way the view faces', () => {
    const r = rig(270); // looking east, so right is south
    r.keys.press('KeyD', true);
    step(r, 0.25);
    expect(r.controls.target.z).toBeGreaterThan(0);
    expect(Math.abs(r.controls.target.x)).toBeLessThan(1e-6);
  });

  it('Q turns the view left and E right, about what it looks at', () => {
    const r = rig(180);
    r.keys.press('KeyQ', true);
    step(r, 0.5); // an eighth of a turn
    expect(headingOf(r.camera)).toBeCloseTo(315);
    expect(r.controls.target.length()).toBeCloseTo(0);
    r.keys.press('KeyQ', false); r.keys.press('KeyE', true);
    step(r, 1);
    expect(headingOf(r.camera)).toBeCloseTo(45);
  });

  it('does not turn in plan view, as the mouse cannot', () => {
    const r = rig(180);
    r.controls.enableRotate = false;
    r.keys.press('KeyE', true);
    step(r, 1);
    expect(headingOf(r.camera)).toBeCloseTo(0);
  });

  it('+ and - zoom in and out, within the camera\'s limits', () => {
    const r = rig(180), dist = () => r.camera.position.distanceTo(r.controls.target), start = dist();
    r.keys.press('Equal', true);
    step(r, 0.5);
    expect(dist()).toBeCloseTo(start * Math.exp(-0.8));
    r.keys.press('Equal', false); r.keys.press('Minus', true);
    for (let i = 0; i < 100; i++) step(r, 0.05);
    expect(dist()).toBeCloseTo(3000);
  });

  it('stops when let go, or when the window loses focus', () => {
    const r = rig(180);
    expect(r.keys.step(0.1)).toBe(false);
    r.keys.press('KeyW', true); r.keys.press('KeyD', true);
    expect(r.keys.step(0.1)).toBe(true);
    r.keys.press('KeyW', false);
    expect(r.keys.step(0.1)).toBe(true);
    r.keys.release();
    expect(r.keys.step(0.1)).toBe(false);
    r.keys.press('KeyR', true); // not a camera key
    expect(r.keys.step(0.1)).toBe(false);
  });
});

describe('framing the laydown', () => {
  it('finds the circle that holds every point and its own radius', () => {
    expect(framing([])).toBeNull();
    expect(framing([{ x: 5, z: -3, r: 0 }])).toEqual({ x: 5, z: -3, radius: 0 });
    const f = framing([{ x: -10, z: 0, r: 0 }, { x: 10, z: 0, r: 0 }, { x: 0, z: 0, r: 15 }]);
    expect(f.x).toBeCloseTo(0); expect(f.z).toBeCloseTo(0); expect(f.radius).toBeCloseTo(15);
  });

  it('stands far enough out for the narrower side of the screen to hold it', () => {
    const wide = new THREE.PerspectiveCamera(60, 2), tall = new THREE.PerspectiveCamera(60, 0.5);
    expect(fitDistance(10, wide)).toBeCloseTo(12.5 / Math.sin(Math.PI / 6)); // the height is narrower
    expect(fitDistance(10, tall)).toBeGreaterThan(fitDistance(10, wide)); // the width is narrower
  });
});
