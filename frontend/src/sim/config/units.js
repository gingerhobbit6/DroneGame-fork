// Deployment packs: a military unit and the real systems, vehicles and people assigned to it, kept on the player's profile.
// The ids match Echelon in backend/app/account_schemas.py, whose tests read this file. A pack's vehicles are PATROL_VEHICLES.

import { MOUNTS, PATROL_VEHICLES } from './patrol.js';

export const ECHELONS = {
  fireteam: { name: 'Fire team', desc: 'Four soldiers, often with one handheld system.' },
  section: { name: 'Section', desc: 'Eight to ten soldiers: a small counter-drone detachment.' },
  platoon: { name: 'Platoon', desc: 'Around thirty soldiers in three sections.' },
  troop: { name: 'Troop', desc: 'An artillery or air defence platoon, usually with its own sensors and launchers.' },
  company: { name: 'Company', desc: 'Around a hundred soldiers in three platoons.' },
  squadron: { name: 'Squadron', desc: 'A company-sized cavalry, signals or air defence unit.' },
  battery: { name: 'Battery', desc: 'An artillery or air defence company with its radars and launchers.' },
  battalion: { name: 'Battalion', desc: 'Several companies or batteries under one headquarters.' },
};

// Whether a vehicle can carry a system, parked or in a patrol.
export const carries = (vehicle, id) => Object.hasOwn(PATROL_VEHICLES, vehicle ?? '') && Object.hasOwn(MOUNTS, id) && MOUNTS[id] <= PATROL_VEHICLES[vehicle].carries;

export const UNIT_LIMITS = { lines: 40, count: 50, peopleGroups: 20 }; // MAX_UNIT_LINES, MAX_UNIT_COUNT and the people limit in account_schemas.py
