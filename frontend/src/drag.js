// Dragging a system (on a pack's vehicle, or not) or a group of people from a list onto the map. Only this game's own cards carry DRAG_TYPE.

import { PEOPLE, PEOPLE_LIMITS, STRUCTURES, carries } from './sim/config/index.js';

export const DRAG_TYPE = 'application/x-site-guard';

// What the map accepts from a drag, checked because a drop can carry anything another page put on the clipboard.
export function readDrop(text) {
  let item;
  try { item = JSON.parse(text); } catch { return null; }
  if (item && typeof item.system === 'string' && Object.hasOwn(STRUCTURES, item.system)) {
    if (item.vehicle == null) return { system: item.system };
    return carries(item.vehicle, item.system) ? { system: item.system, vehicle: item.vehicle } : null; // parked on a vehicle from a pack
  }
  const g = item?.people;
  if (g && Number.isInteger(g.count) && g.count >= 1 && g.count <= PEOPLE_LIMITS.perGroup && Object.hasOwn(PEOPLE, g.protection)) return { people: { count: g.count, protection: g.protection } };
  return null;
}
