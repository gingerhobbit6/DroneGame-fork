// @vitest-environment jsdom
// A deployed pack's kit is all that can be placed, each with its line's settings, and the pack can be edited from inside the
// game. Also: large systems reload only once the fighting stops, and a fast round bursts on a target it would fly through.

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { DRONES, STRUCTURES, resetAllFigures } from '../src/sim/config/index.js';
import { effectorFor, kitLeft, sensorChecklist, stepStatus } from '../src/ui/assistant/guide.js';
import { closestOnPath } from '../src/sim/effectors.js';
import { fieldsFor } from '../src/sim/unit-config.js';
import { magazineWord, updateMagazine } from '../src/sim/magazine.js';
import { hereU, u } from '../src/sim/units.js';
import { view } from '../src/render/view.js';
import { App } from '../src/ui/App.jsx';
import { GameContext } from '../src/ui/hooks.js';
import { AccountContext } from '../src/ui/account/pack.js';
import { ProfileHub } from '../src/ui/account/ProfileHub.jsx';
import { Overlay } from '../src/ui/Overlay.jsx';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const USER = { id: 1, username: 'operator', display_name: 'Sgt Alex Smith', rank: '', organisation: '', created_at: '2026-11-07T10:00:00+00:00', last_sign_in: null };
const PACK = { id: 1, name: '1 Troop', echelon: 'troop', callsign: '', assets: { systems: [{ id: 'radar_a800', count: 1 }, { id: 'jammer', count: 2 }], vehicles: [], people: [] } };
const KIT = { radar_a800: 1, jammer: 2 };

let api, game;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  api = createFakeApi();
  game = createGame({ seed: '1', terrainSeed: '1', api, storage: createFakeStorage() });
  game.attach = vi.fn();
  view.wizard = 'closed';
  game.sim.commands.deploy('1', '1');
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('a deployed pack limits what can be placed', () => {
  beforeEach(() => game.sim.commands.setPacked(KIT));

  it('refuses kit the pack does not hold, or more than it holds', () => {
    expect(game.sim.commands.place('radar_a800', 30, 0)).toBeNull();
    expect(game.sim.commands.place('radar_a800', -30, 0)).toBe('All 1 Blighter A800 in your deployment pack are placed');
    expect(game.sim.commands.place('laser', 0, 30)).toMatch(/is not in your deployment pack/);
    expect(game.sim.canPlace(0, -30, STRUCTURES.jammer)).toBe(true);
  });

  it('keeps the kit in the run log, and drops anything that is not a system and a count', () => {
    game.sim.commands.startWave();
    expect(game.sim.log).toContainEqual({ step: 0, name: 'setPacked', args: [KIT] });
    game.sim.commands.setPacked({ radar_a800: 2, nonsense: 3, jammer: -1, radar: 1.5 });
    expect(game.sim.state.kit).toEqual({ radar_a800: 2 });
    game.sim.commands.setPacked(false);
    expect(game.sim.state).toMatchObject({ packed: false, kit: null });
  });

  it('places each system with the settings its line holds', () => {
    game.usePackLoadouts([{ id: 'radar_a800', count: 1, settings: { mount: 12, clutter: 'high', nonsense: 1 } }, { id: 'jammer', count: 2 }]);
    expect(game.loadoutFor('radar_a800')).toEqual({ mount: 12, clutter: 'high' });
    expect(game.sim.commands.place('radar_a800', 30, 0, game.loadoutFor('radar_a800'))).toBeNull();
    expect(game.sim.structures.at(-1).def.settings).toEqual({ mount: 12, clutter: 'high' });
  });

  it("puts the settings back to the catalogue's once the pack is withdrawn", () => {
    game.setLoadout('radar', fieldsFor('radar').find((f) => f.key === 'mount'), 9); // the player's own choice for a system the pack does not hold
    game.usePackLoadouts([{ id: 'radar_a800', count: 1, settings: { mount: 12 } }]);
    game.usePackLoadouts(null);
    expect(game.loadoutFor('radar_a800')).toEqual({});
    expect(game.loadoutFor('radar').mount).toBe(9);
  });
});

describe('the toolbar with a pack deployed', { timeout: 30000 }, () => {
  const page = (account = {}) => {
    game.sim.commands.setPacked(KIT);
    render(<AccountContext.Provider value={{ user: USER, activeUnit: PACK, ...account }}><App game={game} /></AccountContext.Provider>);
  };

  it('lists only what the pack holds when a row is clicked, with how many are left', () => {
    page();
    expect($('[data-catalogue="radar"]').textContent).toContain('1 in your pack');
    fireEvent.click($('[data-catalogue="radar"]'));
    expect($$('#tool-picker [data-pick]').map((e) => e.dataset.pick)).toEqual(['radar_a800']);
    expect($('#tool-picker').textContent).toContain('Radar: 1 in your pack');
    expect($('#tool-picker').textContent).toContain('1 of 1 to place');
    expect(game.getTool()).toBeNull();
  });

  it('opens the list on a hotkey, rather than picking a system to place', () => {
    page();
    fireEvent.keyDown(window, { key: '1' });
    expect(game.getTool()).toBeNull();
    expect(game.catalogue()).toBe('radar');
  });

  it('says when the pack holds none of a kind, and offers to edit it', () => {
    const editPack = vi.fn();
    page({ editPack });
    fireEvent.click($('[data-catalogue="laser"]'));
    expect($('#tool-picker').textContent).toContain('Your deployment pack holds no laser systems.');
    fireEvent.click(screen.getByRole('button', { name: 'Add some to the pack' }));
    expect(editPack).toHaveBeenCalled();
  });
});

