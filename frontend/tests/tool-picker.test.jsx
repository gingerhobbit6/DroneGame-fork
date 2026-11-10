// @vitest-environment jsdom
// Choosing a real system in the toolbar's list, and placing it with chosen settings.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame } from '../src/game.js';
import { STRUCTURES, TOOLBAR, firstClass, resetAllFigures } from '../src/sim/config/index.js';
import { UNIT_FIELDS } from '../src/sim/unit-config.js';
import { view } from '../src/render/view.js';
import { GameContext } from '../src/ui/hooks.js';
import { Toolbar } from '../src/ui/Toolbar.jsx';
import { ToolPicker } from '../src/ui/ToolPicker.jsx';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

let game, sim;
const $ = (sel) => document.querySelector(sel);
const show = () => render(<GameContext.Provider value={game}><Toolbar /><ToolPicker /></GameContext.Provider>);
const field = (key) => UNIT_FIELDS.find((f) => f.key === key);
const commit = (el, value) => { el.value = value; fireEvent.change(el); };

beforeEach(() => {
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  sim = game.sim;
  sim.state.started = true;
  view.wizard = 'closed';
});
afterEach(() => { cleanup(); resetAllFigures(); view.wizard = 'closed'; });

describe('the catalogue of real systems', () => {
  it('names every system, with a source for its figures', () => {
    for (const def of Object.values(STRUCTURES)) {
      expect(def.product).toBeTruthy();
      expect(def.ref.confidence).toBeTruthy();
    }
  });

  it('keeps the standard medium system as the first offered', () => {
    expect(firstClass(TOOLBAR[0])).toBe('radar');
    expect(firstClass(TOOLBAR[1])).toBe('rf');
    expect(firstClass(TOOLBAR.find((g) => g.kind === 'interceptor'))).toBe('interceptor');
  });

  it('makes each further system its own choice, with its own figures', () => {
    expect(STRUCTURES.radar_a800.range).toBe(3000);
    expect(STRUCTURES.radar_a800.emits[0].f).toEqual([[15.7, 17.2]]);
    expect(STRUCTURES.interceptor_p1.shotCost).toBe(1000);
    expect(STRUCTURES.rf_elysion.sapient.noise.az).toBe(30);
  });
});

describe('the list', () => {
  it('stays closed until a kind is picked', () => {
    show();
    expect($('#tool-picker')).toBeNull();
    act(() => game.setTool('sell'));
    expect($('#tool-picker')).toBeNull();
  });

  it('opens on a toolbar row with nothing picked, and says what to do', () => {
    show();
    fireEvent.click($('.tool-row .tool'));
    expect(game.getTool()).toBeNull();
    expect(game.catalogue()).toBe('radar');
    const text = $('#tool-picker').textContent;
    for (const name of ['Echodyne EchoGuard', 'Robin Radar IRIS', 'Blighter A800', 'Hensoldt Spexer']) expect(text).toContain(name);
    expect(document.querySelectorAll('[data-pick]').length).toBe(7);
    expect(document.querySelectorAll('[aria-pressed="true"]').length).toBe(0);
    expect(text).toContain('3.1 km small drone');
    expect($('#pick-hint').textContent).toMatch(/Drag a system onto the map/);
    expect(text).not.toMatch(/\b[SML] · /); // no small, medium and large labels
    fireEvent.click($('[data-pick="radar_a800"]'));
    expect(game.getTool()).toBe('radar_a800');
    expect($('#pick-hint').textContent).toMatch(/Blighter A800 is picked: click the map/);
    fireEvent.click($('.tool-row .tool'));
    expect(game.getTool()).toBeNull();
    expect($('#tool-picker')).toBeNull();
  });

  it('opens another kind\'s list in place of the first', () => {
    show();
    act(() => game.setTool('radar'));
    fireEvent.click(document.querySelectorAll('.tool-row .tool')[1]);
    expect(game.getTool()).toBeNull();
    expect($('#tool-picker').getAttribute('aria-label')).toBe('Choose a RF detector');
  });

  it('picks with the keyboard too', () => {
    show();
    act(() => game.openCatalogue('rf'));
    fireEvent.keyDown($('[data-pick="rf_s"]'), { key: 'Enter' });
    expect(game.getTool()).toBe('rf_s');
  });

  it('switches system without switching placing off', () => {
    show();
    act(() => game.setTool('radar'));
    fireEvent.click($('[data-pick="radar_a800"]'));
    expect(game.getTool()).toBe('radar_a800');
    fireEvent.click($('[data-pick="radar_a800"]'));
    expect(game.getTool()).toBe('radar_a800');
    expect($('.tool-row .k').textContent).toContain('Blighter A800');
  });

  it('has no small, medium and large buttons on the rows', () => {
    show();
    expect(document.querySelector('.tool-sizes')).toBeNull();
    expect($('.tool-row .k').textContent).toBe('[1] 7 real systems');
    act(() => game.setTool('radar_a800'));
    expect($('.tool-row .k').textContent).toBe('[1] Blighter A800');
  });

  it('marks what you cannot afford', () => {
    show();
    act(() => { game.setTool('radar'); sim.state.budget = 100000; game.bump(); });
    expect($('[data-pick="radar_s"]').className).not.toContain('poor');
    expect($('[data-pick="radar"]').className).toContain('poor');
  });

  it('closes with its button, and stops placing', () => {
    show();
    act(() => game.setTool('radar'));
    fireEvent.click($('#picker-close'));
    expect($('#tool-picker')).toBeNull();
    expect(game.getTool()).toBeNull();
    act(() => game.setTool('rf'));
    expect($('#tool-picker')).not.toBeNull();
  });

  it('shows beside the wizard, sharing the column', () => {
    view.wizard = 'open';
    show();
    act(() => game.setTool('radar'));
    expect($('#tool-picker').className).toContain('with-wizard');
  });

  it('waits for the game to start', () => {
    sim.state.started = false;
    show();
    act(() => game.openCatalogue('radar'));
    expect($('#tool-picker')).toBeNull();
  });

  it('offers a system\'s own settings, and shows what they do', () => {
    show();
    act(() => game.setTool('radar'));
    expect($('#place-mount')).not.toBeNull();
    commit($('#place-watts'), '6'); // half the IRIS's rated 12 W
    expect($('#tool-picker').textContent).toContain('2.6 km');
    commit($('#place-mount'), '500');
    expect($('#place-mount').value).toBe('35');
    expect($('#tool-picker').textContent).toContain('£776k');
    fireEvent.click($('[aria-label="Reset Mast height"]'));
    expect(game.loadoutFor('radar').mount).toBeUndefined();
  });

  it('keeps settings separately for each system', () => {
    show();
    act(() => game.setTool('radar'));
    commit($('#place-watts'), '6');
    fireEvent.click($('[data-pick="radar_a800"]'));
    expect($('#place-watts').value).toBe('4'); // the A800's own rated output
    fireEvent.click($('[data-pick="radar"]'));
    expect($('#place-watts').value).toBe('6');
  });

  it('only accepts settings that belong to the system', () => {
    act(() => game.setLoadout('radar', field('view'), 3));
    expect(game.loadoutFor('radar')).toEqual({});
  });
});

