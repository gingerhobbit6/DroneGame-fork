// @vitest-environment jsdom
// The patrol planner: one patrol, dismounted or mounted, every bearer of a system a marker in its formation, clicked to load it.

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame } from '../src/game.js';
import { view } from '../src/render/view.js';
import { resetAllFigures } from '../src/sim/config/index.js';
import { GameContext } from '../src/ui/hooks.js';
import { ZonePanel } from '../src/ui/ZonePanel.jsx';
import { AccountContext } from '../src/ui/account/pack.js';
import { bearers, fill, packLeft } from '../src/ui/patrol-bearers.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

const ROUTE = [[10, 10], [30, 10], [30, 30], [10, 30]];
let game, pack = null;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const show = () => { cleanup(); render(<AccountContext.Provider value={pack ? { activeUnit: { id: 1, name: 'Troop', assets: pack } } : null}><GameContext.Provider value={game}><ZonePanel onClose={() => {}} /></GameContext.Provider></AccountContext.Provider>); };
const patrol = () => game.sim.getPatrol();
const click = (sel) => { fireEvent.click($(sel)); show(); };
const offered = () => Object.fromEntries($$('#pp-selected [data-give]').map((b) => [b.dataset.give, !b.disabled]));

beforeEach(() => {
  pack = null; view.patrolBearer = null;
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  game.sim.state.started = true;
  expect(game.commands.setPatrol(ROUTE)).toBeNull();
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('a dismounted patrol', () => {
  it('shows every soldier as a marker, and lets one carry two hand-held systems but nothing bigger', () => {
    show();
    click('input[name="pp-type"][value="dismounted"]');
    expect(patrol().type).toBe('dismounted');
    expect(patrol().column).toEqual([]); // the Hilux and Patria it had do not walk with soldiers
    expect($$('.pp-bearer.soldier')).toHaveLength(patrol().group.count);
    click('[data-bearer="s2"]');
    const can = offered();
    expect(can.rf_rfpatrol).toBe(true);
    expect(can.radar_a800).toBe(false); // greyed out: medium needs a mounted patrol
    expect($('#pp-selected').textContent).toContain('needs a mounted patrol');
    click('#pp-selected [data-give="rf_rfpatrol"]');
    click('#pp-selected [data-give="gun_droneround"]');
    expect(patrol().column).toEqual([expect.objectContaining({ vehicle: 'foot', soldier: 2, system: 'rf_rfpatrol', also: ['gun_droneround'] })]);
    expect(offered().rf_chuyka).toBe(false); // two is all a soldier carries
    click('#pp-selected [data-take-off="0"]');
    expect(patrol().column[0]).toMatchObject({ soldier: 2, system: 'gun_droneround' });
  });

  it('keeps each soldier\'s kit with them when the formation and spacing change', () => {
    show();
    click('input[name="pp-type"][value="dismounted"]');
    click('[data-bearer="s4"]');
    click('#pp-selected [data-give="rf_chuyka"]');
    fireEvent.change($('#pp-spacing'), { target: { value: '20' } }); show();
    fireEvent.change($('#pp-formation'), { target: { value: 'wedge' } }); show();
    expect(patrol()).toMatchObject({ spacing: 20, formation: 'wedge' });
    expect(patrol().column).toEqual([expect.objectContaining({ soldier: 4, system: 'rf_chuyka' })]);
    const chuyka = patrol().escorts[0].s, lead = patrol().group;
    expect(Math.hypot(chuyka.pos.x - lead.spots[8], chuyka.pos.z - lead.spots[9])).toBeLessThan(0.01); // standing with soldier 5
  });

  it('fills from the pack: soldiers take the hand-held kit, a THeMIS the light systems, the rest stays in the pack', () => {
    pack = { systems: [{ id: 'rf_rfpatrol', count: 3 }, { id: 'gun_droneround', count: 4 }, { id: 'gun_hmg', count: 1 }, { id: 'radar_a800', count: 1 }], vehicles: [{ id: 'themis', count: 1 }, { id: 'patria', count: 1 }], people: [] };
    show();
    click('input[name="pp-type"][value="dismounted"]');
    click('#pp-fill');
    const col = patrol().column;
    expect(col.filter((e) => e.vehicle === 'foot').flatMap((e) => [e.system, ...(e.also ?? [])]).sort()).toEqual(['gun_droneround', 'gun_droneround', 'gun_droneround', 'gun_droneround', 'rf_rfpatrol', 'rf_rfpatrol', 'rf_rfpatrol']);
    expect(col.filter((e) => e.vehicle !== 'foot')).toEqual([expect.objectContaining({ vehicle: 'themis', system: 'gun_hmg' })]);
    expect(col.filter((e) => e.vehicle === 'foot').every((e) => !e.also)).toBe(true); // one each before anyone takes a second
    click('#pp-clear');
    expect(patrol().column).toEqual([]);
  });
});

describe('a mounted patrol', () => {
  it('drives with its soldiers riding, its vehicles in the chosen shape, loaded by clicking them', () => {
    show();
    click('input[name="pp-type"][value="mounted"]');
    expect(patrol().column.map((e) => e.vehicle)).toEqual(['hilux', 'patria']); // kept: both ride in a mounted patrol
    click('[data-add-vehicle="themis"]');
    expect(patrol().column).toHaveLength(3);
    fireEvent.change($('#pp-shape'), { target: { value: 'box' } }); show();
    expect(new Set(patrol().column.map((e) => e.side)).size).toBeGreaterThan(1);
    click('[data-bearer="v1"]'); // the Patria
    expect(offered().missile_paladin).toBe(true);
    expect(offered().gun_droneround).toBe(false); // a soldier's rifle needs a dismounted patrol
    click('#pp-selected [data-give="missile_paladin"]');
    expect(patrol().column[1].also).toEqual(['missile_paladin']);
    const riders = patrol().group;
    expect(riders.spots.slice(0, 2)).not.toEqual([riders.spots[2], riders.spots[3]]); // spread over the vehicles
  });

  it('warns, but allows, a patrol beyond the pack', () => {
    pack = { systems: [{ id: 'gun_hmg', count: 1 }], vehicles: [{ id: 'hilux', count: 1 }], people: [] };
    show();
    click('input[name="pp-type"][value="mounted"]');
    expect($('.pp-warn').textContent).toMatch(/Beyond your pack: .*Patria/);
  });
});

describe('the planner\'s working', () => {
  it('gives an older column\'s soldiers without a place the first free soldiers', () => {
    const list = bearers([{ vehicle: 'foot', system: 'rf_chuyka', gap: 0 }], { type: 'mixed', formation: 'file', spacing: 5 }, 3);
    expect(list.find((b) => b.key === 's0').systems).toEqual(['rf_chuyka']);
  });

  it('fills a mounted patrol heaviest first, keeping the pack\'s count', () => {
    const left = packLeft({ systems: [{ id: 'missile_paladin', count: 1 }, { id: 'radar_a800', count: 1 }, { id: 'gun_hmg', count: 2 }], vehicles: [{ id: 'patria', count: 1 }, { id: 'themis', count: 1 }] }, []);
    const { column, spare } = fill({ type: 'mounted', formation: 'file', spacing: 40 }, 8, left);
    expect(spare).toBe(0);
    expect(column[0]).toMatchObject({ vehicle: 'patria', system: 'missile_paladin', also: ['radar_a800'] });
    expect(column[1]).toMatchObject({ vehicle: 'themis', system: 'gun_hmg', also: ['gun_hmg'] }); // spread over the vehicles
  });
});
