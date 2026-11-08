// @vitest-environment jsdom
// Simulated people: placing groups, what protection does, and that they never change the attack.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame } from '../src/game.js';
import { BUILD, CASUALTY, DRONES, FIGURE_FIELDS, PEOPLE, PEOPLE_LIMITS, RESEARCHED, casualtyRadii, exportFigures, importFigures, resetAllFigures } from '../src/sim/config/index.js';
import { blastOnGround, blastOnSite, bunkerSide } from '../src/sim/people.js';
import { parsePack, worldId } from '../src/sim/world-pack.js';
import { terrainState } from '../src/sim/terrain.js';
import { view } from '../src/render/view.js';
import { GameContext } from '../src/ui/hooks.js';
import { Hud } from '../src/ui/Hud.jsx';
import { Overlay } from '../src/ui/Overlay.jsx';
import { SourcesTab } from '../src/ui/dock/SourcesTab.jsx';
import { Toolbar } from '../src/ui/Toolbar.jsx';
import { ToolPicker } from '../src/ui/ToolPicker.jsx';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';
import { CENTRE, fixtureParts } from './support/fixture-pack.js';
import { MIXED, play, setUp } from './support/scenarios.js';

const CLEAR_SPOT = [20, 20]; // scene units: open, flat ground near the station on terrain 1
let game, sim;
const $ = (sel) => document.querySelector(sel);
const fakeWorld = () => ({ state: sim.state, people: sim.people, rec: sim.rec, emit() {}, peopleRev: 0 });
const fpv = (uid = 1) => ({ uid, def: DRONES.fpv });
const shahed = (uid = 1) => ({ uid, def: DRONES.fw });
const down = (protection) => sim.people.filter((g) => g.protection === protection).reduce((sum, g) => sum + g.hits.length, 0);
const aBuilding = () => terrainState.data.buildings.find((b) => Math.hypot(b.x, b.z) < BUILD.maxDist - 50);

