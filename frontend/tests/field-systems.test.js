// The systems added from the field: a shotgun, a rifle firing Drone Round, DroneShield's RfPatrol, the Chuyka FPV video detector, the
// PodView camera, the XENTA-M5 radar and the VEPR M100 dome jammer, and soldiers on foot carrying them in a patrol's column.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DRONES, ESCORT_CARRIERS, PATROL_VEHICLES, STRUCTURES, TOOLBAR, WORLD, escortCarries, resetAllFigures } from '../src/sim/config/index.js';
import { covers, heardBand } from '../src/sim/rf-model.js';
import { reachFor } from '../src/sim/site-range.js';
import { coverArc, inCover } from '../src/sim/sensor-model.js';
import { crewed } from '../src/sim/crew.js';
import { columnProblem } from '../src/sim/patrol.js';
import { MAST_SIDE } from '../src/sim/sharing.js';
import { terrainState } from '../src/sim/terrain.js';
import { u } from '../src/sim/units.js';
import { createSimulation } from '../src/sim/simulation.js';
import { unitDef } from '../src/sim/unit-config.js';
import { setUp } from './support/scenarios.js';

const NEW = ['gun_shotgun', 'gun_droneround', 'rf_rfpatrol', 'rf_chuyka', 'camera_podview', 'camera_spyke', 'camera_skyspyke', 'radar_xenta', 'jammer_vepr'];
const square = (cx, cz, r) => [[cx - r, cz - r], [cx + r, cz - r], [cx + r, cz + r], [cx - r, cz + r]];

let sim;
beforeEach(() => { sim = createSimulation(); setUp(sim, { seed: '1', laydown: [] }); });
afterEach(() => resetAllFigures());

describe('the new systems in the catalogue', () => {
  it('lists each in its own kind’s toolbar row, with a source for its figures', () => {
    for (const id of NEW) {
      const def = STRUCTURES[id];
      expect(TOOLBAR.find((g) => g.kind === def.kind).classes, id).toContain(id);
      expect(def.ref.sources.length, id).toBeGreaterThan(0);
      expect(def.ref.basis, id).toBeTruthy();
    }
  });
});

describe('the shotgun and the rifle with Drone Round', () => {
  it('are carried and fired by a soldier, off the network', () => {
    for (const id of ['gun_shotgun', 'gun_droneround']) {
      expect(STRUCTURES[id]).toMatchObject({ kind: 'gun', handheld: true, mount: 1.5 });
      expect(crewed(STRUCTURES[id]), id).toBe(true);
    }
  });

  it('gives Drone Round its published 100 m and 2,200 ft/s, twice the shotgun’s reach', () => {
    const [shot, rifle] = [STRUCTURES.gun_shotgun, STRUCTURES.gun_droneround];
    expect(rifle.published).toBe(100);
    expect(rifle.missileSpeed).toBeCloseTo(2200 * 0.3048, -1);
    expect(rifle.range).toBeGreaterThan(2 * shot.range);
    expect(rifle.magazine).toBe(30);
  });

  it('wreck a first-person-view drone with one hit and barely mark a Shahed', () => {
    for (const id of ['gun_shotgun', 'gun_droneround']) {
      expect(STRUCTURES[id].damage, id).toBeGreaterThanOrEqual(DRONES.fpv.hp);
      expect(STRUCTURES[id].damage, id).toBeLessThan(DRONES.geran2.hp);
    }
  });
});

describe('the RfPatrol', () => {
  it('is worn by a soldier, passive, and hears a hobby drone’s 2.4 GHz control link at its 2 km', () => {
    expect(STRUCTURES.rf_rfpatrol).toMatchObject({ kind: 'rf', handheld: true, mount: 1.5, emits: [] });
    expect(heardBand(unitDef('rf_rfpatrol'), DRONES.fpv)).toBe('control24');
    expect(reachFor(unitDef('rf_rfpatrol'), DRONES.fpv)).toBe(unitDef('rf_rfpatrol').range);
    expect(heardBand(unitDef('rf_rfpatrol'), DRONES.fo)).toBeNull();
  });
});

