// The patrol planner's working: every soldier and vehicle that can carry a system (a "bearer"), where each stands in the formation,
// what each can take, and the column the game's patrol is built from (sim/patrol.js). Pure functions of the column and the plan, so
// the panel (PatrolPlanner.jsx) only draws them and sends the new column to the game.
//
// A column entry is { vehicle, system, also?, gap, side, soldier? }. A soldier carrying systems is an entry with vehicle 'foot' and
// `soldier`, their place in the formation; the game keeps their systems with them whatever the formation or spacing.

import { ESCORT_CARRIERS, MAX_ESCORTS, MAX_ESCORT_GAP, MAX_ESCORT_SIDE, MAX_ON_FOOT, MAX_ON_VEHICLE, MOUNTS, ON_FOOT, PATROL, PATROL_TYPES, STRUCTURES, escortCarries } from '../sim/config/index.js';
import { soldierSpot } from '../sim/formation.js';

export const SHORT = { patria: 'PAT', hilux: 'HLX', themis: 'UGV' };
export const VEHICLE_SHAPES = { column: 'Column', staggered: 'Staggered', box: 'Box' };
export const DEFAULT_SPACING = { dismounted: PATROL.foot.spacing, mounted: 40, mixed: PATROL.foot.spacing };
const clamp = (x, lim) => Math.max(-lim, Math.min(lim, Math.round(x)));
const carried = (e) => [e.system, ...(e.also ?? [])];
const isFoot = (e) => Object.hasOwn(ON_FOOT, e.vehicle);

// Where vehicle k of n stands in a mounted patrol's shape, centred on the patrol, as metres ahead and to the right.
export function vehicleSpot(shape, k, n, spacing) {
  const rows = shape === 'box' ? Math.ceil(n / 2) : n, row = shape === 'box' ? Math.floor(k / 2) : k;
  const along = ((rows - 1) / 2 - row) * spacing;
  const across = shape === 'column' ? 0 : (k % 2 ? 0.5 : -0.5) * spacing * (shape === 'box' ? 1 : 0.8);
  return { along, across };
}

// Every bearer in this patrol: its soldiers (unless mounted, when they ride) and its vehicles, each with its place, what it carries and
// which column entry holds that. A soldier's entry saved without a place goes to the first soldier with none.
export function bearers(column, plan, soldiers) {
  const list = [], free = column.map((e, at) => (isFoot(e) && e.soldier == null ? at : -1)).filter((at) => at >= 0);
  if (plan.type !== 'mounted') {
    for (let i = 0; i < soldiers; i++) {
      let at = column.findIndex((e) => isFoot(e) && e.soldier === i);
      if (at < 0 && free.length && !column.some((e) => isFoot(e) && e.soldier === i)) at = free.shift();
      list.push({ key: `s${i}`, kind: 'soldier', label: `S${i + 1}`, name: `Soldier ${i + 1}`, soldier: i, index: at, systems: at >= 0 ? carried(column[at]) : [], slots: MAX_ON_FOOT, ...soldierSpot(plan.formation, i, plan.spacing) });
    }
  }
  const count = {};
  column.forEach((e, at) => {
    if (isFoot(e)) return;
    count[e.vehicle] = (count[e.vehicle] ?? 0) + 1;
    list.push({ key: `v${at}`, kind: 'vehicle', vehicle: e.vehicle, label: `${SHORT[e.vehicle]} ${count[e.vehicle]}`, name: `${ESCORT_CARRIERS[e.vehicle].name} ${count[e.vehicle]}`, index: at, systems: carried(e), slots: MAX_ON_VEHICLE, along: e.gap, across: e.side ?? 0 });
  });
  return list;
}

// Why this bearer cannot take this system, or null.
export function carryProblem(b, id) {
  if (b.systems.length >= b.slots) return b.kind === 'soldier' ? `A soldier carries ${MAX_ON_FOOT} systems at most` : `A vehicle carries ${MAX_ON_VEHICLE} systems at most`;
  if (b.kind === 'soldier') return escortCarries('foot', id) ? null : 'Too big to carry: it needs a vehicle';
  if (!Object.hasOwn(MOUNTS, id)) return 'Cannot ride in a patrol';
  if (!escortCarries(b.vehicle, id)) return ON_FOOT.foot.takes.includes(id) && !escortCarries('patria', id) ? 'Fired by a soldier on foot, not from a vehicle' : `Too heavy for a ${ESCORT_CARRIERS[b.vehicle].name}`;
  if (MOUNTS[id] === 3 && b.systems.some((s) => MOUNTS[s] === 3)) return 'One heavy system to a vehicle';
  return null;
}

// Why nothing in a patrol of this type could carry this system, or null: greyed out in the planner's list.
export function typeProblem(type, id) {
  if (!Object.hasOwn(MOUNTS, id)) return 'Cannot ride in a patrol';
  return PATROL_TYPES[type].takes.some((v) => escortCarries(v, id)) ? null : type === 'dismounted' ? 'Too big for soldiers or a THeMIS: it needs a mounted patrol' : 'Fired by a soldier on foot: it needs a dismounted patrol';
}

// The column with this system given to this bearer.
export function giveTo(column, b, id) {
  if (b.index >= 0) return column.map((e, at) => (at === b.index ? { ...e, also: [...(e.also ?? []), id] } : e));
  return [...column, { vehicle: 'foot', system: id, soldier: b.soldier, gap: clamp(b.along, MAX_ESCORT_GAP), side: clamp(b.across, MAX_ESCORT_SIDE) }];
}

