// @vitest-environment jsdom
// Selecting a system and the Unit panel, driven by a real simulation with no 3D view.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createGame } from '../src/game.js';
import { DRONES, STRUCTURES, resetAllFigures } from '../src/sim/config/index.js';
import { reachFor } from '../src/sim/network/sensors.js';
import { pickStructure, selectionFrom } from '../src/render/placement.js';
import { labelLift } from '../src/render/structure-view.js';
import { view } from '../src/render/view.js';
import { GameContext } from '../src/ui/hooks.js';
import { useHotkeys } from '../src/ui/useHotkeys.js';
import { UnitPanel } from '../src/ui/UnitPanel.jsx';
import { NodesTab } from '../src/ui/dock/NodesTab.jsx';
import { MIXED, setUp } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

let game;
const $ = (sel) => document.querySelector(sel);
const panel = () => $('#unit-panel');
const refresh = () => act(() => game.bump());
const lay = (laydown = MIXED) => { setUp(game.sim, { seed: '1', laydown }); };
const unit = (id) => game.sim.structures.find((s) => s.def.id === id);
const show = (ui = <UnitPanel />) => render(<GameContext.Provider value={game}>{ui}</GameContext.Provider>);
const pick = (s) => act(() => game.select(s));
const openRange = () => fireEvent.click($('#unit-range'));

