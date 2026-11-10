// A free-form laydown for the evolutionary search: which systems ride on which vehicle, and which stand out on their own.
//
// GENOME: { R, rot, veh: [[id, ...], ...], rem: [{ id, n, rho }, ...] }
//   R, rot   the vehicles stand evenly round a ring of R metres, turned by `rot` of one gap
//   veh      one list of system ids per vehicle (the number of vehicles is its length)
//   rem      groups of remote systems: n of `id` on a ring of rho x R metres. Only networked jammers and acoustic or RF detectors
//            may stand alone; everything else needs a vehicle. Only the vehicle count is counted as "sites".
// toDesign() turns it into the layout the runner plays. repair() makes any genome obey the rules.

import { STRUCTURES, MOUNTS } from '../../src/sim/config/index.js';
import { RULES, SELF_PROPELLED } from './model.mjs';

const isJammer = (id) => STRUCTURES[id].kind === 'jammer';
export const REMOTE_OK = (id) => (isJammer(id) && STRUCTURES[id].networked !== false) || (STRUCTURES[id].role === 'sensor' && ['acoustic', 'rf'].includes(STRUCTURES[id].kind));

// What may be put where, with how likely each is to be picked. Pools are chosen from the game's own tables, so a new system shows up here by itself.
const w = (list) => list.filter(([id]) => STRUCTURES[id]); // ignore any id this version of the game lacks
export const POOLS = {
  sensor: w([['radar_s', 6], ['radar_a400', 1.5], ['radar_a800', 1.5], ['rf_s', 1.5], ['rf', 1], ['camera_s', 1], ['camera', 1], ['radar_giraffe', 0.1]]),
  weapon: w([['gun_hmg', 4], ['gun_s', 1], ['gun_50', 1], ['interceptor', 2], ['interceptor_p1', 4], ['missile_s', 5], ['missile_rr', 3], ['missile_paladin', 1], ['jammer_jupiter', 0.5], ['jammer_sf', 0.7]]),
  alone: w([['gun_gepard', 0.6], ['laser_rfdew', 0.6]]), // self-propelled: a whole vehicle each
  remote: w([['jammer_sf', 5], ['jammer_jupiter', 1], ['jammer_neo', 1], ['jammer_l', 0.5], ['acoustic_l', 2], ['acoustic_s', 1], ['acoustic', 1], ['rf_elysion', 1], ['rf_airfence', 1], ['rf_l', 0.5]]).filter(([id]) => REMOTE_OK(id)),
};
const MAX_K = RULES.maxVehicles, MIN_K = 2;

export const pick = (rand, pool) => {
  let r = rand() * pool.reduce((s, [, p]) => s + p, 0);
  for (const [id, p] of pool) { r -= p; if (r <= 0) return id; }
  return pool.at(-1)[0];
};
const int = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const roleOf = (id) => STRUCTURES[id].role;

// A vehicle's list made legal: at most 3 systems, one sensor, a heavy system with at most one other, a self-propelled one alone.
function repairVehicle(list) {
  const alone = list.find((id) => SELF_PROPELLED.has(id));
  if (alone) return [alone];
  const out = [];
  let sensors = 0;
  for (const id of list) {
    if (!MOUNTS[id]) continue;
    if (roleOf(id) === 'sensor') { if (sensors++ >= RULES.maxSensors) continue; }
    if (out.length >= RULES.maxPerVehicle) continue;
    out.push(id);
  }
  if (out.some((id) => MOUNTS[id] === 3) && out.length > 2) { const heavy = out.find((id) => MOUNTS[id] === 3); return [heavy, out.find((id) => id !== heavy)]; }
  return out.length ? out : ['gun_hmg'];
}