describe('placing with chosen settings', () => {
  it('places the unit with them, and charges its real price', () => {
    const before = sim.state.budget;
    expect(game.commands.place('radar', 30, 0, { mount: 35, watts: 6 })).toBeNull();
    const [s] = sim.structures;
    expect(s.def.mount).toBe(35);
    expect(s.def.settings.watts).toBe(6);
    expect(sim.state.budget).toBe(before - 1035000);
    expect(sim.ledger.capex).toBe(1035000);
  });

  it('refuses when the chosen settings cost more than is left', () => {
    sim.state.budget = 1000000;
    expect(game.commands.place('radar', 30, 0, { mount: 35 })).toContain('Not enough budget');
    expect(sim.structures.length).toBe(0);
    expect(game.commands.place('radar', 30, 0)).toBeNull();
  });

  it('holds untrusted settings to the limits', () => {
    game.commands.place('radar', 30, 0, { mount: 1e9, constructor: 1, view: 1 });
    expect(sim.structures[0].def.settings).toEqual({ mount: 35 });
  });

  it('the real systems survive the rebuild at wave 1 with their settings', () => {
    game.commands.place('radar_a800', 30, 0, { watts: 2 });
    game.commands.place('interceptor_p1', -30, 0);
    sim.state.warnedWire = true;
    game.commands.startWave();
    const a800 = sim.structures.find((s) => s.def.id === 'radar_a800');
    expect(a800.def.settings.watts).toBe(2);
    expect(a800.short).toBe('A80-01');
    expect(sim.structures.find((s) => s.def.id === 'interceptor_p1').def.shotCost).toBe(1000);
  });
});

describe('what a spot really gets', () => {
  it('tells you at the cursor, and when you place', () => {
    show();
    act(() => game.setTool('radar'));
    expect($('#picker-here')).toBeNull();
    const cursor = game.cursor;
    game.cursor = () => ({ x: 30, z: 0 });
    act(() => game.bump());
    expect($('#picker-here').textContent).toContain('At the cursor:');
    game.cursor = cursor;
  });

  it('leaves out weapons that fly over the ground', () => {
    show();
    act(() => game.setTool('missile'));
    game.cursor = () => ({ x: 30, z: 0 });
    act(() => game.bump());
    expect($('#picker-here')).toBeNull();
  });
});
