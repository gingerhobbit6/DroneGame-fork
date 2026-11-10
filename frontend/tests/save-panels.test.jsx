// @vitest-environment jsdom
// The saved laydowns, run history and figure set panels, with the backend up, refusing and down.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { ADAPT, GAME_VERSION, STRUCTURES, resetAllFigures } from '../src/sim/config/index.js';
import { GameContext } from '../src/ui/hooks.js';
import { SavedTab } from '../src/ui/dock/SavedTab.jsx';
import { RunsTab } from '../src/ui/dock/RunsTab.jsx';
import { LabTab } from '../src/ui/dock/LabTab.jsx';
import { FigureSets } from '../src/ui/dock/FigureSets.jsx';
import { MIXED, setUp } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

const $ = (q) => document.querySelector(q);
const text = (q) => $(q) && $(q).textContent;
const type = (el, v) => fireEvent.change(el, { target: { value: v } });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const empty = { structures: [], fusionUplinks: [], fusionCell: 'B8' };

let game, api, storage;
const show = (ui) => render(<GameContext.Provider value={game}>{ui}</GameContext.Provider>);
const armed = () => { setUp(game.sim, { seed: '1', laydown: MIXED }); game.sim.state.warnedWire = true; };

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  api = createFakeApi(); storage = createFakeStorage();
  game = createGame({ seed: '1', terrainSeed: '1', api, storage });
});
afterEach(() => { cleanup(); resetAllFigures(); vi.unstubAllGlobals(); });

