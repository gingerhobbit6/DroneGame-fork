// A foot patrol and the vehicles that escort it. Every number here is a labelled assumption, not a real unit's figures, and each
// can be changed in the Sources tab. See docs/PATROL_MODE.md.
//
// walkSpeed: how fast the group walks its route (m/s). escortGap: how far apart a new vehicle keeps from the last, along the route (m).
// groupSize: how many soldiers walk in the patrol. spacing: metres between soldiers in the formation. endDelay: seconds the patrol
// waits at the end of its route before it walks back.
export const PATROL = {
  foot: {
    name: 'Foot patrol', walkSpeed: 1.4, escortGap: 40, groupSize: 12, spacing: 5, endDelay: 60,
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
  mule: { name: 'Mule UGV', carries: 1, mast: 2, desc: 'A tracked uncrewed carrier in the Milrem THeMIS class, 2.5 by 2.0 m, 20 km/h, up to 1,200 kg. Carries light systems.' },
};

// The systems that can ride in a patrol, and what it takes to carry each: 1 light (any vehicle), 2 medium (a Hilux or a Patria),
// 3 heavy (a Patria). An ASSUMPTION from each product's weight and how it is shown mounted.
export const MOUNTS = {
  rf: 1, rf_s: 1, camera_s: 1, jammer: 1, jammer_s: 1, gun_hmg: 1, interceptor: 1, interceptor_p1: 1, missile_s: 1,
  radar_s: 2, radar_a400: 2, radar_a800: 2, camera: 2, jammer_jupiter: 2, jammer_sf: 2, missile_rr: 2,
  gun_s: 2, gun_50: 2, // a gunner stands in the back, so not on an uncrewed Mule
  radar_giraffe: 3, missile_paladin: 3, gun_skyranger: 3,
};
export const MAX_ESCORTS = 6; // MAX_ESCORTS in backend/app/schemas.py
export const MAX_ESCORT_GAP = 200; // metres
export const MAX_ESCORT_SIDE = 100; // metres: MAX_ESCORT_SIDE in backend/app/schemas.py
