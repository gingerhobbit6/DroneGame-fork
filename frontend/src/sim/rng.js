// Seeded random numbers. Everything that affects the simulation draws from here, never from Math.random,
// so the same seed + the same laydown gives the same experiment.
//
// Three independent streams, so one never shifts another:
//  - sim: runtime chance (sensor noise, hit rolls)
//  - ids: message identifiers (ULID/UUID)
//  - waves: pre-rolled per wave from (seed, wave number), so a wave's contents don't depend on when it starts

export function hashSeed(value) { // FNV-1a over a string or number
  const s = String(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const streams = { sim: mulberry32(1), ids: mulberry32(2) };

export function seedAll(seed) {
  streams.sim = mulberry32(hashSeed(`${seed}:sim`));
  streams.ids = mulberry32(hashSeed(`${seed}:ids`));
}

export const rand = () => streams.sim();
export const idRand = () => streams.ids();
export const waveStream = (seed, n) => mulberry32(hashSeed(`${seed}:wave:${n}`));

// standard normal from any uniform source
export function gaussFrom(next) {
  let a = 0, b = 0;
  while (!a) a = next();
  while (!b) b = next();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}
export const gauss = () => gaussFrom(rand);

// Fixed epoch so message timestamps are identical between runs of the same scenario.
export const EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
