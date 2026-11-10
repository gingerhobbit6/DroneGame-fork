// What a path over real ground costs a radio signal, on top of the free-space loss already inside a system's open-field range.
// Methods: terrain and buildings by the Bullington construction (ITU-R P.526-15, section 4.5.1, equations 31 and 49 to 57), trees by
// Weissberger's model, and the earth's curve at the standard 4/3 effective radius. Mast height matters because it sets the path's clearance.
// shortcut: no ground reflection lobes or weather. Clearance of the first Fresnel zone stands in for them. Add ITU-R P.528 if long low paths need them.

import { TERRAIN } from './config/index.js';

const GHZ_METRES = 0.299792458;  // wavelength in metres = this / frequency in GHz
const EARTH_M = 8495000;         // 4/3 of the earth's radius, for standard refraction
const MAX_SAMPLES = 256;         // points along one path: every sensor checks every drone on every scan, so this bounds the cost. shortcut: a point for every 20 m cell only out to 5.1 km, further apart beyond, where a roof can fall between two; raise it if long paths over towns matter.
const FOLIAGE_MAX_M = 400;       // Weissberger's model stops here. Beyond it, the signal goes over the trees instead.

// Scratch profile, so that a path allocates no arrays.
const dist = new Float64Array(MAX_SAMPLES), hardTop = new Float64Array(MAX_SAMPLES), softTop = new Float64Array(MAX_SAMPLES);

export const wavelength = (ghz) => GHZ_METRES / ghz;
export const freeSpaceLoss = (metres, ghz) => 20 * Math.log10((4 * Math.PI * metres) / wavelength(ghz));
export const earthBulge = (d, D) => (d * (D - d)) / (2 * EARTH_M);
export const fresnelRadius = (d, D, ghz) => Math.sqrt((wavelength(ghz) * d * (D - d)) / D);

// Loss over one knife edge, from how far the edge reaches into the path (P.526 equation 31).
export const knifeEdgeLoss = (v) => (v <= -0.78 ? 0 : 6.9 + 20 * Math.log10(Math.hypot(v - 0.1, 1) + v - 0.1));

// Loss through trees, with depth in metres (Weissberger).
export function foliageLoss(depth, ghz) {
  if (depth <= 0) return 0;
  const d = Math.min(depth, FOLIAGE_MAX_M), scale = ghz ** 0.284;
  return d <= 14 ? 0.45 * scale * d : 1.33 * scale * d ** 0.588;
}

// Bullington's single equivalent edge for a profile. top holds obstacle heights, with the earth's bulge added (P.526 equations 49 to 57).
function bullington(top, count, D, hA, hB, lambda) {
  let slopeA = -Infinity, slopeB = -Infinity, vMax = -Infinity;
  for (let i = 0; i < count; i++) {
    const d = dist[i], e = D - d, h = top[i];
    slopeA = Math.max(slopeA, (h - hA) / d);
    slopeB = Math.max(slopeB, (h - hB) / e);
    vMax = Math.max(vMax, (h - (hA * e + hB * d) / D) * Math.sqrt((2 * D) / (lambda * d * e)));
  }
  let v = vMax; // the path is clear: the point that comes closest to it
  if (slopeA >= (hB - hA) / D && slopeA + slopeB > 1e-9) { // beyond the horizon: the point where the two steepest lines cross
    const edge = (hB - hA + slopeB * D) / (slopeA + slopeB);
    v = (hA + slopeA * edge - (hA * (D - edge) + hB * edge) / D) * Math.sqrt((2 * D) / (lambda * edge * (D - edge)));
  }
  const loss = knifeEdgeLoss(v);
  return loss + (1 - Math.exp(-loss / 6)) * (10 + (0.02 * D) / 1000);
}

// The loss on the path from a to b ({ x, y, z } in metres), in dB beyond free space. Over the trees or through them, whichever is less.
export function pathLoss(world, a, b, ghz) {
  const dx = b.x - a.x, dz = b.z - a.z, D = Math.hypot(dx, dz);
  const n = Math.min(MAX_SAMPLES, Math.ceil(D / world.cell));
  if (n < 2) return { loss: 0, diffraction: 0, foliage: 0, canopy: 0 };
  const step = D / n;
  let depth = 0;
  for (let s = 1; s < n; s++) {
    const t = s / n, d = t * D, x = a.x + dx * t, z = a.z + dz * t;
    const k = world.cellOf(x, z);
    const ground = world.groundAt(x, z) + earthBulge(d, D);
    const hard = ground + world.bldg[k];
    const trees = d > TERRAIN.endClear ? world.canopy[k] : 0; // trees next to the mast are assumed cleared, as for line of sight
    dist[s - 1] = d; hardTop[s - 1] = hard; softTop[s - 1] = hard + trees;
    const ray = a.y + (b.y - a.y) * t;
    if (trees && ray >= hard && ray < hard + trees) depth += step;
  }
  const lambda = wavelength(ghz);
  const diffraction = bullington(hardTop, n - 1, D, a.y, b.y, lambda);
  const loss = depth ? Math.min(bullington(softTop, n - 1, D, a.y, b.y, lambda), diffraction + foliageLoss(depth, ghz)) : diffraction;
  return { loss, diffraction, foliage: loss - diffraction, canopy: depth };
}

// A system's reach falls with loss the same way for a one-way link, and for a radar that takes the loss both ways over the fourth power of range.
export const reachFactor = (lossDb) => 10 ** (-lossDb / 20);
