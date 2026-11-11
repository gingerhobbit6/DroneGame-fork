// Placing, selling and restoring systems, and the network wiring between them. Like the laydown, the wiring is locked
// once the first wave starts, so runs are comparable.

import { Vector3 } from 'three';
import { WORLD, BUILD, COMMS, ECONOMY, PATROL, PATROL_VEHICLES, STRUCTURES, carries, vehicleId } from './config/index.js';
import { MAST_SIDE, RIDER_STEP, hostFor, nextPlatform, platformOf, regroupVehicles } from './sharing.js';
import { terrainState } from './terrain.js';
import { SITE_POS, u, hdist, hereU } from './units.js';
import { cleanZone, reachProblem, siteIsFree, zoneCentre } from './attack-area.js';
import { outwardFrom } from './sensor-model.js';
import { cleanMix, hasStrike, isDefaultMix } from './attack-mix.js';
import { ENV, cleanConditions } from './conditions.js';
import { buyTerminal, money } from './economy.js';
import { capturePeople, clearPeople, removePeople, restorePeople } from './people.js';
import { fillMagazine } from './magazine.js';
import { LAYDOWN_LOCKED, designLocked } from './lock.js';
import { DEFAULT_PLAN, planOf, setPatrol } from './patrol.js';
import { inCorridor } from './route.js';
import { cleanCallsign, cleanName, cleanSettings, fieldsFor, setSetting, unitCost, unitDef } from './unit-config.js';

// saved holds a unit's settings and custom names, and reserved the callsigns other saved units will need.
export function addStructure(w, id, x, z, saved = {}, reserved) {
  const def = unitDef(id, cleanSettings(id, saved.settings));
  if (carries(saved.vehicle, id)) def.vehicle = saved.vehicle; // parked on a vehicle from a pack, and drawn on it
  if (def.vehicle && saved.rider) def.rider = true; // a second or third system on that vehicle, which is drawn once
  const y = hereU(x, z);
  const s = { def, health: def.health || 30, pos: new Vector3(x, y, z), cd: 0, aim: 0, beamTarget: null };
  // unless it is told otherwise, it faces away from what is defended, so it follows a drawn area or a walking patrol
  // a jammer on a pan-and-tilt head faces where the fusion node last turned it (s.slewTo, tasking.js)
  Object.defineProperty(def, 'facing', { get: () => s.slewTo ?? def.settings.facing ?? outwardFrom(w.state.zoneCentre, s.pos) });
  const name = cleanName(saved.name), callsign = cleanCallsign(saved.callsign);
  if (name || callsign) s.custom = { name, callsign };
  fillMagazine(s);
  w.structures.push(s);
  w.net.registerNode(s, reserved);
  return s;
}

export function removeStructure(w, s) {
  w.net.deregisterNode(s);
  w.structures.splice(w.structures.indexOf(s), 1);
}

// Why a system can't stand here on this ground, or null: off the map, in water, on a building or on ground too steep. A laydown made
// for other ground leaves out what fails this.
function groundProblem(w, x, z) {
  const xm = x * WORLD.metresPerUnit, zm = z * WORLD.metresPerUnit;
  return reachProblem(w, x, z) || (terrainState.data.onBuilding(xm, zm) && 'There is a building here')
    || (terrainState.data.coverAt(xm, zm) === 4 && 'You cannot build in water') || (terrainState.data.slope(xm, zm) > 0.4 && 'The ground is too steep') || null;
}

export function placementProblem(w, x, z, def, cost = def.cost) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 'Choose a spot on the map';
  const r = Math.hypot(x, z);
  const xm = x * WORLD.metresPerUnit, zm = z * WORLD.metresPerUnit;
  if (designLocked(w)) return LAYDOWN_LOCKED;
  if (w.structures.length >= BUILD.maxSystems) return `No more than ${BUILD.maxSystems} systems, so the laydown can still be saved`;
  if (!siteIsFree(w) && r < u(BUILD.minDist)) return `Too close to the station (minimum ${BUILD.minDist} m)`;
  const far = reachProblem(w, x, z);
  if (far) return far;
  if (w.patrol && !inCorridor(w.patrol, x, z)) return 'With a patrol, systems stand inside its corridor';
  if (terrainState.data.onBuilding(xm, zm)) return 'There is a building here';
  if (terrainState.data.coverAt(xm, zm) === 4) return 'You cannot build in water';
  if (terrainState.data.slope(xm, zm) > 0.4) return 'The ground is too steep';
  if (w.structures.some((s) => hdist(s.pos, { x, z }) < u(BUILD.spacing)) && !hostFor(w, x, z, def)) return 'Too close to another structure';
  const kit = w.state.kit;
  if (kit) {
    const held = kit[def.id] ?? 0, placed = w.structures.filter((s) => s.def.id === def.id).length;
    if (placed >= held) return held ? `All ${held} ${def.product} in your deployment pack are placed` : `The ${def.product} is not in your deployment pack`;
  }
  if (!w.state.packed && w.state.budget < cost) return `Not enough budget (${money(cost)} needed, ${money(w.state.budget)} left)`;
  return null;
}

