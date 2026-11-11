// A patrol: soldiers in a formation walking a route from its start to its end, waiting there, then walking back, escorted by
// vehicles that keep their places in the formation. Strike drones attack the patrol in place of the station. Nothing here draws a
// random number, so a patrol walks the same way on every run, and a laydown without one runs none of this. See docs/PATROL_MODE.md.

import { COMMS, ESCORT_CARRIERS, MAX_ESCORTS, MAX_ESCORT_GAP, MAX_ESCORT_SIDE, MAX_FOOT_BEARERS, MAX_ON_FOOT, MAX_ON_VEHICLE, MOUNTS, ON_FOOT, PATROL, PATROL_TYPES, STRUCTURES, escortCarries } from './config/index.js';
import { SITE_POS, hereU, u } from './units.js';
import { buyTerminal, money } from './economy.js';
import { addStructure, removeStructure, wireFusion, wireNode } from './laydown.js';
import { RIDER_STEP } from './sharing.js';
import { designLocked } from './lock.js';
import { addGroup, cleanCount } from './people.js';
import { FORMATIONS, placeIn, soldierSpot } from './formation.js';
import { legEnds, routeProblem, widthProblem } from './route.js';
import { cleanSettings, unitCost } from './unit-config.js';

export { MAX_WAYPOINTS, routeProblem } from './route.js';

const FOOT = PATROL.foot;
export const DEFAULT_PLAN = { width: 200, formation: 'file', type: 'mixed', spacing: FOOT.spacing };
const full = (plan) => ({ ...DEFAULT_PLAN, spacing: FOOT.spacing, ...plan }); // a plan saved before there was a type or spacing

// Why this column can't escort a patrol of this type, or null: up to MAX_ESCORTS vehicles and MAX_FOOT_BEARERS soldiers carrying, each
// carrying what it can take, near the people. A soldier (`soldier`, its place in the formation) carries up to MAX_ON_FOOT systems.
export function columnProblem(column, type = 'mixed') {
  if (!Array.isArray(column)) return 'Choose the vehicles for the patrol';
  const foot = column.filter((e) => Object.hasOwn(ON_FOOT, e?.vehicle)), takes = PATROL_TYPES[type]?.takes ?? [];
  if (column.length - foot.length > MAX_ESCORTS) return `A patrol takes ${MAX_ESCORTS} vehicles at most`;
  if (foot.length > MAX_FOOT_BEARERS) return `${MAX_FOOT_BEARERS} soldiers at most can carry systems`;
  const placed = foot.filter((e) => e.soldier != null).map((e) => e.soldier);
  if (new Set(placed).size < placed.length) return 'Each soldier has one place in the list';
  for (const e of column) {
    if (!Object.hasOwn(ESCORT_CARRIERS, e?.vehicle)) return 'Choose a vehicle for each place in the column';
    if (!takes.includes(e.vehicle)) return `A ${PATROL_TYPES[type].name.toLowerCase()} patrol does not take a ${ESCORT_CARRIERS[e.vehicle].name}`;
    if (e.soldier != null && !(Number.isInteger(e.soldier) && e.soldier >= 0 && e.soldier < 100)) return 'Choose a soldier in the patrol';
    const v = ESCORT_CARRIERS[e.vehicle], sys = STRUCTURES[e.system];
    if (!Object.hasOwn(MOUNTS, e.system) || !sys) return 'That system cannot ride in a patrol';
    if (!escortCarries(e.vehicle, e.system)) return `A ${v.name} cannot carry the ${sys.name}`;
    const also = e.also ?? [];
    if (!Array.isArray(also) || also.length > MAX_ON_VEHICLE - 1) return `A vehicle carries ${MAX_ON_VEHICLE} systems at most`;
    if (Object.hasOwn(ON_FOOT, e.vehicle) && also.length > MAX_ON_FOOT - 1) return `A soldier on foot carries ${MAX_ON_FOOT} systems at most`;
    for (const id of also) if (!Object.hasOwn(MOUNTS, id) || !escortCarries(e.vehicle, id)) return `A ${v.name} cannot carry the ${STRUCTURES[id]?.name ?? 'system'}`;
    if ([e.system, ...also].filter((id) => MOUNTS[id] === 3).length > 1) return `A ${v.name} carries one heavy system at most`;
    if (!Number.isFinite(e.gap) || Math.abs(e.gap) > MAX_ESCORT_GAP) return `Keep each vehicle within ${MAX_ESCORT_GAP} m of the people`;
    if (e.side != null && !(Number.isFinite(e.side) && Math.abs(e.side) <= MAX_ESCORT_SIDE)) return `Keep each vehicle within ${MAX_ESCORT_SIDE} m to the side`;
  }
  return null;
}

