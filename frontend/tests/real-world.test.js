// Real worlds in the rules: the grid arithmetic, checking and cutting a pack, and a full game on one.

import { beforeEach, describe, expect, it } from 'vitest';
import { bngToWgs84, parseGridRef, squaresAround, wgs84ToBng } from '../src/sim/bng.js';
import { fromLatLon, gridFor, gridRef, onGrid, parsePosition, toLatLon } from '../src/sim/grids.js';
import { lest97ToWgs84, wgs84ToLest97 } from '../src/sim/lest97.js';
import { cutWorld, latLonOf, parsePack, parseWorldId, siteProblem, snap, worldId, worldLabel } from '../src/sim/world-pack.js';
import { createSimulation } from '../src/sim/simulation.js';
import { terrainState } from '../src/sim/terrain.js';
import { hereU } from '../src/sim/units.js';
import { bus, location } from '../src/sim/sapient.js';
import { resetAllFigures, WORLD } from '../src/sim/config/index.js';
import * as THREE from 'three';
import { buildWorldView } from '../src/render/terrain-view.js';
import { CENTRE, fixtureParts, gridsHash } from './support/fixture-pack.js';
import { MIXED, setUp } from './support/scenarios.js';

const { east: E, north: N } = CENTRE;
const HASH = 'a'.repeat(64);
const parts = fixtureParts();
const pack = () => parsePack({ ...parts.header, gridsSha256: HASH }, parts.grids, parts.features);