export function repair(g) {
  const k = Math.max(MIN_K, Math.min(MAX_K, g.veh.length));
  const veh = g.veh.slice(0, k).map(repairVehicle);
  while (veh.length < k) veh.push(['gun_hmg']);
  const R = Math.max(300, Math.min(900, Math.round(g.R / 10) * 10));
  // remote groups: legal ids, spaced apart so no two stand within the minimum gap, and not so many that a ring cannot hold them
  let rem = g.rem.filter((r) => STRUCTURES[r.id] && REMOTE_OK(r.id) && r.n > 0).slice(0, 4).map((r) => ({ ...r }));
  rem.sort((a, b) => a.rho - b.rho);
  let floor = 1 + 110 / R;
  for (const r of rem) {
    r.rho = Math.max(r.rho, floor); floor = r.rho + 90 / R;
    const maxN = Math.floor((2 * Math.PI * R * r.rho) / 75);
    r.n = Math.max(1, Math.min(r.n, maxN, 24));
    r.rho = +r.rho.toFixed(3);
  }
  rem = rem.filter((r) => R * r.rho <= RULES.maxDist);
  return { R, rot: +(((g.rot % 1) + 1) % 1).toFixed(3), veh, rem };
}

export function random(rand) {
  const k = int(rand, MIN_K, MAX_K), veh = [];
  for (let i = 0; i < k; i++) {
    if (rand() < 0.04) { veh.push([pick(rand, POOLS.alone)]); continue; }
    const list = [];
    if (rand() < 0.55) list.push(pick(rand, POOLS.sensor));
    if (RULES.maxSensors > 1 && rand() < 0.3) list.push(pick(rand, POOLS.sensor)); // a second sensor on the same vehicle, if allowed
    const nWeapons = 1 + (rand() < 0.5 ? 1 : 0);
    for (let j = 0; j < nWeapons; j++) list.push(pick(rand, POOLS.weapon));
    veh.push(list);
  }
  // somewhere there has to be a radar or something that senses
  if (!veh.some((l) => l.some((id) => roleOf(id) === 'sensor'))) veh[int(rand, 0, k - 1)].push('radar_s');
  const rem = [];
  for (let j = int(rand, 0, 3); j > 0; j--) rem.push({ id: pick(rand, POOLS.remote), n: int(rand, 1, 14), rho: 1.1 + rand() * 1.7 });
  return repair({ R: 300 + Math.round(rand() * 40) * 10, rot: rand(), veh, rem });
}

// A few small random changes. `rand` is a seeded generator so a search can be repeated.
export function mutate(parent, rand) {
  const g = JSON.parse(JSON.stringify(parent));
  const changes = 1 + (rand() < 0.5 ? 1 : 0) + (rand() < 0.2 ? 1 : 0);
  for (let c = 0; c < changes; c++) {
    const op = Math.floor(rand() * 12), i = int(rand, 0, g.veh.length - 1);
    if (op === 0) g.R += (rand() - 0.5) * 160;
    else if (op === 1) g.rot = rand();
    else if (op === 2 && g.veh.length < MAX_K) g.veh.splice(int(rand, 0, g.veh.length), 0, rand() < 0.6 ? [...g.veh[i]] : random(rand).veh[0]);   // one more vehicle
    else if (op === 3 && g.veh.length > MIN_K) g.veh.splice(i, 1);                                                                                // one fewer
    else if (op === 4) { const j = int(rand, 0, g.veh[i].length - 1); const role = roleOf(g.veh[i][j]); g.veh[i][j] = pick(rand, role === 'sensor' ? POOLS.sensor : POOLS.weapon); } // swap a system
    else if (op === 5 && g.veh[i].length < 3) g.veh[i].push(pick(rand, rand() < 0.3 ? POOLS.sensor : POOLS.weapon));                              // add one
    else if (op === 6 && g.veh[i].length > 1) g.veh[i].splice(int(rand, 0, g.veh[i].length - 1), 1);                                              // take one away
    else if (op === 7) { const a = g.veh[i], j = int(rand, 0, g.veh.length - 1); g.veh[i] = g.veh[j]; g.veh[j] = a; }                              // swap two vehicles' kit
    else if (op === 8) g.rem.push({ id: pick(rand, POOLS.remote), n: int(rand, 1, 12), rho: 1.1 + rand() * 1.7 });
    else if (op === 9 && g.rem.length) g.rem.splice(int(rand, 0, g.rem.length - 1), 1);
    else if (op === 10 && g.rem.length) { const r = g.rem[int(rand, 0, g.rem.length - 1)]; if (rand() < 0.5) r.n += int(rand, -3, 3); else r.rho += (rand() - 0.5) * 0.5; if (rand() < 0.15) r.id = pick(rand, POOLS.remote); }
    else if (op === 11) { const src = g.veh[i]; g.veh = g.veh.map(() => [...src]); }                                                                  // every vehicle alike
  }
  if (!g.veh.some((l) => l.some((id) => roleOf(id) === 'sensor') ) && !g.rem.some((r) => roleOf(r.id) === 'sensor')) g.veh[0].push('radar_s');
  return repair(g);
}

