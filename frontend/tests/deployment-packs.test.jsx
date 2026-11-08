// @vitest-environment jsdom
// Deployment packs: building one on the profile, deploying it, and dragging its kit and catalogue cards onto the map.

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { ApiError } from '../src/api/client.js';
import { DRAG_TYPE, readDrop } from '../src/drag.js';
import { PATROL_VEHICLES, STRUCTURES, resetAllFigures } from '../src/sim/config/index.js';
import { view } from '../src/render/view.js';
import { App } from '../src/ui/App.jsx';
import { AccountContext, bump, describeTotals, packTotals, remaining } from '../src/ui/account/pack.js';
import { ProfileHub } from '../src/ui/account/ProfileHub.jsx';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

const $ = (sel) => document.querySelector(sel);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const press = (name, root = screen) => fireEvent.click(root.getByRole('button', { name }));
const USER = { username: 'operator', display_name: 'Sgt Alex Smith', rank: '', organisation: '', created_at: '2026-11-07T10:00:00+00:00', last_sign_in: null };
const PACK = {
  name: '1 Troop', echelon: 'troop', callsign: 'Hawk 1',
  assets: { systems: [{ id: 'radar_a800', count: 2 }, { id: 'jammer', count: 1 }], vehicles: [{ id: 'patria', count: 2 }], people: [{ count: 8, protection: 'open' }] },
};
const drag = () => { const data = {}; return { data, dataTransfer: { setData: (t, v) => { data[t] = v; }, getData: (t) => data[t] ?? '', types: [] } }; };

let api, game;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  api = createFakeApi();
  api.auth = { updateProfile: vi.fn(async (body) => ({ ...USER, ...body })), changePassword: vi.fn(async () => null), newRecoveryCode: vi.fn(async () => ({ recovery_code: 'FRESH2-FRESH3-FRESH4-FRESH5' })) };
  game = createGame({ seed: '1', terrainSeed: '1', api, storage: createFakeStorage() });
  game.attach = vi.fn();
  view.wizard = 'closed';
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('what a pack holds', () => {
  it('counts sensors, effectors, vehicles, people and cost', () => {
    const t = packTotals(PACK.assets);
    expect(t).toEqual({ sensors: 2, effectors: 1, vehicles: 2, people: 8, cost: STRUCTURES.radar_a800.cost * 2 + STRUCTURES.jammer.cost });
    expect(describeTotals(t)).toBe('2 sensors · 1 effector · 2 vehicles · 8 people');
    expect(describeTotals(packTotals({}))).toBe('Empty');
  });

  it('keeps each line once, within the limit, and drops lines at zero', () => {
    let lines = bump([], 'radar', 1);
    lines = bump(lines, 'radar', 1);
    expect(lines).toEqual([{ id: 'radar', count: 2 }]);
    expect(bump(lines, 'radar', -2)).toEqual([]);
    expect(bump([], 'radar', -1)).toEqual([]);
    expect(bump([{ id: 'radar', count: 50 }], 'radar', 1)).toEqual([{ id: 'radar', count: 50 }]);
  });

  it('works out what is still to place from the map', () => {
    game.sim.state.started = true;
    game.sim.addStructure('radar_a800', 20, 0);
    game.sim.people.push({ id: 1, count: 8, protection: 'open', hits: [] });
    const left = remaining(PACK.assets, game.sim);
    expect(left.systems).toEqual([{ id: 'radar_a800', count: 2, left: 1 }, { id: 'jammer', count: 1, left: 1 }]);
    expect(left.people).toEqual([{ count: 8, protection: 'open', left: 0 }]);
  });
});

describe('what the map accepts from a drag', () => {
  it.each([
    ['{"system":"radar"}', { system: 'radar' }],
    ['{"people":{"count":8,"protection":"bunker"}}', { people: { count: 8, protection: 'bunker' } }],
    ['{"system":"__proto__"}', null], ['{"system":"nuke"}', null], ['{"people":{"count":0,"protection":"open"}}', null],
    ['{"people":{"count":9999,"protection":"open"}}', null], ['{"people":{"count":3,"protection":"castle"}}', null], ['not json', null], ['', null], ['null', null],
  ])('%s', (text, expected) => expect(readDrop(text)).toEqual(expected));
});