describe('grid references', () => {
  it.each([
    ['SU 22 66', 422000, 166000], ['su2266', 422000, 166000], ['NN 166 712', 216600, 771200], ['TQ 30000 80000', 530000, 180000],
    ['TF', 500000, 300000], ['HP 61 16', 461000, 1216000], ['SV 90 10', 90000, 10000],
  ])('reads %s', (text, e, n) => { expect(parseGridRef(text)).toEqual({ e, n }); });
  it.each(['', 'S1 22 66', 'SU 2 66', 'SU 223', 'SI 22 66', 'AA 10 10', 'SU 123456 123456', null])('refuses %s', (text) => { expect(parseGridRef(text)).toBeNull(); });
  it('writes them, at each precision, and round trips', () => {
    expect(gridRef(422000, 166000)).toBe('SU 220 660');
    expect(gridRef(216612, 771288, 10)).toBe('NN 16612 71288');
    expect(gridRef(461000, 1216000, 4)).toBe('HP 61 16');
    expect(gridRef(-5, 0)).toBe('off the grid');
    expect(parseGridRef(gridRef(567000, 340000))).toEqual({ e: 567000, n: 340000 });
  });
  // the expected values come from pyproj with OSTN15, the full OS transformation
  it.each([
    [56.79685, -5.0036, 216670.9, 771283.7], [52.6576, 1.7179, 651535.6, 313138.5], [51.4, -1.72, 419574.5, 166811.6],
    [50.07, -5.71, 134626.5, 25472.4], [58.64, -3.07, 337985.3, 972954.0],
  ])('turns GPS position %f, %f into the grid, within about 5 m', (lat, lon, e, n) => {
    const got = wgs84ToBng(lat, lon);
    expect(Math.hypot(got.e - e, got.n - n)).toBeLessThan(6);
  });
  it.each(['51.4, -1.72', '51.4 -1.72', '51.4N 1.72W', '51.4° N, 1.72° W', '51.4n,1.72w'])('reads latitude and longitude %s', (text) => {
    const got = parsePosition(text);
    expect(Math.hypot(got.e - 419574.5, got.n - 166811.6)).toBeLessThan(6); // the same pyproj figure as above
  });
  it('takes the other side of the equator and of Greenwich from the letters', () => {
    expect(parsePosition('52.6576 1.7179 E')).toEqual(wgs84ToBng(52.6576, 1.7179));
    expect(parsePosition('33.9 S, 18.4 E')).toEqual(wgs84ToBng(-33.9, 18.4));
  });
  it.each([
    ['422000 166000', 422000, 166000], ['422000, 166000', 422000, 166000], ['E 422000 N 166000', 422000, 166000], ['422000E 166000N', 422000, 166000],
    ['90000.5 7000.25', 90000.5, 7000.25], ['461000 1216000', 461000, 1216000],
  ])('reads eastings and northings %s', (text, e, n) => { expect(parsePosition(text)).toEqual({ e, n }); });
  it('still reads grid references', () => { expect(parsePosition('SU 220 660')).toEqual({ e: 422000, n: 166000 }); });
  it.each([
    '', null, 'hello', '51.4', '51.4, ', '220 660', // the last has no square letters, so it must not pass as metres
    '51.4N 1.72W extra', '1.72W 51.4N', '166000N 422000E', '51,4 -1,72',
    '-51.4 N, 1.72 W', '51.4, -1.72 W', // a sign and a letter together could mean either side
    '95, -1.72', '51.4, 358', // out of range, though 358 would wrap round to Great Britain
  ])('cannot read %s', (text) => { expect(parsePosition(text)).toBeNull(); });
  it.each([
    ['48.85, 2.35'], ['40, -100'], ['-1.72, 51.4'], ['33.9 S, 18.4 E'], ['90, 0'], // latitude and longitude elsewhere, or the wrong way round
    ['700000 100000'], ['100000 1300000'], ['8000000 100000'],
  ])('reads %s as off the grid', (text) => {
    const { e, n } = parsePosition(text);
    expect(onGrid(e, n)).toBe(false);
  });
  it.each([[56.79685, -5.0036], [52.6576, 1.7179], [50.07, -5.71], [58.64, -3.07], [60.8, -0.8], [49.9, -6.3]])('turns the grid back into GPS position %f, %f', (lat, lon) => {
    const { e, n } = wgs84ToBng(lat, lon), back = bngToWgs84(e, n);
    expect(Math.abs(back.lat - lat)).toBeLessThan(1e-6);
    expect(Math.abs(back.lon - lon)).toBeLessThan(1e-6);
  });
  it('finds the 100 km squares a map would touch, as the builder does', () => {
    expect(squaresAround(422000, 166000, 15000)).toEqual(['SU']);
    expect(squaresAround(400000, 200000, 15000)).toEqual(['SO', 'SP', 'ST', 'SU']);
    expect(squaresAround(5000, 5000, 15000)).toEqual(['SV']); // the other three are off the grid
  });
  // the expected values come from pyproj, EPSG:3301
  it.each([
    ['Tapa', 59.2606, 25.9587, 611707.6, 6570775.9], ['Narva', 59.3772, 28.1903, 738046.72, 6589571.88], ['Tallinn', 59.437, 24.7536, 542763.37, 6589036.28],
    ['Saaremaa', 58.25, 22.5, 411930.71, 6457563.99], ['Valga', 57.78, 26.03, 620762.83, 6406059.12],
  ])('puts %s on the Estonian grid, and back again', (_, lat, lon, e, n) => {
    const got = wgs84ToLest97(lat, lon), back = lest97ToWgs84(e, n);
    expect(Math.hypot(got.e - e, got.n - n)).toBeLessThan(0.05);
    expect(Math.abs(back.lat - lat)).toBeLessThan(1e-6);
    expect(Math.abs(back.lon - lon)).toBeLessThan(1e-6);
  });
  it('tells which grid a position is on from the position alone', () => {
    expect(onGrid(611700, 6570700)).toBe(true);
    expect(onGrid(800000, 6570700)).toBe(false); // past Estonia
    expect(onGrid(611700, 2000000)).toBe(false); // between the two grids
    expect(gridRef(611789, 6570789)).toBe('E 611700 N 6570700');
    expect(gridRef(611789, 6570789, 10)).toBe('E 611789 N 6570789');
    expect(gridRef(800000, 6570700)).toBe('off the grid');
    expect(gridRef(422000, 166000)).toBe('SU 220 660');
    expect(toLatLon(611708, 6570776).lon).toBeCloseTo(25.9587, 4);
    expect(toLatLon(422000, 166000).lon).toBeCloseTo(-1.71, 1);
    expect(gridFor(6570700)).toBe(wgs84ToLest97);
    expect(gridFor(166000)).toBe(wgs84ToBng);
  });
  it('puts a GPS position on the grid that covers it, and refuses the rest', () => {
    expect(fromLatLon(59.2606, 25.9587)).toEqual(wgs84ToLest97(59.2606, 25.9587));
    expect(fromLatLon(51.39, -1.68)).toEqual(wgs84ToBng(51.39, -1.68));
    for (const [lat, lon] of [[60.17, 24.94], [56.95, 24.1], [55.75, 37.62], [48.85, 2.35], [-33.9, 18.4]]) { // Helsinki, Riga, Moscow, Paris, Cape Town
      const { e, n } = fromLatLon(lat, lon);
      expect(onGrid(e, n)).toBe(false);
    }
  });
  it.each([
    ['59.2606, 25.9587', 611708, 6570776], ['59.2606N 25.9587E', 611708, 6570776], ['611708 6570776', 611708, 6570776],
    ['6570776 611708', 611708, 6570776], ['E 611700 N 6570700', 611700, 6570700], ['611700E 6570700N', 611700, 6570700],
  ])('reads the Estonian position %s', (text, e, n) => {
    const got = parsePosition(text);
    expect(Math.hypot(got.e - e, got.n - n)).toBeLessThan(1);
    expect(onGrid(got.e, got.n)).toBe(true);
  });
  it('writes a world on the Estonian grid into the same identity, and reads it back', () => {
    const id = worldId(HASH, 611700, 6570700);
    expect(parseWorldId(id)).toEqual({ hash: 'a'.repeat(32), e0: 611700, n0: 6570700 });
    expect(id.length).toBeLessThanOrEqual(64);
    expect(worldLabel(id)).toBe('Real map, E 611700 N 6570700');
  });
  it('counts a point as on the grid only inside its limits', () => {
    expect(onGrid(0, 0)).toBe(true);
    expect(onGrid(699999, 1299999)).toBe(true);
    for (const [e, n] of [[-1, 0], [0, -1], [700000, 0], [0, 1300000], [NaN, 0]]) expect(onGrid(e, n)).toBe(false);
  });
});