// The column with this bearer's k-th system taken off. A soldier left with nothing leaves the column; a vehicle keeps its last one.
export function takeOff(column, b, k) {
  const ids = b.systems.filter((_, j) => j !== k);
  if (!ids.length) return column.filter((_, at) => at !== b.index);
  return column.map((e, at) => (at === b.index ? { ...e, system: ids[0], also: ids.length > 1 ? ids.slice(1) : undefined } : e));
}

// Every soldier's entry keeps its place, and the vehicles stand in the chosen shape: in a mounted patrol, `shape` at the spacing; in a
// dismounted one, each THeMIS beside the soldiers, spread along them.
export function relay(column, plan, soldiers, shape = 'column') {
  const vehicles = column.filter((e) => !isFoot(e)), spots = bearers([], plan, soldiers);
  const depth = Math.min(0, ...spots.map((s) => s.along)), wide = Math.max(0, ...spots.map((s) => Math.abs(s.across)));
  let k = 0;
  return column.map((e) => {
    if (isFoot(e)) { const at = soldierSpot(plan.formation, e.soldier ?? 0, plan.spacing); return { ...e, gap: clamp(at.along, MAX_ESCORT_GAP), side: clamp(at.across, MAX_ESCORT_SIDE) }; }
    const j = k++;
    const at = plan.type === 'mounted' ? vehicleSpot(shape, j, vehicles.length, plan.spacing)
      : { along: (depth * (j + 1)) / (vehicles.length + 1), across: (j % 2 ? -1 : 1) * (wide + Math.max(plan.spacing, 5)) };
    return { ...e, gap: clamp(at.along, MAX_ESCORT_GAP), side: clamp(at.across, MAX_ESCORT_SIDE) };
  });
}

// What the pack has left for the patrol: each system and vehicle less those standing on the map outside the patrol. Null with no pack.
export function packLeft(assets, structures) {
  if (!assets) return null;
  const outside = structures.filter((s) => !s.escort), parked = {};
  for (const s of outside) if (s.def.vehicle && !s.def.rider) parked[s.def.vehicle] = (parked[s.def.vehicle] ?? 0) + 1;
  const systems = {}, vehicles = {};
  for (const l of assets.systems) if (STRUCTURES[l.id]) systems[l.id] = (systems[l.id] ?? 0) + l.count - outside.filter((s) => s.def.id === l.id).length;
  for (const l of assets.vehicles) vehicles[l.id] = (vehicles[l.id] ?? 0) + l.count - (parked[l.id] ?? 0);
  return { systems, vehicles };
}

// How far the column goes beyond the pack: [{ id, name, over }], systems and vehicles. Allowed, but the planner warns.
export function overPack(column, left) {
  if (!left) return [];
  const used = {}, vehicles = {};
  for (const e of column) { for (const id of carried(e)) used[id] = (used[id] ?? 0) + 1; if (!isFoot(e)) vehicles[e.vehicle] = (vehicles[e.vehicle] ?? 0) + 1; }
  return [
    ...Object.entries(used).filter(([id, n]) => n > (left.systems[id] ?? 0)).map(([id, n]) => ({ id, name: STRUCTURES[id].name, over: n - Math.max(0, left.systems[id] ?? 0) })),
    ...Object.entries(vehicles).filter(([id, n]) => n > (left.vehicles[id] ?? 0)).map(([id, n]) => ({ id, name: ESCORT_CARRIERS[id].name, over: n - Math.max(0, left.vehicles[id] ?? 0) })),
  ];
}

// The column the pack fills for this patrol, and how many of its systems no one could carry. Dismounted: every THeMIS the pack has
// walks with the soldiers; soldiers take the hand-held systems, one each before anyone takes a second, soldier-only ones first; a
// THeMIS takes what is left that it can. Mounted: the vehicles, largest first, take the systems, heaviest first.
export function fill(plan, soldiers, left, shape = 'column') {
  let column = [];
  const types = plan.type === 'mounted' ? ['patria', 'hilux', 'themis'] : ['themis'];
  for (const v of types) for (let n = left.vehicles[v] ?? 0; n > 0 && column.length < MAX_ESCORTS; n--) column.push({ vehicle: v, system: null, gap: 0, side: 0 });
  const order = Object.keys(left.systems).filter((id) => left.systems[id] > 0 && Object.hasOwn(MOUNTS, id))
    .sort((a, b) => Number(ON_FOOT.foot.takes.includes(b) && !escortCarries('themis', b)) - Number(ON_FOOT.foot.takes.includes(a) && !escortCarries('themis', a)) || Number(ON_FOOT.foot.takes.includes(b)) - Number(ON_FOOT.foot.takes.includes(a)) || MOUNTS[b] - MOUNTS[a]);
  let spare = 0;
  const holders = () => bearers(column.map((e) => (e.system ? e : { ...e, system: '_' })), plan, soldiers).map((b) => ({ ...b, systems: b.systems.filter((s) => s !== '_') }));
  for (const id of order) {
    for (let n = left.systems[id]; n > 0; n--) {
      const can = holders().filter((b) => !carryProblem(b, id)).sort((a, b) => (a.kind === b.kind ? a.systems.length - b.systems.length : a.kind === 'soldier' ? -1 : 1));
      const b = can[0];
      if (!b) { spare++; continue; }
      if (b.kind === 'vehicle' && !column[b.index].system) column[b.index] = { ...column[b.index], system: id };
      else column = giveTo(column, b, id);
    }
  }
  column = column.filter((e) => e.system); // a vehicle that got nothing stays in the pack
  return { column: relay(column, plan, soldiers, shape), spare };
}