beforeEach(() => {
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  sim = game.sim;
  sim.state.started = true;
  view.people = { count: 10, protection: 'open' };
  view.wizard = 'closed';
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('placing a group', () => {
  it('places unarmoured people on open ground, with a spot for each', () => {
    expect(sim.commands.placePeople(...CLEAR_SPOT, 25, 'open')).toBeNull();
    const [g] = sim.people;
    expect(g.count).toBe(25);
    expect(g.spots.length).toBe(50);
    const metres = Math.hypot(g.spots[48] - g.x, g.spots[49] - g.z) * 20;
    expect(metres).toBeLessThan(10); // a crowd, not a scatter
  });

  it('keeps the group size within the limits', () => {
    sim.commands.placePeople(...CLEAR_SPOT, 1e6, 'open');
    sim.commands.placePeople(...CLEAR_SPOT, 0, 'open');
    expect(sim.people.map((g) => g.count)).toEqual([PEOPLE_LIMITS.perGroup, 1]);
    expect(sim.commands.placePeople(...CLEAR_SPOT, NaN, 'open')).toMatch(/how many/);
  });

  it.each([['constructor'], ['nonsense']])('refuses protection level %s', (level) => {
    expect(sim.commands.placePeople(...CLEAR_SPOT, 5, level)).toMatch(/protection/);
    expect(sim.people).toHaveLength(0);
  });

  it('refuses a spot outside the build zone', () => {
    expect(sim.commands.placePeople(BUILD.maxDist, 0, 5, 'open')).toMatch(/build zone/);
  });

  it('limits how many groups there are', () => {
    for (let i = 0; i < PEOPLE_LIMITS.groups; i++) expect(sim.commands.placePeople(20 + i * 0.1, 20, 1, 'open')).toBeNull();
    expect(sim.commands.placePeople(...CLEAR_SPOT, 1, 'open')).toMatch(/No more than/);
  });

  it('locks with the laydown once the first wave starts', () => {
    sim.commands.placePeople(...CLEAR_SPOT, 5, 'open');
    sim.state.wave = 1;
    expect(sim.commands.placePeople(21, 21, 5, 'open')).toMatch(/locked/);
    sim.commands.removePeople(sim.people[0].id);
    expect(sim.people).toHaveLength(1);
    sim.state.wave = 0;
  });
});

describe('a group in a building', () => {
  it('needs a building, on generated ground', () => {
    expect(sim.commands.placePeople(...CLEAR_SPOT, 5, 'building')).toMatch(/building/);
    const b = aBuilding();
    expect(sim.commands.placePeople(b.x / 20, b.z / 20, 5, 'building')).toBeNull();
  });

  it('refuses unarmoured people and a bunker on a building', () => {
    const b = aBuilding();
    expect(sim.commands.placePeople(b.x / 20, b.z / 20, 5, 'open')).toMatch(/In a building/);
    expect(sim.commands.placePeople(b.x / 20, b.z / 20, 5, 'bunker')).toMatch(/In a building/);
  });

  it('stands everyone inside the walls', () => {
    const b = aBuilding();
    sim.commands.placePeople(b.x / 20, b.z / 20, 40, 'building');
    const [g] = sim.people, c = Math.cos(b.angle || 0), s = Math.sin(b.angle || 0);
    for (let i = 0; i < g.count; i++) {
      const dx = g.spots[i * 2] * 20 - b.x, dz = g.spots[i * 2 + 1] * 20 - b.z;
      expect(Math.abs(dx * c - dz * s)).toBeLessThanOrEqual(Math.max(b.w / 2, 0.5) + 1e-3);
      expect(Math.abs(dx * s + dz * c)).toBeLessThanOrEqual(Math.max(b.d / 2, 0.5) + 1e-3);
    }
  });

  it('uses the true outlines on a real map', () => {
    const parts = fixtureParts();
    const pack = parsePack({ ...parts.header, gridsSha256: 'a'.repeat(64) }, parts.grids, parts.features);
    sim.registerPack(pack);
    expect(sim.commands.deploy('1', worldId(pack.hash, CENTRE.east, CENTRE.north))).toBeNull();
    const data = terrainState.data;
    const b = data.buildings.find((o) => Math.hypot(o.x, o.z) < BUILD.maxDist - 50);
    expect(data.geo).toBeTruthy();
    expect(sim.commands.placePeople(b.x / 20, b.z / 20, 5, 'building')).toBeNull();
    expect(data.buildingAt(b.x, b.z)).toBe(b);
    expect(sim.commands.placePeople((b.x + b.w + 40) / 20, b.z / 20, 5, 'building')).toMatch(/building/);
    sim.commands.reset('clear');
    sim.commands.deploy('1', '1');
  });
});

describe('casualties', () => {
  it('protection shelters people from the same blast', () => {
    const groups = [[-40, -40, 'open'], [0, -40, 'building'], [-40, 0, 'bunker']];
    // the same layout for each level, as if each were alone: the rules do not look at what is under them
    for (const [x, z, level] of groups) sim.people.push({ id: x, x, z, y: 0, count: 300, protection: level, spots: new Float32Array(600).map((_, i) => (i % 2 ? z : x)), down: new Uint8Array(300), hits: [] });
    const w = fakeWorld();
    for (const [x, z] of groups) blastOnGround(w, fpv(x * z + x), x + 0.1, z);
    expect(down('open')).toBeGreaterThan(down('building'));
    expect(down('building')).toBeGreaterThan(down('bunker'));
    expect(sim.state.casualties).toBe(down('open') + down('building') + down('bunker'));
  });

  it('nobody is hurt beyond the casualty radius, and no one is hurt twice', () => {
    sim.commands.placePeople(...CLEAR_SPOT, 100, 'open');
    const w = fakeWorld();
    blastOnGround(w, fpv(), CLEAR_SPOT[0] + 200 / 20, CLEAR_SPOT[1]);
    expect(sim.state.casualties).toBe(0);
    for (let uid = 1; uid < 50; uid++) blastOnGround(w, shahed(uid), ...CLEAR_SPOT);
    const [g] = sim.people;
    expect(new Set(g.hits).size).toBe(g.hits.length);
    expect(g.hits.length).toBeLessThanOrEqual(100);
    expect(g.hits.length).toBeGreaterThan(50);
  });

  it('a drone with no warhead hurts nobody', () => {
    sim.commands.placePeople(...CLEAR_SPOT, 100, 'open');
    blastOnGround(fakeWorld(), { uid: 1, def: DRONES.spotter }, ...CLEAR_SPOT);
    expect(sim.state.casualties).toBe(0);
  });

  it('a strike on the site can reach people standing in it', () => {
    // the station's own buildings are on terrain 1, so they stand in the first gap
    const spots = Array.from({ length: 21 }, (_, i) => [(i - 10) * 0.5, 2]);
    const [x, z] = spots.find(([a, b]) => sim.canPlacePeople(a, b, 'open'));
    expect(sim.commands.placePeople(x, z, 200, 'open')).toBeNull();
    const w = fakeWorld();
    for (let uid = 1; uid <= 20; uid++) blastOnSite(w, shahed(uid));
    expect(sim.state.casualties).toBeGreaterThan(0);
  });
  it('a strike aimed inside a drawn area lands on its aim point', () => {
    expect(sim.commands.placePeople(...CLEAR_SPOT, 50, 'open')).toBeNull();
    blastOnSite(fakeWorld(), { ...fpv(), aim: { x: -CLEAR_SPOT[0], z: -CLEAR_SPOT[1] } }); // far from the group
    expect(sim.state.casualties).toBe(0);
    blastOnSite(fakeWorld(), { ...fpv(2), aim: { x: CLEAR_SPOT[0], z: CLEAR_SPOT[1] } });
    expect(sim.state.casualties).toBeGreaterThan(0);
  });

  it('come back after a reset, with the group still there', () => {
    sim.commands.placePeople(...CLEAR_SPOT, 50, 'open');
    blastOnGround(fakeWorld(), shahed(), ...CLEAR_SPOT);
    expect(sim.state.casualties).toBeGreaterThan(0);
    sim.commands.reset('keep');
    expect(sim.state.casualties).toBe(0);
    expect(sim.people.map((g) => [g.count, g.hits.length])).toEqual([[50, 0]]);
    sim.commands.reset('clear');
    expect(sim.people).toHaveLength(0);
  });
});

describe('runs', () => {
  const STRUCK = [['radar', 400, 0]]; // nothing to stop the strikes it draws
  const results = () => [sim.state.kills, sim.state.leaks, sim.state.health, sim.state.budget, sim.state.hits, sim.state.time, sim.bus.seq];
  const run = (people) => {
    setUp(sim, { seed: '7', laydown: STRUCK });
    for (const [x, z, count, level] of people) sim.commands.placePeople(x, z, count, level);
    play(sim, 3);
    return { results: results(), digest: sim.digest(), casualties: sim.state.casualties };
  };
  // beside the radar, so the strikes it draws reach them
  const CROWD = [[20, 0.5, 200, 'open'], [20, -0.5, 200, 'open']];

  it('people never change the attack', () => {
    const without = run([]);
    const beside = run(CROWD);
    expect(beside.casualties).toBeGreaterThan(0);
    expect(beside.results).toEqual(without.results);
    expect(beside.digest).not.toBe(without.digest); // casualties are part of the fingerprint when there are people
  }, 120000);

  it('the same run gives the same casualties, whatever order the groups were placed in', () => {
    const a = run(CROWD), b = run([...CROWD].reverse());
    expect(b.casualties).toBe(a.casualties);
    expect(b.digest).toBe(a.digest);
  }, 120000);

  it('records who was down in each frame, only when there are people', () => {
    setUp(sim, { seed: '7', laydown: MIXED });
    sim.run(20);
    expect(sim.rec.frames.at(-1).casualties).toBeUndefined();
    sim.commands.placePeople(...CLEAR_SPOT, 5, 'open');
    sim.run(20);
    expect(sim.rec.frames.at(-1).casualties).toEqual([0]);
  });
});

describe('saving', () => {
  it('a laydown keeps its people, sorted, and leaves the field out with none', () => {
    expect(sim.currentLaydown().people).toBeUndefined();
    sim.commands.placePeople(30, 20, 5, 'bunker');
    sim.commands.placePeople(...CLEAR_SPOT, 7, 'open');
    const spec = JSON.parse(JSON.stringify(sim.currentLaydown()));
    expect(spec.people).toEqual([{ x: 20, z: 20, count: 7, protection: 'open' }, { x: 30, z: 20, count: 5, protection: 'bunker' }]);
    expect(sim.commands.loadLaydown(spec, '1')).toBeNull();
    expect(sim.people.map((g) => g.count)).toEqual([7, 5]);
  });

  it('keeps soldiers as soldiers, saving the role only for them', () => {
    expect(sim.commands.placePeople(30, 20, 5, 'open', 'military')).toBeNull();
    expect(sim.commands.placePeople(...CLEAR_SPOT, 7, 'open', 'tank')).toBe('Choose civilians or soldiers');
    sim.commands.placePeople(...CLEAR_SPOT, 7, 'open');
    const spec = JSON.parse(JSON.stringify(sim.currentLaydown()));
    expect(spec.people).toEqual([{ x: 20, z: 20, count: 7, protection: 'open' }, { x: 30, z: 20, count: 5, protection: 'open', role: 'military' }]);
    expect(sim.commands.loadLaydown(spec, '1')).toBeNull();
    expect(sim.people.map((g) => g.role)).toEqual(['civilian', 'military']);
  });

  it('ignores a group it does not understand', () => {
    const spec = { structures: [], fusionUplinks: [], fusionCell: 'B8', people: [{ x: 20, z: 20, count: 5, protection: 'toString' }, { x: 20, z: 20, count: 5, protection: 'open' }] };
    expect(sim.commands.loadLaydown(spec, '1')).toBeNull();
    expect(sim.people.map((g) => g.protection)).toEqual(['open']);
  });
});

describe('figures', () => {
  it('labels every casualty figure as an assumption, and the warhead as researched', () => {
    for (const key of ['pCasualty', 'reachScale']) expect(FIGURE_FIELDS[key].basis).toBe('assumption');
    expect(FIGURE_FIELDS.warhead.basis).toBe('research');
  });

  it('grows the radii with the cube root of the warhead, from the M67 grenade', () => {
    const m67 = casualtyRadii({ warhead: 0.18 });
    expect(m67.lethal).toBeCloseTo(5, 0); expect(m67.injury).toBeCloseTo(14, 0); // the US Army's 5 m and 15 m
    const shahed = casualtyRadii(DRONES.shahed136);
    expect(shahed.injury / shahed.lethal).toBeCloseTo(CASUALTY.injuryK / CASUALTY.lethalK);
    expect(shahed.injury).toBeCloseTo(m67.injury * Math.cbrt(DRONES.shahed136.warhead / 0.18));
    expect(casualtyRadii(DRONES.orlan10)).toEqual({ lethal: 0, injury: 0 }); // a reconnaissance drone carries none
  });

  it('kills only within the lethal radius and injures only within the injury radius', () => {
    sim.commands.placePeople(...CLEAR_SPOT, 400, 'open');
    blastOnGround(fakeWorld(), shahed(), ...CLEAR_SPOT);
    const g = sim.people[0], { lethal, injury } = casualtyRadii(DRONES.fw), at = (i) => Math.hypot(g.spots[i * 2] - CLEAR_SPOT[0], g.spots[i * 2 + 1] - CLEAR_SPOT[1]) * 20;
    const killed = g.hits.filter((i) => g.down[i] === 2), injured = g.hits.filter((i) => g.down[i] === 1);
    expect(killed.length).toBeGreaterThan(0); expect(injured.length).toBeGreaterThan(0);
    for (const i of killed) expect(at(i)).toBeLessThan(lethal + 1);
    for (const i of injured) expect(at(i)).toBeLessThan(injury + 1);
    expect(sim.state.killed).toBe(killed.length); expect(sim.state.injured).toBe(injured.length);
    expect(sim.state.casualties).toBe(killed.length + injured.length);
  });

  it('a bunker shelters more than a building, which shelters more than the open', () => {
    const { open, building, bunker } = RESEARCHED.people;
    expect(open.pCasualty * open.reachScale).toBeGreaterThan(building.pCasualty * building.reachScale);
    expect(building.pCasualty * building.reachScale).toBeGreaterThan(bunker.pCasualty * bunker.reachScale);
  });

  it('exports only when edited, and comes back', () => {
    expect(exportFigures().people).toBeUndefined();
    sim.commands.setFigure('people', 'bunker', 'pCasualty', 0.5);
    const saved = exportFigures();
    expect(saved.people).toEqual({ bunker: { pCasualty: 0.5 } });
    resetAllFigures();
    expect(PEOPLE.bunker.pCasualty).toBe(RESEARCHED.people.bunker.pCasualty);
    importFigures(saved);
    expect(PEOPLE.bunker.pCasualty).toBe(0.5);
  });

  it('a bunker is big enough for everyone in it', () => {
    expect(bunkerSide(500) ** 2).toBeGreaterThanOrEqual(500);
  });
});

describe('the screens', () => {
  const show = (...parts) => render(<GameContext.Provider value={game}>{parts}</GameContext.Provider>);

  it('chooses size and protection in the picker, and places on a click', () => {
    show(<Toolbar key="t" />, <ToolPicker key="p" />);
    fireEvent.click($('[data-tool="people"]'));
    expect(game.getTool()).toBe('people');
    const size = $('#people-count');
    size.value = 12; fireEvent.change(size);
    fireEvent.click($('[data-protection="bunker"]'));
    expect($('[data-protection="bunker"]').getAttribute('aria-pressed')).toBe('true');
    expect(view.people).toEqual({ count: 12, protection: 'bunker' });
    expect(document.body.textContent).toMatch(/assumed figures/);
    fireEvent.click($('[data-role="military"]'));
    expect($('[data-role="military"]').getAttribute('aria-pressed')).toBe('true');
    expect(view.people.role).toBe('military');
  });

  it('lists the groups, and removes one', () => {
    sim.commands.placePeople(...CLEAR_SPOT, 12, 'open');
    show(<ToolPicker key="p" />);
    act(() => game.setTool('people'));
    const [g] = sim.people;
    expect($('.people-list').textContent).toContain('12 civilians · Unarmoured');
    fireEvent.click($(`[data-remove="${g.id}"]`));
    expect(sim.people).toHaveLength(0);
  });

  it('shows casualties in the HUD', () => {
    show(<Hud key="h" />);
    expect($('#killed').textContent).toBe('0');
    act(() => { sim.commands.placePeople(...CLEAR_SPOT, 50, 'open'); blastOnGround(fakeWorld(), shahed(), ...CLEAR_SPOT); game.bump(); });
    expect(Number($('#killed').textContent)).toBe(sim.state.killed);
    expect(Number($('#injured').textContent)).toBe(sim.state.injured);
  });

  it('marks every figure in the Sources tab as an assumption', () => {
    show(<SourcesTab key="s" active={false} />);
    const fields = [...document.querySelectorAll('input[data-key="pCasualty"], input[data-key="reachScale"]')];
    expect(fields.length).toBeGreaterThanOrEqual(6); // both, for each level of protection
    for (const input of fields) expect(input.closest('label').querySelector('.fb').textContent).toBe('ASSUMPTION');
    expect(document.body.textContent).toMatch(/not base real decisions/);
  });

  it('sums them up by protection when the site is lost, and says they are assumed', () => {
    sim.commands.placePeople(...CLEAR_SPOT, 50, 'open');
    sim.commands.placePeople(30, 30, 20, 'bunker');
    blastOnGround(fakeWorld(), shahed(), ...CLEAR_SPOT);
    sim.state.over = true;
    show(<Overlay key="o" />);
    const text = $('#casualty-summary').textContent;
    const [open] = sim.people, count = (sev) => open.hits.filter((i) => open.down[i] === sev).length;
    expect(text).toContain(`unarmoured ${count(2)} killed and ${count(1)} injured of 50`);
    expect(text).toMatch(/in a bunker \d+ killed and \d+ injured of 20/);
    expect(text).toMatch(/assumed figures/);
    sim.state.over = false;
  });
});