describe('the Chuyka video detector', () => {
  const chuyka = () => unitDef('rf_chuyka');

  it('hears only video bands, so a drone’s control link alone gives it nothing', () => {
    expect(covers(chuyka())).toEqual(['video58']);
    expect(heardBand(chuyka(), DRONES.fpv)).toBe('video58');
    const controlOnly = { ...DRONES.fpv, links: { control: 'control24' } };
    expect(heardBand(chuyka(), controlOnly)).toBeNull();
    expect(heardBand(chuyka(), DRONES.fo)).toBeNull(); // fibre-optic: no radio at all
  });

  it('hears a first-person-view drone’s video at the 4 km its maker gives', () => {
    expect(reachFor(chuyka(), DRONES.fpv)).toBeCloseTo(4000 * WORLD.rangeScale, -2);
  });

  it('gives only a rough bearing, as a receiver with no direction finding', () => {
    expect(STRUCTURES.rf_chuyka.df).toBe('sector');
    expect(STRUCTURES.rf_chuyka.sapient.noise.az).toBe(30);
  });
});

describe('the PodView camera, XENTA-M5 radar and VEPR dome jammer', () => {
  it('fits the PodView with its laser rangefinder and its 720°/s slew', () => {
    expect(STRUCTURES.camera_podview).toMatchObject({ kind: 'camera', rangefinder: 'yes', slewRate: 720 });
    expect(STRUCTURES.camera_podview.range).toBeGreaterThan(STRUCTURES.camera_l.range);
  });

  it('has the SPYKE stare at a fixed 79° by 57° view, with no aim to cue and six drones located a look', () => {
    const spyke = STRUCTURES.camera_spyke;
    expect(spyke).toMatchObject({ kind: 'camera', stare: true, arc: 79, elevation: 57, locators: 1 });
    expect(STRUCTURES.camera_skyspyke).toMatchObject({ stare: true, arc: 360, locators: 6, cost: 400000 }); // six heads, £300,000
    expect(coverArc(STRUCTURES.camera_skyspyke)).toBe(360);
    expect(spyke.fov).toBeUndefined(); // so nothing cues or turns it
    const def = { ...spyke, facing: 90 };
    expect(inCover(def, 90 + 39, 5)).toBe(true);
    expect(inCover(def, 90 + 41, 5)).toBe(false);
    expect(inCover(def, 90, 50)).toBe(false);
    expect(inCover(STRUCTURES.camera_podview, 270, 50)).toBe(true); // a pointed camera's view is checked by its aim instead
    expect(unitDef('camera_spyke').settings ?? {}).not.toHaveProperty('slew');
  });

  it('has the XENTA-M5 see all round, further than any other radar here but the Giraffe', () => {
    const xenta = STRUCTURES.radar_xenta;
    expect(coverArc(xenta)).toBe(360);
    for (const def of Object.values(STRUCTURES).filter((d) => d.kind === 'radar' && d.id !== 'radar_xenta' && d.id !== 'radar_giraffe')) expect(xenta.range, def.id).toBeGreaterThan(def.range);
  });

  it('networks the VEPR M100 and jams control, video and GNSS', () => {
    expect(STRUCTURES.jammer_vepr.networked).not.toBe(false);
    expect(STRUCTURES.jammer_vepr.bands).toEqual(['control900', 'control24', 'video58', 'gnss']);
  });
});

describe('the CORTEXA GUARDIAN arrangement', () => {
  it('lets the EchoGuard take four panels, as CORTEXA mounts four', () => {
    expect(coverArc(unitDef('radar_s', { panels: 4 }))).toBe(360);
  });
});

describe('soldiers on foot in a patrol', () => {
  const COLUMN = [{ vehicle: 'foot', system: 'rf_rfpatrol', gap: 15, side: 0 }, { vehicle: 'foot', system: 'gun_droneround', gap: 5, side: 5 }, { vehicle: 'hilux', system: 'rf_chuyka', gap: -40, side: 0 }];

  it('carry a hand-held system, and nothing a vehicle should carry', () => {
    expect(columnProblem(COLUMN)).toBeNull();
    for (const id of ['rf_rfpatrol', 'rf_chuyka', 'gun_shotgun', 'gun_droneround']) expect(escortCarries('foot', id), id).toBe(true);
    expect(escortCarries('foot', 'radar_a800')).toBe(false);
    expect(escortCarries('hilux', 'gun_droneround')).toBe(false); // fired on foot, not from a vehicle
    expect(escortCarries('themis', 'rf_rfpatrol')).toBe(true); // a vehicle can carry a detector
    expect(columnProblem([{ vehicle: 'foot', system: 'missile_rr', gap: 0, side: 0 }])).toMatch(/Soldier on foot cannot carry/);
  });

  it('are not a deployment pack’s vehicles', () => {
    expect(Object.keys(PATROL_VEHICLES)).not.toContain('foot');
    expect(Object.keys(ESCORT_CARRIERS)).toContain('foot');
  });

  it('walk with the patrol carrying their systems at a soldier’s height', () => {
    expect(sim.commands.setPatrol(square(20, 20, 10), COLUMN)).toBeNull();
    const escorts = sim.getPatrol().escorts;
    expect(escorts.map(({ s }) => [s.def.id, s.def.vehicle, s.def.mount])).toEqual([['rf_rfpatrol', 'foot', 1.5], ['gun_droneround', 'foot', 1.5], ['rf_chuyka', 'hilux', 3]]);
  });
});

