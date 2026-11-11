// @vitest-environment jsdom
// Small, medium and large systems: the catalogue, the toolbar and its hotkeys, and each unit's own definition.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zoomMax } from '../src/sim/camera-model.js';
import { createGame } from '../src/game.js';
import { STRUCTURES, TOOLBAR, firstClass, resetAllFigures } from '../src/sim/config/index.js';
import { GameContext } from '../src/ui/hooks.js';
import { Toolbar } from '../src/ui/Toolbar.jsx';
import { useHotkeys } from '../src/ui/useHotkeys.js';
import { play, setUp } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

let game;
const $ = (sel) => document.querySelector(sel);
const group = (kind) => TOOLBAR.find((g) => g.kind === kind);
const sizeButtons = ({ classes }) => classes.filter((id) => STRUCTURES[id].size && !STRUCTURES[id].variantOf); // a row's standard S, M and L, not its other real systems

beforeEach(() => {
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  game.getReplay = () => null;
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('the catalogue', () => {
  it('puts every system in exactly one toolbar row, of its own kind', () => {
    const listed = TOOLBAR.flatMap((g) => g.classes);
    expect([...listed].sort()).toEqual(Object.keys(STRUCTURES).sort());
    for (const g of TOOLBAR) for (const id of g.classes) expect(STRUCTURES[id].kind).toBe(g.kind);
  });

  it('offers the medium size first, and orders sizes small to large', () => {
    for (const g of TOOLBAR.filter((row) => sizeButtons(row).length)) {
      expect(sizeButtons(g).map((id) => STRUCTURES[id].size)).toEqual(['S', 'M', 'L']);
      expect(STRUCTURES[firstClass(g)].size).toBe('M');
      const [s, m, l] = sizeButtons(g).map((id) => STRUCTURES[id]);
      const reach = (d) => d.range * zoomMax(d); // a zoom camera searches wide and reaches furthest on a cue
      expect(reach(s)).toBeLessThan(reach(l));
      // Real ranges do not always rise with size: the Sting is reported to fly further than the larger Merops.
      if (g.kind !== 'interceptor') expect(reach(s)).toBeLessThan(reach(m));
      if (g.kind !== 'interceptor') expect(reach(m)).toBeLessThan(reach(l));
      // Real prices do not always rise with size: a large acoustic station is reported cheaper than a medium array, and a small laser dearer than the DragonFire figure.
      if (['radar', 'rf', 'camera', 'jammer'].includes(g.kind)) {
        expect(s.cost).toBeLessThan(m.cost);
        expect(m.cost).toBeLessThan(l.cost);
      }
    }
  });

  // Every system plays a real wave, so a new one cannot break the simulation unnoticed.
  it.each(Object.keys(STRUCTURES))('%s plays through a wave', (id) => {
    setUp(game.sim, { seed: '1', laydown: [[id, 600, 0], ['radar', -600, 0]] });
    play(game.sim, 1);
    expect(game.sim.state.wave).toBe(1);
    expect(game.sim.state.waveActive).toBe(false);
  }, 60000);

  it.each(['jammer_s', 'jammer', 'jammer_l'])('%s jams, and its kills count as jamming', (id) => {
    setUp(game.sim, { seed: '1', laydown: [[id, 300, 300], [id, -300, 300], [id, 300, -300], [id, -300, -300], ['radar', -500, 0]] });
    play(game.sim, 1);
    expect(game.sim.ledger.killedBy.jammer.fpv).toBeGreaterThan(0);
  }, 60000);
});

describe('the toolbar', () => {
  const show = () => render(<GameContext.Provider value={game}><Toolbar /></GameContext.Provider>);

  it('has one row per kind and no size buttons: each row opens its list of real systems', () => {
    show();
    expect(document.querySelectorAll('.tool-row').length).toBe(TOOLBAR.length);
    expect(document.querySelectorAll('.tool-sizes button').length).toBe(0);
    fireEvent.click($('[data-catalogue="radar"]'));
    expect(game.getTool()).toBeNull();
    expect(game.catalogue()).toBe('radar');
    expect($('.tool.active').textContent).toContain('from £');
    act(() => game.setTool('radar_l'));
    expect($('.tool.active').textContent).toContain('£1.88M');
  });

  it('the row\'s button closes its open list, and switches placing off', () => {
    show();
    act(() => game.setTool('rf_s'));
    fireEvent.click($('[data-catalogue="rf"]'));
    expect(game.getTool()).toBeNull();
    expect(game.catalogue()).toBeNull();
  });

  it('remembers a system the wizard picks, for the hotkey, and marks each row for its spotlight', () => {
    show();
    act(() => game.setTool('jammer_l'));
    expect(game.toolChoice(group('jammer'))).toBe('jammer_l');
    expect($('[data-catalogue="interceptor"]')).not.toBeNull();
  });
});

describe('the hotkeys', () => {
  const Keys = () => { useHotkeys(); return null; };
  const press = (key) => fireEvent.keyDown(window, { key });
  const show = () => render(<GameContext.Provider value={game}><Keys /></GameContext.Provider>);

  it('leave keys with Ctrl, Cmd or Alt held to the browser', () => {
    show();
    for (const held of ['ctrlKey', 'metaKey', 'altKey']) fireEvent.keyDown(window, { key: '1', [held]: true });
    expect(game.getTool()).toBeFalsy();
    press('1');
    expect(game.getTool()).toBe('radar');
  });

  it('pause on Space after a click left a button focused, and do not press that button again', () => {
    show();
    for (const tag of ['button', 'summary']) {
      const el = document.body.appendChild(document.createElement(tag));
      fireEvent.pointerDown(el.appendChild(document.createElement('span'))); // a click on the button's icon or text
      act(() => game.setSpeed(1));
      expect(fireEvent.keyDown(el, { key: ' ' })).toBe(false); // false: the key's own action, pressing the button, was stopped
      expect(game.clock.speed).toBe(0);
      expect(fireEvent.keyUp(el, { key: ' ' })).toBe(false);
      fireEvent.keyDown(el, { key: 'Tab' }); // from here the focus is the keyboard's, and Space is the button's again
      expect(fireEvent.keyDown(el, { key: ' ' })).toBe(true);
      expect(game.clock.speed).toBe(0);
      el.remove();
    }
  });

  it('leave Space to a button reached with the keyboard, and typing to a text area', () => {
    show();
    const speed = game.clock.speed;
    for (const tag of ['button', 'summary']) {
      const el = document.body.appendChild(document.createElement(tag));
      expect(fireEvent.keyDown(el, { key: ' ' })).toBe(true); // no click put the focus here
      el.remove();
    }
    expect(game.clock.speed).toBe(speed);
    const area = document.body.appendChild(document.createElement('textarea'));
    fireEvent.keyDown(area, { key: '1' });
    area.remove();
    expect(game.getTool()).toBeFalsy();
    press(' ');
    expect(game.clock.speed).not.toBe(speed); // Space anywhere else still pauses or resumes
  });

  it('picks medium, then cycles through the sizes', () => {
    show();
    press('1');
    expect(game.getTool()).toBe('radar');
    press('1');
    expect(game.getTool()).toBe('radar_giraffe');
    press('1');
    expect(game.getTool()).toBe('radar_l');
    press('1');
    expect(game.getTool()).toBe('radar_xenta');
    press('1');
    expect(game.getTool()).toBe('radar_s');
    press('1');
    expect(game.getTool()).toBe('radar_a400');
    press('1');
    expect(game.getTool()).toBe('radar_a800');
    press('1');
    expect(game.getTool()).toBe('radar');
  });

  it('goes back to the size last used, and another kind\'s key moves to that kind', () => {
    show();
    press('2');
    press('2');
    press('4');
    expect(game.getTool()).toBe('jammer');
    press('2');
    expect(game.getTool()).toBe('rf_elysion');
  });

  it('reaches the new sizes and the acoustic row from their keys', () => {
    show();
    press('7');
    expect(game.getTool()).toBe('laser');
    press('7');
    expect(game.getTool()).toBe('laser_l');
    press('8');
    expect(game.getTool()).toBe('acoustic');
    press('9');
    expect(game.getTool()).toBe('people');
    press('0');
    expect(group('gun').classes).toContain(game.getTool());
  });

  it('switches a system with one size off on the second press', () => {
    show();
    const single = { kind: 'solo', classes: ['laser'] };
    act(() => game.cycleTool(single));
    expect(game.getTool()).toBe('laser');
    act(() => game.cycleTool(single));
    expect(game.getTool()).toBeNull();
  });
});

describe('each unit\'s own definition', () => {
  const two = () => {
    setUp(game.sim, { seed: '1', laydown: [['radar', 600, 0], ['radar', -600, 0]] });
    return game.sim.structures;
  };

  it('an edit to one unit moves neither another unit nor the catalogue', () => {
    const [a, b] = two();
    game.commands.configureUnit(a, 'mount', 35);
    game.commands.configureUnit(a, 'scan', 0.5);
    game.commands.configureUnit(a, 'band', 'k'); // a narrower beam: its own angle error
    expect(a.def.sapient.noise.az).toBeLessThan(0.6);
    expect(a.def.cost).toBeGreaterThan(900000);
    expect(a.def.sapient.interval).toBe(0.5);
    for (const other of [b.def, STRUCTURES.radar]) {
      expect(other.cost).toBe(900000);
      expect(other.mount).toBe(25);
      expect(other.sapient.interval).toBe(1);
      expect(other.sapient.noise.az).toBe(0.6);
    }
  });

  it('a figure edit reaches units already placed', () => {
    const [a] = two();
    game.commands.setFigure('structures', 'radar', 'published', 3000);
    expect(a.def.range).toBe(3000);
    game.commands.setRangeScale(2);
    expect(a.def.range).toBe(6000);
    game.commands.setRangeScale(1);
  });

  it('refunds and counts use the unit\'s own price', () => {
    const [a] = two();
    game.commands.wireNode(a, null);
    game.commands.configureUnit(a, 'mount', 35);
    const unwired = game.sim.state.budget;
    game.commands.sell(a.pos.x, a.pos.z);
    expect(game.sim.state.budget).toBe(unwired + 900000 + 135000);
  });
});
