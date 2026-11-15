// The fixed raids a defence is scored on, in place of waves that grow until it breaks, and how a raid is scored.
//
// Each raid is one attack of a set size, played as the first wave so the enemy has not adapted, and every team meets the same raid on
// the same seeds. There are two kinds, and every drone in them is a named type, not a generic one:
//
//  NATION raids: what Russia, Iran or China might send at one site for the same money, $1m each (about £750k), mixing their own types
//  with the tactics each is known for or, for China, is expected to use. Groups are timed to ARRIVE in a set order (time on target):
//  a spotter first, then decoys or cheap drones to draw fire, then the strike, then anything that finishes the job. The overall score
//  pools the three, weighted by threat: each counts by the warhead weight it carries, so a raid that brings more harm counts for more.
//  The mixes and timings are ASSUMPTIONS drawn from open reporting, not intelligence:
//   russia  Orlan-10 spotting, Gerbera decoys ahead of Geran-2 salvos, Lancet-3 on what radiates, Molniya-2 and KVN fibre-optic FPVs
//           finishing (as reported from Ukraine since 2023)
//   iran    a Mohajer-6 overhead and massed Shahed-131 then Shahed-136 from several directions (as in the April 2024 attack on Israel)
//   china   no combat record: ASN-301 anti-radar munitions first (its Harpy-derived suppression role), cheap Feilong-300D en masse,
//           Sunflower-200 strikes, CH-901 loitering munitions and Skywalker fibre-optic drones, under an ASN-209 spotter
//
//  TYPE raids: one kind of drone at a time, sized to stretch a defence, to show what each sensing mode is good and bad at.
//
// The score. Every strike drone carries a destructive weight, its damage (config/drones.js). PROTECTION is the share of the raid's
// total weight that never reached the site or a system: 1 - weight(leaked or struck) / weight(launched). 100% stops everything;
// 0% stops nothing, as no defence would. Alongside it: people killed and injured, systems lost (£), site damage (with any spotter's
// bonus), what the enemy lost per £1 of ammunition, how far out threats were first seen and how far out they were stopped.

import { DRONES, WORLD } from '../../src/sim/config/index.js';
import { waveStream } from '../../src/sim/rng.js';
import { mean, ci, paired } from './stats.mjs';

// groups: [{ type, n, from (launch areas, each on its own bearing), arrive (seconds into the raid the first should arrive), gap
// (seconds between launches) }]. A group is launched so that it arrives at `arrive`, from where its type usually starts.
export const RAIDS = [
  { id: 'russia', kind: 'nation', name: 'Russia', what: 'Orlan-10 spotter; 10 Gerbera decoys, then 10 Geran-2; 4 Lancet-3; 40 Molniya-2 and 6 KVN fibre-optic FPVs',
    groups: [{ type: 'orlan10', n: 1, from: 1, arrive: 0 }, { type: 'gerbera', n: 10, from: 3, arrive: 60, gap: 4 }, { type: 'geran2', n: 10, from: 2, arrive: 100, gap: 6 },
      { type: 'lancet3', n: 4, from: 2, arrive: 130, gap: 10 }, { type: 'molniya2', n: 40, from: 4, arrive: 160, gap: 3 }, { type: 'kvn', n: 6, from: 2, arrive: 170, gap: 10 }] },
  { id: 'iran', kind: 'nation', name: 'Iran', what: 'Mohajer-6 spotter; 15 Shahed-131 from three directions, then 17 Shahed-136 from two',
    groups: [{ type: 'mohajer6', n: 1, from: 1, arrive: 0 }, { type: 'shahed131', n: 15, from: 3, arrive: 60, gap: 4 }, { type: 'shahed136', n: 17, from: 2, arrive: 120, gap: 4 }] },
  { id: 'china', kind: 'nation', name: 'China', what: 'ASN-209 spotter; 4 ASN-301 anti-radar; 10 Feilong-300D; 10 Sunflower-200; 6 CH-901; 40 Skywalker fibre-optic',
    groups: [{ type: 'asn209', n: 1, from: 1, arrive: 0 }, { type: 'asn301', n: 4, from: 2, arrive: 30, gap: 5 }, { type: 'feilong300d', n: 10, from: 3, arrive: 90, gap: 4 },
      { type: 'sunflower200', n: 10, from: 2, arrive: 120, gap: 5 }, { type: 'ch901', n: 6, from: 2, arrive: 150, gap: 8 }, { type: 'skywalker', n: 40, from: 3, arrive: 150, gap: 3 }] },
  { id: 'fpv', kind: 'type', name: 'FPV quadcopters', what: '16 seven-inch FPVs from four directions', groups: [{ type: 'fpv7inch', n: 16, from: 4, arrive: 0, gap: 4 }] },
  { id: 'fibre', kind: 'type', name: 'Fibre-optic FPVs', what: '10 KVN fibre-optic FPVs from two directions', groups: [{ type: 'kvn', n: 10, from: 2, arrive: 0, gap: 8 }] },
  { id: 'owa', kind: 'type', name: 'One-way attack', what: '12 Shahed-136 from three directions', groups: [{ type: 'shahed136', n: 12, from: 3, arrive: 0, gap: 4 }] },
  { id: 'jet', kind: 'type', name: 'Jet one-way attack', what: '4 Geran-3 jet-powered Shaheds', groups: [{ type: 'geran3', n: 4, from: 2, arrive: 0, gap: 5 }] },
  { id: 'loiter', kind: 'type', name: 'Loitering munitions', what: '8 Lancet-3 from two directions', groups: [{ type: 'lancet3', n: 8, from: 2, arrive: 0, gap: 8 }] },
  { id: 'cots', kind: 'type', name: 'Commercial drones', what: '8 Mavic 3, 4 last-mile FPVs and 2 Agras T30 bombers', groups: [{ type: 'mavic3', n: 8, from: 4, arrive: 0, gap: 5 }, { type: 'fpvlastmile', n: 4, from: 2, arrive: 20, gap: 6 }, { type: 'agrast30', n: 2, from: 1, arrive: 40, gap: 10 }] },
  { id: 'sead', kind: 'type', name: 'Anti-radar', what: '4 ASN-301 anti-radar munitions', groups: [{ type: 'asn301', n: 4, from: 4, arrive: 0, gap: 5 }] },
];
export const raidById = (id) => RAIDS.find((r) => r.id === id);
export const raidCost = (raid) => raid.groups.reduce((s, g) => s + DRONES[g.type].cost * g.n, 0); // dollars