function planProblem(plan) {
  const type = PATROL_TYPES[plan?.type];
  if (!type) return 'Choose a dismounted or a mounted patrol';
  if (!(Number.isFinite(plan.spacing) && plan.spacing >= type.spacing[0] && plan.spacing <= type.spacing[1])) return `Keep the spacing between ${type.spacing[0]} and ${type.spacing[1]} m`;
  return widthProblem(plan.width) || (Object.hasOwn(FORMATIONS, plan.formation) ? null : 'Choose a formation');
}

// Each soldier and each vehicle at its place in the formation, and the people's group at the lead soldier.
function placeAll(w) {
  const p = w.patrol, g = p.group;
  const rides = p.type === 'mounted' ? p.escorts.filter((e) => !e.s.def.rider) : []; // mounted, the soldiers ride on the vehicles
  const spot = (i) => (rides.length ? { along: rides[i % rides.length].gap, across: rides[i % rides.length].side } : soldierSpot(p.formation, i, p.spacing));
  for (let i = 0; i < g.count; i++) {
    const { along, across } = spot(i), q = placeIn(p, along, across);
    g.spots[i * 2] = q.x; g.spots[i * 2 + 1] = q.z;
  }
  const lead = placeIn(p, 0, 0);
  g.x = lead.x; g.z = lead.z; g.y = hereU(lead.x, lead.z);
  w.peopleRev++;
  for (const { s, gap, side, soldier, k } of p.escorts) { // a soldier's systems go with that soldier, the second carried beside the first
    const at = soldier == null ? { along: gap, across: side } : soldierSpot(p.formation, soldier, p.spacing), q = placeIn(p, at.along + (soldier == null ? 0 : k * 0.8), at.across);
    s.pos.set(q.x, hereU(q.x, q.z), q.z);
  }
  w.state.zoneCentre = lead; // the fusion node measures threats from the patrol
}

// Every system in the column and its terminal, and a terminal for the fusion node if it has none. The vehicles themselves are
// not priced: the budget is for counter-drone systems.
const carried = (e) => [e.system, ...(e.also ?? [])];
const onVehicle = (vehicle, system) => (STRUCTURES[system].mount == null ? {} : { mount: ESCORT_CARRIERS[vehicle].mast }); // its mast on the vehicle
// priced as startPatrol charges it, on its vehicle's mast, so what passes the check can be paid for
const escortCost = (w, column) => column.reduce((sum, e) => sum + carried(e).reduce((a, id) => a + unitCost(id, cleanSettings(id, onVehicle(e.vehicle, id))), 0), 0)
  + COMMS.starlink.cost * (column.flatMap(carried).filter((id) => STRUCTURES[id].networked !== false).length + (w.net.fusion.uplinks.has('starlink') ? 0 : 1));

function startPatrol(w, route, column, plan) {
  const [x, z] = route[0];
  let platforms = 0;
  // each vehicle's systems: its first carries it and is drawn on it; a second rides a little ahead and a third a little behind
  const escorts = column.flatMap((e) => {
    const { vehicle, gap, side, soldier } = e, ids = carried(e), platform = ids.length > 1 ? `patrol-${++platforms}` : null;
    return ids.map((system, k) => {
      const s = addStructure(w, system, x, z, { settings: onVehicle(vehicle, system) });
      s.escort = true; s.def.vehicle = vehicle; // the unit's own definition, so the drawing puts it on the vehicle
      if (k > 0) s.def.rider = true;
      if (platform) s.platform = platform; // they share a strike (targeting.js)
      w.state.budget -= s.def.cost; w.ledger.capex += s.def.cost;
      if (s.def.networked !== false) wireNode(w, s, 'starlink'); // shortcut: assumes a terminal that works on the move. Model cellular or a mesh radio if escorts need a choice.
      return { s, gap: gap + [0, RIDER_STEP, -RIDER_STEP][k], side, soldier, k };
    });
  });
  wireFusion(w, 'starlink', true);
  const group = addGroup(w, x, z, cleanCount(FOOT.groupSize), 'open', 'military'); // a figure, so it gets the same cap as any group
  group.patrol = true;
  w.patrol = {
    route, ends: legEnds(route), width: plan.width, formation: plan.formation, type: plan.type, spacing: plan.spacing, dist: 0, dir: 1, phase: 'home', wait: 0, homeWave: 0, trips: 0,
    group, escorts, column, halted: false, fix: null,
  };
  placeAll(w);
}