describe('the wizard with a pack deployed', () => {
  beforeEach(() => game.sim.commands.setPacked({ radar_a400: 1, rf_s: 1, jammer: 1 }));

  it("recommends only the pack's sensors, and is done once they are all placed", () => {
    expect(sensorChecklist(game.sim).map((r) => [r.kind, r.def.id])).toEqual([['radar', 'radar_a400'], ['rf', 'rf_s']]);
    expect(stepStatus(game.sim, null).sensors).toBe(false);
    game.sim.addStructure('radar_a400', 30, 0);
    game.sim.addStructure('rf_s', -30, 0);
    expect(sensorChecklist(game.sim).every((r) => r.done)).toBe(true);
    expect(stepStatus(game.sim, null).sensors).toBe(true);
  });

  it("recommends only the pack's effectors, and moves on once nothing left in it would help", () => {
    expect(effectorFor(DRONES.fpv, Infinity, kitLeft(game.sim)).id).toBe('jammer');
    expect(stepStatus(game.sim, null).effectors).toBe(false);
    game.sim.addStructure('jammer', 0, 30);
    expect(effectorFor(DRONES.fpv, Infinity, kitLeft(game.sim))).toBeUndefined();
    expect(stepStatus(game.sim, null).effectors).toBe(true);
  });
});

describe('choosing a pack on the start screen', { timeout: 30000 }, () => {
  const start = (account = {}) => {
    game.sim.commands.leave(); // back to the start screen
    const value = { user: USER, activeUnit: null, deploy: vi.fn(), openProfile: vi.fn(), ...account };
    render(<GameContext.Provider value={game}><AccountContext.Provider value={value}><Overlay /></AccountContext.Provider></GameContext.Provider>);
    return value;
  };

  it('deploys the pack chosen, or none for a budget', async () => {
    const made = await api.units.create(PACK);
    const account = start();
    await settle();
    const select = $('#start-pack-select');
    expect([...select.options].map((o) => o.textContent)).toEqual(['None: buy any system, on a budget', '1 Troop (1 sensor · 2 effectors)']);
    fireEvent.change(select, { target: { value: String(made.id) } });
    expect(account.deploy).toHaveBeenCalledWith(expect.objectContaining({ id: made.id, name: '1 Troop' }));
    fireEvent.change(select, { target: { value: '' } });
    expect(account.deploy).toHaveBeenLastCalledWith(null);
  });

  it('offers to build one when there are none', async () => {
    const account = start();
    await settle();
    expect($('#start-pack').textContent).toContain('You have no packs yet.');
    fireEvent.click($('#start-pack-build'));
    expect(account.openProfile).toHaveBeenCalled();
  });

  it('is not there without an account', () => {
    start({ user: null });
    expect($('#start-pack')).toBeNull();
  });

  it('lists a pack built in the profile once the profile closes', async () => {
    game.sim.commands.leave();
    const value = { user: USER, activeUnit: null, deploy: vi.fn(), openProfile: vi.fn(), covered: false };
    const page = (account) => <GameContext.Provider value={game}><AccountContext.Provider value={account}><Overlay /></AccountContext.Provider></GameContext.Provider>;
    const { rerender } = render(page(value));
    await settle();
    expect($('#start-pack').textContent).toContain('You have no packs yet.');
    await api.units.create(PACK);
    rerender(page({ ...value, covered: true })); // the profile, where it was built
    rerender(page({ ...value, covered: false }));
    await settle();
    expect([...$('#start-pack-select').options].map((o) => o.textContent)).toContain('1 Troop (1 sensor · 2 effectors)');
  });

  it('never shows the previous account\'s cached packs after a username is reused', async () => {
    const made = await api.units.create(PACK);
    let currentUserId = USER.id;
    api.units.list = vi.fn(async () => currentUserId === USER.id ? [{ id: made.id }] : []);
    game.sim.commands.leave();
    const base = { user: USER, activeUnit: null, deploy: vi.fn(), openProfile: vi.fn(), covered: false };
    const page = (account) => <GameContext.Provider value={game}><AccountContext.Provider value={account}><Overlay /></AccountContext.Provider></GameContext.Provider>;
    const { rerender } = render(page(base));
    await settle();
    expect($('#start-pack-select').options.length).toBe(2);
    currentUserId = 2;
    rerender(page({ ...base, user: { ...USER, id: 2 } }));
    await settle();
    expect(api.units.list).toHaveBeenCalledTimes(2);
    expect([...$('#start-pack-select').options].map((o) => o.textContent)).toEqual(['None: buy any system, on a budget']);
    expect(base.deploy).not.toHaveBeenCalled();
  });
});

