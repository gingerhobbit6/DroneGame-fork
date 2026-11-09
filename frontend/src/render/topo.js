// Topography from a real world's own height grid: height colours, hill shading and contour lines. No DOM, and no download, so it works offline.

import { clamp } from '../sim/world.js';

const WATER = 4, WOOD = 1, BUILDING = 2;
const MAX_CONTOUR_LEVELS = 2_000_000, MAX_CONTOUR_SEGMENTS = 1_000_000, MAX_CONTOUR_LABELS = 50_000;
// The same colours as .topo-legend in map-panel.css.
const RAMP = [[0, 120, 170, 110], [0.3, 190, 210, 130], [0.55, 235, 220, 150], [0.8, 205, 160, 105], [1, 165, 120, 90]];

// Lowest and highest dry ground, in metres above sea level.
export function heightRange({ ground, cover, geo }) {
  let low = Infinity, high = -Infinity;
  for (let k = 0; k < ground.length; k++) {
    if (cover[k] === WATER) continue;
    if (ground[k] < low) low = ground[k];
    if (ground[k] > high) high = ground[k];
  }
  if (low === Infinity) return { low: 0, high: 0 }; // all water
  return { low: low + geo.H0, high: high + geo.H0 };
}

export const contourStep = ({ low, high }) => (high - low < 60 ? 5 : high - low < 400 ? 10 : 25);

export function rampColour(t) {
  const at = clamp(t, 0, 1);
  const upper = RAMP.findIndex(([stop]) => stop >= at), b = RAMP[Math.max(upper, 1)], a = RAMP[Math.max(upper, 1) - 1];
  const mix = (at - a[0]) / (b[0] - a[0]);
  return [1, 2, 3].map((c) => a[c] + (b[c] - a[c]) * mix);
}

// The ramp at 1,024 steps, worked out once: working it out for each of a real world's 7 million posts took most of a second.
const STEPS = 1024, TABLE = new Float32Array(STEPS * 3);
for (let k = 0; k < STEPS; k++) TABLE.set(rampColour(k / (STEPS - 1)), 3 * k);

// One RGBA pixel per grid post, north at the top.
export function topoPixels(data) {
  const { N, cell, ground, cover, geo } = data, range = heightRange(data), span = Math.max(range.high - range.low, 1);
  const out = new Uint8ClampedArray(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i, o = k * 4;
      if (cover[k] === WATER) { out[o] = 150; out[o + 1] = 200; out[o + 2] = 235; out[o + 3] = 255; continue; }
      // light from the north-west, as on printed maps, with slopes doubled so gentle ground still reads
      const gx = (ground[j * N + Math.min(i + 1, N - 1)] - ground[j * N + Math.max(i - 1, 0)]) / cell;
      const gz = (ground[Math.min(j + 1, N - 1) * N + i] - ground[Math.max(j - 1, 0) * N + i]) / cell;
      const shade = clamp((1 + gx + gz) / Math.hypot(gx, gz, 1), 0.55, 1.25);
      const c = 3 * Math.round(clamp((ground[k] + geo.H0 - range.low) / span, 0, 1) * (STEPS - 1));
      let r = TABLE[c], g = TABLE[c + 1], b = TABLE[c + 2];
      if (cover[k] === WOOD) { r *= 0.72; g *= 0.86; b *= 0.68; }
      if (cover[k] === BUILDING) { r = 95; g = 90; b = 88; }
      out[o] = r * shade; out[o + 1] = g * shade; out[o + 2] = b * shade; out[o + 3] = 255;
    }
  }
  return out;
}

// Lidar picks up every bank and ditch, which would make contours fizz, so they follow a lightly smoothed copy.
function smoothed(ground, N) {
  const out = new Float32Array(ground.length);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let b = Math.max(j - 1, 0); b <= Math.min(j + 1, N - 1); b++) for (let a = Math.max(i - 1, 0); a <= Math.min(i + 1, N - 1); a++) sum += ground[b * N + a];
      out[j * N + i] = sum / ((Math.min(j + 1, N - 1) - Math.max(j - 1, 0) + 1) * (Math.min(i + 1, N - 1) - Math.max(i - 1, 0) + 1));
    }
  }
  return out;
}

// Contours by marching squares. Segments are flat [x1, z1, x2, z2...] lists in metres from the world's north-west corner.
// Every fifth line is an index line, and those carry the height labels.
export function contourLines(data) {
  const { N, cell, cover, geo } = data, ground = smoothed(data.ground, N), step = contourStep(heightRange(data));
  const minor = [], index = [], labels = [], labelled = new Set();
  const LABEL_SPACING = 1500;
  let levels = 0, segments = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const k = j * N + i;
      if (cover[k] === WATER || cover[k + 1] === WATER || cover[k + N] === WATER || cover[k + N + 1] === WATER) continue;
      const a = ground[k] + geo.H0, b = ground[k + 1] + geo.H0, c = ground[k + N + 1] + geo.H0, d = ground[k + N] + geo.H0;
      if (a === b && b === c && c === d) continue;
      const top = Math.max(a, b, c, d);
      for (let level = Math.ceil(Math.min(a, b, c, d) / step) * step; level <= top; level += step) {
        if (++levels > MAX_CONTOUR_LEVELS) throw new Error('This map has too many contour levels to draw.');
        const points = [];
        if (a < level !== b < level) points.push(i + (level - a) / (b - a), j);
        if (b < level !== c < level) points.push(i + 1, j + (level - b) / (c - b));
        if (c < level !== d < level) points.push(i + 1 - (level - c) / (d - c), j + 1);
        if (d < level !== a < level) points.push(i, j + 1 - (level - d) / (a - d));
        const major = level % (step * 5) === 0, list = major ? index : minor;
        for (let p = 0; p + 3 < points.length; p += 4) {
          if (++segments > MAX_CONTOUR_SEGMENTS) throw new Error('This map has too many contour lines to draw.');
          list.push(points[p] * cell, points[p + 1] * cell, points[p + 2] * cell, points[p + 3] * cell);
        }
        if (!major || points.length < 4) continue;
        const x = points[0] * cell, z = points[1] * cell, slot = `${level}:${Math.floor(x / LABEL_SPACING)}:${Math.floor(z / LABEL_SPACING)}`;
        if (labelled.has(slot)) continue;
        labelled.add(slot);
        if (labels.length >= MAX_CONTOUR_LABELS) throw new Error('This map has too many contour labels to draw.');
        const angle = Math.atan2(points[3] - points[1], points[2] - points[0]);
        labels.push({ level, x, z, angle: angle > Math.PI / 2 ? angle - Math.PI : angle < -Math.PI / 2 ? angle + Math.PI : angle }); // never upside down
      }
    }
  }
  return { step, minor, index, labels };
}
