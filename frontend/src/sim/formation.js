// Where each member of a patrol stands, relative to the lead soldier: metres along the route (ahead positive) and across it (right
// positive). Each member follows the route at its own place along it, so the shape bends round turns as a real patrol's does.

import { pointAt } from './route.js';
import { u } from './units.js';

export const FORMATIONS = {
  file: { name: 'Single file', desc: 'One behind the other.' },
  staggered: { name: 'Staggered column', desc: 'Two files, each soldier offset from the one opposite.' },
  wedge: { name: 'Wedge', desc: 'A V behind the lead, spreading out to each side.' },
};

// The soldier's place, in metres, for soldier i of a formation with this spacing.
export function soldierSpot(formation, i, spacing) {
  if (formation === 'staggered') return { along: -Math.floor(i / 2) * spacing - (i % 2) * (spacing / 2), across: i % 2 ? spacing / 2 : -spacing / 2 };
  if (formation === 'wedge') { const k = Math.ceil(i / 2); return { along: -k * spacing, across: i % 2 ? k * spacing : -k * spacing }; }
  return { along: -i * spacing, across: 0 };
}

// The spot, in scene units, of a member this many metres along and across from the lead. dir is 1 walking out and -1 walking back,
// so ahead and right stay ahead and right of the way the patrol faces.
export function placeIn(p, along, across) {
  const q = pointAt(p, p.dist + p.dir * u(along)), hx = q.dx * p.dir, hz = q.dz * p.dir;
  return { x: q.x - hz * u(across), z: q.z + hx * u(across) };
}