describe('editing a pack', { timeout: 30000 }, () => {
  const hub = (account = {}) => {
    const value = { user: USER, setUser: vi.fn(), activeUnit: null, deploy: vi.fn(), signOut: vi.fn(), ...account };
    render(<ProfileHub api={api} account={value} inGame onEnter={vi.fn()} />);
    return value;
  };

  it('sets what each of a line\'s systems is placed with, and saves it', async () => {
    const made = await api.units.create(PACK);
    hub();
    await settle();
    fireEvent.click(within($('[data-pack]')).getByRole('button', { name: 'Edit' })); // the profile has an Edit too
    fireEvent.click(screen.getByText(/Settings for each Blighter A800/));
    fireEvent.change($('#pack-radar_a800-mount'), { target: { value: '20' } });
    fireEvent.blur($('#pack-radar_a800-mount'));
    expect(screen.getByText(/Settings for each Blighter A800: 1 changed/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'One more Blighter A800' })); // a new count keeps the settings
    fireEvent.click(screen.getByRole('button', { name: 'Save pack' }));
    await settle();
    expect(api.units.rows.get(made.id).assets.systems).toEqual([{ id: 'radar_a800', count: 2, settings: { mount: 20 } }, { id: 'jammer', count: 2 }]);
  });

  it('opens on the deployed pack from the game, and goes back to the game', async () => {
    const doneEditing = vi.fn();
    hub({ activeUnit: PACK, editActive: true, doneEditing });
    await settle();
    expect(screen.getByLabelText(/Unit name/).value).toBe('1 Troop');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(doneEditing).toHaveBeenCalled();
  });
});

describe('reloading', () => {
  const world = (state) => ({ state: { waveActive: false, sandbox: false, sbQueue: [], ...state }, drones: [], rec: { event: vi.fn() }, emit: vi.fn() });
  const emptied = (id) => {
    const s = game.sim.addStructure(id, id === 'gun_s' ? 30 : -30, 0);
    s.rounds = 0; s.reload = s.def.reloadTime;
    return s;
  };

  it('a large system waits for the wave to end, while a small one reloads as it fights', () => {
    const nasams = emptied('missile_l'), gpmg = emptied('gun_s');
    for (const s of [nasams, gpmg]) updateMagazine(world({ waveActive: true }), s, 1);
    expect(nasams.reload).toBe(nasams.def.reloadTime);
    expect(magazineWord(nasams, nasams.def)).toBe('Reloads after the wave');
    expect(gpmg.reload).toBe(gpmg.def.reloadTime - 1);
    updateMagazine(world({}), nasams, 1);
    expect(nasams.reload).toBe(nasams.def.reloadTime - 1);
    expect(magazineWord(nasams, nasams.def)).toBe('Reloading');
  });

  it('waits in the sandbox too, while an attack is still coming', () => {
    const nasams = emptied('missile_l');
    updateMagazine(world({ sandbox: true, sbQueue: [{}] }), nasams, 1);
    expect(nasams.reload).toBe(nasams.def.reloadTime);
    updateMagazine(world({ sandbox: true }), nasams, 1);
    expect(nasams.reload).toBe(nasams.def.reloadTime - 1);
  });
});

describe('a fast round', () => {
  it('finds where its path came closest', () => {
    const near = new Vector3();
    expect(closestOnPath(new Vector3(0, 0, 0), new Vector3(10, 0, 0), new Vector3(5, 1, 0), near)).toBe(1);
    expect(near.toArray()).toEqual([5, 0, 0]);
    expect(closestOnPath(new Vector3(0, 0, 0), new Vector3(10, 0, 0), new Vector3(-3, 4, 0), near)).toBe(5); // before the start
  });

  it('bursts on a target it would otherwise fly clean through in one step', () => {
    const d = game.sim.spawnDrone('fw', 0), x = 20, z = 20;
    d.pos.set(x, hereU(x, z) + u(60), z);
    d.def = { ...d.def, speed: 0 };
    const def = STRUCTURES.gun_s, speed = u(def.missileSpeed);
    expect(speed * 0.05).toBeGreaterThan(u(def.fuze) * 10); // a GPMG round covers far more than its fuze in a step
    const at = [];
    game.sim.on('explosion', (e) => at.push(e.pos.distanceTo(d.pos)));
    game.sim.missiles.push({ def, pos: d.pos.clone().add(new Vector3(-speed * 0.025, 0, 0)), vel: new Vector3(speed, 0, 0), target: d, life: 5, from: 100, cueError: 0 });
    game.sim.step();
    expect(at.length).toBe(1);
    expect(at[0]).toBeLessThan(u(def.fuze));
  });
});
