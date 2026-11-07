// What the wizard knows: which steps are done, and which weapon answers which drone. It only reads the game, and only what
// the player could see for themselves: the config and the laydown, never the wave queue or where drones really are.

import { DRONE_CLASSES, STRUCTURES, TOOLBAR } from '../../sim/config/index.js';
import { reachFor } from '../../sim/network/sensors.js';
import { typicalAltitude } from '../../sim/site-range.js';

export const STEP_IDS = ['zone', 'sensors', 'effectors', 'network', 'coverage', 'people', 'rehearse', 'refine', 'preflight'];

const placed = (sim, role) => sim.structures.filter((s) => s.def.role === role);
// With a deployment pack, what of it is still to place ({ id: how many }); null without a pack, when the whole catalogue is open.
export function kitLeft(sim) {
  const kit = sim.state.kit;
  if (!kit) return null;
  const left = { ...kit };
  for (const s of sim.structures) if (left[s.def.id]) left[s.def.id]--;
  return Object.fromEntries(Object.entries(left).filter(([, n]) => n > 0));
}
const budgetOf = (sim) => (sim.state.packed ? Infinity : sim.state.budget); // a pack's budget only counts the cost
// One size of each kind, for the table of which kinds answer which drone. Which size to buy is systemFor's job.
const catalogue = (role) => Object.values(STRUCTURES).filter((d) => d.role === role && (d.size ?? 'M') === 'M' && !d.variantOf);

// A short verdict for how this effector does against this drone, read from its rules so edits cannot make it wrong.
export function answer(drone, def) {
  if (drone.alt[0] > def.range) return 'Far'; // it never comes down within reach
  if (def.fire === 'jam') return drone.jamResist >= 1 ? 'No' : drone.jamResist > 0.6 ? 'Hard' : drone.jamResist > 0 ? 'Part' : 'Yes';
  if (def.fire === 'beam') return drone.loiterDist > def.range ? 'Far' : drone.evade < 0.7 ? 'Slow' : 'Yes';
  if (def.engages && !def.engages.includes(drone.variantOf ?? drone.id)) return 'No';
  if (def.engagePolicy === 'fixed-wing' && drone.model !== 'fw') return 'Last';
  return 'Yes';
}
export const COUNTS = new Set(['Yes', 'Slow', 'Part']);

export const effectorColumns = () => catalogue('effector');

// Drone types nothing in the laydown can answer yet, in catalogue order.
export function unanswered(sim) {
  const defs = placed(sim, 'effector').map((s) => s.def);
  return DRONE_CLASSES.filter((d) => !defs.some((def) => COUNTS.has(answer(d, def))));
}

// Seconds of warning each role should give against a drone flying straight in: time to cue a camera and task a weapon, or to
// engage before it arrives. Assumptions, which make the advice scale with how fast the threat flies.
export const WARNING = { sensor: 60, effector: 20 };

const familyOf = (kind) => TOOLBAR.find((g) => g.kind === kind);
export const kindName = (kind) => familyOf(kind).name;

// How far out along the ground this system reaches this drone at its usual height: 0 if the drone flies above its reach.
// Ground clutter also hides a low flyer from radar beyond its low-flyer range.
export function reachAgainst(def, drone) {
  const flies = typicalAltitude(drone);
  const reach = def.role !== 'sensor' ? def.range : Math.min(reachFor(def, drone), def.lowAlt && flies < def.lowAlt ? def.lowRange : Infinity);
  return Math.sqrt(Math.max(reach ** 2 - flies ** 2, 0));
}

export const warningAgainst = (def, drone) => reachAgainst(def, drone) / drone.speed;

// Which system of this kind to place against these drones: the one that gives enough warning of the most of them, then the
// cheapest of those. If it warns of none, the one that reaches furthest. It stays within the budget while anything fits.
// With a pack, only what of it is left to place (kit); undefined if none of it fits.
export function systemFor(kind, threats, budget, kit = null) {
  const fits = familyOf(kind).classes.filter((id) => !kit || kit[id]).map((id) => STRUCTURES[id]).filter((def) => def.role === 'sensor' || threats.some((d) => answer(d, def) === 'Yes'));
  if (!fits.length) return undefined;
  const affordable = fits.filter((def) => def.cost <= budget);
  const warned = (def) => threats.filter((d) => warningAgainst(def, d) >= WARNING[def.role]).length;
  const furthest = (def) => Math.max(...threats.map((d) => reachAgainst(def, d)));
  return [...(affordable.length ? affordable : fits)].sort((a, b) => warned(b) - warned(a) || (warned(a) ? a.cost - b.cost : furthest(b) - furthest(a)))[0];
}

// The system to answer this drone: the cheapest kind that clearly does, in the size this drone calls for.
// With a pack, the cheapest of its own systems left to place that answers it, or undefined.
export function effectorFor(drone, budget = Infinity, kit = null) {
  const kinds = kit ? Object.keys(kit).map((id) => STRUCTURES[id]).filter((def) => def.role === 'effector') : catalogue('effector');
  const cheapest = kinds.filter((def) => answer(drone, def) === 'Yes').sort((a, b) => a.cost - b.cost)[0];
  return cheapest && systemFor(cheapest.kind, [drone], budget, kit);
}

// Each kind of sensor, marked with whether it is in the laydown yet and which system to place against these drones.
// With a pack, only the kinds it holds, each with its own system: done once all of that kind in the pack is placed.
export function sensorChecklist(sim, threats = DRONE_CLASSES) {
  const have = new Set(placed(sim, 'sensor').map((s) => s.def.kind)), left = kitLeft(sim), kit = sim.state.kit;
  const kinds = catalogue('sensor').map((def) => def.kind).filter((kind, i, all) => all.indexOf(kind) === i)
    .filter((kind) => !kit || familyOf(kind).classes.some((id) => kit[id]));
  return kinds.map((kind) => {
    const def = systemFor(kind, threats, budgetOf(sim), left) ?? systemFor(kind, threats, Infinity, kit); // all placed: name what was
    return { kind, name: kindName(kind), def, threats, done: left ? !familyOf(kind).classes.some((id) => left[id]) : have.has(kind) };
  });
}

export function stepStatus(sim, zone) {
  const kinds = new Set(placed(sim, 'sensor').map((s) => s.def.kind));
  return {
    zone: !!(zone && zone.closed),
    sensors: sim.state.kit ? sensorChecklist(sim).every((r) => r.done) : kinds.has('radar') && kinds.size >= 2,
    effectors: sim.state.kit ? unanswered(sim).every((d) => !effectorFor(d, Infinity, kitLeft(sim))) : unanswered(sim).length === 0, // nothing left in the pack would help
    network: sim.structures.length > 0 && sim.unwired().length === 0 && sim.net.fusion.uplinks.size > 0,
  };
}

// The step the game is really at: the first one neither done nor already passed by the player.
export const firstOpen = (status, passed) => {
  const i = STEP_IDS.findIndex((id) => !status[id] && !passed[id]);
  return i < 0 ? STEP_IDS.length - 1 : i;
};

// Something the player had finished has come undone, such as selling their only radar. Returns its step id, or null.
export function undone(before, now) {
  return ['sensors', 'effectors', 'network'].find((id) => before[id] && !now[id]) || null;
}

