// Deployment packs: what one holds, what it costs, and how much of it is already on the map.

import { createContext, useContext } from 'react';
import { STRUCTURES, UNIT_LIMITS } from '../../sim/config/index.js';
import { unitCost } from '../../sim/unit-config.js';

// The signed-in account, for panels inside the game. Null in tests and anywhere outside the login gate.
export const AccountContext = createContext(null);
export const useAccount = () => useContext(AccountContext);

const emptyAssets = () => ({ systems: [], vehicles: [], people: [] });
export const blankPack = () => ({ name: '', echelon: 'section', callsign: '', assets: emptyAssets() });

export function packTotals({ systems = [], vehicles = [], people = [] }) {
  const of = (role) => systems.filter((l) => STRUCTURES[l.id]?.role === role).reduce((n, l) => n + l.count, 0);
  return {
    sensors: of('sensor'),
    effectors: of('effector'),
    vehicles: vehicles.reduce((n, l) => n + l.count, 0),
    people: people.reduce((n, g) => n + g.count, 0),
    cost: systems.reduce((sum, l) => sum + (STRUCTURES[l.id] ? unitCost(l.id, l.settings) : 0) * l.count, 0), // settings can change a system's price
  };
}

export const describeTotals = (t) => [
  [t.sensors, 'sensor'], [t.effectors, 'effector'], [t.vehicles, 'vehicle'], [t.people, 'person', 'people'],
].filter(([n]) => n).map(([n, one, many]) => `${n} ${n === 1 ? one : many ?? `${one}s`}`).join(' · ') || 'Empty';

// A line's count changed by `by`, keeping each id once and dropping lines that reach zero.
export function bump(lines, id, by) {
  const at = lines.findIndex((l) => l.id === id), count = Math.min((at < 0 ? 0 : lines[at].count) + by, UNIT_LIMITS.count);
  if (at < 0) return count > 0 ? [...lines, { id, count }] : lines;
  return count > 0 ? lines.map((l, i) => (i === at ? { ...l, count } : l)) : lines.filter((_, i) => i !== at); // its settings stay
}

// The settings a line's systems are placed with; an empty set goes back to the catalogue's.
export const withSettings = (lines, id, settings) => lines.map((l) => (l.id !== id ? l : Object.keys(settings).length ? { ...l, settings } : { id: l.id, count: l.count }));

// How many of each system the pack holds, which is all the game lets you place while it is deployed.
export const kitOf = (assets) => Object.fromEntries(assets.systems.filter((l) => STRUCTURES[l.id]).map((l) => [l.id, l.count]));

// How many of each system, people group and vehicle are still to place, counting what is on the map now. A vehicle counts
// whether it is parked or in the patrol's column.
export function remaining(assets, sim) {
  const placed = {};
  for (const s of sim.structures) placed[s.def.id] = (placed[s.def.id] ?? 0) + 1;
  const systems = assets.systems.map((l) => {
    const used = Math.min(placed[l.id] ?? 0, l.count); // each system has one line, so none is counted twice
    return { ...l, left: l.count - used };
  });
  const groups = sim.people.map((g) => `${g.count}:${g.protection}`);
  const people = assets.people.map((g) => {
    const at = groups.indexOf(`${g.count}:${g.protection}`);
    if (at >= 0) groups.splice(at, 1);
    return { ...g, left: at < 0 ? 1 : 0 };
  });
  const onVehicles = {};
  for (const s of sim.structures) if (s.def.vehicle) onVehicles[s.def.vehicle] = (onVehicles[s.def.vehicle] ?? 0) + 1;
  const vehicles = assets.vehicles.map((l) => ({ ...l, left: l.count - Math.min(onVehicles[l.id] ?? 0, l.count) }));
  return { systems, people, vehicles };
}