describe('a camera on a radar’s mast, as on CORTEXA GUARDIAN', () => {
  const at = (id) => sim.structures.filter((s) => s.def.id === id);

  it('puts a PodView placed by an EchoGuard on its mast, at its height, beside it', () => {
    expect(sim.commands.place('radar_s', 30, 0, { panels: 4 })).toBeNull();
    const radar = at('radar_s')[0];
    expect(sim.commands.place('camera_podview', 31, 1)).toBeNull();
    const cam = at('camera_podview')[0];
    expect(cam.pos.z).toBe(radar.pos.z);
    expect(cam.pos.x).toBeCloseTo(radar.pos.x + u(MAST_SIDE), 6);
    expect(cam.def.mount).toBe(radar.def.mount);
  });

  it('takes one camera and one radar to a mast, and nothing else close by', () => {
    expect(sim.commands.place('radar_s', 30, 0)).toBeNull();
    expect(sim.commands.place('camera_podview', 31, 0)).toBeNull();
    expect(sim.commands.place('camera', 30, 1)).toMatch(/Too close/);
    expect(sim.commands.place('radar_s', 70, 0)).toBeNull();
    expect(sim.commands.place('jammer', 71, 0)).toMatch(/Too close/);
  });
});

describe('loading a saved laydown onto the ground in play', () => {
  // a spot on terrain 1 in water, found by looking rather than assumed
  function wet() {
    const m = WORLD.metresPerUnit;
    for (let x = -120; x <= 120; x += 2) for (let z = -120; z <= 120; z += 2) if (Math.hypot(x, z) > 30 && terrainState.data.coverAt(x * m, z * m) === 4) return [x, z];
    return null;
  }

  it('lays it out round this site, leaving out what cannot stand on this ground', () => {
    const [wx, wz] = wet();
    const spec = { structures: [{ id: 'radar_s', x: 30, z: 0 }, { id: 'rf', x: wx, z: wz }], fusionUplinks: [], fusionCell: 'B8' };
    const toasts = [];
    sim.on('toast', (t) => toasts.push(t));
    expect(sim.commands.loadLaydownHere(spec)).toBeNull();
    expect(sim.structures.map((s) => s.def.id)).toEqual(['radar_s']);
    expect(toasts.join(' ')).toMatch(/1 system was left out/);
    expect(sim.state.terrainSeed).toBe('1'); // the ground in play stays
  });
});

describe('moving a placed system', () => {
  it('moves it with its settings, wiring and name, at no cost', () => {
    expect(sim.commands.place('radar_s', 30, 0, { panels: 2 })).toBeNull();
    const before = sim.structures[0], budget = sim.state.budget;
    sim.commands.wireNode(before, 'starlink');
    const [name, short, uplink, after] = [before.autoName, before.autoShort, before.uplink, sim.state.budget];
    expect(sim.commands.move(before, 60, 10)).toBeNull();
    const moved = sim.structures[0];
    expect([moved.pos.x, moved.pos.z]).toEqual([60, 10]);
    expect(moved.def.settings.panels).toBe(2);
    expect(moved.uplink).toBe(uplink);
    expect([moved.custom.name, moved.custom.callsign]).toEqual([name, short]);
    expect(sim.state.budget).toBe(after);
    expect(after).toBeLessThan(budget); // the terminal was bought once, and not again
  });

  it('refuses a spot it could not be placed on, and leaves it where it was', () => {
    sim.commands.place('radar_s', 30, 0);
    sim.commands.place('rf', 70, 0);
    const radar = sim.structures.find((s) => s.def.id === 'radar_s');
    expect(sim.commands.move(radar, 71, 1)).toMatch(/Too close/);
    expect(sim.structures.find((s) => s.def.id === 'radar_s').pos.x).toBe(30);
  });
});

