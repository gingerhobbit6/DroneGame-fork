// A patrol: soldiers in a formation walking a route from its start to its end, waiting there, then walking back, escorted by
// vehicles that keep their places in the formation. Strike drones attack the patrol in place of the station. Nothing here draws a
// random number, so a patrol walks the same way on every run, and a laydown without one runs none of this. See docs/PATROL_MODE.md.

import { COMMS, MAX_ESCORTS, MAX_ESCORT_GAP, MAX_ESCORT_SIDE, MOUNTS, PATROL, PATROL_VEHICLES, STRUCTURES } from './config/index.js';
import { SITE_POS, hereU, u } from './units.js';
import { buyTerminal, money } from './economy.js';
import { addStructure, removeStructure, wireFusion, wireNode } from './laydown.js';
import { designLocked } from './lock.js';
import { addGroup, cleanCount } from './people.js';
import { FORMATIONS, placeIn, soldierSpot } from './formation.js';
import { legEnds, routeProblem, widthProblem } from './route.js';

export { MAX_WAYPOINTS, routeProblem } from './route.js';

const FOOT = PATROL.foot;
export const DEFAULT_PLAN = { width: 200, formation: 'file' };

// Why this column can't escort a patrol, or null: 1 to MAX_ESCORTS vehicles, each carrying a system it can take, near the people.
export function columnProblem(column) {
  if (!Array.isArray(column) || column.length < 1 || column.length > MAX_ESCORTS) return `A patrol needs 1 to ${MAX_ESCORTS} vehicles`;
  for (const e of column) {
    if (!Object.hasOwn(PATROL_VEHICLES, e?.vehicle)) return 'Choose a vehicle for each place in the column';
    const v = PATROL_VEHICLES[e.vehicle], sys = STRUCTURES[e.system];
    if (!Object.hasOwn(MOUNTS, e.system) || !sys) return 'That system cannot ride in a patrol';
    if (MOUNTS[e.system] > v.carries) return `A ${v.name} cannot carry the ${sys.name}`;
    if (!Number.isFinite(e.gap) || Math.abs(e.gap) > MAX_ESCORT_GAP) return `Keep each vehicle within ${MAX_ESCORT_GAP} m of the people`;
    if (e.side != null && !(Number.isFinite(e.side) && Math.abs(e.side) <= MAX_ESCORT_SIDE)) return `Keep each vehicle within ${MAX_ESCORT_SIDE} m to the side`;
  }
  return null;
}

const planProblem = (plan) => widthProblem(plan?.width) || (Object.hasOwn(FORMATIONS, plan?.formation) ? null : 'Choose a formation');

// Each soldier and each vehicle at its place in the formation, and the people's group at the lead soldier.
function placeAll(w) {
  const p = w.patrol, g = p.group;
  for (let i = 0; i < g.count; i++) {
    const { along, across } = soldierSpot(p.formation, i, FOOT.spacing), q = placeIn(p, along, across);
    g.spots[i * 2] = q.x; g.spots[i * 2 + 1] = q.z;
  }
  const lead = placeIn(p, 0, 0);
  g.x = lead.x; g.z = lead.z; g.y = hereU(lead.x, lead.z);
  w.peopleRev++;
  for (const { s, gap, side } of p.escorts) { const q = placeIn(p, gap, side); s.pos.set(q.x, hereU(q.x, q.z), q.z); }
  w.state.zoneCentre = lead; // the fusion node measures threats from the patrol
}

// Every system in the column and its terminal, and a terminal for the fusion node if it has none. The vehicles themselves are
// not priced: the budget is for counter-drone systems.
const escortCost = (w, column) => column.reduce((sum, e) => sum + STRUCTURES[e.system].cost, 0)
  + COMMS.starlink.cost * (column.filter((e) => STRUCTURES[e.system].networked !== false).length + (w.net.fusion.uplinks.has('starlink') ? 0 : 1));

function startPatrol(w, route, column, plan) {
  const [x, z] = route[0];
  const escorts = column.map(({ vehicle, system, gap, side }) => {
    const s = addStructure(w, system, x, z, { settings: STRUCTURES[system].mount == null ? {} : { mount: PATROL_VEHICLES[vehicle].mast } }); // its mast on the vehicle
    s.escort = true; s.def.vehicle = vehicle; // the unit's own definition, so the drawing puts it on the vehicle
    w.state.budget -= s.def.cost; w.ledger.capex += s.def.cost;
    if (s.def.networked !== false) wireNode(w, s, 'starlink'); // shortcut: assumes a terminal that works on the move. Model cellular or a mesh radio if escorts need a choice.
    return { s, gap, side };
  });
  wireFusion(w, 'starlink', true);
  const group = addGroup(w, x, z, cleanCount(FOOT.groupSize), 'open', 'military'); // a figure, so it gets the same cap as any group
  group.patrol = true;
  w.patrol = {
    route, ends: legEnds(route), width: plan.width, formation: plan.formation, dist: 0, dir: 1, phase: 'home', wait: 0, homeWave: 0, trips: 0,
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

export const planOf = (p) => ({ width: p.width, formation: p.formation });
const cleanColumn = (column) => column.map(({ vehicle, system, gap, side }) => ({ vehicle, system, gap, side: side ?? 0 }));

// Set, replace or (with null) clear the patrol, keeping its column and plan (corridor width and formation) unless given others.
// Returns why not, or null.
export function setPatrol(w, points, column = w.patrol?.column ?? FOOT.column, plan = w.patrol ? planOf(w.patrol) : DEFAULT_PLAN) {
  if (designLocked(w)) return 'The patrol is locked once the first wave starts';
  const problem = points == null ? null : w.state.zone ? 'Clear the area to defend first: with a patrol, the patrol is what the enemy attacks' : routeProblem(points) || columnProblem(column) || planProblem(plan);
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
  startPatrol(w, route, cleanColumn(column), { width: plan.width, formation: plan.formation });
  return null;
}

// Once the attack starts the patrol walks out to the end, waits there, and walks back. At the start it holds until the next wave,
// then sets out again. It halts while a weapon is engaging: the crew stop to fire.
export function updatePatrol(w, dt) {
  const p = w.patrol, { state } = w;
  if (!p || !(state.wave > 0 || state.sandbox)) return;
  p.halted = p.escorts.some(({ s }) => s.task && s.def.fire !== 'jam' && w.structures.includes(s)); // a jammer works on the move
  const total = p.ends.at(-1);
  if (p.phase === 'home' && (state.wave > p.homeWave || state.sandbox)) { p.phase = 'out'; p.dir = 1; w.rec.event('patrol', 'Patrol set out'); }
  if (p.phase === 'end') {
    p.wait -= dt;
    if (p.wait <= 0) { p.phase = 'back'; p.dir = -1; w.rec.event('patrol', 'Patrol heading back'); }
  } else if ((p.phase === 'out' || p.phase === 'back') && !p.halted) {
    p.dist += p.dir * u(FOOT.walkSpeed) * dt;
    if (p.phase === 'out' && p.dist >= total) { p.dist = total; p.phase = 'end'; p.wait = FOOT.endDelay; w.rec.event('patrol', 'Patrol reached the end'); w.emit('toast', `Patrol at the end: back in ${Math.round(FOOT.endDelay)} s`); }
    if (p.phase === 'back' && p.dist <= 0) { p.dist = 0; p.phase = 'home'; p.homeWave = state.wave; p.trips++; w.rec.event('patrol', 'Patrol back at the start'); w.emit('toast', 'Patrol back at the start: it sets out again with the next wave'); }
  }
  placeAll(w);
}
