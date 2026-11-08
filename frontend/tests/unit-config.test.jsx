// @vitest-environment jsdom
// Configuring one placed system: limits, prices, names, what is saved, and the Configure side of the Unit panel.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame } from '../src/game.js';
import { COMMS, STRUCTURES, resetAllFigures } from '../src/sim/config/index.js';
import { costProblem } from '../src/sim/laydown.js';
import { UNIT_FIELDS, cleanSettings, fieldsFor, stepOf, unitCost } from '../src/sim/unit-config.js';
import { GameContext } from '../src/ui/hooks.js';
import { UnitPanel } from '../src/ui/UnitPanel.jsx';
import { CostTab } from '../src/ui/dock/CostTab.jsx';
import { setUp } from './support/scenarios.js';
import { replayRun } from './support/replay.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

let game, sim;
const $ = (sel) => document.querySelector(sel);
const unit = (id) => sim.structures.find((s) => s.def.id === id);
const lay = (...ids) => setUp(sim, { seed: '1', laydown: ids.map((id, i) => [id, 600 + i * 100, 0]) });
const firstWave = () => { sim.state.warnedWire = true; game.commands.startWave(); };

beforeEach(() => {
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  game.getReplay = () => null;
  sim = game.sim;
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('the field table', () => {
  it('gives every system something to change, and only systems that exist', () => {
    for (const id of Object.keys(STRUCTURES)) expect(fieldsFor(id).length).toBeGreaterThan(0);
    for (const f of UNIT_FIELDS) for (const id of Object.keys(f.limits)) expect(STRUCTURES[id]).toBeDefined();
  });

  it('keeps every standard value inside its own limits', () => {
    for (const f of UNIT_FIELDS.filter((x) => !x.choices && !x.arcs && !x.bands)) {
      for (const [id, [min, max]] of Object.entries(f.limits)) {
        const base = f.base(STRUCTURES[id]);
        if (base == null) continue; // no standard value: a radar faces away from what is defended
        expect(base).toBeGreaterThanOrEqual(min);
        expect(base).toBeLessThanOrEqual(max);
      }
    }
  });
});

describe('what a setting does', () => {
  const set = (id, key, value) => { lay(id); expect(game.commands.configureUnit(unit(id), key, value)).toBeNull(); return unit(id).def; };

  it('radar power, in watts, trades range and signature', () => {
    const def = set('radar', 'watts', 6); // half the IRIS's rated 12 W
    expect(def.range).toBe(Math.round(3100 * Math.pow(0.5, 0.25)));
    expect(def.signature).toBeCloseTo(0.5);
    expect(def.cost).toBe(900000);
  });

  it('reads a power saved as a percentage as that share of the rated watts, and says where the rating came from', () => {
    expect(cleanSettings('radar', { power: 50 })).toEqual({ watts: 6 });
    expect(cleanSettings('radar_a800', { power: 50, watts: 3 })).toEqual({ watts: 3 });
    const f = fieldsFor('radar_s').find((x) => x.key === 'watts');
    expect(f.note('radar_s')).toMatch(/Rated 2 W: an assumption/);
    expect(f.note('radar_a800')).toMatch(/Rated 4 W: published/);
    expect(stepOf(f, 'jammer_sf')).toBe(50);
  });

  it('jammer power follows the square root', () => {
    const def = set('jammer', 'watts', 10); // a quarter of its 40 W
    expect(def.range).toBe(500);
  });

  it('a slower scan reaches further and really scans less often', () => {
    lay('radar', 'radar_s');
    game.commands.configureUnit(unit('radar'), 'scan', 0.5);
    expect(unit('radar').def.range).toBe(Math.round(3100 * Math.pow(0.5, 0.25)));
    sim.state.warnedWire = true;
    sim.run(400);
    expect(unit('radar').scanId).toBeGreaterThan(unit('radar_s').scanId * 1.8);
  });

  it('a scan as slow as 5 s still confirms tracks', () => {
    lay('radar');
    expect(game.commands.configureUnit(unit('radar'), 'scan', 5)).toBeNull();
    expect(unit('radar').def.sapient.interval).toBe(5);
    firstWave();
    let confirmed = false;
    // drones start 13 km out
    for (let n = 0; n < 10000 && !confirmed; n++) { sim.step(); confirmed = [...sim.net.tracks.values()].some((tr) => tr.status === 'confirmed'); }
    expect(confirmed).toBe(true);
  });

  it('the threshold trades range against false alarms', () => {
    const def = set('rf', 'threshold', 'low');
    expect(def.range).toBe(3850);
    expect(def.falseAlarm).toBeCloseTo(0.1);
    game.commands.configureUnit(unit('rf'), 'threshold', 'high');
    expect(def.range).toBe(3150);
    expect(def.falseAlarm).toBeCloseTo(0.025);
  });

  it('a camera\'s view sets its reach, with the large one matching the lens figures', () => {
    expect(set('camera', 'view', 2.5).range).toBe(2600);
    expect(set('camera_l', 'view', 0.5).range).toBe(6390); // the lens's narrow end: about 6.4 km
    expect(unit('camera_l').def.fov).toBe(0.5);
  });

  it('a small camera has one fixed lens', () => {
    expect(fieldsFor('camera_s').map((f) => f.key)).not.toContain('view');
  });

  it('settings follow figure edits made in the Sources tab', () => {
    const def = set('radar', 'watts', 6);
    game.commands.setFigure('structures', 'radar', 'published', 4000);
    expect(def.range).toBe(Math.round(4000 * Math.pow(0.5, 0.25)));
  });
});

describe('limits', () => {
  beforeEach(() => lay('radar'));

  it('holds a value to its limits and steps', () => {
    game.commands.configureUnit(unit('radar'), 'mount', 500);
    expect(unit('radar').def.mount).toBe(35);
    game.commands.configureUnit(unit('radar'), 'mount', 1);
    expect(unit('radar').def.mount).toBe(5);
    game.commands.configureUnit(unit('radar'), 'scan', 0.74);
    expect(unit('radar').def.settings.scan).toBe(0.7);
  });

  it('gives each size its own limits', () => {
    lay('radar_s', 'radar_l');
    game.commands.configureUnit(unit('radar_s'), 'mount', 500);
    game.commands.configureUnit(unit('radar_l'), 'mount', 500);
    expect(unit('radar_s').def.mount).toBe(25);
    expect(unit('radar_l').def.mount).toBe(40);
  });

  it('refuses what is not a value, or not a field of this system', () => {
    expect(game.commands.configureUnit(unit('radar'), 'watts', Number.NaN)).toContain('Not a valid');
    expect(game.commands.configureUnit(unit('radar'), 'threshold', 'constructor')).toContain('Not a valid');
    expect(game.commands.configureUnit(unit('radar'), 'view', 3)).toContain('cannot be changed');
    expect(game.commands.configureUnit(unit('radar'), '__proto__', 3)).toContain('cannot be changed');
    expect(unit('radar').def.settings).toEqual({});
  });
});

describe('price', () => {
  it('charges and refunds the difference, and counts it as spending on systems', () => {
    lay('radar');
    const { state, ledger } = sim, budget = state.budget, capex = ledger.capex;
    game.commands.configureUnit(unit('radar'), 'mount', 35);
    expect(state.budget).toBe(budget - 135000);
    expect(ledger.capex).toBe(capex + 135000);
    game.commands.configureUnit(unit('radar'), 'mount', null);
    expect(state.budget).toBe(budget);
    expect(unit('radar').def.settings).toEqual({});
  });

  it('refuses what you cannot afford, and changes nothing', () => {
    lay('missile');
    sim.state.budget = 100;
    const problem = game.commands.configureUnit(unit('missile'), 'reload', 2);
    expect(problem).toContain('Not enough budget');
    expect(sim.state.budget).toBe(100);
    expect(unit('missile').def.cooldown).toBe(4);
  });

  it('a saved laydown costs what its units cost', () => {
    const spec = (settings) => ({ structures: Array.from({ length: 8 }, () => ({ id: 'laser', settings })), fusionUplinks: [] });
    expect(costProblem(spec({ beam: 14 }))).toBeNull();
    expect(costProblem(spec({ beam: 56 }))).toContain('more than');
    expect(unitCost('laser', { beam: 56 })).toBe(4000000);
  });

  it('the Cost tab adds up real prices, and says when a size\'s prices differ', () => {
    setUp(sim, { seed: '1', laydown: [['radar', 600, 0], ['radar', -600, 0]] });
    game.commands.configureUnit(sim.structures[0], 'mount', 35);
    render(<GameContext.Provider value={game}><CostTab active /></GameContext.Provider>);
    expect(document.body.textContent).toContain('varies');
    expect(document.body.textContent).toContain('£1,451,250');
  });
});

describe('locks', () => {
  it('nothing but jamming bands changes after the first wave starts', () => {
    lay('jammer');
    firstWave();
    expect(game.commands.configureUnit(unit('jammer'), 'watts', 20)).toContain('locked');
    expect(game.commands.renameUnit(unit('jammer'), 'Alpha', '')).toContain('locked');
    expect(unit('jammer').def.range).toBe(1000);
    game.commands.toggleJamBand(unit('jammer'), 'gnss', true);
    expect(unit('jammer').jamBands.has('gnss')).toBe(true);
  });
});

describe('names', () => {
  it('renames, shows the new name in the log, and goes back', () => {
    lay('radar');
    const s = unit('radar');
    expect(game.commands.renameUnit(s, 'North mast', 'NORTH-1')).toBeNull();
    expect(s.short).toBe('NORTH-1');
    expect(sim.net.nameOf(s.nodeId)).toBe('North mast');
    game.commands.renameUnit(s, '', '');
    expect(s.short).toBe('RDR-01');
    expect(s.name).toBe('Medium radar 01');
    expect(s.custom).toBeUndefined();
  });

  it('refuses a callsign in use or badly formed, and strips control characters from names', () => {
    lay('radar', 'rf');
    expect(game.commands.renameUnit(unit('rf'), '', 'rdr-01')).toContain('already in use');
    expect(game.commands.renameUnit(unit('rf'), '', 'FUSION')).toContain('already in use');
    expect(game.commands.renameUnit(unit('rf'), '', '<b>')).toContain('A callsign is');
    expect(game.commands.renameUnit(unit('rf'), 'A\u0000B‮c', '')).toBeNull();
    expect(unit('rf').name).toBe('ABc');
  });

  it('automatic numbering never takes a callsign a unit has chosen', () => {
    lay('radar');
    game.commands.renameUnit(unit('radar'), '', 'RDR-02');
    expect(game.commands.place('radar', 30, 30)).toBeNull();
    expect(sim.structures[1].short).toBe('RDR-03');
  });
});

describe('saving', () => {
  it('adds nothing to a laydown until something changes', () => {
    lay('radar');
    const [l] = sim.currentLaydown().structures;
    expect(Object.keys(l)).toEqual(['id', 'x', 'z', 'uplink', 'cellBand', 'jam']);
  });

  it('settings, names and prices survive the rebuild when wave 1 starts', () => {
    lay('radar', 'missile');
    game.commands.configureUnit(unit('radar'), 'mount', 35);
    game.commands.configureUnit(unit('radar'), 'watts', 6);
    game.commands.renameUnit(unit('radar'), 'North mast', 'NORTH-1');
    firstWave();
    const s = unit('radar');
    expect(s.def.mount).toBe(35);
    expect(s.def.settings.watts).toBe(6);
    expect([s.name, s.short]).toEqual(['North mast', 'NORTH-1']);
    const terminals = Object.entries(sim.ledger.terminals).reduce((sum, [k, n]) => sum + n * COMMS[k].cost, 0);
    expect(sim.ledger.capex).toBe(1035000 + 1000000 + terminals);
  });

  it('a saved callsign is kept for its unit, whatever order they rebuild in', () => {
    const l = (x, more) => ({ id: 'radar', x, z: 0, uplink: null, cellBand: 'B8', jam: null, ...more });
    const spec = { structures: [l(-30), l(0), l(30, { callsign: 'RDR-01' })], fusionUplinks: [], fusionCell: 'B8' };
    expect(game.commands.loadLaydown(spec, sim.state.terrainSeed)).toBeNull();
    expect(sim.structures.map((s) => s.short)).toEqual(['RDR-02', 'RDR-03', 'RDR-01']);
  });

  it('a tampered save is held to the limits, and cannot reach anything outside the table', () => {
    const saved = JSON.parse('{"mount": 1e9, "power": "loud", "view": 1, "constructor": 1, "__proto__": {"cost": 1}}');
    const clean = cleanSettings('radar', saved);
    expect(clean).toEqual({ mount: 35 });
    expect(unitCost('radar', clean)).toBe(1035000);
    expect(cleanSettings('radar', 'nonsense')).toEqual({});
    expect(cleanSettings('radar', null)).toEqual({});
    expect({}.cost).toBeUndefined();
  });

  it('ignores a duplicate or malformed name in a save', () => {
    const l = (x, more) => ({ id: 'radar', x, z: 0, uplink: null, cellBand: 'B8', jam: null, ...more });
    const spec = { structures: [l(-30, { callsign: 'SAME' }), l(0, { callsign: 'SAME' }), l(30, { callsign: '<script>', name: '  ' })], fusionUplinks: [], fusionCell: 'B8' };
    expect(game.commands.loadLaydown(spec, sim.state.terrainSeed)).toBeNull();
    const shorts = sim.structures.map((s) => s.short);
    expect(new Set(shorts).size).toBe(3);
    expect(shorts).toContain('SAME');
    expect(shorts.join()).not.toContain('<');
  });

  it('a run with custom settings replays to its own digest', () => {
    lay('radar', 'jammer', 'interceptor');
    game.commands.configureUnit(unit('radar'), 'watts', 6);
    game.commands.configureUnit(unit('radar'), 'scan', 0.5);
    game.commands.configureUnit(unit('jammer'), 'watts', 16);
    game.commands.configureUnit(unit('interceptor'), 'reload', 1.5);
    game.commands.renameUnit(unit('radar'), 'North mast', 'NORTH-1');
    let run = null;
    const take = (r) => { run = r; };
    sim.on('runEnded', take);
    firstWave();
    sim.run(600);
    sim.endRun();
    sim.off('runEnded', take);
    const record = JSON.parse(JSON.stringify(run));
    expect(record.spec.structures.find((l) => l.id === 'radar').settings).toEqual({ watts: 6, scan: 0.5 });
    replayRun(sim, record);
    expect(sim.digest()).toBe(record.digest);
  }, 60000);
});

describe('the Configure side of the panel', () => {
  const open = (id) => {
    lay(id);
    render(<GameContext.Provider value={game}><UnitPanel /></GameContext.Provider>);
    act(() => game.select(unit(id)));
    fireEvent.click($('#unit-configure'));
  };
  const commit = (el, value) => { el.value = value; fireEvent.change(el); };

  it('offers each of this system\'s fields, and shows the range and price change at once', () => {
    open('radar');
    for (const f of fieldsFor('radar')) expect($(`#unit-${f.key}`)).not.toBeNull();
    expect($('#unit-view')).toBeNull();
    commit($('#unit-mount'), '35');
    expect($('#unit-editor').textContent).toContain('£776k');
    expect($('#unit-editor').textContent).toContain('+£101k');
    commit($('#unit-watts'), '6');
    expect($('#unit-editor').textContent).toContain('2.6 km');
  });

  it('goes back to the standard value with its reset button', () => {
    open('radar');
    const reset = () => $('[aria-label="Reset Mast height"]');
    expect(reset().disabled).toBe(true);
    commit($('#unit-mount'), '35');
    fireEvent.click(reset());
    expect(unit('radar').def.settings).toEqual({});
    expect($('#unit-mount').value).toBe('25');
  });

  it('puts the input back and says why when an edit is refused', () => {
    open('missile');
    const toasts = [];
    game.onToast((m) => toasts.push(m));
    act(() => { sim.state.budget = 0; game.bump(); });
    commit($('#unit-reload'), '2');
    expect(toasts[0]).toContain('Not enough budget');
    expect($('#unit-reload').value).toBe('4');
  });

  it('shows a clamped value, not what was typed', () => {
    open('radar');
    commit($('#unit-mount'), '500');
    expect($('#unit-mount').value).toBe('35');
  });

  it('takes blanking arcs as text, shows them tidied, and says how to write them', () => {
    open('radar');
    const toasts = [];
    game.onToast((m) => toasts.push(m));
    fireEvent.blur($('#unit-blank'), { target: { value: '40-80,350 - 10' } });
    expect(unit('radar').def.settings.blank).toEqual([[40, 80], [350, 10]]);
    expect($('#unit-blank').value).toBe('40-80, 350-10');
    fireEvent.blur($('#unit-blank'), { target: { value: 'north' } });
    expect(toasts[0]).toContain('such as 40-80');
    expect(unit('radar').def.settings.blank).toEqual([[40, 80], [350, 10]]);
  });

  it('uses a list for choices', () => {
    open('rf');
    fireEvent.change($('#unit-threshold'), { target: { value: 'low' } });
    expect(unit('rf').def.settings.threshold).toBe('low');
  });

  it('renames when you leave the field, and refuses a callsign in use', () => {
    lay('radar', 'rf');
    render(<GameContext.Provider value={game}><UnitPanel /></GameContext.Provider>);
    act(() => game.select(unit('rf')));
    fireEvent.click($('#unit-configure'));
    fireEvent.change($('#unit-name'), { target: { value: 'East ear' } });
    fireEvent.blur($('#unit-name'));
    expect(unit('rf').name).toBe('East ear');
    expect($('#unit-panel').textContent).toContain('East ear');
    fireEvent.change($('#unit-callsign'), { target: { value: 'RDR-01' } });
    fireEvent.blur($('#unit-callsign'));
    expect(unit('rf').short).toBe('RF-01');
    expect($('#unit-callsign').value).toBe('');
  });

  it('sells on the second click', () => {
    open('radar');
    fireEvent.click($('#unit-sell'));
    expect(sim.structures.length).toBe(1);
    fireEvent.click($('#unit-sell'));
    expect(sim.structures.length).toBe(0);
  });

  it('locks at the first wave, leaving a jammer\'s bands live', () => {
    open('jammer');
    act(() => firstWave());
    act(() => game.select(unit('jammer')));
    fireEvent.click($('#unit-configure'));
    expect($('#unit-watts').disabled).toBe(true);
    expect($('#unit-name').disabled).toBe(true);
    expect($('#unit-sell')).toBeNull();
    const gnss = [...document.querySelectorAll('#unit-jamming label')].find((l) => l.textContent.includes('GNSS')).querySelector('input');
    fireEvent.click(gnss);
    expect(unit('jammer').jamBands.has('gnss')).toBe(true);
  });

  it('goes back to the details, and is not offered while reviewing', () => {
    open('radar');
    fireEvent.click($('#unit-details'));
    expect($('#unit-editor')).toBeNull();
    expect($('#unit-panel').textContent).toContain('Modelled on');
    sim.rec.frames.push({ t: 5, budget: 1, structs: [] });
    game.getReplay = () => ({ active: () => true, frameIndex: () => 0 });
    fireEvent.click($('#unit-close'));
    act(() => game.select(unit('radar')));
    expect($('#unit-configure')).toBeNull();
  });
});