// A deployment pack in use: the budget only counts the cost, and a kit ({ system id: how many }) limits what can be placed.
// true is a pack with no kit limit, as older run logs have; anything falsy is no pack.
export function setPacked(w, kit) {
  w.state.packed = !!kit;
  w.state.kit = kit && typeof kit === 'object'
    ? Object.fromEntries(Object.entries(kit).filter(([id, n]) => STRUCTURES[id] && Number.isInteger(n) && n > 0))
    : null;
}

// A system on a vehicle stands at the vehicle's mast height, as in a patrol.
export const onVehicle = (id, settings, vehicle) => (vehicle && STRUCTURES[id].mount != null ? { ...settings, mount: PATROL_VEHICLES[vehicle].mast } : settings);

// Returns the reason it can't be placed, or null if it was. With a vehicle, the system is parked on it.
// Placed beside a vehicle parked from a pack, a system goes onto it if it has room; beside a radar, a camera goes on its mast.
export function place(w, id, x, z, settings, vehicle) {
  if (vehicle != null && !carries(vehicle, id)) return `A ${PATROL_VEHICLES[vehicle]?.name ?? 'vehicle'} cannot carry the ${STRUCTURES[id].name}`;
  const crowded = w.structures.some((s) => hdist(s.pos, { x, z }) < u(BUILD.spacing));
  if (vehicle != null && crowded) return 'Too close to another structure'; // a vehicle of its own needs its own ground
  const host = vehicle == null && crowded ? hostFor(w, x, z, STRUCTURES[id]) : null;
  let rider = null;
  if (host?.mast) { // on the other system's mast, at its height
    ({ x, z } = { x: host.mast.pos.x + u(MAST_SIDE), z: host.mast.pos.z });
    if (STRUCTURES[id].mount != null) settings = { ...settings, mount: host.mast.def.mount };
  } else if (host?.vehicle) { // onto the vehicle: a second system ahead of its first, a third behind
    rider = host.vehicle;
    vehicle = rider.def.vehicle;
    ({ x, z } = { x: rider.pos.x, z: rider.pos.z + u(RIDER_STEP) * (host.crew.length === 1 ? 1 : -1) });
  }
  settings = onVehicle(id, settings, vehicle);
  const cost = unitCost(id, cleanSettings(id, settings));
  const problem = placementProblem(w, x, z, STRUCTURES[id], cost);
  if (problem) return problem;
  w.state.budget -= cost; w.ledger.capex += cost;
  const s = addStructure(w, id, x, z, { settings, vehicle, rider: !!rider });
  if (rider) { rider.platform ??= nextPlatform(w); s.platform = rider.platform; }
  return null;
}

// What a save keeps of one system, and putting it back. Charging is left to the caller.
function captureOne(s) {
  return {
    id: s.def.id, x: s.pos.x, z: s.pos.z, uplink: s.uplink || null, cellBand: s.cellBand, jam: s.jamBands ? [...s.jamBands] : null,
    ...(s.jamOn && s.def.trigger === 'manual' ? { on: true } : {}), // switched on by hand
    ...(Object.keys(s.def.settings).length ? { settings: { ...s.def.settings } } : {}),
    ...(s.def.vehicle ? { vehicle: s.def.vehicle } : {}),
    ...(s.custom?.name ? { name: s.custom.name } : {}),
    ...(s.custom?.callsign ? { callsign: s.custom.callsign } : {}),
  };
}
function restoreOne(w, l, reserved) {
  const s = addStructure(w, l.id, l.x, l.z, l.vehicle ? { ...l, vehicle: vehicleId(l.vehicle) } : l, reserved);
  if (l.uplink) { s.uplink = l.uplink; w.ledger.terminals[l.uplink]++; }
  s.cellBand = l.cellBand;
  if (l.jam && s.jamBands) s.jamBands = new Set(l.jam.filter((b) => s.def.fitted.includes(b)));
  if (l.on === true && s.jamBands) s.jamOn = true;
  return s;
}

