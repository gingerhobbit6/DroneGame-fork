// Range from where a system really stands: the radio path model, the prediction around a spot, and that both agree with play.

import { describe, expect, it } from 'vitest';
import { DRONES, STRUCTURES, WORLD, importFigures, resetAllFigures, setFigure } from '../src/sim/config/index.js';
import { foliageLoss, knifeEdgeLoss, pathLoss, reachFactor } from '../src/sim/propagation.js';
import { pathReport, predictRange, reachFor, reachOnPath, antennaHeight } from '../src/sim/site-range.js';
import { createSimulation } from '../src/sim/simulation.js';
import { unitDef } from '../src/sim/unit-config.js';
import { makeWorld } from '../src/sim/world.js';

const R = 8000, cell = 20, N = Math.round((2 * R) / cell) + 1;

// A flat, open world, with a wall of ground or trees running north to south at some east position.
function worldWith({ ridge = null, trees = null } = {}) {
  const ground = new Float32Array(N * N), canopy = new Uint8Array(N * N), bldg = new Uint8Array(N * N), cover = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -R + i * cell, k = j * N + i;
    if (ridge && Math.abs(x - ridge.x) <= 60) ground[k] = ridge.h;
    if (trees && x >= trees.x && x < trees.x + trees.depth) { canopy[k] = trees.h; cover[k] = 1; }
  }
  return makeWorld({ seed: 't', N, cell, R, ground, canopy, bldg, cover, buildings: [], lines: [], towers: [], station: [] });
}
const EAST = 22; // index of bearing 88 degrees: close to due east, among the 90 bearings
const flat = worldWith();
const on = (y) => ({ x: 0, y, z: 0 });

describe('the formulas', () => {
  it('matches the ITU knife edge at known points', () => {
    expect(knifeEdgeLoss(-1)).toBe(0);
    expect(knifeEdgeLoss(0)).toBeCloseTo(6.03, 1);
    expect(knifeEdgeLoss(1)).toBeCloseTo(13.9, 1);
    expect(knifeEdgeLoss(3)).toBeCloseTo(22.5, 0);
  });

  it('matches Weissberger for trees, joined at 14 m and stopping at 400 m', () => {
    expect(foliageLoss(0, 2.4)).toBe(0);
    expect(foliageLoss(100, 2.4)).toBeCloseTo(25.6, 0);
    expect(foliageLoss(14.001, 2.4)).toBeCloseTo(foliageLoss(14, 2.4), 0);
    expect(foliageLoss(1000, 2.4)).toBe(foliageLoss(400, 2.4));
    expect(foliageLoss(100, 5.8)).toBeGreaterThan(foliageLoss(100, 2.4));
  });

  it('turns 20 dB into a tenth of the range', () => {
    expect(reachFactor(20)).toBeCloseTo(0.1, 5);
    expect(reachFactor(0)).toBe(1);
  });
});

describe('a path over the ground', () => {
  it('costs nothing over a clear open field', () => {
    expect(pathLoss(flat, on(9), { x: 3000, y: 60, z: 0 }, 2.4).loss).toBe(0);
  });

  it('costs more behind a higher ridge, and at a higher frequency', () => {
    const low = worldWith({ ridge: { x: 1000, h: 40 } }), high = worldWith({ ridge: { x: 1000, h: 120 } });
    const to = { x: 3000, y: 20, z: 0 };
    const atLow = pathLoss(low, on(9), to, 2.4).loss, atHigh = pathLoss(high, on(9), to, 2.4).loss;
    expect(atLow).toBeGreaterThan(0);
    expect(atHigh).toBeGreaterThan(atLow);
    expect(pathLoss(high, on(9), to, 5.8).loss).toBeGreaterThan(atHigh);
  });

  it('does not step over a wall one cell wide on a long path', () => {
    // 4 km is 200 cells. With 64 points the path was looked at every 62.5 m, at 1,000 m and 1,062 m, and missed the cell between them.
    const w = worldWith();
    for (let j = 0; j < N; j++) w.ground[j * N + Math.round((1020 + R) / cell)] = 100;
    expect(pathLoss(w, on(9), { x: 4000, y: 20, z: 0 }, 2.4).loss).toBeGreaterThan(20);
  });

  it('is eased by a taller mast', () => {
    const w = worldWith({ ridge: { x: 1000, h: 30 } }), to = { x: 3000, y: 20, z: 0 };
    expect(pathLoss(w, on(40), to, 2.4).loss).toBeLessThan(pathLoss(w, on(5), to, 2.4).loss);
  });

  it('takes whichever is less: through the trees or over them', () => {
    const thin = worldWith({ trees: { x: 500, depth: 40, h: 20 } }), deep = worldWith({ trees: { x: 500, depth: 3000, h: 20 } });
    const low = { x: 4000, y: 12, z: 0 };
    const a = pathLoss(thin, on(9), low, 2.4), b = pathLoss(deep, on(9), low, 2.4);
    expect(a.canopy).toBeGreaterThan(0);
    expect(a.foliage).toBeGreaterThan(0);
    expect(b.loss).toBeGreaterThan(a.loss);
    expect(b.loss).toBeLessThan(foliageLoss(400, 2.4) + b.diffraction); // the signal goes over a deep forest instead
  });
});

