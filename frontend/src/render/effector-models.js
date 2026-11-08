// Models of the interceptors, missiles, guns and lasers, after the real products' photos. Each takes the kit for what stands
// still and the kit for the head, which turns to aim, and returns where the head sits. Launchers fire from about the height
// of their effector's muzzleY.

import { trailer, truck, tracked, tripodLegs, cabin } from './system-parts.js';

const { PI } = Math;

// Tubes (round) or canisters (square), rows by cols, raised `elev` above level, centred at height y.
function pack(k, rows, cols, w, len, elev, y, { round = true, x0 = 0 } = {}) {
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const x = x0 + (j - (cols - 1) / 2) * w * 1.08, v = (i - (rows - 1) / 2) * w * 1.08;
    if (round) k.cyl('body', w / 2, len, x, y + v * Math.cos(elev), -v * Math.sin(elev), { rx: PI / 2 - elev });
    else k.box('body', w, w, len, x, y + v * Math.cos(elev), -v * Math.sin(elev), { rx: -elev });
  }
}

// a small quadcopter interceptor sitting ready. A parked drone's propellers do not turn, so their still blades merge into one mesh
const blades = (k, d, x, y, z) => k.box('dark', d, 0.012, d * 0.09, x, y, z, { rx: 0.3, ry: 0.6 });
function miniQuad(k, x, y, z) {
  k.cyl('body', 0.1, 0.4, x, y + 0.1, z, { r2: 0.05, rx: PI / 2 });
  for (const dx of [-0.22, 0.22]) for (const dz of [-0.2, 0.2]) { k.post('dark', 0.03, 0.06, x + dx, y + 0.1, z + dz); blades(k, 0.3, x + dx, y + 0.14, z + dz); }
}

export function interceptor(b, h, def) {
  switch (def.id) {
    case 'interceptor_s': { // Fortem DroneHunter F700: a large hexacopter with a net gun, on its trailer
      const deck = trailer(b);
      h.box('body', 0.7, 0.35, 0.9, 0, 0.2, 0);
      for (let i = 0; i < 6; i++) { const a = PI / 6 + (i * PI) / 3, x = Math.sin(a), z = Math.cos(a); h.strut('body', [0, 0.3, 0], [x, 0.35, z], 0.06); blades(h, 0.8, x, 0.42, z); }
      h.cyl('dark', 0.12, 0.5, 0, 0.1, 0.5, { rx: PI / 2 });
      return { headY: deck };
    }
    case 'interceptor_l': { // Project Eagle Merops: a small fixed-wing interceptor on a launch rail on a pickup
      const bed = truck(b);
      h.strut('metal', [0, 0, -1.1], [0, 0.9, 0.7], 0.1);
      h.cyl('body', 0.1, 1.0, 0, 0.62, 0.15, { r2: 0.06, rx: PI / 2 - 0.45 });
      h.box('body', 1.4, 0.04, 0.25, 0, 0.62, 0.15, { rx: -0.45 });
      return { headY: bed, headZ: -0.6 };
    }
    default: { // Wild Hornets Sting, SkyFall P1-SUN: small interceptor drones ready on their launch case, by the ground station
      b.box('drab', 1.0, 0.5, 0.7, 1.1, 0.25, -0.7);
      b.box('dark', 0.9, 0.6, 0.04, 1.1, 0.8, -1.0, { rx: -0.3 });
      h.box('drab', 1.4, 0.6, 1.2, 0, 0.3, 0);
      for (const x of [-0.35, 0.35]) miniQuad(h, x, 0.6, 0);
      return { headY: 0 };
    }
  }
}

export function missile(b, h, def) {
  switch (def.id) {
    case 'missile_s': // Frankenburg Mark I: two slim launch tubes on a tripod
      pack(h, 1, 2, 0.18, 1.2, 0.35, 0.1);
      tripodLegs(b, 1.6, 0.9);
      return { headY: 1.6 };
    case 'missile_l': { // NASAMS: six canisters in a frame on a trailer
      const deck = trailer(b, 3.2);
      h.box('metal', 0.5, 0.4, 0.6, 0, 0.2, 0);
      pack(h, 2, 3, 0.42, 2.8, 0.45, 1.0, { round: false });
      return { headY: deck };
    }
    case 'missile_rr': case 'missile_hvm': { // Rapid Ranger on a truck, HVM on a Stormer: a sight between two pods of tubes
      const roof = def.id === 'missile_hvm' ? tracked(b) : truck(b);
      h.box('body', 0.5, 0.6, 0.6, 0, 0.5, 0);
      for (const x0 of [-0.55, 0.55]) pack(h, 2, 2, 0.2, 1.3, 0.3, 0.7, { x0 });
      return { headY: roof, headZ: def.id === 'missile_hvm' ? 0 : -0.6 };
    }
    case 'missile_skysabre': { // Sky Sabre: a block of canisters standing upright on a truck, fired straight up
      const bed = truck(b, 4.2);
      pack(b, 2, 4, 0.3, 1.6, PI / 2, bed + 0.8, { round: false });
      return { headY: bed + 1.6 };
    }
    default: { // Raytheon Coyote: four canisters raised on a trailer
      const deck = trailer(b);
      h.box('metal', 0.4, 0.5, 0.5, 0, 0.25, 0);
      pack(h, 2, 2, 0.45, 2.2, 0.5, 1.2, { round: false });
      return { headY: deck };
    }
  }
}

// a laser's beam director: a drum held in a yoke, its window forward
function director(k, r, y) {
  k.box('dark', r * 2.6, 0.15, r * 1.4, 0, 0.08, 0);
  for (const x of [-r * 1.2, r * 1.2]) k.box('dark', 0.12, y, r * 0.8, x, y / 2, 0);
  k.cyl('body', r, r * 2.1, 0, y, 0, { rz: PI / 2, seg: 14 });
  k.cyl('glass', r * 0.6, 0.06, 0, y, r * 0.98, { rx: PI / 2, seg: 14 });
}

export function laser(b, h, def) {
  switch (def.id) {
    case 'laser_s': { // AeroVironment LOCUST: a small beam director raised over a vehicle's load bed
      const bed = truck(b);
      b.box('drab', 0.8, 0.9, 0.8, 0, bed + 0.45, -0.6);
      director(h, 0.3, 0.5);
      return { headY: bed + 0.9, headZ: -0.6 };
    }
    case 'laser_rfdew': // Thales RapidDestroyer: a radio-frequency weapon, its large flat antenna tilted up on a truck
      h.box('dark', 0.4, 0.5, 0.4, 0, 0.25, 0);
      h.box('body', 1.4, 1.2, 0.15, 0, 0.9, 0.1, { rx: -0.4 });
      return { headY: truck(b), headZ: -0.6 };
    case 'laser_l': // Rafael Iron Beam: a large beam director on its container
      director(h, 0.8, 1.0);
      return { headY: cabin(b, 4.2) };
    default: // DragonFire: a beam director on its cabin
      director(h, 0.55, 0.8);
      return { headY: cabin(b) };
  }
}
