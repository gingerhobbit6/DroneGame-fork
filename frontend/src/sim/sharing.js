// Systems sharing one place: up to three on a vehicle parked from a pack, and a camera with a radar on one mast. Kept apart from
// laydown.js, which places, moves and sells them by these rules.

import { BUILD, MAX_ON_VEHICLE, MOUNTS, carries } from './config/index.js';
import { u, hdist } from './units.js';

export const nextPlatform = (w) => (w.platforms = (w.platforms ?? 0) + 1);

// The systems on one vehicle (s.platform): they share a strike and go down together (targeting.js), move together and are sold together.
export const platformOf = (w, s) => (s.platform == null ? [s] : w.structures.filter((o) => o.platform === s.platform));
// May one vehicle carry these together? Up to MAX_ON_VEHICLE, each one it can carry, and one heavy (class 3) at most: an ASSUMPTION.
export const vehicleTakes = (vehicle, ids) => ids.length <= MAX_ON_VEHICLE && ids.every((id) => carries(vehicle, id)) && ids.filter((id) => MOUNTS[id] === 3).length <= 1;
export const RIDER_STEP = 1.2; // metres along the vehicle from its first system to a second (ahead) or third (behind)

// Where a system placed here goes when others stand within the spacing, or null if it can't, so it is too close:
// - onto a vehicle parked from a pack that has room for it ({ vehicle, crew }), drawn on that vehicle;
// - onto a radar's mast if it is a camera, or a camera's if it is a radar ({ mast }), as on Roke's CORTEXA GUARDIAN, an Overview
//   PodView over Echodyne EchoGuards. One camera and one radar to a mast.
export function hostFor(w, x, z, def) {
  const near = w.structures.filter((s) => hdist(s.pos, { x, z }) < u(BUILD.spacing));
  if (!near.length || near.some((s) => s.escort)) return null;
  const head = near.find((s) => s.def.vehicle && !s.def.rider);
  if (head) {
    const crew = platformOf(w, head);
    return near.every((s) => crew.includes(s)) && vehicleTakes(head.def.vehicle, [...crew.map((s) => s.def.id), def.id]) ? { vehicle: head, crew } : null;
  }
  if (near.length !== 1 || near[0].def.vehicle) return null;
  const kinds = new Set([def.kind, near[0].def.kind]);
  return kinds.size === 2 && kinds.has('camera') && kinds.has('radar') ? { mast: near[0] } : null;
}
export const MAST_SIDE = 1.5; // metres from the mast's middle, so the two models stand side by side at its top

// Systems on one vehicle are saved one by one, a few metres apart, while separate systems stand at least the spacing apart. So systems
// on the same kind of vehicle within a few metres of each other are one vehicle again, the first of them carrying it.
export function regroupVehicles(w) {
  const near = (a, b) => hdist(a.pos, b.pos) < u(RIDER_STEP * 2.5);
  for (const s of w.structures) {
    if (!s.def.vehicle || s.escort || s.platform != null) continue;
    const crew = w.structures.filter((o) => o !== s && !o.escort && o.platform == null && o.def.vehicle === s.def.vehicle && near(o, s));
    if (!crew.length) continue;
    s.platform = nextPlatform(w);
    s.def.rider = false;
    for (const o of crew.slice(0, MAX_ON_VEHICLE - 1)) { o.platform = s.platform; o.def.rider = true; }
  }
}
