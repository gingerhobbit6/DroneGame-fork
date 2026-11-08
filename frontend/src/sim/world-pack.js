// Real worlds. A pack holds the grids for a large area, and a world is a 14 km square cut from it around the chosen site.
// A world's identity is one short string, so saved laydowns and runs carry it the same way as a terrain seed.

import { WORLD } from './config/index.js';
import { makeWorld, pickMasts } from './world.js';
import { hashSeed, mulberry32 } from './rng.js';
import { gridRef } from './grids.js';

const ID = /^pack:([0-9a-f]{32}):(\d{6}):(\d{7}):real$/;
const CELL = 20, MAX_N = 4001, WATER = 4; // packs up to 80 km across
const MAX_BUILDINGS = 500000;

export const parseWorldId = (world) => {
  const m = ID.exec(world || '');
  return m ? { hash: m[1], e0: Number(m[2]), n0: Number(m[3]) } : null;
};
export const worldId = (hash, e0, n0) => `pack:${hash.slice(0, 32)}:${String(e0).padStart(6, '0')}:${String(n0).padStart(7, '0')}:real`;
export const worldLabel = (world) => { const id = parseWorldId(world); return id ? `Real map, ${gridRef(id.e0, id.n0)}` : world; };

const finiteList = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);

// Checks everything the rules will trust. Grids are { ground: Float32Array, canopy, bldg, cover: Uint8Array }.
export function parsePack(header, grids, features) {
  const { N, cell, half, east, north, gridsSha256 } = header || {};
  if (!Number.isInteger(N) || N < 701 || N > MAX_N || N % 2 === 0) throw new Error('This pack has an unexpected size.');
  if (cell !== CELL || half !== ((N - 1) * CELL) / 2) throw new Error('This pack has an unexpected grid.');
  if (!Number.isInteger(east) || !Number.isInteger(north) || east % CELL || north % CELL) throw new Error('This pack is not on the national grid.');
  if (!/^[0-9a-f]{64}$/.test(gridsSha256 || '')) throw new Error('This pack has no valid fingerprint.');
  if (!finiteList(header.lonFit, 6) || !finiteList(header.latFit, 6) || !Number.isFinite(header.geoidSeparation)) throw new Error('This pack has no valid position fit.');
  const size = N * N;
  for (const name of ['ground', 'canopy', 'bldg', 'cover']) if (grids[name]?.length !== size) throw new Error('This pack has a grid of the wrong length.');
  // a NaN compares false in the line of sight test, which would silently report a clear line
  for (let i = 0; i < size; i++) if (!Number.isFinite(grids.ground[i])) throw new Error('This pack has a height that is not a number.');
  if (!Array.isArray(features?.buildings) || features.buildings.length > MAX_BUILDINGS || !Array.isArray(features.lines)) throw new Error('This pack has unreadable features.');
  return { hash: gridsSha256.slice(0, 32), header, grids, features };
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
export const BUILT_HALF = 15000; // how far a pack built from the start screen reaches from its middle: the builder's default of 30 km across

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
