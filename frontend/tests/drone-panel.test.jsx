// @vitest-environment jsdom
// Clicking a drone, the Drone panel and Follow, and name tags giving way where they would overlap.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGame } from '../src/game.js';
import { DRONES, WORLD } from '../src/sim/config/index.js';
import { spawnDrone, removeDrone } from '../src/sim/drones.js';
import { pickDrone } from '../src/render/placement.js';
import { createLabels } from '../src/render/labels.js';
import { view } from '../src/render/view.js';
import { GameContext } from '../src/ui/hooks.js';
import { DronePanel, linksOf, statusOf } from '../src/ui/DronePanel.jsx';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

let game;
const $ = (sel) => document.querySelector(sel);
const show = () => render(<GameContext.Provider value={game}><DronePanel /></GameContext.Provider>);

const radius = WORLD.radius;
beforeAll(() => { WORLD.radius = 3000; }); // panel interactions need a real simulation, but no particular world extent
afterAll(() => { WORLD.radius = radius; });

beforeEach(() => {
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  game.getReplay = () => null;
  Object.assign(view, { truth: true, drone: null, follow: false });
});
afterEach(() => { cleanup(); Object.assign(view, { truth: true, drone: null, follow: false }); });

describe('picking a drone on the screen', () => {
  const W = 1000, H = 800;
  const cam = new THREE.PerspectiveCamera(55, W / H, 0.5, 4000);
  cam.position.set(0, 100, 200); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const at = (x, y, z) => ({ pos: new THREE.Vector3(x, y, z) });
  const screen = (d) => { const p = d.pos.clone().project(cam); return [((p.x + 1) / 2) * W, ((1 - p.y) / 2) * H]; };

  it('takes the nearest drone within its symbol, and nothing further off or behind the camera', () => {
    const a = at(-5, 20, 0), b = at(5, 20, 0), behind = at(0, 20, 400);
    const [x, y] = screen(b);
    expect(pickDrone([a, b, behind], cam, x, y, W, H)).toBe(b);
    expect(pickDrone([a, b], cam, x + 15, y, W, H)).toBe(b);
    expect(pickDrone([a, b], cam, x + 200, y, W, H)).toBe(null);
    expect(pickDrone([behind], cam, W / 2, H / 2, W, H)).toBe(null);
  });
});

describe('the Drone panel', () => {
  const fly = (type) => { game.sim.state.started = true; return spawnDrone(game.sim, type, 0); };

  it('shows what the drone is and what it is doing, and closes', () => {
    const d = fly('fpv');
    act(() => game.selectDrone(d));
    show();
    const text = $('#drone-panel').textContent;
    expect(text).toContain(DRONES.fpv.name);
    expect(text).toContain('Warhead2 kg');
    expect(text).toContain('No: no sensor has it');
    expect(text).toContain('Control 2.4 GHz, Video 5.8 GHz');
    fireEvent.click($('[aria-label="Close the drone panel"]'));
    expect(view.drone).toBe(null);
  });

  it('follows the drone until it is gone, then says what became of it', () => {
    const d = fly('fw');
    act(() => game.selectDrone(d));
    show();
    fireEvent.click($('#drone-panel .up-eye'));
    expect(view.follow).toBe(true);
    d.log.end = 'killed'; d.log.by = 'missile';
    act(() => { removeDrone(game.sim, d); game.bump(); });
    expect($('#drone-panel').textContent).toContain('Destroyed by missile');
    expect($('#drone-panel .up-eye')).toBe(null); // nothing left to follow
  });

  it('describes a fibre-optic link, a spotter with no warhead, and a lost link', () => {
    expect(linksOf(DRONES.fo)).toMatch(/fibre-optic/);
    expect(linksOf(DRONES.spotter)).toBe('Control 868/915 MHz, Video 5.8 GHz, GNSS L1/L2');
    expect(statusOf({ dead: false, mode: 'home', videoJammed: false })).toBe('Link lost: turning for home');
    expect(statusOf({ dead: true, log: { end: 'leaked' } })).toBe('Hit its target');
  });

  it('closes the panel and stops following when the truth overlay is turned off', () => {
    act(() => game.selectDrone(fly('fpv')));
    show();
    fireEvent.click($('#drone-panel .up-eye'));
    expect(view.follow).toBe(true);
    act(() => game.setViewOption('truth', false));
    expect($('#drone-panel')).toBe(null);
    expect(view.drone).toBe(null);
    expect(view.follow).toBe(false);
    act(() => game.setViewOption('truth', true));
    expect($('#drone-panel')).toBe(null); // the old selection must not return
  });

  it('reports an impact on a deployed system', () => {
    const d = fly('fw');
    const s = game.sim.addStructure('rf', 0, 0);
    d.aim = { x: s.pos.x, z: s.pos.z, structure: s };
    d.pos.copy(s.pos);
    act(() => game.selectDrone(d));
    show();
    act(() => { game.sim.step(); game.bump(); });
    expect($('#drone-panel').textContent).toContain('Hit a deployed system');
    expect($('#drone-panel .up-eye')).toBe(null);
  });

  it('is cleared by a new run, and selecting nothing stops following', () => {
    const d = fly('fpv');
    game.selectDrone(d); view.follow = true;
    game.selectDrone(null);
    expect(view.follow).toBe(false);
    game.selectDrone(fly('fpv'));
    game.commands.reset('clear');
    expect(view.drone).toBe(null);
  });
});

describe('name tags that would overlap', () => {
  const tag = (cls, rect) => {
    const el = document.createElement('div');
    el.className = cls;
    el.getBoundingClientRect = () => ({ left: rect[0], top: rect[1], right: rect[0] + 60, bottom: rect[1] + 14 });
    return el;
  };
  it('keeps the selected tag, then drones, then systems, and hides any tag covering one kept', () => {
    const cam = new THREE.PerspectiveCamera(); cam.updateMatrixWorld();
    const labels = createLabels(document.createElement('div'), cam);
    const system = tag('slabel', [0, 0]), drone = tag('dlabel', [30, 5]), chosen = tag('slabel selected', [65, 10]), apart = tag('slabel', [300, 300]);
    for (const el of [system, drone, chosen, apart]) labels.place(el, 0, 0, -5, true);
    labels.declutter();
    expect(chosen.style.display).toBe('block');
    expect(drone.style.display).toBe('none'); // it covers the selected tag
    expect(system.style.display).toBe('block'); // the drone that covered it has gone
    expect(apart.style.display).toBe('block');
  });
});