describe('the prediction around a spot', () => {
  const fpv = DRONES.fpv;

  it('gives the advertised range in an open field, for every system', () => {
    for (const def of Object.values(STRUCTURES)) {
      if (def.fire === 'guided' || !reachFor(def, fpv)) continue;
      const p = predictRange(def, fpv, flat, 0, 0);
      if (p.limited || def.lowAlt > fpv.alt[0]) continue;
      expect(p.mean / Math.sqrt(p.open ** 2 - p.alt ** 2), def.id).toBeGreaterThan(0.99);
      expect(p.covered, def.id).toBeGreaterThan(0.99);
    }
  });

  it('falls short only towards a ridge, and says which way is worst', () => {
    const w = worldWith({ ridge: { x: 800, h: 150 } });
    const p = predictRange(STRUCTURES.radar, fpv, w, 0, 0);
    expect(p.open).toBe(3100);
    expect(p.max).toBeGreaterThan(3000);
    expect(p.min).toBeLessThan(1000);
    expect(p.first[EAST]).toBeLessThan(1000);
    expect(p.worst).toBeGreaterThan(30);
    expect(p.worst).toBeLessThan(150);
    expect(p.covered).toBeLessThan(0.99);
  });

  it('improves with a taller mast, through the real settings', () => {
    const w = worldWith({ ridge: { x: 1000, h: 13 } });
    const low = predictRange(unitDef('rf', { mount: 3 }), fpv, w, 0, 0, 15);
    const high = predictRange(unitDef('rf', { mount: 15 }), fpv, w, 0, 0, 15);
    expect(high.first[EAST]).toBeGreaterThan(low.first[EAST]);
  });

  it('lets a large RF detector run to the edge of the map, and says so', () => {
    const p = predictRange(STRUCTURES.rf_l, fpv, flat, 0, 0);
    expect(p.open).toBe(14000);
    expect(p.limited).toBe(true);
  });

  it('gives a drone with no radio nothing to hear', () => {
    const p = predictRange(STRUCTURES.rf, DRONES.fw, flat, 0, 0);
    expect(p.open).toBe(0);
    expect(p.mean).toBe(0);
  });

  it('agrees with what detection uses on the same path', () => {
    const w = worldWith({ ridge: { x: 800, h: 150 } });
    const def = STRUCTURES.radar, a = { x: 0, y: w.groundAt(0, 0) + antennaHeight(def), z: 0 };
    const r = pathReport(def, fpv, w, 0, 0, 90);
    const direct = reachOnPath(def, fpv, w, a, { x: r.D, y: fpv.alt[0] / 2 + fpv.alt[1] / 2, z: 0 });
    expect(r.reach).toBeCloseTo(direct, 0);
  });
});

describe('the path report', () => {
  const w = worldWith({ ridge: { x: 800, h: 150 } });

  it('names what is in the way, and how far off', () => {
    const r = pathReport(STRUCTURES.rf, DRONES.fpv, w, 0, 0, 90);
    expect(r.blocker.what).toBe('ground');
    expect(Math.abs(r.blocker.d - 800)).toBeLessThan(100);
    expect(r.loss.diffraction).toBeGreaterThan(0);
    expect(r.reach).toBeLessThan(r.open);
  });

  it('finds nothing in the way on a clear bearing', () => {
    const r = pathReport(STRUCTURES.rf, DRONES.fpv, w, 0, 0, 270);
    expect(r.blocker).toBeNull();
    expect(r.loss.loss).toBe(0);
    expect(r.reach).toBe(r.open);
  });

  it('stops at the edge of the map', () => {
    const r = pathReport(STRUCTURES.rf_l, DRONES.fpv, flat, 7000, 0, 90);
    expect(r.D).toBeLessThanOrEqual(1000);
  });

  it('bounds the path for large but server-accepted figures', () => {
    importFigures({ structures: { camera: { published: 1e12 } }, world: { rangeScale: 1e12 } });
    try {
      expect(STRUCTURES.camera.range).toBe(1e24);
      const r = pathReport(STRUCTURES.camera, DRONES.fpv, flat, 0, 0, 90);
      expect(Number.isFinite(r.D)).toBe(true);
      expect(r.D).toBeLessThanOrEqual(flat.R);
      expect(r.points.length).toBeLessThanOrEqual(121);
    } finally { resetAllFigures(); }
  });

  it('rejects an overflowing range scale before replacing existing figures', () => {
    resetAllFigures();
    setFigure('structures', 'camera', 'published', 3000);
    try {
      expect(() => importFigures({ world: { rangeScale: 1e308 } }, true)).toThrow('not a figures file');
      expect(WORLD.rangeScale).toBe(1);
      expect(STRUCTURES.camera.published).toBe(3000);
    } finally { resetAllFigures(); }
  });

  it('rejects an overflowing range scale through the game command', () => {
    const sim = createSimulation();
    expect(() => sim.commands.setRangeScale(1e308)).toThrow('Range scale');
    expect(WORLD.rangeScale).toBe(1);
    expect(STRUCTURES.camera.range).toBe(STRUCTURES.camera.published);
  });
});
