// @vitest-environment jsdom
// Zoomed out, systems and drones are drawn as NATO map symbols instead of models far larger than life; tracks always are.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createGame } from '../src/game.js';
import { DRONES, STRUCTURES } from '../src/sim/config/index.js';
import { u } from '../src/sim/units.js';
import { createStructureViews } from '../src/render/structure-view.js';
import { createDroneViews } from '../src/render/drone-view.js';
import { createBeliefViews } from '../src/render/belief-view.js';
import { createLabels } from '../src/render/labels.js';
import { OPENING_ZOOM, view } from '../src/render/view.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';
import { setUp } from './support/scenarios.js';

const sprite = (group) => group.children.find((o) => o.isSprite);
let game, camera, labels;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  camera = new THREE.PerspectiveCamera();
  labels = createLabels(document.createElement('div'), camera);
});
afterEach(() => { view.zoom = OPENING_ZOOM; view.eye = null; });

describe('map symbols', () => {
  it('a system shows its friend symbol zoomed out and its model zoomed in, never a symbol from a mast', () => {
    setUp(game.sim, { seed: '1', laydown: [['radar', 600, 0], ['missile', -400, 300]] });
    const scene = new THREE.Scene();
    const views = createStructureViews(scene, game.sim, labels);
    const model = (h) => h.children.find((o) => o.isGroup);
    view.zoom = u(3000); views.sync(0);
    const [radar, missile] = scene.children;
    expect(sprite(radar).visible).toBe(true);
    expect(model(radar).visible).toBe(false);
    expect(sprite(radar).userData.symbol).toBe('friend:radar');
    expect(sprite(missile).userData.symbol).toBe('friend:missile');
    view.zoom = u(300); views.sync(0);
    expect(sprite(radar).visible).toBe(false);
    expect(model(radar).visible).toBe(true);
    view.zoom = u(3000); view.eye = game.sim.structures[1]; views.sync(0);
    expect(sprite(radar).visible).toBe(false);
    expect(model(radar).visible).toBe(true);
    expect(model(missile).visible).toBe(false); // the camera is on its mast
  });

  it("a laser's beam is red and starts at its symbol zoomed out, at its muzzle zoomed in; an RF weapon's is its own colour", () => {
    setUp(game.sim, { seed: '1', laydown: [['laser', 300, 0], ['laser_rfdew', -300, 0]] });
    const scene = new THREE.Scene(), views = createStructureViews(scene, game.sim, labels);
    const [laser, rf] = game.sim.structures, target = { pos: new THREE.Vector3(40, 10, 0) };
    laser.beamTarget = rf.beamTarget = target;
    const beams = () => scene.children.filter((o) => o.name === 'beam');
    const from = (o) => o.geometry.attributes.instanceStart.data.array;
    view.zoom = u(3000); views.sync(0);
    const [red, wide] = beams();
    expect(red.geometry.instanceCount).toBe(1);
    expect(from(red)[1]).toBeCloseTo(laser.pos.y + 0.5); // where its symbol is drawn
    expect(from(red)[3]).toBeCloseTo(target.pos.x); // and on to the target
    const glow = new THREE.Color().fromArray(red.geometry.attributes.instanceColorStart.data.array);
    expect(glow.r).toBeGreaterThan(0.9); expect(glow.g).toBeLessThan(0.3); // red
    expect(new THREE.Color().fromArray(wide.geometry.attributes.instanceColorStart.data.array).getHex()).toBe(rf.def.color);
    expect(scene.children.filter((o) => o.name === 'beam core')).toHaveLength(1); // only the laser has a white-hot core
    view.zoom = u(300); views.sync(0);
    expect(from(red)[1]).toBeGreaterThan(laser.pos.y + 0.5); // from its drawn muzzle, higher up
    laser.beamTarget = null; views.sync(0);
    expect(red.geometry.instanceCount).toBe(0);
  });

  it('a true drone shows a hostile air symbol zoomed out, grey if unseen, and its model zoomed in', () => {
    const d = { type: 'fpv', def: DRONES.fpv, detected: true, hp: 20, uid: 1, heading: 0, bank: 0, pos: new THREE.Vector3(0, 5, 0), launch: new THREE.Vector3() };
    const scene = new THREE.Scene();
    const views = createDroneViews(scene, { drones: [d] }, labels, camera);
    view.zoom = u(3000); views.sync(0);
    const [group] = scene.children;
    expect(sprite(group).visible).toBe(true);
    expect(sprite(group).userData.symbol).toBe('hostile:rotary');
    expect(group.children[0].visible).toBe(false);
    d.detected = false; views.sync(0);
    expect(sprite(group).userData.symbol).toBe('unseen:rotary');
    view.zoom = u(50); d.detected = true; views.sync(0);
    expect(sprite(group).visible).toBe(false);
    expect(group.children[0].visible).toBe(true);
  });

  it('a track takes the hostile frame once classified, sharing one texture per symbol', () => {
    const tr = (id) => ({ id, short: `T${id}`, status: 'confirmed', airframe: 'Unknown', estErr: 20, est: { east: 100 * id, north: 0, up: 50 } });
    const net = { tracks: new Map([[1, tr(1)], [2, tr(2)]]), bearingCandidates: () => [] };
    const scene = new THREE.Scene();
    const beliefs = createBeliefViews(scene, net, createLabels(document.createElement('div'), camera));
    beliefs.update();
    const [a, b] = scene.children.filter((o) => sprite(o)).map(sprite);
    expect(a.userData.symbol).toBe('unknown:uav');
    expect(a.material.map).toBe(b.material.map);
    net.tracks.get(1).airframe = 'Multirotor';
    net.tracks.get(2).airframe = 'Fixed wing';
    beliefs.update();
    expect(a.userData.symbol).toBe('hostile:rotary');
    expect(b.userData.symbol).toBe('hostile:uav');
    net.tracks.get(2).status = 'tentative';
    beliefs.update();
    expect(b.userData.symbol).toBe('pending:uav');
  });

  it('draws every symbol with a frame and an icon', async () => {
    vi.resetModules();
    const calls = [];
    HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...args) => calls.push([k, ...args])) });
    const { symbolSprite } = await import('../src/render/symbols.js');
    for (const kind of ['radar', 'rf', 'camera', 'acoustic', 'jammer', 'interceptor', 'missile', 'gun', 'laser']) symbolSprite(`friend:${kind}`, 0);
    for (const key of ['hostile:rotary', 'unseen:uav', 'unknown:uav', 'pending:uav']) symbolSprite(key, 0);
    const texts = calls.filter(([k]) => k === 'fillText').map(([, text]) => text);
    expect(texts).toEqual(['RAD', 'RF', 'EO', 'ACU', 'EW', 'GUN', 'LSR']);
    expect(calls.filter(([k]) => k === 'stroke')).toHaveLength(13);
    expect(calls.filter(([k]) => k === 'setLineDash')).toHaveLength(1); // only the pending frame is dashed
    calls.length = 0;
    for (const def of Object.values(STRUCTURES)) symbolSprite(`friend:${def.kind}`, 0); // every kind in the catalogue, not just these
    expect(calls.filter(([k, text]) => k === 'fillText' && text === '?')).toEqual([]);
  });
});
