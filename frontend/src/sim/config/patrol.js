// A foot patrol and the vehicles that escort it. Every number here is a labelled assumption, not a real unit's figures, and each
// can be changed in the Sources tab. See docs/PATROL_MODE.md.
//
// walkSpeed: how fast the group walks its route (m/s). escortGap: how far apart a new vehicle keeps from the last, along the route (m).
// driveSpeed: how fast a mounted patrol drives its route, with the soldiers riding (m/s, about 29 km/h on a track: an ASSUMPTION).
// groupSize: how many soldiers walk in the patrol. spacing: metres between soldiers in a new patrol's formation (the patrol planner
// sets its own). endDelay: seconds the patrol
// waits at the end of its route before it walks back.
export const PATROL = {
  foot: {
    name: 'Foot patrol', walkSpeed: 1.4, driveSpeed: 8, escortGap: 40, groupSize: 12, spacing: 5, endDelay: 60,
    // the column a new patrol gets: gap is metres along the route, ahead of the lead soldier or (negative) behind; side is metres to
    // the right of the way it faces, or (negative) to the left
    column: [{ vehicle: 'hilux', system: 'radar_a800', gap: 40, side: 0 }, { vehicle: 'patria', system: 'missile_rr', gap: -40, side: 0 }],
    desc: 'Soldiers walking a route to its end and back, escorted by vehicles carrying sensors and weapons. The patrol halts while a weapon is engaging.',
  },
  // How the enemy finds a patrol (sim/hunt.js). sightRange: how far a spotter's camera picks out the patrol, with a clear line of sight
  // (m). strikeSight: how far a strike drone with a video link sees it for itself (m). holdRadius: how far from the corridor's middle
  // a strike with no fix circles, waiting for one (m). holdTime: how long it can wait before it must turn for home (s).
  enemy: {
    name: 'Enemy search', sightRange: 3500, strikeSight: 500, holdRadius: 400, holdTime: 600,
    desc: 'Strikes home on the last fix a spotter passed them, which goes stale when the spotter is jammed, shot down or loses sight. A drone with a camera sees the patrol for itself when close.',
  },
};

// The vehicles a patrol can bring, from their published sizes. carries: the heaviest class of system it takes (MOUNTS). mast: how
// high its system's antenna or sensor stands, in metres, an ASSUMPTION from photos of vehicle-mounted kit. armour: a strike does
// 1 / armour of its damage to a system on it, as armour keeps out the blast and fragments that wreck a soft vehicle: an ASSUMPTION.
export const PATROL_VEHICLES = {
  patria: { name: 'Patria 6x6', carries: 3, mast: 3.5, armour: 2, desc: 'Armoured six-wheeler, 7.5 by 2.9 m, over 100 km/h on roads. Carries anything that rides in a patrol.' },
  hilux: { name: 'Toyota Hilux', carries: 2, mast: 3, desc: 'Double-cab pickup, 5.3 by 1.9 m, its system on the load bed. Carries light and medium systems.' },
  themis: { name: 'Milrem THeMIS', carries: 1, mast: 2, desc: 'Milrem Robotics’ tracked uncrewed ground vehicle, 2.47 by 2.04 m and 1.17 m high, 1,650 kg, 20 km/h, 750 kg rated payload (1,200 kg at most). Carries light systems.' },
};

// The systems that can ride in a patrol, and what it takes to carry each: 1 light (any vehicle), 2 medium (a Hilux or a Patria),
// 3 heavy (a Patria). An ASSUMPTION from each product's weight and how it is shown mounted.
export const MOUNTS = {
  rf: 1, rf_s: 1, camera_s: 1, jammer: 1, jammer_s: 1, gun_hmg: 1, interceptor: 1, interceptor_p1: 1, missile_s: 1,
  radar_s: 2, radar_a400: 2, radar_a800: 2, camera: 2, jammer_jupiter: 2, jammer_sf: 2, missile_rr: 2,
  gun_s: 2, gun_50: 2, // a gunner stands in the back, so not on an uncrewed Mule
  radar_giraffe: 3, missile_paladin: 3, gun_skyranger: 3,
  rf_chuyka: 1, rf_rfpatrol: 1, camera_podview: 1, camera_spyke: 1, camera_skyspyke: 2, jammer_vepr: 1, gun_shotgun: 2, gun_droneround: 2, radar_xenta: 3, // field-systems.js
};
// A soldier on foot can take a place in a patrol's column with a hand-held system, walking with the others. Not a vehicle, so it is
// not part of a deployment pack's vehicles: a unit always has soldiers. `takes` lists what one can carry.
export const ON_FOOT = {
  foot: { name: 'Soldier on foot', takes: ['rf_rfpatrol', 'rf_chuyka', 'gun_shotgun', 'gun_droneround'], mast: 1.5, desc: 'A soldier in the patrol carrying a hand-held system: a wearable RF detector, an FPV video detector, a shotgun or a rifle with Drone Round.' },
};
// What can take a place in a patrol's column, and whether it can carry this system.
export const ESCORT_CARRIERS = { ...PATROL_VEHICLES, ...ON_FOOT };
export function escortCarries(carrier, id) {
  const c = ESCORT_CARRIERS[carrier];
  return !!c && Object.hasOwn(MOUNTS, id) && (c.takes ? c.takes.includes(id) : MOUNTS[id] <= c.carries && !ON_FOOT_ONLY.has(id));
}
const ON_FOOT_ONLY = new Set(['gun_shotgun', 'gun_droneround']); // a soldier's own gun is fired on foot, not from a vehicle
// Vehicle ids that older saves and laydown files use, and what each is now. The database is rewritten (migration 0004).
export const RENAMED_VEHICLES = { mule: 'themis' };
export const vehicleId = (id) => RENAMED_VEHICLES[id] ?? id;
export const MAX_ON_VEHICLE = 3; // systems one vehicle carries at most, in a patrol or parked
export const MAX_ON_FOOT = 2; // hand-held systems one soldier carries at most
export const MAX_FOOT_BEARERS = 24; // soldiers in a column carrying systems: MAX_FOOT_BEARERS in backend/app/schemas.py
export const MAX_ESCORTS = 6; // MAX_ESCORTS in backend/app/schemas.py
export const MAX_ESCORT_GAP = 200; // metres
export const MAX_ESCORT_SIDE = 100; // metres: MAX_ESCORT_SIDE in backend/app/schemas.py
// The two kinds of patrol. Dismounted: the soldiers walk, each can carry hand-held systems, and only a THeMIS goes with them.
// Mounted: the vehicles drive at driveSpeed with the soldiers riding, and carry every system. spacing: metres between members, [min, max].
export const PATROL_TYPES = {
  dismounted: { name: 'Dismounted', takes: ['themis', 'foot'], spacing: [2, 30] },
  mounted: { name: 'Mounted', takes: ['patria', 'hilux', 'themis'], spacing: [10, 80] }, // 80 m keeps six vehicles within 200 m of the middle
  // a patrol drawn before choosing, or saved before there was a choice: soldiers walk with any vehicles, as patrols always did
  mixed: { name: 'Mixed', takes: ['patria', 'hilux', 'themis', 'foot'], spacing: [2, 30], older: true },
};
