// Real worlds. A pack holds the grids for a large area, and a world is a square cut from it around the chosen site, 2 x WORLD.radius across.
// A world's identity is one short string, so saved laydowns and runs carry it the same way as a terrain seed.

import { WORLD } from './config/index.js';
import { makeWorld, pickMasts } from './world.js';
import { hashSeed, mulberry32 } from './rng.js';
import { gridRef, onGrid, toLatLon } from './grids.js';

const ID = /^pack:([0-9a-f]{32}):(\d{6}):(\d{7}):real$/;
const CELL = 20, MAX_N = 4001, WATER = 4; // 80 km at most
const MAX_BUILDINGS = 500000, MAX_HEIGHT = 20000; // metres: no ground is that high or deep, so anything past it is damage
const MAX_SIDE = 1000; // metres: the largest building in a real pack so far is 577 m long, and a vast one would wall off the map
export const MAX_LINES = 3000, MAX_LINE_POINTS = 30000; // each retained span becomes three rendered conductors
const MAX_BORDER_RINGS = 1000, MAX_BORDER_POINTS = 50000;
const MAX_ROADS = 150000, MAX_ROAD_POINTS = 400000, MAX_NAMES = 25000;

export const parseWorldId = (world) => {
  const m = ID.exec(world || '');
  return m ? { hash: m[1], e0: Number(m[2]), n0: Number(m[3]) } : null;
};
export const worldId = (hash, e0, n0) => `pack:${hash.slice(0, 32)}:${String(e0).padStart(6, '0')}:${String(n0).padStart(7, '0')}:real`;
export const worldLabel = (world) => { const id = parseWorldId(world); return id ? `Real map, ${gridRef(id.e0, id.n0)}` : world; };

const finiteList = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
const building = (b) => finiteList(b, 6) && [b[2], b[3], b[4]].every((v) => v >= 0 && v <= MAX_SIDE); // x, z, width, depth, height, angle
const path = (points) => Array.isArray(points) && points.every((p) => finiteList(p, 2));
const road = (r, remaining) => Array.isArray(r) && r.length === 2 && typeof r[0] === 'string' && r[0].length <= 64 &&
  Array.isArray(r[1]) && r[1].length <= remaining && path(r[1]); // class, points
const name = (n) => Array.isArray(n) && n.length === 5 && typeof n[0] === 'string' && n[0].length <= 80 &&
  typeof n[1] === 'string' && n[1].length <= 64 && typeof n[2] === 'string' && n[2].length <= 32 &&
  Number.isFinite(n[3]) && Number.isFinite(n[4]); // text, kind, height, x, z
// A pack's data licences go on screen with the map, and an imported file can put anything there: only the ones the map shows, as text, cut short.
const CREDITS = ['satellite', 'osmap', 'lidar', 'heights', 'names'], MAX_CREDIT = 600;
const cleanCredits = (c) => Object.fromEntries(CREDITS.filter((k) => typeof c?.[k] === 'string').map((k) => [k, c[k].slice(0, MAX_CREDIT)]));

// Checks everything the rules will trust. Grids are { ground: Float32Array, canopy, bldg, cover: Uint8Array }.
export function parsePack(header, grids, features) {
  const { N, cell, half, east, north, gridsSha256 } = header || {};
  if (!Number.isInteger(N) || N > MAX_N || N % 2 === 0) throw new Error('This pack has an unexpected size.');
  if (N < (2 * WORLD.radius) / CELL + 1) throw new Error(`This pack is smaller than a ${(2 * WORLD.radius) / 1000} km world. Build it again at a larger size.`);
  if (cell !== CELL || half !== ((N - 1) * CELL) / 2) throw new Error('This pack has an unexpected grid.');
  if (!Number.isInteger(east) || !Number.isInteger(north) || east % CELL || north % CELL || !onGrid(east, north)) throw new Error('This pack is not on the national grid.');
  if (!/^[0-9a-f]{64}$/.test(gridsSha256 || '')) throw new Error('This pack has no valid fingerprint.');
  if (!finiteList(header.lonFit, 6) || !finiteList(header.latFit, 6) || !Number.isFinite(header.geoidSeparation)) throw new Error('This pack has no valid position fit.');
  const geo = { e0: east, n0: north, packEast: east, packNorth: north, lonFit: header.lonFit, latFit: header.latFit };
  for (const dx of [-half, 0, half]) for (const dy of [-half, 0, half]) {
    const got = latLonOf(geo, dx, dy), expected = toLatLon(east + dx, north + dy);
    if (![got.lat, got.lon, expected.lat, expected.lon].every(Number.isFinite) ||
        Math.abs(got.lat - expected.lat) > 0.2 || Math.abs(got.lon - expected.lon) > 0.2) throw new Error('This pack has no valid position fit.');
  }
  const size = N * N;
  for (const name of ['ground', 'canopy', 'bldg', 'cover']) if (grids[name]?.length !== size) throw new Error('This pack has a grid of the wrong length.');
  // a NaN compares false in the line of sight test, which would silently report a clear line
  for (let i = 0; i < size; i++) if (!(Math.abs(grids.ground[i]) < MAX_HEIGHT)) throw new Error('This pack has a height that is not a real one.');
  if (!Array.isArray(features?.buildings) || features.buildings.length > MAX_BUILDINGS || !Array.isArray(features.lines) || features.lines.length > MAX_LINES) throw new Error('This pack has unreadable features.');
  let linePoints = 0;
  for (const line of features.lines) {
    if (!Array.isArray(line) || line.length > MAX_LINE_POINTS - linePoints || !path(line)) throw new Error('This pack has unreadable features.');
    linePoints += line.length;
  }
  if (!features.buildings.every(building)) throw new Error('This pack has unreadable features.');
  if (features.roads !== undefined) {
    if (!Array.isArray(features.roads) || features.roads.length > MAX_ROADS) throw new Error('This pack has unreadable features.');
    let roadPoints = 0;
    for (const item of features.roads) {
      if (!road(item, MAX_ROAD_POINTS - roadPoints)) throw new Error('This pack has unreadable features.');
      roadPoints += item[1].length;
    }
  }
  if (features.names !== undefined && (!Array.isArray(features.names) || features.names.length > MAX_NAMES || !features.names.every(name))) {
    throw new Error('This pack has unreadable features.');
  }
  if (features.beyond !== undefined) {
    if (!Array.isArray(features.beyond) || features.beyond.length > MAX_BORDER_RINGS) throw new Error('This pack has unreadable features.');
    let borderPoints = 0;
    for (const ring of features.beyond) {
      if (!Array.isArray(ring) || ring.length < 3 || ring.length > MAX_BORDER_POINTS - borderPoints || !path(ring) ||
          ring.some(([x, z]) => Math.abs(x) > half + CELL || Math.abs(z) > half + CELL)) throw new Error('This pack has unreadable features.');
      borderPoints += ring.length;
    }
  }
  return { hash: gridsSha256.slice(0, 32), header: { ...header, credits: cleanCredits(header.credits) }, grids, features };
}

