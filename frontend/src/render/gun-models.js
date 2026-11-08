// Models of the guns, after the real products' photos: what they stand on, and a head that turns to aim. A crew-served machine
// gun has its gunner standing behind it, turning with it. In model units (2.2 m each at true size).

import { SYSTEM_UNIT_M } from '../sim/config/index.js';
import { soldierFigure } from './figures.js';
import { trailer, tracked } from './system-parts.js';
import { hilux, patria } from './vehicle-models.js';

const { PI } = Math;
const M = 1 / SYSTEM_UNIT_M; // metres to model units

// a barrel along +z from z0, raised `elev` above level, at height y
function barrel(k, r, len, y, z0, elev, x = 0) {
  k.cyl('dark', r, len, x, y + (len / 2) * Math.sin(elev), z0 + (len / 2) * Math.cos(elev), { rx: PI / 2 - elev });
}

// A machine gun on a pintle in a pickup's load bed, its gunner standing behind it.
function pintle(b, h, heavy) {
  const { roof, z } = hilux(b);
  h.post('metal', 0.03, 0.45, 0, 0.22, 0.15);
  h.box('dark', 0.06, 0.08, heavy ? 0.5 : 0.4, 0, 0.47, 0.22);
  barrel(h, heavy ? 0.022 : 0.014, heavy ? 0.5 : 0.35, 0.47, 0.45, 0.15);
  h.box('drab', heavy ? 0.1 : 0.07, 0.08, 0.1, heavy ? 0.08 : 0.06, 0.44, 0.2); // ammunition box
  h.geo('figure', soldierFigure().scale(M, M, M).translate(0, 0, -0.2));
  return { headY: roof, headZ: z };
}

export function gun(b, h, def) {
  switch (def.id) {
    case 'gun_s': return pintle(b, h, false); // L7A2 GPMG
    case 'gun_50': return pintle(b, h, true); // L111A1 .50 cal
    case 'missile_paladin': { // Terrahawk Paladin: a 30 mm gun turret on a trailer, with its ammunition box
      const deck = trailer(b);
      h.box('body', 0.8, 0.6, 1.0, 0, 0.5, 0);
      h.box('drab', 0.4, 0.4, 0.6, 0.6, 0.5, -0.1);
      barrel(h, 0.1, 1.8, 0.9, 0.3, 0.3);
      h.cyl('dark', 0.16, 0.25, 0, 0.9 + 1.9 * Math.sin(0.3), 0.3 + 1.9 * Math.cos(0.3), { rx: PI / 2 - 0.3 }); // muzzle brake
      return { headY: deck };
    }
    case 'gun_skyranger': { // Skyranger 30: an angular turret with its radar panels and a 30 mm gun, on an 8x8
      const { roof, z } = patria(b);
      h.box('body', 0.95, 0.5, 1.1, 0, 0.25, 0);
      for (const x of [-0.5, 0.5]) h.box('dark', 0.04, 0.35, 0.45, x, 0.3, 0.1);
      h.box('dark', 0.35, 0.25, 0.35, 0, 0.62, -0.2); // radar and sights
      barrel(h, 0.06, 1.3, 0.3, 0.5, 0.25);
      return { headY: roof, headZ: z };
    }
    case 'gun_gepard': { // Gepard: a turret with a 35 mm gun on each side and its search radar dish behind, on a tracked hull
      const roof = tracked(b, 3.4);
      h.box('body', 1.0, 0.55, 1.1, 0, 0.28, 0);
      for (const x of [-0.6, 0.6]) { h.box('drab', 0.2, 0.3, 0.6, x, 0.35, 0.1); barrel(h, 0.05, 1.5, 0.38, 0.4, 0.3, x); }
      h.post('metal', 0.04, 0.4, 0, 0.75, -0.35);
      h.box('dark', 0.9, 0.35, 0.06, 0, 1.0, -0.35, { rx: -0.3 }); // search radar
      return { headY: roof };
    }
    case 'gun_l': { // Skynex: a 35 mm revolver gun in a boxy turret on its trailer, a sight on top
      const deck = trailer(b, 3);
      h.box('metal', 0.5, 0.4, 0.5, 0, 0.2, 0);
      h.box('body', 1.0, 0.7, 1.2, 0, 0.75, 0);
      h.box('dark', 0.3, 0.25, 0.3, 0.25, 1.22, -0.1);
      barrel(h, 0.08, 1.9, 0.85, 0.55, 0.3);
      return { headY: deck };
    }
    default: { // a 12.7 mm gun on a remote weapon station, on a Hilux's load bed: sight box, gun and ammunition box
      const { roof, z } = hilux(b);
      h.box('body', 0.3, 0.22, 0.3, 0, 0.11, 0);
      h.box('dark', 0.12, 0.12, 0.14, 0.2, 0.2, 0.05);
      barrel(h, 0.025, 0.75, 0.25, 0.1, 0.25, -0.05);
      h.box('drab', 0.12, 0.12, 0.18, -0.2, 0.18, -0.05);
      return { headY: roof, headZ: z };
    }
  }
}