describe('world identity', () => {
  it('fits the save limit, and only an exact match counts', () => {
    const id = worldId(HASH, 422000, 166000);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(parseWorldId(id)).toEqual({ hash: 'a'.repeat(32), e0: 422000, n0: 166000 });
    for (const seed of ['1', 'pack:', `${id}x`, id.replace(':real', ':model'), 'hills', null]) expect(parseWorldId(seed)).toBeNull();
    expect(worldLabel(id)).toBe('Real map, SU 220 660');
    expect(worldLabel('hills')).toBe('hills');
  });
});

describe('checking a pack', () => {
  const header = () => ({ ...parts.header, gridsSha256: HASH });
  it.each([
    ['an even size', { N: 800 }], ['a huge size', { N: 90001 }], ['another cell size', { cell: 10 }], ['a mismatched span', { half: 9000 }],
    ['an off-grid middle', { east: E + 1 }], ['no fingerprint', { gridsSha256: 'x' }], ['no fit', { lonFit: [1] }], ['an infinite fit', { latFit: [Infinity, 0, 0, 0, 0, 0] }],
    ['a huge but finite fit', { lonFit: [1e30, 0, 0, 0, 0, 0] }],
  ])('refuses %s', (_, change) => { expect(() => parsePack({ ...header(), ...change }, parts.grids, parts.features)).toThrow(); });
  it('refuses excessive wire geometry even when a world bypasses the pack parser', () => {
    const points = Array.from({ length: 30001 }, (_, i) => ({ x: i % 2 * 20, z: 0 }));
    expect(() => buildWorldView(new THREE.Scene(), { lines: [points] }, new THREE.MeshStandardMaterial())).toThrow(/power-line points/);
  });
  it('takes a 70 km pack, as the builder now makes, and refuses one over 80 km', () => {
    expect(() => parsePack({ ...header(), N: 3501, half: 35000 }, parts.grids, parts.features)).toThrow(/wrong length/); // past the size check
    expect(() => parsePack({ ...header(), N: 4003, half: 40020 }, parts.grids, parts.features)).toThrow(/unexpected size/);
  });
  it('refuses grids of the wrong length, and unreadable features', () => {
    expect(() => parsePack(header(), { ...parts.grids, bldg: new Uint8Array(3) }, parts.features)).toThrow(/wrong length/);
    expect(() => parsePack(header(), parts.grids, { lines: [] })).toThrow(/features/);
  });
  it.each([NaN, Infinity, 1e6])('refuses a height of %s, which would silently report clear sight lines', (bad) => {
    const ground = parts.grids.ground.slice();
    ground[1234] = bad;
    expect(() => parsePack(header(), { ...parts.grids, ground }, parts.features)).toThrow(/not a real one/);
  });
  it.each([
    ['a building with a missing number', { buildings: [[1, 2, 3, 4, 5]] }], ['a building that is not numbers', { buildings: [[1, 2, 3, 4, 5, 'x']] }],
    ['a line point that is not numbers', { lines: [[[0, 0], [null, 1]]] }], ['a line that is not a list', { lines: [5] }],
  ])('refuses %s', (_, change) => { expect(() => parsePack(header(), parts.grids, { ...parts.features, ...change })).toThrow(/features/); });
});