describe('saved laydowns panel', () => {
  it('saves, lists, and needs a name', async () => {
    armed();
    show(<SavedTab active />);
    await settle();
    expect(screen.getByText('Nothing saved yet.')).toBeTruthy();
    expect($('#save-laydown').disabled).toBe(true);
    expect($('#save-laydown').textContent).toBe(`Save ${MIXED.length} systems`);
    fireEvent.submit($('.saved-form'));
    expect(api.laydowns.rows.size).toBe(0);
    type($('#save-name'), '  Outer ring ');
    fireEvent.click($('#save-laydown'));
    await settle();
    expect(api.laydowns.rows.get(1)).toMatchObject({ world: '1', game_version: GAME_VERSION });
    expect(api.laydowns.rows.get(1).spec.structures.length).toBe(MIXED.length);
    expect(text('#saved-note')).toContain('Outer ring');
    expect(text('#saved-list')).toContain('Outer ring');
    expect($('#save-name').value).toBe('');
  });

  it('keeps the name you typed when saving fails, and says why', async () => {
    armed();
    show(<SavedTab active />);
    await settle();
    api.state.refuse = true;
    type($('#save-name'), 'Rejected');
    fireEvent.click($('#save-laydown'));
    await settle();
    expect(text('#saved-note')).toMatch(/refused/);
    expect($('#save-name').value).toBe('Rejected');
  });

  it('loads on a second click, switches ground, and updates the address', async () => {
    armed();
    const spec = game.sim.currentLaydown();
    await api.laydowns.create({ name: 'Saved', world: 'hills', spec, game_version: GAME_VERSION });
    game.commands.reset('clear');
    show(<SavedTab active />);
    await settle();
    const load = () => screen.getByText(/^(Load|Replace run\?)$/);
    fireEvent.click(load());
    expect(load().textContent).toBe('Replace run?');
    expect(game.sim.structures.length).toBe(0);
    fireEvent.click(load());
    await settle();
    expect(game.sim.structures.length).toBe(MIXED.length);
    expect(game.sim.state.terrainSeed).toBe('hills');
    expect(location.search).toContain('terrain=hills');
    expect(text('#saved-note')).toBe('Loaded "Saved".');
  });

  it('warns when a laydown came from another version, and refuses one it cannot afford', async () => {
    armed();
    await api.laydowns.create({ name: 'Old', world: '1', spec: game.sim.currentLaydown(), game_version: '0.0.1' });
    show(<SavedTab active />);
    await settle();
    fireEvent.click(screen.getByText('Load'));
    fireEvent.click(screen.getByText('Replace run?'));
    await settle();
    expect(text('#saved-note')).toMatch(/saved by version 0.0.1/);
    STRUCTURES.radar.cost = 2e9;
    fireEvent.click(screen.getByText('Load'));
    fireEvent.click(screen.getByText('Replace run?'));
    await settle();
    expect(text('#saved-note')).toMatch(/more than the/);
  });

  it('updates and deletes on a second click', async () => {
    armed();
    await api.laydowns.create({ name: 'Mine', world: '1', spec: empty, game_version: GAME_VERSION });
    show(<SavedTab active />);
    await settle();
    fireEvent.click(screen.getByText('Update'));
    expect(api.laydowns.rows.get(1).spec).toEqual(empty);
    fireEvent.click(screen.getByText('Overwrite?'));
    await settle();
    expect(api.laydowns.rows.get(1).spec.structures.length).toBe(MIXED.length);
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Sure?'));
    await settle();
    expect(api.laydowns.rows.size).toBe(0);
  });

  it('forgets a half-finished click after a while', async () => {
    vi.useFakeTimers();
    await api.laydowns.create({ name: 'Mine', world: '1', spec: empty, game_version: GAME_VERSION });
    show(<SavedTab active />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Sure?')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(screen.getByText('Delete')).toBeTruthy();
    vi.useRealTimers();
  });

  it('tells you when the server is down, keeps the game playable, and recovers', async () => {
    armed();
    api.state.down = true;
    show(<SavedTab active />);
    await settle();
    expect(text('#saved-error')).toMatch(/not running/);
    game.sim.run(10); // still playing
    api.state.down = false;
    fireEvent.click(screen.getByText('Try again'));
    await settle();
    expect($('#saved-error')).toBeNull();
  });

  it('does not fetch while hidden', async () => {
    show(<SavedTab active={false} />);
    await settle();
    expect(api.state.calls).toEqual([]);
  });
});

describe('run history panel', () => {
  const addRun = (over = {}) => api.runs.create({ scenario_seed: '7', world: '1', waves_completed: 3, kills: 9, leaks: 1, health: 45, capex: 1e6, consumables: 2e5, budget_left: 13.8e6, enemy_cost: 5e4, ...over });

  it('lists runs and says they are self-reported', async () => {
    await addRun();
    show(<RunsTab active />);
    await settle();
    expect(text('#runs-list')).toContain('45%');
    expect(document.body.textContent).toContain('not proof of a score');
  });
  it('explains an empty history', async () => {
    show(<RunsTab active />);
    await settle();
    expect(document.body.textContent).toContain('No runs recorded yet');
  });
  it('pages through them', async () => {
    for (let i = 0; i < 25; i++) await addRun({ kills: i });
    show(<RunsTab active />);
    await settle();
    expect(text('.runs-paging')).toContain('1–20 of 25');
    fireEvent.click(screen.getByText('Older'));
    await settle();
    expect(text('.runs-paging')).toContain('21–25 of 25');
    expect(screen.getByText('Older').disabled).toBe(true);
    fireEvent.click(screen.getByText('Newer'));
    await settle();
    expect(screen.getByText('Newer').disabled).toBe(true);
  });
  it('deletes on a second click', async () => {
    await addRun();
    show(<RunsTab active />);
    await settle();
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Sure?'));
    await settle();
    expect(api.runs.rows.size).toBe(0);
    expect(text('#runs-note')).toBe('Run deleted.');
    await addRun();
    await act(async () => { game.bump(); });
  });
  it('shows a new run when it is saved, even with the same message as last time', async () => {
    show(<RunsTab active />);
    await settle();
    for (let i = 1; i <= 2; i++) {
      await act(async () => { await game.saver.save({ scenario_seed: 's', world: '1', waves_completed: i, kills: i, leaks: 0, health: 100, capex: 0, consumables: 0, budget_left: 0, enemy_cost: 0 }); });
      await settle();
      expect(document.querySelectorAll('#runs-list tbody tr').length).toBe(i);
    }
  });
  it('shows kept runs and saves them when the server is back', async () => {
    api.state.down = true;
    await act(async () => { await game.saver.save({ scenario_seed: 's', world: '1', waves_completed: 1, kills: 1, leaks: 0, health: 100, capex: 0, consumables: 0, budget_left: 0, enemy_cost: 0 }); });
    show(<RunsTab active />);
    await settle();
    expect(text('#runs-error')).toMatch(/not running/);
    expect(text('#runs-pending')).toContain('1 run kept');
    fireEvent.click($('#runs-retry'));
    await settle();
    expect(text('#runs-note')).toMatch(/still not running/);
    api.state.down = false;
    fireEvent.click($('#runs-retry'));
    await waitFor(() => expect($('#runs-pending')).toBeNull());
    expect(api.runs.rows.size).toBe(1);
    await waitFor(() => expect($('#runs-error')).toBeNull()); // cleared once the list has loaded again, a moment after the save
    expect(document.querySelectorAll('#runs-list tbody tr').length).toBe(1);
  });
  it('reports a failed delete', async () => {
    await addRun();
    show(<RunsTab active />);
    await settle();
    api.state.down = true;
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Sure?'));
    await settle();
    expect(text('#runs-note')).toMatch(/not running/);
  });
});

describe('saved figure sets', () => {
  it('saves your changes and applies them over the researched values', async () => {
    const onApplied = vi.fn();
    game.commands.setFigure('structures', 'radar', 'published', 4242);
    game.commands.setAdapt('evadePerWave', 0.3);
    show(<FigureSets active onApplied={onApplied} />);
    await settle();
    expect($('#figset-save').disabled).toBe(true);
    fireEvent.submit($('#figure-sets .saved-form'));
    expect(api.figureSets.rows.size).toBe(0);
    type($('#figset-name'), 'Long range');
    fireEvent.click($('#figset-save'));
    await settle();
    const saved = api.figureSets.rows.get(1);
    expect(saved.figures.structures.radar.published).toBe(4242);
    expect(saved.figures.adapt.evadePerWave).toBe(0.3);
    expect(text('#figset-note')).toContain('Long range');

    resetAllFigures();
    game.commands.setFigure('drones', 'fpv', 'hp', 999); // not in the set, so applying must clear it
    fireEvent.click(screen.getByText('Apply'));
    expect(STRUCTURES.radar.published).not.toBe(4242);
    fireEvent.click(screen.getByText('Replace figures?'));
    await settle();
    expect(STRUCTURES.radar.published).toBe(4242);
    expect(ADAPT.evadePerWave).toBe(0.3);
    expect(game.sim.log.at(-1).name).toBe('applyFigures');
    expect(onApplied).toHaveBeenCalled();
    expect(text('#figset-note')).toContain('Applied');
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Sure?'));
    await settle();
    expect(api.figureSets.rows.size).toBe(0);
  });

  it('says when the server is down, and keeps what you typed', async () => {
    api.state.down = true;
    show(<FigureSets active onApplied={() => {}} />);
    await settle();
    expect(text('#figset-error')).toMatch(/not running/);
    type($('#figset-name'), 'Mine');
    fireEvent.click($('#figset-save'));
    await settle();
    expect(text('#figset-note')).toMatch(/not running/);
    expect($('#figset-name').value).toBe('Mine');
    api.state.down = false;
    fireEvent.click(screen.getByText('Try again'));
    await settle();
    expect($('#figset-error')).toBeNull();
  });
});

describe('lab tab', () => {
  const put = (file, over = {}) => api.lab.files.set(file, { name: file, world: '1', game_version: GAME_VERSION, spec: JSON.parse(JSON.stringify(game.sim.currentLaydown())), ...over });

  it('says so when the lab has written nothing', async () => {
    show(<LabTab active />);
    await settle();
    expect(text('.muted')).toContain('No lab laydowns yet');
    expect($('#lab-report')).toBeNull();
  });

  it('lists the lab laydowns with their results and links the report', async () => {
    armed();
    api.lab.report = true;
    put('lab-1.json', { name: 'lab 1 7 sites', lab: { sites: 7, waves: 27, ci: 0, capex: 5112678, perPoundShots: 0.04, perPound: 0.31, what: '7 vehicles at 350 m' } });
    put('plain.json', { name: 'starting layout' });
    show(<LabTab active />);
    await settle();
    const rows = [...document.querySelectorAll('#lab-list tbody tr')].map((r) => r.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('lab 1 7 sites');
    expect(rows[0]).toContain('27');
    expect(rows[0]).toContain('£3.83M'); // the game shows its dollar prices in pounds
    expect(rows[0]).toContain('£0.04 / £0.31');
    expect($('#lab-report').getAttribute('href')).toBe('/api/v1/lab/report');
  });

  it('loads one into the run after a second click, without saving it', async () => {
    armed();
    put('lab-1.json', { name: 'lab 1 7 sites' });
    game.sim.commands.reset('clear');
    expect(game.sim.structures.length).toBe(0);
    show(<LabTab active />);
    await settle();
    const button = $('#lab-list .saved-actions button');
    fireEvent.click(button);
    expect(button.textContent).toBe('Replace run?');
    expect(game.sim.structures.length).toBe(0);
    fireEvent.click(button);
    await settle();
    expect(game.sim.structures.length).toBe(MIXED.length);
    expect(text('#lab-note')).toContain('lab 1 7 sites');
    expect(api.laydowns.rows.size).toBe(0);
  });

  it('shows the reason when the server is down, and can try again', async () => {
    api.state.down = true;
    show(<LabTab active />);
    await settle();
    expect(text('#lab-error')).toContain('not running');
    api.state.down = false;
    fireEvent.click($('#lab-error button'));
    await settle();
    expect($('#lab-error')).toBeNull();
  });
});

describe('opening a laydown file', () => {
  const open = async (content, name = 'lab.json') => {
    show(<SavedTab active />);
    await settle();
    const file = new File([typeof content === 'string' ? content : JSON.stringify(content)], name, { type: 'application/json' });
    await act(async () => { fireEvent.change($('#import-laydown'), { target: { files: [file] } }); await new Promise((r) => setTimeout(r, 20)); });
  };

  it('loads a saved laydown file into the run without saving it', async () => {
    armed();
    const spec = JSON.parse(JSON.stringify(game.sim.currentLaydown()));
    game.sim.commands.reset('clear');
    expect(game.sim.structures.length).toBe(0);
    await open({ name: 'From disk', world: '1', game_version: GAME_VERSION, spec });
    expect(game.sim.structures.length).toBe(MIXED.length);
    expect(text('#saved-note')).toContain('From disk');
    expect(api.laydowns.rows.size).toBe(0);
  });

  it('refuses a file that is not a laydown, and leaves the run alone', async () => {
    armed();
    await open({ spec: { structures: [{ id: 'not_a_system', x: 0, z: 0 }], fusionUplinks: [] } });
    expect(text('#saved-note')).toMatch(/not a laydown/);
    expect(game.sim.structures.length).toBe(MIXED.length);
    await open('this is not json');
    expect(text('#saved-note')).toBeTruthy();
    expect(game.sim.structures.length).toBe(MIXED.length);
  });
});
