// The patrol's vehicles, in system model units (2.2 m each at true size, SYSTEM_UNIT_M), front along +z, from their published
// dimensions. Each returns where a mounted system's head sits on it: its height and how far along it.

const { PI } = Math;
const wheel = (k, r, w, x, y, z) => k.cyl('dark', r, w, x, y, z, { rz: PI / 2, seg: 12 });

// Patria 6x6: 7.5 m long, 2.9 m wide and 2.5 m to the hull top, on three axles, with a sloped nose and a remote weapon ring.
export function patria(k) {
  for (const z of [1.05, 0.15, -1.0]) for (const x of [-0.58, 0.58]) wheel(k, 0.25, 0.16, x, 0.25, z);
  k.box('drab', 1.18, 0.38, 3.2, 0, 0.5, -0.05); // lower hull, between the wheels
  k.box('drab', 1.32, 0.42, 2.7, 0, 0.93, -0.3); // upper hull
  k.box('drab', 1.32, 0.35, 0.8, 0, 0.82, 1.35, { rx: 0.5 }); // sloped nose
  k.box('dark', 0.9, 0.08, 0.3, 0, 1.05, 1.0, { rx: 0.5 }); // driver's vision blocks
  k.cyl('drab', 0.32, 0.08, 0, 1.18, -0.6, { seg: 12 }); // weapon ring
  return { roof: 1.22, z: -0.6 };
}

// Toyota Hilux double cab: 5.33 m long, 1.86 m wide, 1.82 m tall, with its load bed behind the cab, in military olive.
export function hilux(k) {
  for (const z of [0.78, -0.72]) for (const x of [-0.37, 0.37]) wheel(k, 0.17, 0.12, x, 0.17, z);
  k.box('drab', 0.85, 0.28, 2.42, 0, 0.34, 0); // chassis and lower body
  k.box('drab', 0.85, 0.15, 0.75, 0, 0.55, 0.85); // bonnet
  k.box('drab', 0.82, 0.34, 0.95, 0, 0.66, 0.05); // double cab
  k.box('dark', 0.78, 0.2, 0.04, 0, 0.7, 0.53, { rx: -0.4 }); // windscreen
  for (const x of [-0.41, 0.41]) k.box('drab', 0.03, 0.14, 0.72, x, 0.55, -0.78); // bed sides
  k.box('drab', 0.85, 0.14, 0.03, 0, 0.55, -1.2); // tailgate
  return { roof: 0.48, z: -0.75 };
}

// Milrem THeMIS: 2.47 m long, 2.04 m wide and 1.17 m tall, two track units with a payload deck between them.
export function themis(k) {
  for (const x of [-0.37, 0.37]) {
    k.box('dark', 0.2, 0.36, 1.12, x, 0.2, 0);
    k.box('drab', 0.22, 0.12, 1.0, x, 0.42, 0); // track unit cover
  }
  k.box('drab', 0.56, 0.12, 0.9, 0, 0.44, 0); // payload deck
  k.box('dark', 0.2, 0.1, 0.1, 0, 0.52, 0.5); // its cameras
  return { roof: 0.5, z: 0 };
}

export const VEHICLES = { patria, hilux, themis };