describe('cutting a world', () => {
  it('puts the site at height zero and the grid in the right place', () => {
    const w = cutWorld(pack(), E, N);
    expect(w.N).toBe(2701);
    expect(w.groundAt(0, 0)).toBe(0);
    expect(w.geo).toMatchObject({ e0: E, n0: N, H0: 100, tier: 'lidar' });
    expect(w.groundAt(0, -4000)).toBeCloseTo(0.3 * 1000); // north is -z, and the hill is to the north
    expect(w.coverAt(5400, 0)).toBe(4);
    expect(w.canopyAt(1000, 1000)).toBe(18);
    expect(w.bldgAt(-1000, 1000)).toBe(9);
  });
  it('moves everything with the site', () => {
    const w = cutWorld(pack(), E + 600, N - 400);
    expect(w.geo.H0).toBe(100);
    expect(w.coverAt(5400 - 600, 0)).toBe(4);
    expect(w.canopyAt(1000 - 600, 1000 - 400)).toBe(18);
    expect(w.buildings).toEqual([{ x: -1600, z: 600, w: 40, d: 30, h: 9, angle: 0.5 }]); // and the far corner one is clipped
    expect(w.lines[0][0]).toEqual({ x: -600, z: 2600 });
  });
  it('refuses a site that does not work', () => {
    const p = pack();
    expect(siteProblem(p, E + 2000, N)).toMatch(/edge/);
    expect(siteProblem(p, E + 10, N)).toMatch(/20 m/);
    expect(siteProblem(p, E, N)).toBeNull();
    const wet = { ...p, grids: { ...p.grids, cover: p.grids.cover.slice() } };
    wet.grids.cover[1400 * 2801 + 1400] = 4;
    expect(siteProblem(wet, E, N)).toMatch(/water/);
    expect(() => cutWorld(p, E + 2000, N)).toThrow(/edge/);
    expect(snap(422013)).toBe(422020);
  });
  it('gives the same masts every time, on land', () => {
    const a = cutWorld(pack(), E, N), b = cutWorld(pack(), E, N);
    expect(a.towers).toEqual(b.towers);
    expect(a.towers.length).toBeGreaterThan(0);
    for (const t of a.towers) expect(t.x).toBeLessThan(5000);
  });
  it('draws one tree on each tree cell, centred on it, so the picture is the grid the rules use', () => {
    const w = cutWorld(pack(), E, N);
    const [trees, houses] = buildWorldView(new THREE.Scene(), w, new THREE.MeshStandardMaterial()).scenery;
    expect(trees.count).toBe(39 * 49); // the fixture wood's cells: x 820 to 1580, z 520 to 1480
    expect(houses.count).toBe(w.buildings.length);
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), cell = 20 / WORLD.metresPerUnit;
    for (let n = 0; n < trees.count; n++) {
      p.setFromMatrixPosition((trees.getMatrixAt(n, m4), m4));
      expect(Math.abs(p.x / cell - Math.round(p.x / cell))).toBeLessThan(1e-6);
      expect(Math.abs(p.z / cell - Math.round(p.z / cell))).toBeLessThan(1e-6);
    }
  });
  it('works out positions from the pack fit', () => {
    const w = cutWorld(pack(), E, N);
    expect(latLonOf(w.geo, 0, 0).lat).toBeCloseTo(51.41, 6);
    expect(latLonOf(w.geo, 0, 10000).lat).toBeCloseTo(51.4999, 3);
  });
  it('hash matches what the file format fingerprints', async () => {
    expect(await gridsHash(parts.grids)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('playing on a real world', () => {
  let sim, id;
  const newSim = () => {
    const s = createSimulation({ seed: '1', terrainSeed: '1' });
    s.registerPack(pack());
    return s;
  };
  beforeEach(() => { resetAllFigures(); sim = newSim(); id = worldId(HASH, E, N); });

  it('refuses a world whose pack is not loaded, changing nothing', () => {
    const other = worldId('b'.repeat(64), E, N);
    expect(sim.commands.deploy('1', other)).toMatch(/not loaded/);
    expect(sim.state).toMatchObject({ started: false, terrainSeed: '1' });
    expect(sim.commands.loadLaydown({ structures: [], fusionUplinks: [], fusionCell: 'B8' }, other)).toMatch(/not loaded/);
    expect(sim.state.terrainSeed).toBe('1');
  });
  it('keeps the active world and most recent pack, and releases older registrations', () => {
    expect(sim.commands.deploy('1', id)).toBeNull();
    const original = pack();
    const older = { ...original, hash: 'b'.repeat(32) };
    const newest = { ...original, hash: 'c'.repeat(32) };
    sim.registerPack(older);
    sim.registerPack(newest);
    expect(sim.commands.deploy('1', worldId(older.hash, E, N))).toMatch(/not loaded/);
    expect(sim.state.terrainSeed).toBe(id);
    expect(sim.commands.deploy('1', worldId(newest.hash, E, N))).toBeNull();
  });
  it('registers its nodes with grid bearings and real positions', () => {
    expect(sim.commands.deploy('1', id)).toBeNull();
    expect(sim.state.started).toBe(true);
    const status = bus.entries.find((e) => e.msg.status_report);
    expect(status.msg.status_report.node_location.y).toBeCloseTo(51.41, 3);
    expect(status.msg.status_report.node_location.z).toBeCloseTo(100 + 48.5 + 80, 0);
    setUp(sim, { seed: '1', laydown: MIXED });
    const reg = bus.entries.find((e) => e.msg.registration?.mode_definition[0].detection_definition?.[0].location_type.range_bearing_units); // a sensor, not the fusion node
    expect(reg.msg.registration.mode_definition[0].detection_definition[0].location_type.range_bearing_datum).toBe('RANGE_BEARING_DATUM_GRID');
  });
  it('plays a game repeatably, and goes back to true north on generated ground', () => {
    const play = () => {
      const s = newSim();
      s.commands.deploy('1', id);
      setUp(s, { seed: '1', laydown: MIXED });
      s.state.warnedWire = true;
      s.commands.startWave();
      let lowest = Infinity;
      for (let n = 0; s.state.waveActive && !s.state.over && n < 20000; n += 20) {
        s.run(20);
        for (const d of s.drones) lowest = Math.min(lowest, d.pos.y - hereU(d.pos.x, d.pos.z));
      }
      return { digest: s.digest(), kills: s.state.kills, lowest, world: s.state.terrainSeed };
    };
    const first = play();
    expect(first.world).toBe(id);
    expect(first.lowest).toBeGreaterThan(0);
    expect(play()).toEqual(first);
    const s = newSim();
    s.commands.deploy('1', id);
    s.commands.deploy('1', 'hills');
    expect(terrainState.data.geo).toBeNull();
    expect(location(0, 0, 10).y).toBe(0);
  }, 120000);
  it('keeps spotters above mountains taller than they fly', () => {
    const tall = pack();
    tall.grids = { ...tall.grids, ground: tall.grids.ground.map((v, k) => (Math.floor(k / 801) < 150 ? 1500 : v)) };
    sim.registerPack(tall);
    sim.commands.deploy('1', id);
    const d = sim.spawnDrone('spotter', -Math.PI / 2, { jitter: 0, altFrac: 0 }); // from the north, over the tall ground
    for (let i = 0; i < 400 && !d.dead; i++) {
      sim.step();
      expect(d.pos.y).toBeGreaterThan(hereU(d.pos.x, d.pos.z));
    }
  });
});
