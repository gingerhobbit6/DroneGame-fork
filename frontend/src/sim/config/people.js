// Simulated people and how well each level of protection shelters them. Every number here is a labelled assumption chosen to teach
// the idea, not casualty data, and each can be changed in the Sources tab.
//
// pCasualty: chance a person at the point of the blast is hurt. reachScale: how far the blast reaches them, as a fraction of the
// drone's casualty radii (CASUALTY). The chance falls off with distance (see sim/people.js).
export const PEOPLE = {
  open: { name: 'Unarmoured', short: 'open', pCasualty: 0.9, reachScale: 1, color: 0xffb74d, desc: 'In the open, with no protection.' },
  building: { name: 'In a building', short: 'bldg', pCasualty: 0.35, reachScale: 0.6, color: 0x90caf9, desc: 'Inside an ordinary building. Click on a building to place them.' },
  bunker: { name: 'In a bunker', short: 'bunker', pCasualty: 0.03, reachScale: 0.2, color: 0xa5d6a7, desc: 'In a hardened shelter, drawn as a low concrete block.' },
};

export const PEOPLE_LIMITS = { groups: 50, perGroup: 500 };

// How far a drone's blast can kill or injure an unprotected person: K x the cube root of its warhead's explosive (kg) in metres,
// as blast and fragments scale. Anchored on the M67 grenade, whose 0.18 kg gives the US Army's 5 m lethal and 15 m casualty radii,
// so K is about 9 and 25. Bigger warheads throw heavier fragments further, so these are likely low for them. ASSUMPTIONS.
export const CASUALTY = {
  lethalK: 9, injuryK: 25,
  sources: [
    { label: 'GlobalSecurity: M67 grenade (US Army manual figures)', url: 'https://www.globalsecurity.org/military/systems/munitions/m67.htm' },
    { label: 'Wikipedia: M67 grenade', url: 'https://en.wikipedia.org/wiki/M67_grenade' },
  ],
};
export const casualtyRadii = (def) => { const c = Math.cbrt(def.warhead || 0); return { lethal: CASUALTY.lethalK * c, injury: CASUALTY.injuryK * c }; };

// Who a group is. It changes only how they are drawn: a soldier and a civilian in the same place are hurt alike.
export const PEOPLE_ROLES = {
  civilian: { name: 'Civilians', desc: 'In everyday clothes.' },
  military: { name: 'Soldiers', desc: 'In MultiCam, with helmets, body armour and rifles.' },
};
