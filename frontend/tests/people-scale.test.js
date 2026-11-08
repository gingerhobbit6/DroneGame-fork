// @vitest-environment jsdom
// People are drawn at true human scale on generated ground and on real maps. Generated ground draws trees and houses
// larger than life (TERRAIN.visualScale), and people must not pick that up.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame } from '../src/game.js';
import { BUILD, TERRAIN, WORLD } from '../src/sim/config/index.js';
import { parsePack, worldId } from '../src/sim/world-pack.js';
import { terrainState } from '../src/sim/terrain.js';
import { createPeopleViews } from '../src/render/people-view.js';
import { view } from '../src/render/view.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';
import { CENTRE, fixtureParts } from './support/fixture-pack.js';

let sim;
const labels = { make: () => document.createElement('div'), place() {} };

beforeEach(() => {
  sim = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() }).sim;
  sim.state.started = true;
  view.replayCasualties = null;
});
afterEach(() => { sim.commands.reset('clear'); sim.commands.deploy('1', '1'); });

// Height and width in metres of every civilian drawn (top and skin), or every soldier (helmet to boots, arms to arms).
function measure(role = 'civilian') {
  const scene = new THREE.Scene();
  createPeopleViews(scene, sim, labels).sync();
  const [, top, skin, soldier] = scene.children;
  const [bodies, heads] = role === 'military' ? [soldier, soldier] : [top, skin];
  heads.geometry.computeBoundingBox(); bodies.geometry.computeBoundingBox();
  const tall = heads.geometry.boundingBox.max.y, wide = bodies.geometry.boundingBox.max.x - bodies.geometry.boundingBox.min.x;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  return Array.from({ length: bodies.count }, (_, i) => {
    bodies.getMatrixAt(i, m); m.decompose(p, q, s);
    return { height: tall * s.y * WORLD.metresPerUnit, width: wide * s.x * WORLD.metresPerUnit };
  });
}

const human = (people) => {
  expect(people.length).toBeGreaterThan(0);
  for (const { height, width } of people) {
    expect(height).toBeGreaterThan(1.55); expect(height).toBeLessThan(1.95);
    expect(width).toBeGreaterThan(0.45); expect(width).toBeLessThan(0.65);
  }
};

describe('people at true scale', () => {
  it('on generated ground, where other models are drawn larger', () => {
    expect(terrainState.data.geo).toBeFalsy();
    expect(TERRAIN.visualScale).toBeGreaterThan(1);
    expect(sim.commands.placePeople(20, 20, 30, 'open')).toBeNull();
    human(measure());
  });

  it('soldiers too, in their helmets and armour', () => {
    expect(sim.commands.placePeople(20, 20, 30, 'open', 'military')).toBeNull();
    human(measure('military'));
    expect(measure()).toEqual([]);
  });

  it('on a real map', () => {
    const parts = fixtureParts();
    const pack = parsePack({ ...parts.header, gridsSha256: 'a'.repeat(64) }, parts.grids, parts.features);
    sim.registerPack(pack);
    expect(sim.commands.deploy('1', worldId(pack.hash, CENTRE.east, CENTRE.north))).toBeNull();
    sim.state.started = true;
    const b = terrainState.data.buildings.find((o) => Math.hypot(o.x, o.z) < BUILD.maxDist - 50);
    expect(sim.commands.placePeople(b.x / WORLD.metresPerUnit, b.z / WORLD.metresPerUnit, 5, 'building')).toBeNull();
    human(measure());
  });
});
