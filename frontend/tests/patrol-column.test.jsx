// @vitest-environment jsdom
// Choosing the patrol's vehicles and what they carry in the Area panel.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { MOUNTS, PATROL, PATROL_VEHICLES, resetAllFigures } from '../src/sim/config/index.js';
import { GameContext } from '../src/ui/hooks.js';
import { ZonePanel } from '../src/ui/ZonePanel.jsx';
import { AccountContext } from '../src/ui/account/pack.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

const ROUTE = [[10, 10], [30, 10], [30, 30], [10, 30]]; // open, flat ground near the station on terrain 1
let game;
const $ = (sel) => document.querySelector(sel);
const show = () => render(<GameContext.Provider value={game}><ZonePanel onClose={() => {}} /></GameContext.Provider>);
const column = () => game.sim.getPatrol().column;

beforeEach(() => {
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  game.sim.state.started = true;
  expect(game.commands.setPatrol(ROUTE)).toBeNull();
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('the patrol column', () => {
  it('lists the default column and swaps a vehicle, keeping to what it can carry', () => {
    show();
    expect(column()).toEqual(PATROL.foot.column);
    fireEvent.change($('[aria-label="Vehicle 2"]'), { target: { value: 'themis' } }); // the Rapid Ranger is too heavy for a THeMIS
    expect(column()[1].vehicle).toBe('themis');
    expect(MOUNTS[column()[1].system]).toBeLessThanOrEqual(PATROL_VEHICLES.themis.carries);
  });

  it('changes what a vehicle carries, adds a vehicle and removes one', () => {
    show();
    fireEvent.change($('[aria-label="What vehicle 1 carries"]'), { target: { value: 'jammer_jupiter' } });
    expect(column()[0].system).toBe('jammer_jupiter');
    fireEvent.click($('#escort-add'));
    expect(column()).toHaveLength(3);
    expect(column()[2]).toMatchObject({ vehicle: 'themis', system: 'gun_hmg' });
    fireEvent.click($('[aria-label="Remove vehicle 1"]'));
    expect(column().map((e) => e.system)).toEqual(['missile_rr', 'gun_hmg']);
    expect(game.sim.structures.map((s) => s.def.id).sort()).toEqual(['gun_hmg', 'missile_rr']);
  });

  it('only lists the column once the attack has started', () => {
    game.sim.state.wave = 1;
    show();
    expect($('[aria-label="Vehicle 1"]')).toBeNull();
    expect(document.body.textContent).toContain('Toyota Hilux: Blighter A800, 40 m ahead');
  });
});

describe('the patrol column with a deployment pack', () => {
  const withPack = (vehicles) => render(
    <AccountContext.Provider value={{ activeUnit: { id: 1, name: '1 Troop', assets: { systems: [], vehicles, people: [] } } }}>
      <GameContext.Provider value={game}><ZonePanel onClose={() => {}} /></GameContext.Provider>
    </AccountContext.Provider>,
  );
  const options = (label) => [...$(`[aria-label="${label}"]`).options].map((o) => o.textContent);

  it("takes only the pack's vehicles, as many as it has", () => {
    const pack = [{ id: 'hilux', count: 1 }, { id: 'patria', count: 1 }]; // the default column uses both
    withPack(pack);
    expect(options('Vehicle 1')).toEqual(['Toyota Hilux', 'Soldier on foot']); // a unit always has soldiers
    expect($('#escort-add')).toBeNull();
    expect(document.body.textContent).toContain('Every vehicle in your pack is in use.');
    fireEvent.click($('[aria-label="Remove vehicle 2"]'));
    cleanup(); withPack(pack); // the game's tick redraws the panel
    expect(options('Vehicle 1')).toEqual(['Patria 6x6', 'Toyota Hilux', 'Soldier on foot']);
    fireEvent.click($('#escort-add'));
    expect(column().map((e) => e.vehicle)).toEqual(['hilux', 'patria']);
  });

  it('counts vehicles parked on the map, and marks one beyond the pack', () => {
    expect(game.commands.place('jammer', 20, 13, undefined, 'hilux')).toBeNull();
    withPack([{ id: 'hilux', count: 1 }, { id: 'patria', count: 2 }]);
    expect(options('Vehicle 1')).toEqual(['Patria 6x6', 'Toyota Hilux (beyond your pack)', 'Soldier on foot']);
    expect(document.body.textContent).toContain("The column takes your pack's vehicles: 1 Toyota Hilux, 2 Patria 6x6, less any parked on the map.");
  });
});

describe('messages with the Area to defend panel open', () => {
  it('stay on screen for 8 s, not the usual 2.6 s', async () => {
    const { Toast } = await import('../src/ui/Panels.jsx');
    vi.useFakeTimers();
    try {
      render(<GameContext.Provider value={game}><Toast /><ZonePanel onClose={() => {}} /></GameContext.Provider>);
      act(() => game.toast('That route crosses water'));
      act(() => vi.advanceTimersByTime(3000));
      expect($('#toast').className).toBe('show');
      act(() => vi.advanceTimersByTime(5500));
      expect($('#toast').className).toBe('');
    } finally { vi.useRealTimers(); }
  });
});