// Move a placed system, with its settings, wiring and name, before the first wave. A vehicle moves with every system on it. Returns why
// it can't, or null; if it can't, the system stays where it was. Nothing is bought or refunded.
export function move(w, s, x, z) {
  if (designLocked(w)) return LAYDOWN_LOCKED;
  if (!w.structures.includes(s)) return 'That system is no longer on the map';
  if (s.escort) return 'A patrol\u2019s systems move with the patrol: change its column instead';
  if (s.def.rider) return 'It rides on a vehicle: move the vehicle';
  const crew = platformOf(w, s), platform = s.platform;
  const kept = crew.map((o) => ({
    l: { ...captureOne(o), rider: !!o.def.rider, name: o.custom?.name || o.autoName, callsign: o.custom?.callsign || o.autoShort }, // it keeps its name
    dx: o.pos.x - s.pos.x, dz: o.pos.z - s.pos.z,
  }));
  const from = { x: s.pos.x, z: s.pos.z };
  for (const o of crew) { if (o.uplink) w.ledger.terminals[o.uplink]--; removeStructure(w, o); } // judged as if it were not there
  const problem = placementProblem(w, x, z, s.def, 0); // nothing is bought, so the budget is not asked
  const at = problem ? from : { x, z };
  const moved = kept.map(({ l, dx, dz }) => restoreOne(w, { ...l, x: at.x + dx, z: at.z + dz }));
  if (platform != null) for (const o of moved) o.platform = platform;
  w.emit('moved', moved[0]);
  return problem;
}

// Sell the nearest system to this point, if one is close enough, or remove the nearest group of people if they are nearer. Selling a
// vehicle's first system sells the vehicle with everything on it.
const PEOPLE_PICK = 60; // metres: a group is drawn small, so a click this close means it
export function sell(w, x, z) {
  if (designLocked(w)) { w.emit('toast', LAYDOWN_LOCKED); return; }
  let best = null, bd = u(150);
  for (const s of w.structures) { const d = hdist(s.pos, { x, z }); if (d < bd && !s.escort) { bd = d; best = s; } } // the escort goes with its patrol
  let group = null, gd = Math.min(bd, u(PEOPLE_PICK));
  for (const g of w.people) { const d = Math.hypot(g.x - x, g.z - z); if (d < gd && !g.patrol) { gd = d; group = g; } }
  if (group) { removePeople(w, group.id); return; }
  if (!best) return;
  for (const s of best.def.rider ? [best] : platformOf(w, best)) {
    const refund = Math.round(s.def.cost * BUILD.sellRefund);
    w.state.budget += refund; w.ledger.capex -= refund;
    if (s.uplink) buyTerminal(w, s.uplink, null); // its terminal is refunded too
    removeStructure(w, s);
  }
}

export function captureLaydown(w) {
  return {
    // sorted, so the order systems were placed in cannot change the run
    structures: w.structures.filter((s) => !s.escort).map(captureOne) // the patrol's escort is rebuilt from its route
      .sort((a, b) => a.id.localeCompare(b.id) || a.x - b.x || a.z - b.z),
    fusionUplinks: [...w.net.fusion.uplinks], fusionCell: w.net.fusion.cellBand,
    ...capturePeople(w),
    ...(w.state.zone ? { zone: w.state.zone } : {}),
    ...(isDefaultMix(w.state.attack) ? {} : { attack: w.state.attack }),
    ...(w.state.conditions === 'day' ? {} : { conditions: w.state.conditions }),
    ...(w.patrol ? { patrol: w.patrol.route, patrolColumn: w.patrol.column, patrolPlan: planOf(w.patrol) } : {}),
  };
}

// Why a saved laydown can't be afforded at today's prices, or null if it can.
export function costProblem(spec) {
  const terminals = [...spec.structures.map((l) => l.uplink), ...spec.fusionUplinks].filter(Boolean);
  const total = spec.structures.reduce((sum, l) => sum + unitCost(l.id, cleanSettings(l.id, l.settings)), 0) + terminals.reduce((sum, k) => sum + COMMS[k].cost, 0);
  return total > ECONOMY.budget ? `That laydown costs ${money(total)}, more than the ${money(ECONOMY.budget)} budget at today's prices` : null;
}