describe('the profile hub', { timeout: 30000 }, () => {
  const hub = (account = {}) => {
    const value = { user: USER, setUser: vi.fn(), activeUnit: null, deploy: vi.fn(), signOut: vi.fn(), ...account };
    const onEnter = vi.fn();
    render(<ProfileHub api={api} account={value} inGame={false} onEnter={onEnter} />);
    return { account: value, onEnter };
  };

  it('builds a pack from real systems, vehicles and people, and lists it', async () => {
    hub();
    await settle();
    expect(screen.getByText('No deployment packs yet.')).not.toBeNull();
    press('New pack');
    fireEvent.change(screen.getByLabelText(/Unit name/), { target: { value: ' 1 Troop ' } });
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'troop' } });
    fireEvent.change(screen.getByLabelText(/Callsign/), { target: { value: 'Hawk 1' } });
    press('One more Blighter A800'); press('One more Blighter A800');
    press('One more Patria 6x6');
    press('Add a group of people');
    const people = screen.getByLabelText('People in the group');
    fireEvent.change(people, { target: { value: '' } }); // clearing the box to retype it is not a 1
    expect(people.value).toBe('8');
    fireEvent.change(people, { target: { value: '12' } });
    expect($('.acct-sum').textContent).toContain('Sensors2');
    press('Save pack');
    await settle();
    const saved = [...api.units.rows.values()][0];
    expect(saved).toMatchObject({ name: '1 Troop', echelon: 'troop', callsign: 'Hawk 1', assets: { systems: [{ id: 'radar_a800', count: 2 }], vehicles: [{ id: 'patria', count: 1 }], people: [{ count: 12, protection: 'open' }] } });
    expect($('[data-pack]').textContent).toContain('2 sensors · 1 vehicle · 12 people');
  });

  it('refuses a bad callsign before saving', async () => {
    hub();
    await settle();
    press('New pack');
    fireEvent.change(screen.getByLabelText(/Unit name/), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText(/Callsign/), { target: { value: '<b>' } });
    press('Save pack');
    expect(screen.getByRole('alert').textContent).toMatch(/callsign/);
    expect(api.units.rows.size).toBe(0);
  });

  it('deploys a pack, edits it and deletes it with a second click', async () => {
    await api.units.create(PACK);
    const { account, onEnter } = hub();
    await settle();
    const card = within($('[data-pack]'));
    press('Deploy', card);
    expect(account.deploy).toHaveBeenCalledWith(expect.objectContaining({ name: '1 Troop' }));
    expect(onEnter).toHaveBeenCalled();
    press('Edit', card);
    expect(screen.getByLabelText(/Unit name/).value).toBe('1 Troop');
    press('Cancel');
    await settle();
    press('Delete', within($('[data-pack]')));
    expect(api.units.rows.size).toBe(1);
    press('Sure?', within($('[data-pack]')));
    await settle();
    expect(api.units.rows.size).toBe(0);
  });

  it('shows when the packs cannot load', async () => {
    api.units.list = vi.fn(async () => { throw new ApiError('The save server is not running.', true); });
    hub();
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/not running/);
  });

  it('edits the profile', async () => {
    const { account } = hub();
    await settle();
    press('Edit');
    fireEvent.change(screen.getByLabelText('Rank or role'), { target: { value: 'Sergeant' } });
    press('Save');
    await settle();
    expect(api.auth.updateProfile).toHaveBeenCalledWith({ display_name: 'Sgt Alex Smith', rank: 'Sergeant', organisation: '' });
    expect(account.setUser).toHaveBeenCalledWith(expect.objectContaining({ rank: 'Sergeant' }));
  });

  it('changes the password, and makes a new recovery code', async () => {
    hub();
    await settle();
    press('Change password');
    fireEvent.change(screen.getByLabelText('Current password', { selector: 'input' }), { target: { value: 'old password' } });
    fireEvent.change(screen.getByLabelText(/New password/, { selector: 'input' }), { target: { value: 'short' } });
    press('Change password');
    expect(screen.getByRole('alert').textContent).toMatch(/at least 10/);
    fireEvent.change(screen.getByLabelText(/New password/, { selector: 'input' }), { target: { value: 'a brand new passphrase' } });
    press('Change password');
    await settle();
    expect(api.auth.changePassword).toHaveBeenCalledWith({ current_password: 'old password', new_password: 'a brand new passphrase' });
    expect(screen.getByRole('status').textContent).toMatch(/Every other device was signed out/);
    press('New recovery code');
    fireEvent.change(screen.getByLabelText('Current password', { selector: 'input' }), { target: { value: 'old password' } });
    press('Show a new code');
    await settle();
    expect($('#recovery-code').textContent).toBe('FRESH2-FRESH3-FRESH4-FRESH5');
  });
});

