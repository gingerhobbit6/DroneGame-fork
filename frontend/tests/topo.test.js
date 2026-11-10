// Height colours and contours from a world's own grid.
import { describe, expect, it } from 'vitest';
import { contourLines, contourStep, heightRange, rampColour, topoPixels } from '../src/render/topo.js';

// A plain slope rising to the north, with water along the east edge.
function slope({ N = 11, cell = 20, H0 = 100, rise = 10, water = false } = {}) {
  const ground = new Float32Array(N * N), cover = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { ground[j * N + i] = (N - 1 - j) * rise; if (water && i === N - 1) { cover[j * N + i] = 4; ground[j * N + i] = -100; } }
  return { N, cell, ground, cover, geo: { H0 } };
}

describe('topography', () => {
  it('measures heights above sea level, and leaves water out', () => {
    expect(heightRange(slope())).toEqual({ low: 100, high: 200 });
    expect(heightRange(slope({ water: true }))).toEqual({ low: 100, high: 200 });
  });
  it('spaces contours by how hilly the world is', () => {
    expect(contourStep({ low: 0, high: 30 })).toBe(5);
    expect(contourStep({ low: 0, high: 200 })).toBe(10);
    expect(contourStep({ low: 0, high: 800 })).toBe(25);
  });
  it('colours lowest to highest, staying inside the ramp', () => {
    expect(rampColour(0)).toEqual([120, 170, 110]);
    expect(rampColour(1)).toEqual([165, 120, 90]);
    expect(rampColour(-5)).toEqual(rampColour(0));
    expect(rampColour(5)).toEqual(rampColour(1));
  });
  it('paints one solid pixel for each post, and water blue', () => {
    const data = slope({ water: true }), px = topoPixels(data);
    expect(px.length).toBe(data.N * data.N * 4);
    expect(px[3]).toBe(255);
    expect([...px.slice((data.N - 1) * 4, (data.N - 1) * 4 + 3)]).toEqual([150, 200, 235]);
  });
  it('runs contours along the slope at the right height, thick on index lines, labelled once in each area', () => {
    const data = slope(), { step, minor, index, labels } = contourLines(data);
    expect(step).toBe(10);
    expect(index.length).toBeGreaterThan(0);
    expect(minor.length).toBeGreaterThan(0);
    // 150 m is 50 m above the low edge, so 5 posts north of it: row 5, which is 100 m from the north edge
    const at150 = labels.find((l) => l.level === 150);
    expect(at150.z).toBeCloseTo(100);
    expect(Math.abs(at150.angle)).toBeCloseTo(0); // level ground along an east-west line, and upright
    expect(labels.filter((l) => l.level === 150)).toHaveLength(1);
    for (let s = 1; s < index.length; s += 2) expect(index[s] % 100).toBeCloseTo(0); // every thick line is a 50 m level
  });
  it('draws no contours across water', () => {
    const data = slope({ water: true }), { minor, index } = contourLines(data);
    for (const list of [minor, index]) for (let s = 0; s < list.length; s += 4) { expect(list[s]).toBeLessThan(data.cell * (data.N - 2) + 0.01); expect(list[s + 2]).toBeLessThan(data.cell * (data.N - 2) + 0.01); }
  });
  it('stops hostile height oscillation before contour geometry exhausts memory', () => {
    const data = slope({ N: 71, H0: 0, rise: 0 });
    for (let j = 0; j < data.N; j++) for (let i = 0; i < data.N; i++) data.ground[j * data.N + i] = i % 2 ? 19998 : -19998;
    expect(() => contourLines(data)).toThrow(/too many contour/);
  });
});
