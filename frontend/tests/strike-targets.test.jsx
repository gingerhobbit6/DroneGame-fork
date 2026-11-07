// @vitest-environment jsdom
// What strike drones aim at in a drawn area (its systems, people and buildings, not any spot), and the ground view from a mast.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { DRONES, WORLD, resetAllFigures } from '../src/sim/config/index.js';
import { terrainState } from '../src/sim/terrain.js';
import { inZone } from '../src/sim/attack-area.js';
import { AIM_SHARE, chooseAim } from '../src/sim/targeting.js';
import { antennaHeight } from '../src/sim/site-range.js';
import { u } from '../src/sim/units.js';
import { createEyeView } from '../src/render/eye-view.js';
import { view } from '../src/render/view.js';
import { GameContext } from '../src/ui/hooks.js';
import { UnitPanel } from '../src/ui/UnitPanel.jsx';
import { EyeBar } from '../src/ui/EyeBar.jsx';
import { useHotkeys } from '../src/ui/useHotkeys.js';
import { setUp } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

const AREA = [[100, -60], [200, -60], [200, 40], [100, 40]]; // scene units: 2 to 4 km east of the station, on terrain 1
const STRIKER = Object.values(DRONES).find((d) => d.role !== 'spotter' && !d.seeksEmitters).id;
const $ = (sel) => document.querySelector(sel);
let game, sim;
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  sim = game.sim;
  setUp(sim, { seed: '1', laydown: [] });
  view.eye = null; view.selected = null;
});
afterEach(() => { cleanup(); resetAllFigures(); view.eye = null; view.selected = null; });

describe('what a strike aims at in the drawn area', () => {
  it('picks a kind by its share, then one of that kind, among what the area holds', () => {
    // an area round a building of the generated ground, with a radar and a group of people in it too
    const { N, cell, R, bldg } = terrainState.data, m = WORLD.metresPerUnit;
    const k = bldg.findIndex((h, i) => h && Math.hypot(-R + (i % N) * cell, -R + Math.floor(i / N) * cell) > 1500);
    const bx = (-R + (k % N) * cell) / m, bz = (-R + Math.floor(k / N) * cell) / m;
    const area = [[bx - 40, bz - 40], [bx + 40, bz - 40], [bx + 40, bz + 40], [bx - 40, bz + 40]];
    sim.commands.setZone(area);
    const radar = sim.addStructure('radar', bx + 25, bz + 25);
    sim.addStructure('jammer', bx + 60, bz); // outside the area
    const spot = [[bx - 25, bz - 25], [bx - 25, bz + 25], [bx + 25, bz - 25]].find(([x, z]) => sim.commands.placePeople(x, z, 10, 'open') === null);
    expect(spot).toBeDefined();
    const w = { state: sim.state, structures: sim.structures, people: sim.people };
    expect(chooseAim(w, seq(0.01, 0))).toMatchObject({ kind: 'system', structure: radar });
    expect(chooseAim(w, seq(AIM_SHARE.system + 0.01, 0))).toMatchObject({ kind: 'people', x: spot[0], z: spot[1] });
    const building = chooseAim(w, seq(0.99, 0.5));
    expect(building.kind).toBe('building');
    expect(inZone(area, building.x, building.z)).toBe(true);
  });

  it('aims at a random spot only when the area holds nothing to strike', () => {
    sim.commands.setZone([[300, 300], [310, 300], [310, 310], [300, 310]]); // a small empty square far out
    const aim = chooseAim({ state: sim.state, structures: [], people: [] }, seq(0.5));
    expect(aim.kind).toBeUndefined();
    expect(aim.structure).toBeNull();
  });

  it('strikes the system it aimed at, or the ground where it stood once it is gone', () => {
    sim.commands.setZone(AREA);
    const radar = sim.addStructure('radar', 150, 0);
    const d = sim.spawnDrone(STRIKER, 0);
    d.aim = { x: radar.pos.x, z: radar.pos.z, structure: radar, kind: 'system' };
    for (let i = 0; i < 40000 && sim.drones.includes(d); i++) sim.step();
    expect(radar.health).toBeLessThan(radar.def.health);
    expect(sim.state.hits).toBe(1);
    const second = sim.spawnDrone(STRIKER, 0);
    second.aim = { x: 120, z: -20, structure: sim.addStructure('rf', 120, -20), kind: 'system' };
    sim.commands.reset('clear'); // the system is cleared away before it arrives
    sim.state.started = true; sim.commands.setZone(AREA);
    expect(sim.drones.includes(second)).toBe(false); // a reset clears the sky too
  });
});

describe('the ground view from a mast', () => {
  const controls = () => ({ enabled: true, target: new Vector3() });

  it('puts the camera at the top of the mast, looking out, and gives the map view back', () => {
    const radar = sim.addStructure('radar', 30, 0), camera = new PerspectiveCamera(), c = controls();
    camera.position.set(0, 300, 380);
    const eye = createEyeView(camera, c, sim, document.createElement('canvas'));
    expect(eye.update()).toBe(false);
    view.eye = radar;
    expect(eye.update()).toBe(true);
    expect(c.enabled).toBe(false);
    expect(camera.position.y).toBeCloseTo(radar.pos.y + u(antennaHeight(radar.def) + 2), 5);
    view.eye = null;
    expect(eye.update()).toBe(false);
    expect(c.enabled).toBe(true);
    expect(camera.position.toArray()).toEqual([0, 300, 380]);
  });

  it('turns to the drone it is engaging', () => {
    const gun = sim.addStructure('gun_hmg', 30, 0), camera = new PerspectiveCamera(), eye = createEyeView(camera, controls(), sim, document.createElement('canvas'));
    const d = sim.spawnDrone(STRIKER, 0);
    d.pos.set(30, gun.pos.y + 5, -40); // to the north of it
    gun.task = { drone: d };
    view.eye = gun;
    eye.update();
    for (let i = 0; i < 60; i++) eye.update();
    const ahead = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(ahead.z).toBeLessThan(-0.9);
  });

  it('stays on its system when wave 1 rebuilds the laydown', () => {
    const radar = sim.addStructure('radar', 30, 0);
    game.lookFrom(radar);
    sim.state.warnedWire = true;
    game.commands.startWave();
    expect(view.eye).not.toBe(radar); // a new object for the same system
    expect(view.eye).toMatchObject({ def: { id: 'radar' }, pos: { x: radar.pos.x, z: radar.pos.z } });
    expect(sim.structures).toContain(view.eye);
  });

  it('leaves on its own when the system is gone', () => {
    const radar = sim.addStructure('radar', 30, 0), eye = createEyeView(new PerspectiveCamera(), controls(), sim, document.createElement('canvas'));
    view.eye = radar;
    eye.update();
    sim.commands.sell(radar.pos.x, radar.pos.z);
    expect(eye.update()).toBe(false);
    expect(view.eye).toBeNull();
  });

  it('opens from the Unit panel, says what it shows, and closes with Esc', () => {
    function Keys() { useHotkeys(); return null; }
    const radar = sim.addStructure('radar', 30, 0);
    game.select(radar);
    render(<GameContext.Provider value={game}><UnitPanel /><EyeBar /><Keys /></GameContext.Provider>);
    fireEvent.click($('#unit-eye'));
    expect(view.eye).toBe(radar);
    expect($('#eye-bar').textContent).toContain(`Ground view from ${radar.short}`);
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(view.eye).toBeNull();
    expect($('#eye-bar')).toBeNull();
    expect(view.selected).toBe(radar); // Esc leaves the ground view first, before closing the panel
    vi.restoreAllMocks();
  });
});