// The layout the runner plays.
export function toDesign(g, attack) {
  const k = g.veh.length;
  const at = (a, r) => [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)];
  const vehicles = g.veh.map((ids, i) => ({ at: at(((i + g.rot) / k) * Math.PI * 2, g.R), sys: ids.map((id) => (id === 'radar_s' ? ['radar_s', { panels: 3 }] : [id])) }));
  const remote = [];
  g.rem.forEach((r, j) => {
    for (let n = 0; n < r.n; n++) remote.push([r.id, ...at(((n + (j + 1) / (g.rem.length + 1)) / r.n + g.rot / k) * Math.PI * 2, g.R * r.rho)]);
  });
  return { vehicles, remote, bunker: 15, ...(attack ? { attack } : {}) };
}

// ---- what a layout is, for the report and for keeping a spread of different kinds
const FAMILY = { gun: ['gun_hmg', 'gun_s', 'gun_50', 'gun_skyranger'], interceptor: ['interceptor', 'interceptor_p1'], missile: ['missile_s', 'missile_rr', 'missile_paladin'], heavy: ['gun_gepard', 'laser_rfdew', 'laser_s'] };
export const familyOf = (id) => Object.entries(FAMILY).find(([, ids]) => ids.includes(id))?.[0] ?? null;

// The kind of weapon that holds most of the money.
export function mainFamily(g) {
  const spend = {};
  for (const list of g.veh) for (const id of list) { const f = familyOf(id); if (f) spend[f] = (spend[f] || 0) + STRUCTURES[id].cost + 1; }
  const top = Object.entries(spend).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : 'none';
}
export const buildCost = (g) => {
  let c = 0;
  for (const list of g.veh) for (const id of list) c += id === 'radar_s' ? 135_000 : STRUCTURES[id].cost;
  for (const r of g.rem) c += r.n * STRUCTURES[r.id].cost;
  return c + 349 * (g.veh.reduce((s, l) => s + l.length, 0) + g.rem.reduce((s, r) => s + r.n, 0));
};
export const describeGenome = (g) => {
  const count = {};
  for (const list of g.veh) for (const id of list) count[id] = (count[id] || 0) + 1;
  for (const r of g.rem) count[`${r.id} (remote)`] = (count[`${r.id} (remote)`] || 0) + r.n;
  return `${g.veh.length} vehicles at ${g.R} m: ` + Object.entries(count).map(([id, n]) => `${n}x ${id}`).join(', ');
};
export const keyOfGenome = (g) => JSON.stringify([g.R, g.rot, g.veh, g.rem.map((r) => [r.id, r.n, r.rho])]);

// Starting points: the brief's best, and the hand-made variants that did best against the Russian attack.
export function seeds() {
  const sensorRing = (k, n) => Array.from({ length: k }, (_, i) => (i < n ? ['radar_s'] : []));
  const mk = (k, extra, radars, jam) => repair({ R: 450, rot: 0, veh: sensorRing(k, radars).map((s) => [...s, 'gun_hmg', ...extra]), rem: [{ id: 'jammer_sf', n: jam, rho: 1.33 }] });
  return [mk(10, ['interceptor_p1'], 4, 12), mk(3, ['missile_s'], 3, 12), mk(3, ['missile_rr'], 3, 12), mk(5, ['missile_s'], 4, 10), mk(4, ['missile_s'], 4, 12), mk(6, ['missile_s'], 4, 8)];
}
