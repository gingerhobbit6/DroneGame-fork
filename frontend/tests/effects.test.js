// Combat effects: missile smoke, gun tracer, explosions and scorch marks come from fixed pools, and clear() empties them.

import * as THREE from 'three';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POOLS, createEffects } from '../src/render/effects.js';
import { view } from '../src/render/view.js';
import { terrainState } from '../src/sim/terrain.js';
import { u } from '../src/sim/units.js';

let scene, fx, sim, saved;
const heard = {};
const boom = (y, color = 0xffcc66, r = u(80)) => heard.explosion({ pos: new THREE.Vector3(3, y, 3), r, color });
const drawn = (name) => scene.getObjectByName(name).geometry.getAttribute('size').array.filter((s) => s > 0).length;
const marks = () => scene.getObjectByName('scorch').children.filter((m) => m.visible).length;
const cones = () => scene.children.filter((o) => o.isMesh && o.name !== 'tracers').length; // a wide line is a mesh too
const round = (kind, vel) => ({ def: { kind }, pos: new THREE.Vector3(0, 1, 0), vel, target: null, life: 10 });
function fly(m, frames) { for (let i = 0; i < frames; i++) { m.pos.addScaledVector(m.vel, 1 / 60); fx.update(1 / 60); } }

beforeAll(() => { saved = { data: terrainState.data, zoom: view.zoom }; terrainState.data = { groundAt: () => 0 }; });
afterAll(() => { terrainState.data = saved.data; view.zoom = saved.zoom; });
beforeEach(() => {
  view.zoom = 10; // close in, where things are drawn true size
  scene = new THREE.Scene();
  sim = { missiles: [], structures: [], on: (name, fn) => { heard[name] = fn; } };
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1e5);
  camera.position.set(0, 10, 10);
  fx = createEffects(scene, sim, camera);
});

describe('combat effects', () => {
  it('a missile leaves a smoke trail and is drawn as a cone; an interceptor drone leaves no smoke', () => {
    const m = round('missile', new THREE.Vector3(0, 10, 10));
    sim.missiles.push(m);
    fx.update(1 / 60);
    const atLaunch = drawn('smoke');
    expect(atLaunch).toBeGreaterThan(0); // the launch puff
    expect(drawn('glow')).toBe(1); // and its flash
    fly(m, 30);
    expect(drawn('smoke')).toBeGreaterThan(atLaunch + 10);
    expect(scene.getObjectByName('heads').geometry.drawRange.count).toBe(1); // a glow to follow it by
    expect(cones()).toBe(1);
    sim.missiles.length = 0;
    fx.clear();
    sim.missiles.push(round('interceptor', new THREE.Vector3(0, 3, 3)));
    fly(sim.missiles[0], 60);
    expect(drawn('smoke')).toBe(0);
    expect(cones()).toBe(1);
  });

  it('draws a gun round as a streak along its flight, with a flash at the muzzle and no cone', () => {
    const m = round('gun', new THREE.Vector3(50, 0, 0));
    sim.missiles.push(m);
    fx.update(1 / 60);
    expect(drawn('glow')).toBe(1);
    fly(m, 3);
    const line = scene.getObjectByName('tracers'), p = line.geometry.attributes.instanceStart.data.array;
    expect(line.geometry.instanceCount).toBe(1);
    expect(p[0]).toBeCloseTo(m.pos.x);
    expect(p[3]).toBeLessThan(p[0]); // the tail is behind the head, along its flight
    expect(p[4]).toBeCloseTo(p[1]);
    expect(cones()).toBe(0);
    sim.missiles.length = 0;
    fx.update(1 / 60);
    expect(line.geometry.instanceCount).toBe(0);
  });

  it('an explosion on the ground leaves a scorch mark, one in the air does not', () => {
    boom(50);
    fx.update(1 / 60);
    expect(marks()).toBe(0);
    expect(drawn('smoke')).toBeGreaterThan(0);
    expect(drawn('glow')).toBeGreaterThan(0);
    boom(u(3));
    fx.update(1 / 60);
    expect(marks()).toBe(1);
    boom(u(30), 0xff5252); // a strike lands on the ground or a system, from whatever height it went off
    fx.update(1 / 60);
    expect(marks()).toBe(2);
  });

  it('tints the fireball by the explosion colour, so a miss reads differently from a hit', () => {
    boom(50, 0x90a4ae);
    const tint = scene.getObjectByName('glow').geometry.getAttribute('tint').array, miss = new THREE.Color(0x90a4ae);
    expect([tint[4], tint[5], tint[6]]).toEqual([miss.r, miss.g, miss.b].map((v) => Math.fround(v))); // the first fire after the core
  });

  it('keeps to fixed pools under a heavy barrage', () => {
    const objects = scene.children.length;
    for (let i = 0; i < 2000; i++) boom(i % 2 ? 50 : 0);
    for (let i = 0; i < 300; i++) sim.missiles.push(round(i % 2 ? 'gun' : 'missile', new THREE.Vector3(i, 20, 5)));
    fx.update(1 / 60);
    for (const m of sim.missiles) m.pos.addScaledVector(m.vel, 1);
    fx.update(1 / 60);
    expect(scene.getObjectByName('smoke').geometry.getAttribute('size').count).toBe(POOLS.smoke);
    expect(drawn('smoke')).toBeLessThanOrEqual(POOLS.smoke);
    expect(drawn('glow')).toBeLessThanOrEqual(POOLS.glow);
    expect(scene.getObjectByName('tracers').geometry.instanceCount).toBe(150);
    expect(marks()).toBe(POOLS.marks);
    expect(scene.children.length).toBe(objects + 150); // the missiles' cones and nothing else
  });

  it('clear() takes every effect away, and hide() hides them', () => {
    sim.missiles.push(round('missile', new THREE.Vector3(0, 10, 10)), round('gun', new THREE.Vector3(50, 0, 0)));
    fly(sim.missiles[0], 10);
    boom(0);
    boom(50);
    fx.update(1 / 60);
    fx.hide();
    expect(scene.children.filter((o) => o.visible)).toHaveLength(0);
    fx.clear();
    expect(drawn('smoke')).toBe(0);
    expect(drawn('glow')).toBe(0);
    expect(scene.getObjectByName('tracers').geometry.instanceCount).toBe(0);
    expect(marks()).toBe(0);
    expect(cones()).toBe(0);
  });
});