describe('the pack tray in the game', { timeout: 30000 }, () => {
  const page = (activeUnit = { id: 1, ...PACK }) => {
    game.sim.state.started = true;
    render(<AccountContext.Provider value={{ user: USER, activeUnit }}><App game={game} /></AccountContext.Provider>);
    act(() => game.openCatalogue('unit', true));
  };

  it('lists the pack\'s kit with what is left to place, from its own toolbar row', () => {
    page();
    expect($('[data-catalogue="unit"]').textContent).toContain('Hawk 1 · 1 Troop');
    const tray = $('#tool-picker');
    expect(tray.getAttribute('aria-label')).toBe('Deployment pack: 1 Troop');
    expect(tray.textContent).toContain('2 of 2 to place');
    expect($('[data-tray-vehicle="patria"]').textContent).toContain('2 of 2 to place');
    act(() => { game.sim.addStructure('radar_a800', 20, 0); game.bump(); });
    expect($('[data-pick="radar_a800"]').textContent).toContain('1 of 2 to place');
    act(() => { game.sim.addStructure('radar_a800', -20, 0); game.bump(); });
    expect($('[data-pick="radar_a800"]').textContent).toContain('All 2 placed');
  });

  it('has no row or tray without a deployed pack', () => {
    page(null);
    expect($('[data-catalogue="unit"]')).toBeNull();
    expect($('#tool-picker')).toBeNull();
  });

  it('drags a system: its preview follows the cursor, and the tool before comes back', () => {
    page();
    const { data, dataTransfer } = drag();
    fireEvent.dragStart($('[data-pick="radar_a800"]'), { dataTransfer });
    expect(JSON.parse(data[DRAG_TYPE])).toEqual({ system: 'radar_a800' });
    expect(game.getTool()).toBe('radar_a800');
    expect($('#tool-picker').getAttribute('aria-label')).toMatch(/Deployment pack/); // the tray stays put while dragging
    fireEvent.dragEnd($('[data-pick="radar_a800"]'));
    expect(game.getTool()).toBeNull();
  });

  it('places what is dropped on the map, systems and people alike', () => {
    page();
    act(() => game.startDrag({ system: 'radar_a800' }));
    act(() => game.dropAt({ system: 'radar_a800' }, 30, 0));
    expect(game.sim.structures.map((s) => s.def.id)).toEqual(['radar_a800']);
    expect(game.getTool()).toBeNull();
    expect($('#toast').textContent).toMatch(/Click a system for details$/); // no Esc to press: the drag put the tool back
    const { data, dataTransfer } = drag();
    fireEvent.dragStart($('[data-tray-people="0"]'), { dataTransfer });
    expect(readDrop(data[DRAG_TYPE])).toEqual({ people: { count: 8, protection: 'open' } });
    act(() => game.dropAt(readDrop(data[DRAG_TYPE]), -30, 10));
    expect(game.sim.people.map((g) => g.count)).toEqual([8]);
    expect($('[data-tray-people="0"]').textContent).toContain('Placed');
  });

  it('picks a tray system to place by clicking, and keeps the tray open', () => {
    page();
    fireEvent.click($('[data-pick="jammer"]'));
    expect(game.getTool()).toBe('jammer');
    expect(game.catalogue()).toBe('unit');
    fireEvent.click($('[data-pick="jammer"]'));
    expect(game.getTool()).toBeNull();
    fireEvent.click($('[data-pick="jammer"]'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(game.getTool()).toBeNull();
    expect(game.catalogue()).toBe('unit'); // Esc puts the system down, and the tray stays
  });

  it('parks a pack system on a pack vehicle, at its mast height, and counts both', () => {
    page();
    const carry = screen.getByLabelText('What the Patria 6x6 carries');
    expect(carry.value).toBe('radar_a800'); // the first system with some left
    fireEvent.change(carry, { target: { value: 'jammer' } });
    const { data, dataTransfer } = drag();
    fireEvent.dragStart($('[data-tray-vehicle="patria"]'), { dataTransfer });
    expect(readDrop(data[DRAG_TYPE])).toEqual({ system: 'jammer', vehicle: 'patria' });
    expect([game.getTool(), game.toolVehicle()]).toEqual(['jammer', 'patria']);
    act(() => game.dropAt(readDrop(data[DRAG_TYPE]), 30, 0));
    const [s] = game.sim.structures;
    expect([s.def.id, s.def.vehicle, s.def.settings.mount]).toEqual(['jammer', 'patria', PATROL_VEHICLES.patria.mast]);
    expect([game.getTool(), game.toolVehicle()]).toEqual([null, null]); // the drag put both back
    expect($('[data-tray-vehicle="patria"]').textContent).toContain('1 of 2 to place');
    expect($('[data-pick="jammer"]').textContent).toContain('All 1 placed');
    expect(game.sim.currentLaydown().structures[0]).toMatchObject({ id: 'jammer', vehicle: 'patria' }); // and it is saved with it
  });

  it('picks a vehicle by clicking, apart from the same system on foot', () => {
    page();
    fireEvent.click($('[data-tray-vehicle="patria"]'));
    expect([game.getTool(), game.toolVehicle()]).toEqual(['radar_a800', 'patria']);
    expect($('[data-tray-vehicle="patria"]').getAttribute('aria-pressed')).toBe('true');
    expect($('[data-pick="radar_a800"]').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click($('[data-pick="radar_a800"]'));
    expect([game.getTool(), game.toolVehicle()]).toEqual(['radar_a800', null]);
    expect(game.commands.place('radar_a800', 30, 0, undefined, 'patria')).toBeNull(); // a click on the map with the vehicle picked
    expect(game.sim.structures[0].def.vehicle).toBe('patria');
  });

  it('says when nothing in the pack fits on a vehicle', () => {
    page({ id: 2, ...PACK, assets: { systems: [{ id: 'radar_giraffe', count: 1 }], vehicles: [{ id: 'mule', count: 1 }], people: [] } });
    expect($('#tool-picker').textContent).toContain('Nothing in this pack fits on a Mule UGV.');
    expect($('[data-tray-vehicle="mule"]').getAttribute('aria-disabled')).toBe('true');
    expect($('[data-tray-vehicle="mule"]').getAttribute('draggable')).toBe('false');
  });
});

describe('a system parked on a vehicle', () => {
  beforeEach(() => { game.sim.state.started = true; });

  it('is refused on a vehicle too small for it', () => {
    expect(game.commands.place('radar_giraffe', 30, 0, undefined, 'mule')).toBe('A Mule UGV cannot carry the Giraffe 1X'); // in the patrol's words
    expect(game.sim.structures).toHaveLength(0);
  });

  it('comes back on its vehicle from a saved laydown, and a vehicle that cannot carry it is dropped', () => {
    const spec = { structures: [{ id: 'jammer', x: 30, z: 0, uplink: null, cellBand: 'B8', jam: null, vehicle: 'hilux' }, { id: 'radar_giraffe', x: -30, z: 0, uplink: null, cellBand: 'B8', jam: null, vehicle: 'mule' }], fusionUplinks: [], fusionCell: 'B8' };
    expect(game.commands.loadLaydown(spec, game.sim.state.terrainSeed)).toBeNull();
    expect(game.sim.structures.map((s) => s.def.vehicle ?? null)).toEqual(['hilux', null]);
    expect(readDrop(JSON.stringify({ system: 'radar_giraffe', vehicle: 'mule' }))).toBeNull(); // nor can a drag ask for it
  });
});

describe('dragging from the toolbar\'s list', { timeout: 30000 }, () => {
  it('drags any real system of the kind, without picking it for clicks', () => {
    game.sim.state.started = true;
    render(<App game={game} />);
    fireEvent.click($('[data-catalogue="laser"]'));
    const { data, dataTransfer } = drag();
    fireEvent.dragStart($('[data-pick="laser_s"]'), { dataTransfer });
    expect(readDrop(data[DRAG_TYPE])).toEqual({ system: 'laser_s' });
    expect(game.getTool()).toBe('laser_s');
    act(() => game.dropAt({ system: 'laser_s' }, 25, 5));
    expect(game.sim.structures.map((s) => s.def.id)).toEqual(['laser_s']);
    expect(game.getTool()).toBeNull();
    expect(game.catalogue()).toBe('laser'); // the list stays open for the next one
  });

  it('closes with Esc, even with nothing picked', () => {
    game.sim.state.started = true;
    render(<App game={game} />);
    fireEvent.click($('[data-catalogue="rf"]'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(game.catalogue()).toBeNull();
  });
});