// Rebuild the systems and their wiring, charging the budget as if they had just been bought.
// here: the laydown was made for other ground, so it is laid out round this site and any system that cannot stand on this ground is
// left out. Returns how many were.
export function restoreLaydown(w, spec, here = false) {
  const charge = (v) => { w.state.budget -= v; w.ledger.capex += v; };
  const reserved = new Set(spec.structures.map((l) => cleanCallsign(l.callsign)).filter(Boolean));
  let left = 0;
  for (const l of spec.structures) {
    if (here && groundProblem(w, l.x, l.z)) { left++; continue; }
    const s = restoreOne(w, l, reserved);
    charge(s.def.cost);
    if (l.uplink) charge(COMMS[l.uplink].cost);
  }
  regroupVehicles(w);
  for (const k of spec.fusionUplinks) { w.net.fusion.uplinks.add(k); w.ledger.terminals[k]++; charge(COMMS[k].cost); }
  w.net.fusion.cellBand = spec.fusionCell;
  clearPeople(w);
  restorePeople(w, spec.people);
  applyZone(w, cleanZone(spec.zone));
  w.state.attack = cleanMix(spec.attack);
  applyConditions(w, spec.conditions);
  const refused = spec.patrol && setPatrol(w, spec.patrol, spec.patrolColumn?.map((e) => ({ ...e, vehicle: vehicleId(e.vehicle) })) ?? PATROL.foot.column, spec.patrolPlan ?? DEFAULT_PLAN); // a saved route comes from outside the game, so it is checked again
  if (refused) w.emit('toast', `The saved patrol was left out: ${refused}`);
  return left;
}

// Which drone types the waves send. Like the laydown, it is locked once the first wave starts. Returns why not, or null.
export function setAttack(w, ids) {
  if (designLocked(w)) return 'The attack is locked once the first wave starts';
  if (!hasStrike(ids)) return 'Tick at least one drone that strikes: spotters alone attack nothing';
  w.state.attack = cleanMix(ids);
  return null;
}

// The light and weather the run is fought in. Like the laydown, it is locked once the first wave starts. Returns why not, or null.
export function setConditions(w, name) {
  if (designLocked(w)) return 'The conditions are locked once the first wave starts';
  applyConditions(w, name);
  return null;
}
export function applyConditions(w, name) { w.state.conditions = ENV.now = cleanConditions(name); }

function applyZone(w, points) {
  w.state.zone = points;
  w.state.zoneCentre = points ? zoneCentre(points) : SITE_POS;
}

// The area the enemy attacks, in place of the station. Like the laydown, it is locked once the first wave starts. Returns why not, or null.
export function setZone(w, points) {
  if (designLocked(w)) return 'The area to defend is locked once the first wave starts';
  if (points && w.patrol) return 'Clear the patrol first: with a patrol, the patrol is what the enemy attacks';
  applyZone(w, cleanZone(points));
  return null;
}

// Change one field on one unit, paying or being refunded the difference. A null value goes back to the standard one. Returns why not, or null.
export function configureUnit(w, s, key, value) {
  if (designLocked(w)) return LAYDOWN_LOCKED;
  const field = fieldsFor(s.def.id).find((f) => f.key === key);
  if (!field) return 'That cannot be changed on this system';
  const before = s.def.cost, was = s.def.settings[key];
  if (!setSetting(s.def.settings, field, s.def.id, value)) return field.invalid ?? `Not a valid ${field.label.toLowerCase()}`;
  const delta = s.def.cost - before;
  if (!w.state.packed && delta > w.state.budget) {
    if (was == null) delete s.def.settings[key]; else s.def.settings[key] = was;
    return `Not enough budget (${money(delta)} more needed, ${money(w.state.budget)} left)`;
  }
  w.state.budget -= delta; w.ledger.capex += delta;
  if (key === 'fitted') s.jamBands = new Set([...s.jamBands].filter((b) => s.def.fitted.includes(b))); // a band taken out stops being jammed
  return null;
}

// Give a unit its own name and callsign. An empty one goes back to the automatic one. Returns why not, or null.
export function renameUnit(w, s, name, callsign) {
  if (designLocked(w)) return LAYDOWN_LOCKED;
  const cleanN = cleanName(name), cleanC = cleanCallsign(callsign);
  if (callsign && !cleanC) return 'A callsign is up to 12 letters, numbers, spaces or dashes';
  const short = cleanC || s.autoShort;
  const taken = [...w.net.nodes.values(), w.net.gui].some((o) => o !== s && o.short?.toLowerCase() === short.toLowerCase());
  if (taken) return `${short} is already in use`;
  s.custom = cleanN || cleanC ? { name: cleanN, callsign: cleanC } : undefined;
  w.net.renameNode(s);
  return null;
}