describe('removing people', () => {
  it('lets the sell tool take away a group clicked on the map', () => {
    expect(sim.commands.placePeople(40, 0, 10, 'open')).toBeNull();
    expect(sim.people).toHaveLength(1);
    sim.commands.sell(40.5, 0.5);
    expect(sim.people).toHaveLength(0);
  });
});

describe('up to three systems on a vehicle', () => {
  it('puts systems placed by a parked vehicle onto it, up to three, sharing a strike, and sells them together', () => {
    expect(sim.commands.place('radar_a800', 30, 0, undefined, 'patria')).toBeNull();
    expect(sim.commands.place('gun_hmg', 31, 0)).toBeNull();
    expect(sim.commands.place('jammer_s', 30, 1)).toBeNull();
    const crew = sim.structures;
    expect(crew).toHaveLength(3);
    expect(new Set(crew.map((s) => s.platform)).size).toBe(1);
    expect(crew.filter((s) => s.def.rider)).toHaveLength(2);
    for (const s of crew) expect(s.def.vehicle).toBe('patria');
    expect(sim.commands.place('rf', 30, 2)).toMatch(/Too close/); // a fourth does not fit
    sim.commands.sell(30, 0);
    expect(sim.structures).toHaveLength(0);
  });

  it('keeps a vehicle and what it carries together through a save', () => {
    sim.commands.place('radar_a800', 30, 0, undefined, 'hilux');
    sim.commands.place('gun_hmg', 31, 0);
    const spec = JSON.parse(JSON.stringify(sim.currentLaydown()));
    expect(sim.commands.loadLaydown(spec, '1')).toBeNull();
    const crew = sim.structures;
    expect(crew).toHaveLength(2);
    expect(crew[0].platform).toBe(crew[1].platform);
    expect(crew.filter((s) => s.def.rider)).toHaveLength(1);
  });

  it('carries extra systems in a patrol column, at most three a vehicle and one heavy', () => {
    const column = [{ vehicle: 'patria', system: 'radar_a800', also: ['gun_hmg', 'jammer_s'], gap: 30, side: 0 }];
    expect(columnProblem(column)).toBeNull();
    expect(columnProblem([{ ...column[0], also: ['gun_hmg', 'jammer_s', 'rf'] }])).toMatch(/3 systems at most/);
    expect(columnProblem([{ vehicle: 'patria', system: 'missile_paladin', also: ['radar_giraffe'], gap: 0 }])).toMatch(/one heavy/);
    expect(columnProblem([{ vehicle: 'foot', system: 'rf_rfpatrol', also: ['gun_shotgun'], gap: 0 }])).toBeNull(); // two hand-held systems
    expect(columnProblem([{ vehicle: 'foot', system: 'rf_rfpatrol', also: ['gun_shotgun', 'rf_chuyka'], gap: 0 }])).toMatch(/2 systems at most/);
    expect(columnProblem([{ vehicle: 'patria', system: 'missile_rr', gap: 0 }], 'dismounted')).toMatch(/does not take/);
    expect(columnProblem([{ vehicle: 'foot', system: 'rf_rfpatrol', gap: 0, soldier: 1 }], 'mounted')).toMatch(/does not take/);
    expect(sim.commands.setPatrol(square(20, 20, 10), column)).toBeNull();
    const escorts = sim.getPatrol().escorts.map(({ s }) => s);
    expect(escorts.map((s) => s.def.id)).toEqual(['radar_a800', 'gun_hmg', 'jammer_s']);
    expect(new Set(escorts.map((s) => s.platform)).size).toBe(1);
  });

  it('reads an older save’s vehicle id as the THeMIS', () => {
    const spec = { structures: [{ id: 'jammer', x: 30, z: 0, vehicle: 'mule' }], fusionUplinks: [], fusionCell: 'B8' };
    expect(sim.commands.loadLaydown(spec, '1')).toBeNull();
    expect(sim.structures[0].def.vehicle).toBe('themis');
  });
});