// How far out a type usually starts, for timing its launch: the map's edge for one flown in from far off, else the middle of its band
function usualStart(def) {
  if (def.launch === 'edge') return WORLD.spawnDist;
  const [near, far] = WORLD.launchBand[def.launch ?? (def.model === 'quad' ? 'short' : 'long')];
  return (near + far) / 2;
}

// The raid's spawns, as a wave's queue: the same for every team on one seed, different from seed to seed.
export function raidQueue(raid, seed) {
  const rng = waveStream(seed, `raid-${raid.id}`), out = [];
  for (const g of raid.groups) {
    const def = DRONES[g.type];
    if (!def) throw new Error(`raid ${raid.id}: unknown drone ${g.type}`);
    const areas = Array.from({ length: g.from }, () => ({ bearing: rng() * Math.PI * 2, dist: rng() }));
    const launch = (g.arrive || 0) - usualStart(def) / def.speed;
    for (let i = 0; i < g.n; i++) {
      const a = areas[i % g.from];
      out.push({ t: launch + i * (g.gap || 0), type: g.type, bearing: a.bearing, dist: a.dist, jitter: (rng() - 0.5) * 0.3, altFrac: rng() });
    }
  }
  const t0 = Math.min(...out.map((q) => q.t));
  return out.map((q) => ({ ...q, t: q.t - t0 })).sort((a, b) => a.t - b.t);
}

const weight = (type) => (DRONES[type].role === 'spotter' ? 0 : DRONES[type].damage);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// One game's figures. null if the game was invalid.
export function scoreGame(r) {
  if (!r || r.invalid) return null;
  const strikes = r.flights.filter((f) => weight(f.type) > 0);
  const total = strikes.reduce((s, f) => s + weight(f.type), 0);
  const through = strikes.filter((f) => f.end === 'leaked' || f.end === 'struck').reduce((s, f) => s + weight(f.type), 0);
  const killed = strikes.filter((f) => f.end === 'killed');
  return {
    protection: total ? 1 - through / total : 1, total, through,
    leaks: strikes.filter((f) => f.end === 'leaked' || f.end === 'struck').length,
    unseen: strikes.length ? strikes.filter((f) => f.seenSite == null).length / strikes.length : 0,
    seenAt: median(strikes.filter((f) => f.seenSite != null).map((f) => f.seenSite)),
    stoppedAt: median(killed.map((f) => f.site)),
    killedPeople: r.killed, injured: r.injured, lostGbp: r.lostValue * 0.75, damage: r.damage,
    radarsLost: r.radarsLost ?? null, radarOn: r.radarOn ?? null,
    shotsGbp: r.shots * 0.75, destroyedGbp: r.destroyed * 0.75, launchedGbp: r.launched * 0.75, capexGbp: r.capex * 0.75,
  };
}

// Protection over several raids on one seed, weighted by threat: the warhead weight stopped over the weight sent, pooled. null if any is missing.
export function pooled(games) {
  if (!games.length || games.some((g) => !g)) return null;
  const total = games.reduce((s, g) => s + g.total, 0);
  return total ? 1 - games.reduce((s, g) => s + g.through, 0) / total : 1;
}

// A team's games on one raid, in seed order, summed up. `games` are scoreGame() results (null for an invalid game).
export function summarise(games) {
  const ok = games.filter(Boolean), col = (k) => ok.map((g) => g[k]).filter((x) => x != null);
  const sum = (k) => ok.reduce((s, g) => s + (g[k] || 0), 0);
  return {
    games: ok.length, invalid: games.length - ok.length,
    protection: mean(col('protection')), ci: ci(col('protection')), leaks: mean(col('leaks')), unseen: mean(col('unseen')),
    seenAt: median(col('seenAt')), stoppedAt: median(col('stoppedAt')), killedPeople: mean(col('killedPeople')), injured: mean(col('injured')),
    radarsLost: mean(col('radarsLost')), radarOn: mean(col('radarOn')),
    lostGbp: mean(col('lostGbp')), damage: mean(col('damage')), capexGbp: mean(col('capexGbp')),
    exchange: sum('shotsGbp') ? sum('destroyedGbp') / sum('shotsGbp') : null, // enemy £ destroyed per £1 of ammunition
  };
}

// The change in protection from a to b on the same seeds, with its 95% interval. a and b: per-seed protection, null where a game was invalid.
export function protectionChange(a, b) {
  const both = a.map((x, i) => [x, b[i]]).filter(([x, y]) => x != null && y != null);
  return paired(both.map(([, y]) => y), both.map(([x]) => x));
}