// ---------- the network design: terminals, wires and settings ----------
// Every sensor and effector reaches the fusion node through a terminal (Starlink or cellular) that costs money; the fusion
// node needs its own.
// a system the network can wire: not the perimeter, and not one its crew works by hand off the network
const isNode = (s) => (s.def.role === 'sensor' || s.def.role === 'effector') && s.def.id !== 'perimeter' && s.def.networked !== false;
const locked = (w) => { if (!designLocked(w)) return false; w.emit('toast', 'The network is locked once the first wave starts'); return true; };

export const unwired = (w) => [...w.net.nodes.values()].filter((s) => isNode(s) && !s.uplink);

// kind: 'starlink' | 'cellular' | null (unplug)
export function wireNode(w, s, kind) {
  if (kind && s.def.networked === false) { w.emit('toast', `${s.name} is worked by its crew and cannot be networked`); return false; }
  if (locked(w)) return false;
  if ((s.uplink || null) === kind) return true;
  if (!buyTerminal(w, s.uplink, kind)) return false;
  s.uplink = kind;
  return true;
}
export function wireFusion(w, kind, on) {
  if (locked(w)) return false;
  const f = w.net.fusion.uplinks;
  if (on === f.has(kind)) return true;
  if (on ? !buyTerminal(w, null, kind) : !buyTerminal(w, kind, null)) return false;
  if (on) f.add(kind); else f.delete(kind);
  return true;
}
export function setCellBand(w, s, band) { if (!designLocked(w)) s.cellBand = band; }
export function setFusionCellBand(w, band) { if (!designLocked(w)) w.net.fusion.cellBand = band; }
export function toggleJamBand(w, s, band, on) { if (!on) s.jamBands.delete(band); else if (s.def.fitted.includes(band)) s.jamBands.add(band); } // an operating setting, allowed any time, on fitted bands only

// Wire everything unwired: cellular where a tower reaches well, otherwise Starlink if it has sky, and give the fusion node both.
export function autoWire(w) {
  if (locked(w)) return;
  let cell = 0, sat = 0, none = 0;
  for (const s of w.net.nodes.values()) {
    if (!isNode(s) || s.uplink) continue;
    const c = w.net.comms.linkFor(s, 'cellular', s.cellBand), k = w.net.comms.linkFor(s, 'starlink');
    const pick = c.up && c.quality > 0.4 ? 'cellular' : k.up ? 'starlink' : c.up ? 'cellular' : null;
    if (pick && wireNode(w, s, pick)) pick === 'cellular' ? cell++ : sat++; else none++;
  }
  wireFusion(w, 'starlink', true); wireFusion(w, 'cellular', true);
  w.emit('toast', `Wired ${cell + sat} systems (${cell} cellular, ${sat} Starlink)${none ? `; ${none} could not be connected` : ''}; fusion node on both`);
}
// Wire every networked system, and the fusion node, on one kind of link, replacing what each had. Says how many have no link there.
export function wireAll(w, kind) {
  if (locked(w)) return;
  let done = 0, failed = 0, dead = 0;
  for (const s of w.net.nodes.values()) {
    if (!isNode(s) || s.def.networked === false) continue;
    if (wireNode(w, s, kind)) { done++; if (!w.net.comms.linkFor(s, kind, s.cellBand).up) dead++; } else failed++;
  }
  wireFusion(w, kind, true);
  const name = kind === 'starlink' ? 'Starlink' : 'cellular';
  w.emit('toast', `Wired ${done} systems and the fusion node on ${name}${failed ? `; ${failed} could not be (the budget?)` : ''}${dead ? `; ${dead} have no ${name} link where they stand` : ''}`);
}
export function clearWires(w) {
  if (locked(w)) return;
  for (const s of w.net.nodes.values()) if (isNode(s) && s.uplink) wireNode(w, s, null);
  wireFusion(w, 'starlink', false); wireFusion(w, 'cellular', false);
}
export function setJamming(w, s, on) { if (s.jamBands) s.jamOn = !!on; } // a jammer switched by hand: also allowed any time