const rowOf = (pack, n) => (pack.header.north + pack.header.half - n) / CELL;
const colOf = (pack, e) => (e - (pack.header.east - pack.header.half)) / CELL;

// Why a world can't be centred here, or null if it can. A site snaps to a 20 m post, so a cut needs no resampling.
export function siteProblem(pack, e0, n0) {
  if (e0 % CELL || n0 % CELL) return 'The site must be on a 20 m post.';
  const room = pack.header.half - WORLD.radius;
  if (Math.abs(e0 - pack.header.east) > room || Math.abs(n0 - pack.header.north) > room) return 'That is too near the edge of this map pack for a full world.';
  if (pack.grids.cover[rowOf(pack, n0) * pack.header.N + colOf(pack, e0)] === WATER) return 'The site cannot be on water.';
  return null;
}

export const snap = (v) => Math.round(v / CELL) * CELL;
export const BUILT_HALF = 35000; // how far a pack built from the start screen reaches from its middle: the builder's default of 70 km across

// Longitude and latitude of a point in metres east and north of the site, from the pack's fit.
export function latLonOf(geo, eastM, northM) {
  const x = (geo.e0 + eastM - geo.packEast) / 10000, y = (geo.n0 + northM - geo.packNorth) / 10000;
  const poly = (c) => c[0] + c[1] * x + c[2] * y + c[3] * x * x + c[4] * x * y + c[5] * y * y;
  return { lon: poly(geo.lonFit), lat: poly(geo.latFit) };
}

export function cutWorld(pack, e0, n0, world = worldId(pack.hash, e0, n0)) {
  const problem = siteProblem(pack, e0, n0);
  if (problem) throw new Error(problem);
  const { header, grids: g, features } = pack;
  const R = WORLD.radius, N = (2 * R) / CELL + 1, row0 = rowOf(pack, n0 + R), col0 = colOf(pack, e0 - R);
  const H0 = g.ground[rowOf(pack, n0) * header.N + colOf(pack, e0)];
  const grids = { N, cell: CELL, R, ground: new Float32Array(N * N), canopy: new Uint8Array(N * N), bldg: new Uint8Array(N * N), cover: new Uint8Array(N * N) };
  for (let j = 0; j < N; j++) {
    const from = (row0 + j) * header.N + col0;
    for (let i = 0; i < N; i++) grids.ground[j * N + i] = g.ground[from + i] - H0;
    grids.canopy.set(g.canopy.subarray(from, from + N), j * N);
    grids.bldg.set(g.bldg.subarray(from, from + N), j * N);
    grids.cover.set(g.cover.subarray(from, from + N), j * N);
  }
  // features are in metres from the pack's middle, so they move to be relative to the site
  const dx = e0 - header.east, dz = header.north - n0;
  const inside = (x, z) => Math.abs(x) <= R && Math.abs(z) <= R;
  const buildings = [];
  for (const [x, z, w, d, h, angle] of features.buildings) if (inside(x - dx, z - dz)) buildings.push({ x: x - dx, z: z - dz, w, d, h, angle });
  const lines = [];
  for (const line of features.lines) {
    const kept = line.map(([x, z]) => ({ x: x - dx, z: z - dz })).filter((p) => inside(p.x, p.z));
    if (kept.length > 1) lines.push(kept);
  }
  const towers = pickMasts(grids, mulberry32(hashSeed(`${world}:masts`)), 2 - H0); // not real masts: OS open data has none
  const geo = { e0, n0, H0, packEast: header.east, packNorth: header.north, lonFit: header.lonFit, latFit: header.latFit, geoidSeparation: header.geoidSeparation, tier: header.tier, lidarHalf: header.lidarHalf || 0 };
  return makeWorld({ seed: world, ...grids, buildings, lines, towers, station: [], geo });
}