// Before the first wave nothing has happened, so the escort is refunded in full. The fusion node keeps its terminal.
export function clearPatrol(w) {
  const p = w.patrol;
  if (!p) return;
  for (const { s } of p.escorts) {
    if (!w.structures.includes(s)) continue;
    w.state.budget += s.def.cost; w.ledger.capex -= s.def.cost;
    if (s.uplink) buyTerminal(w, s.uplink, null);
    removeStructure(w, s);
  }
  const at = w.people.indexOf(p.group);
  if (at >= 0) w.people.splice(at, 1);
  w.peopleRev++;
  w.patrol = null;
  w.state.zoneCentre = SITE_POS;
}

export const planOf = (p) => ({ width: p.width, formation: p.formation, type: p.type, spacing: p.spacing });
const cleanColumn = (column) => column.map(({ vehicle, system, also, gap, side, soldier }) => ({ vehicle, system, ...(also?.length ? { also: [...also] } : {}), gap, side: side ?? 0, ...(soldier != null ? { soldier } : {}) }));

// Set, replace or (with null) clear the patrol, keeping its column and plan (corridor width and formation) unless given others.
// Returns why not, or null.
export function setPatrol(w, points, column = w.patrol?.column ?? FOOT.column, given = w.patrol ? planOf(w.patrol) : DEFAULT_PLAN) {
  const plan = full(given);
  if (designLocked(w)) return 'The patrol is locked once the first wave starts';
  const problem = points == null ? null : w.state.zone ? 'Clear the area to defend first: with a patrol, the patrol is what the enemy attacks' : routeProblem(points) || columnProblem(column, plan.type) || planProblem(plan);
  if (problem) return problem;
  const before = w.patrol && { route: w.patrol.route, column: w.patrol.column, plan: planOf(w.patrol) };
  clearPatrol(w);
  if (points == null) return null;
  const route = points.map(([x, z]) => [x, z]);
  if (!w.state.packed && w.state.budget < escortCost(w, column)) { // a deployment pack's budget only counts, as for systems
    const need = escortCost(w, column);
    if (before) startPatrol(w, before.route, before.column, before.plan); // a change that is too dear leaves the patrol as it was
    return `Not enough budget for the escort (${money(need)} needed, ${money(w.state.budget)} left)`;
  }
  startPatrol(w, route, cleanColumn(column), { width: plan.width, formation: plan.formation, type: plan.type, spacing: plan.spacing });
  return null;
}

// Once the attack starts the patrol walks out to the end, waits there, and walks back. At the start it holds until the next wave,
// then sets out again. It halts while a weapon is engaging: the crew stop to fire.
export function updatePatrol(w, dt) {
  const p = w.patrol, { state } = w;
  if (!p || !(state.wave > 0 || state.sandbox)) return;
  p.halted = p.escorts.some(({ s }) => s.task && s.def.fire !== 'jam' && w.structures.includes(s)); // a jammer works on the move
  const total = p.ends.at(-1), { dist, dir } = p;
  if (p.phase === 'home' && (state.wave > p.homeWave || state.sandbox)) { p.phase = 'out'; p.dir = 1; w.rec.event('patrol', 'Patrol set out'); }
  if (p.phase === 'end') {
    p.wait -= dt;
    if (p.wait <= 0) { p.phase = 'back'; p.dir = -1; w.rec.event('patrol', 'Patrol heading back'); }
  } else if ((p.phase === 'out' || p.phase === 'back') && !p.halted) {
    p.dist += p.dir * u(p.type === 'mounted' ? FOOT.driveSpeed : FOOT.walkSpeed) * dt;
    if (p.phase === 'out' && p.dist >= total) { p.dist = total; p.phase = 'end'; p.wait = FOOT.endDelay; w.rec.event('patrol', 'Patrol reached the end'); w.emit('toast', `Patrol at the end: back in ${Math.round(FOOT.endDelay)} s`); }
    if (p.phase === 'back' && p.dist <= 0) { p.dist = 0; p.phase = 'home'; p.homeWave = state.wave; p.trips++; w.rec.event('patrol', 'Patrol back at the start'); w.emit('toast', 'Patrol back at the start: it sets out again with the next wave'); }
  }
  if (p.dist !== dist || p.dir !== dir) placeAll(w); // where everyone stands follows only from these, so a waiting patrol is left as it is
}
