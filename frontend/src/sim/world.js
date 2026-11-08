// The world the rules play on: grids of ground height, trees, buildings and cover, and the questions asked of them. It does not
// care where the grids came from. Coordinates are metres in scene axes: x is east, z is south (north is -z), y is height.
//
// grids: { N (points per side), cell (m), R (m from the centre to an edge), ground Float32Array, canopy, bldg and cover Uint8Arrays }

import { TERRAIN, COMMS } from './config/index.js';

export const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const WALL_GAP = 1; // metres a system must stand clear of a wall

// Mark a building on the grids, clearing any trees under it.
export function rasterBox({ N, cell, R, canopy, bldg, cover }, b) {
  const i0 = Math.floor((b.x - b.w / 2 + R) / cell), i1 = Math.ceil((b.x + b.w / 2 + R) / cell);
  const j0 = Math.floor((b.z - b.d / 2 + R) / cell), j1 = Math.ceil((b.z + b.d / 2 + R) / cell);
  for (let j = clamp(j0, 0, N - 1); j <= clamp(j1, 0, N - 1); j++) {
    for (let i = clamp(i0, 0, N - 1); i <= clamp(i1, 0, N - 1); i++) {
      const k = j * N + i;
      bldg[k] = Math.max(bldg[k], Math.min(255, Math.round(b.h)));
      canopy[k] = 0; cover[k] = 2;
    }
  }
}

// Cell towers: a few masts on high ground, spread out around the site, picked from random candidates above minGround.
export function pickMasts({ N, cell, R, ground }, rng, minGround) {
  const towers = [];
  const candidates = Array.from({ length: 60 }, () => {
    const a = rng() * Math.PI * 2, d = 3500 + rng() * 3500;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    return { x, z, h: ground[clamp(Math.round((z + R) / cell), 0, N - 1) * N + clamp(Math.round((x + R) / cell), 0, N - 1)] };
  }).filter((c) => c.h > minGround).sort((a, b) => b.h - a.h);
  for (const c of candidates) {
    if (towers.length >= COMMS.towers) break;
    if (towers.every((t) => Math.hypot(t.x - c.x, t.z - c.z) > 3000)) towers.push({ x: c.x, z: c.z, ground: c.h });
  }
  return towers;
}

export function makeWorld({ seed, N, cell, R, ground, canopy, bldg, cover, buildings, lines, towers, station, geo = null }) {
  const at = (i, j) => j * N + i;

  function groundAt(x, z) { // bilinear
    const fx = clamp((x + R) / cell, 0, N - 1.001), fz = clamp((z + R) / cell, 0, N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = ground[at(i, j)], b = ground[at(i + 1, j)], c = ground[at(i, j + 1)], d = ground[at(i + 1, j + 1)];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  const cellOf = (x, z) => at(clamp(Math.round((x + R) / cell), 0, N - 1), clamp(Math.round((z + R) / cell), 0, N - 1));

  // Line of sight between two points (metres). Returns { clear, blocker, canopy } where canopy is the metres of the
  // path inside tree canopy. Trees close to the start (a sensor or weapon) are assumed cleared.
  function los(ax, ay, az, bx, by, bz, endClear = TERRAIN.endClear) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const lenH = Math.hypot(dx, dz);
    const n = Math.max(2, Math.ceil(lenH / cell));
    const step = lenH / n;
    let canopyLen = 0;
    for (let s = 1; s < n; s++) {
      const t = s / n;
      const x = ax + dx * t, z = az + dz * t, y = ay + dy * t;
      const g = groundAt(x, z), k = cellOf(x, z);
      if (y < g + bldg[k]) return { clear: false, blocker: bldg[k] ? 'building' : 'terrain', canopy: canopyLen };
      const c = canopy[k];
      if (c && y < g + c && t * lenH > endClear) canopyLen += step;
    }
    return { clear: true, blocker: null, canopy: canopyLen };
  }

  // Whether a point is on a building. A real map has true outlines, so a gap between houses counts as free even though its 20 m grid
  // cell is marked. Other worlds only have the grid.
  function onBuilding(x, z) {
    if (!bldg[cellOf(x, z)]) return false;
    if (!geo || !buildings.length) return true;
    return !!buildingAt(x, z);
  }
  // Buildings filed by 100 m square on first use: a real map can hold half a million, too many to scan for every point asked about.
  // Each is filed under every square its footprint can reach, in list order, so the first match is the one a full scan finds.
  let filed = null;
  const square = (x, z) => (Math.floor(x / 100) + 1000) * 2000 + Math.floor(z / 100) + 1000;
  function fileBuildings() {
    filed = new Map();
    for (const b of buildings) {
      const r = Math.hypot(b.w, b.d) / 2 + WALL_GAP;
      for (let x = Math.floor((b.x - r) / 100); x <= Math.floor((b.x + r) / 100); x++) {
        for (let z = Math.floor((b.z - r) / 100); z <= Math.floor((b.z + r) / 100); z++) {
          const k = square(x * 100, z * 100);
          if (!filed.has(k)) filed.set(k, []);
          filed.get(k).push(b);
        }
      }
    }
  }
  function buildingAt(x, z) {
    if (!filed) fileBuildings();
    return (filed.get(square(x, z)) ?? []).find((b) => {
      const dx = x - b.x, dz = z - b.z, c = Math.cos(b.angle || 0), s = Math.sin(b.angle || 0);
      return Math.abs(dx * c - dz * s) <= b.w / 2 + WALL_GAP && Math.abs(dx * s + dz * c) <= b.d / 2 + WALL_GAP;
    }) || null;
  }

  return {
    seed, N, cell, R, ground, canopy, bldg, cover, buildings, lines, towers, station, geo, // geo: where a real world is on the grid, or null
    groundAt, cellOf, los, onBuilding, buildingAt,
    coverAt: (x, z) => cover[cellOf(x, z)],
    canopyAt: (x, z) => canopy[cellOf(x, z)],
    bldgAt: (x, z) => bldg[cellOf(x, z)],
    slope: (x, z) => {
      const e = cell;
      return Math.hypot(groundAt(x + e, z) - groundAt(x - e, z), groundAt(x, z + e) - groundAt(x, z - e)) / (2 * e);
    },
  };
}