beforeEach(() => {
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  view.selected = null;
  game.getReplay = () => null;
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('picking a system on the screen', () => {
  const W = 1000, H = 800;
  const camera = () => {
    const c = new THREE.PerspectiveCamera(55, W / H, 0.5, 4000);
    c.position.set(0, 100, 200); c.lookAt(0, 0, 0); c.updateMatrixWorld(); c.updateProjectionMatrix();
    return c;
  };
  const at = (x, z) => ({ pos: new THREE.Vector3(x, 0, z), def: STRUCTURES.camera });
  const screen = (s, cam, lift = 0) => {
    const p = s.pos.clone().setY(lift).project(cam);
    return [((p.x + 1) / 2) * W, ((1 - p.y) / 2) * H];
  };

  it('finds a system at its base, and all the way up to its name tag', () => {
    const cam = camera(), s = at(0, 0);
    expect(pickStructure([s], cam, ...screen(s, cam), W, H)).toBe(s);
    expect(pickStructure([s], cam, ...screen(s, cam, 4), W, H)).toBe(s);
    expect(pickStructure([s], cam, ...screen(s, cam, labelLift(s.def)), W, H)).toBe(s);
  });

  it('takes a tighter tolerance while placing', () => {
    const cam = camera(), s = at(0, 0);
    const [x, y] = screen(s, cam);
    expect(pickStructure([s], cam, x + 12, y, W, H)).toBe(s);
    expect(pickStructure([s], cam, x + 12, y, W, H, 8)).toBe(null);
  });

  it('finds nothing away from any system', () => {
    const cam = camera(), s = at(0, 0);
    const [x, y] = screen(s, cam);
    expect(pickStructure([s], cam, x + 40, y, W, H)).toBe(null);
    expect(pickStructure([], cam, x, y, W, H)).toBe(null);
  });

  it('takes the nearer of two systems', () => {
    const cam = camera(), a = at(-5, 0), b = at(5, 0);
    expect(pickStructure([a, b], cam, ...screen(b, cam), W, H)).toBe(b);
    expect(pickStructure([a, b], cam, ...screen(a, cam), W, H)).toBe(a);
  });

  it('ignores a system behind the camera', () => {
    const cam = camera(), s = at(0, 400);
    expect(pickStructure([s], cam, W / 2, H / 2, W, H)).toBe(null);
  });
});

describe('what a click selects', () => {
  const tag = { short: 'RDR-01' }, model = { short: 'INT-01' };
  it('with no tool: a name tag, then a nearby system, then nothing', () => {
    expect(selectionFrom(null, tag, () => model)).toBe(tag);
    expect(selectionFrom(null, null, () => model)).toBe(model);
    expect(selectionFrom(null, null, () => null)).toBe(null);
  });
  it('with a placement tool: a system selects, and anywhere else places', () => {
    expect(selectionFrom('radar', tag, () => model)).toBe(tag);
    expect(selectionFrom('radar', null, () => model)).toBe(model);
    expect(selectionFrom('radar', null, () => null)).toBe(undefined);
  });
  it('with the Sell or zone tool: the click always belongs to the tool', () => {
    expect(selectionFrom('sell', tag, () => model)).toBe(undefined);
    expect(selectionFrom('zone', tag, () => model)).toBe(undefined);
  });
});

describe('what stays selected', () => {
  it('finds the same system again when wave 1 rebuilds them all', () => {
    lay();
    const first = game.sim.structures.find((s) => s.def.id === 'interceptor');
    const { x, z } = first.pos;
    game.select(first);
    game.sim.state.warnedWire = true;
    game.commands.startWave();
    const now = game.getSelected();
    expect(now).not.toBe(first);
    expect(game.sim.structures).toContain(now);
    expect(now.def.id).toBe('interceptor');
    expect([now.pos.x, now.pos.z]).toEqual([x, z]);
  });

  it('clears when the system is sold', () => {
    lay([['radar', 600, 0]]);
    const s = unit('radar');
    game.select(s);
    game.commands.sell(s.pos.x, s.pos.z);
    expect(game.getSelected()).toBe(null);
  });

  it('selling at a system\'s own position sells that system, even with a neighbour at the minimum spacing', () => {
    lay([['radar', 600, 0], ['rf', 660, 0], ['interceptor', 540, 0]]);
    const target = unit('rf');
    game.commands.sell(target.pos.x, target.pos.z);
    expect(game.sim.structures.map((s) => s.def.id).sort()).toEqual(['interceptor', 'radar']);
  });

  it('clears when the system is destroyed', () => {
    lay([['radar', 600, 0]]);
    game.select(unit('radar'));
    game.sim.structures.length = 0;
    expect(game.getSelected()).toBe(null);
  });

  it('clears on a new laydown', () => {
    lay([['radar', 600, 0]]);
    game.select(unit('radar'));
    game.commands.reset('clear');
    expect(game.getSelected()).toBe(null);
  });

  it('is not an input to the run: nothing is logged and the digest does not move', () => {
    lay();
    const logged = game.sim.log.length, digest = game.sim.digest();
    game.select(unit('radar'));
    game.getSelected();
    game.select(null);
    expect(game.sim.log.length).toBe(logged);
    expect(game.sim.digest()).toBe(digest);
  });
});

describe('the panel', () => {
  it('shows nothing until a system is selected, and closes with its button', () => {
    lay();
    show();
    expect(panel()).toBe(null);
    pick(unit('radar'));
    expect(panel().textContent).toContain('RDR-01 · Medium radar');
    fireEvent.click($('#unit-close'));
    expect(panel()).toBe(null);
    expect(view.selected).toBe(null);
  });

  // Every system in the catalogue, so a new one cannot break the panel unnoticed.
  it.each(Object.keys(STRUCTURES))('describes %s', (id) => {
    lay([[id, 600, 0]]);
    show();
    pick(unit(id));
    const text = panel().textContent, def = STRUCTURES[id];
    expect(text).toContain(def.desc);
    expect(text).toContain(`${def.health} / ${def.health}`);
    expect(text).toContain(def.ref.analogues[0]);
    expect(text).toContain('600 m from the site, bearing 090°');
    if (def.role === 'sensor') {
      expect(text).toContain(`${(reachFor(def, DRONES.fpv) / 1000).toFixed(1)} km`);
      expect(text).toContain('No rounds');
    } else {
      expect(text).toContain(`${(def.range / 1000).toFixed(1)} km in an open field`);
      expect(text).toMatch(/Magazine|Stored beam/);
    }
  });

  it('gives a radar its range against each drone, from the figures the simulation uses', () => {
    lay([['radar', 600, 0]]);
    show();
    pick(unit('radar'));
    const text = panel().textContent;
    expect(text).toContain('Fixed-wing strike drone6.6 km');
    expect(text).toContain('First-person-view strike drone3.1 km');
    expect(text).toContain('About 86% chance');
    expect(text).toContain('Below 40 m');
    expect(text).toContain('Range ±8 m, bearing ±0.6°, elevation ±1.2°, velocity');
  });

  it('follows a figure edit', () => {
    lay([['radar', 600, 0]]);
    show();
    pick(unit('radar'));
    act(() => { game.commands.setFigure('structures', 'radar', 'published', 3000); });
    expect(panel().textContent).toContain('First-person-view strike drone3.0 km');
  });

  it('says an RF detector cannot hear silent drones, and gives a bearing only', () => {
    lay([['rf', 600, 0]]);
    show();
    pick(unit('rf'));
    const text = panel().textContent;
    expect(text).toContain('Fibre-optic strike dronecannot hear');
    expect(text).toContain('Fixed-wing strike dronecannot hear');
    expect(text).toContain('Fixed-wing spotter drone5.5 km');
    expect(text).toContain('Bearing ±3°');
    expect(text).not.toContain('range ±');
  });

  it('says what a cued camera does', () => {
    lay([['camera', 600, 0]]);
    show();
    pick(unit('camera'));
    const text = panel().textContent;
    expect(text).toContain('Searching');
    expect(text).toContain('once cued');
    expect(text).toContain('10° search view, 2.5° on a cue');
    expect(text).toContain('airframe type');
  });

  it('states what a launcher can pay for, and when it cannot fire', () => {
    lay([['interceptor', 600, 0]]);
    show();
    pick(unit('interceptor'));
    const shots = Math.floor(game.sim.state.budget / 5000).toLocaleString('en-US');
    expect(panel().textContent).toContain(`Budget covers ${shots} shots`);
    expect(panel().textContent).toContain('12 / 12 rounds');
    expect(panel().textContent).toContain('Ready');
    expect(panel().textContent).toContain('Fired0 rounds');
    expect(panel().textContent).toContain('In storage24 rounds');
    expect(panel().textContent).toContain('30 s to fill the magazine, 3 s between shots');
    expect(panel().textContent).toContain('Per round£3,750');
    expect(panel().textContent).toContain('EngagesAny drone');
    act(() => { unit('interceptor').cd = 1.2; game.bump(); });
    expect(panel().textContent).toContain('Next shot in 1.2 s');
    act(() => { game.sim.state.budget = 0; game.bump(); });
    expect(panel().textContent).toContain('OUT OF BUDGET');
  });

  it('shows a launcher reloading, running low and out of rounds', () => {
    lay([['missile', 600, 0]]);
    show();
    const s = unit('missile');
    pick(s);
    act(() => { s.rounds = 1; game.bump(); });
    expect(panel().textContent).toContain('1 / 4 rounds LOW');
    act(() => { s.rounds = 0; s.reload = 12.2; game.bump(); });
    expect(panel().textContent).toContain('0 / 4 rounds Reloading');
    expect(panel().textContent).toContain('Reloading, 13 s left');
    act(() => { s.reload = 0; s.storage = 0; game.bump(); });
    expect(panel().textContent).toContain('0 / 4 rounds EMPTY');
    expect(panel().textContent).toContain('Out of rounds');
  });

  it('gives a sensor the same rows, with figures of its own', () => {
    lay([['radar', 600, 0]]);
    show();
    const s = unit('radar');
    pick(s);
    act(() => { s.scanId = 1200; s.detections = 1; game.bump(); });
    const text = panel().textContent;
    expect(text).toContain('No rounds: a sensor fires nothing');
    expect(text).toContain('1,200 made, 1 detection');
    expect(text).toContain(`Scan period${s.def.sapient.interval} s`);
    expect(text).toContain('Per useNo cost');
    expect(text).toContain('Price£675k');
  });

  it('says rounds are free in the sandbox', () => {
    lay([['missile', 600, 0]]);
    show();
    pick(unit('missile'));
    expect(panel().textContent).toContain('Kept for fixed-wing tracks');
    act(() => { game.sim.state.sandbox = true; game.bump(); });
    expect(panel().textContent).toContain('Free in the sandbox');
  });

  it('prices the laser by the second', () => {
    lay([['laser', 600, 0]]);
    show();
    pick(unit('laser'));
    expect(panel().textContent).toContain('Per second£10');
    expect(panel().textContent).toContain('300 / 300 s');
    expect(panel().textContent).toContain('None: it recharges');
    expect(panel().textContent).toContain('300 s from empty, only while not firing');
    expect(panel().textContent).toContain('Any drone');
    expect(panel().textContent).toContain('clear line of sight');
  });

  it('lists a jammer\'s bands and what each one does, and follows a change', () => {
    lay([['jammer', 600, 0]]);
    show();
    pick(unit('jammer'));
    const before = panel().textContent;
    expect(before).toContain('No rounds: unlimited while powered');
    expect(before).toContain('0 s so far');
    expect(before).toContain('ReloadNone needed');
    expect(before).toContain('Control 2.4 GHz, Video 5.8 GHz');
    expect(before).toContain('First-person-view strike dronecontrol, video');
    expect(before).toContain('Fixed-wing spotter dronevideo, resists 75%');
    expect(before).toContain('Fibre-optic strike dronenot affected');
    expect(before).toContain('Fixed-wing strike dronenot affected');
    act(() => { game.commands.toggleJamBand(unit('jammer'), 'gnss', true); });
    expect(panel().textContent).toContain('Fixed-wing strike dronenavigation, resists 50%');
    act(() => { for (const b of [...unit('jammer').jamBands]) game.commands.toggleJamBand(unit('jammer'), b, false); });
    expect(panel().textContent).toContain('No bands set');
  });

  it('shows the jammer switching on', () => {
    lay([['jammer', 600, 0]]);
    show();
    pick(unit('jammer'));
    expect(panel().textContent).toContain('Standing by');
    act(() => { unit('jammer').mode = 'Jam'; game.bump(); });
    expect(panel().textContent).toContain('Jamming');
  });

  it('warns about a system with no terminal, and reports a wired one', () => {
    game.sim.state.started = true;
    game.sim.addStructure('radar', 30, 0);
    show();
    pick(unit('radar'));
    expect(panel().textContent).toContain('No terminal: this system is offline');
    act(() => { game.commands.wireNode(unit('radar'), 'starlink'); });
    expect(panel().textContent).not.toContain('No terminal');
    expect(panel().textContent).toContain('Starlink');
    act(() => { game.commands.wireNode(unit('radar'), 'cellular'); });
    expect(panel().textContent).toContain('Band 8');
  });

  it('warns when contact is lost or a link is down', () => {
    lay([['radar', 600, 0]]);
    show();
    pick(unit('radar'));
    act(() => { unit('radar').offline = true; game.bump(); });
    expect(panel().textContent).toContain('lost contact');
    const { comms } = game.sim.net;
    const nodeLink = vi.spyOn(comms, 'nodeLink').mockReturnValue({ up: false, reason: 'jammed' });
    const pathFor = vi.spyOn(comms, 'pathFor').mockReturnValue({ ok: false, reason: 'no route' });
    refresh();
    expect(panel().textContent).toContain('DOWN');
    expect(panel().textContent).toContain('no route');
    nodeLink.mockRestore(); pathFor.mockRestore();
  });

  it('names the target of an engaging effector, and how far away it is', () => {
    lay([['interceptor', 600, 0]]);
    show();
    pick(unit('interceptor'));
    const tr = { short: 'T7', est: { east: 600, north: 2000, up: 0 } };
    game.sim.net.tracks.set('t', tr);
    act(() => { unit('interceptor').task = { trackId: 't', drone: { dead: false } }; game.bump(); });
    expect(panel().textContent).toContain('Engaging T7');
    expect(panel().textContent).toMatch(/target at 2\.0 km/);
  });

  it('counts shots and kills for the type, and says so', () => {
    lay([['interceptor', 600, 0]]);
    show();
    pick(unit('interceptor'));
    expect(panel().textContent).toContain('All INT0 shots · 0 kills');
    act(() => {
      game.sim.ledger.shots.interceptor = { n: 4, cost: 20000 };
      game.sim.ledger.killedBy.interceptor = { fpv: 2 };
      game.bump();
    });
    expect(panel().textContent).toContain('All INT4 shots · 2 kills · £7,500 a kill');
  });

  it('shows the moment being reviewed, not the live system', () => {
    lay([['interceptor', 600, 0]]);
    show();
    const s = unit('interceptor');
    pick(s);
    s.health = 12;
    s.cd = 2;
    game.sim.rec.frames.push({ t: 75, budget: 5000, structs: [{ id: s.nodeId, mode: 'Ready', trackShort: 'T3', target: 9, health: 24, rounds: 7, storage: 24, reload: 0, fired: 5 }] });
    game.getReplay = () => ({ active: () => true, frameIndex: () => 0 });
    refresh();
    const text = panel().textContent;
    expect(text).toContain('Reviewing 1:15');
    expect(text).toContain('Engaging T3');
    expect(text).toContain('24 / 30');
    expect(text).toContain('Budget covers 1 shot');
    expect(text).toContain('7 / 12 rounds');
    expect(text).toContain('5 rounds');
    expect(text).not.toContain('Next shot');
    expect(text).not.toContain('All INT');
    const rows = [...document.querySelectorAll('.up-row > span:first-child')].map((e) => e.textContent);
    expect(rows).toContain('Status');
    expect(rows).not.toContain('Network');
  });

  it('records health in the snapshots it reads', () => {
    lay([['radar', 600, 0]]);
    game.sim.run(10);
    const frame = game.sim.rec.frames.at(-1);
    expect(frame.structs[0].health).toBe(30);
  });

  it('shows names as text, so a name cannot add markup', () => {
    lay([['radar', 600, 0]]);
    show();
    unit('radar').short = '<img src=x>';
    pick(unit('radar'));
    expect(panel().querySelector('img')).toBe(null);
    expect(panel().textContent).toContain('<img src=x>');
  });
});

describe('selecting without the map', () => {
  it('selects from the Nodes tab, which offers only systems you placed', () => {
    lay();
    show(<><NodesTab active /><UnitPanel /></>);
    const buttons = [...document.querySelectorAll('.node-pick')];
    expect(buttons.length).toBe(game.sim.structures.length);
    expect($('#node-table').textContent).toContain('FUSION');
    fireEvent.click(buttons.find((b) => b.textContent === 'RDR-01'));
    expect(panel().textContent).toContain('RDR-01');
    expect(buttons.find((b) => b.textContent === 'RDR-01').getAttribute('aria-pressed')).toBe('true');
  });

  it('Escape clears the tool first, then the selection', () => {
    const Keys = () => { useHotkeys(); return null; };
    lay();
    show(<><Keys /><UnitPanel /></>);
    pick(unit('radar'));
    act(() => game.setTool('sell'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(game.getTool()).toBe(null);
    expect(panel()).not.toBe(null);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(panel()).toBe(null);
  });
});

describe('the Range side', () => {
  it('gives every system its open-field and predicted range, or says the spot does not matter', () => {
    for (const id of Object.keys(STRUCTURES)) {
      lay([[id, 600, 0]]);
      show();
      pick(unit(id));
      openRange();
      const def = STRUCTURES[id];
      if (def.fire === 'guided') expect($('#sr-guided').textContent).toContain(`${(def.range / 1000).toFixed(1)} km`);
      else {
        expect(panel().textContent).toContain('in an open field. Here:');
        expect($('#sr-polar')).not.toBeNull();
        expect($('#sr-profile')).not.toBeNull();
      }
      cleanup();
    }
  });

  it('lets you pick the threat and the bearing, and explains that path', () => {
    lay([['radar', 600, 0]]);
    show();
    pick(unit('radar'));
    openRange();
    expect(panel().textContent).toContain('the worst');
    fireEvent.change($('#sr-bearing'), { target: { value: '45' } });
    expect(panel().textContent).toContain('Bearing 045°');
    expect(panel().textContent).not.toContain('the worst');
    expect(panel().textContent).toContain('Free-space loss');
    fireEvent.change($('#sr-threat'), { target: { value: 'fw' } });
    expect(panel().textContent).toContain('6.6 km in an open field');
  });

  it('offers an RF detector only the drones it can hear', () => {
    lay([['rf', 600, 0]]);
    show();
    pick(unit('rf'));
    openRange();
    const offered = [...$('#sr-threat').options].map((o) => o.value);
    expect(offered).toContain('fpv');
    expect(offered).not.toContain('fw');
    expect(offered).not.toContain('fo');
  });

  it('follows the mast height', () => {
    lay([['radar', 600, 0]]);
    show();
    pick(unit('radar'));
    openRange();
    expect(panel().textContent).toContain('25 m, 60 m');
    act(() => { game.commands.configureUnit(unit('radar'), 'mount', 35); });
    expect(panel().textContent).toContain('35 m, 60 m');
  });

  it('shows open field and here side by side on the Details side', () => {
    lay([['radar', 600, 0]]);
    show();
    pick(unit('radar'));
    expect(panel().textContent).toContain('Open field');
    expect(panel().textContent).toContain('Here');
  });
});
