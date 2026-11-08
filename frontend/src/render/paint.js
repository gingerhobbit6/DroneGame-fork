// The paint on each system and drone model, and the materials it goes on. The map colour (def.color) stays for labels,
// rings and drop lines. Each colour was checked against photos of the real product (makers' pages, press and wreckage photos)
// in November 2026, and is an estimate of how it looks in daylight, not a paint code: docs/PAINT_SOURCES.md has the source
// and confidence of each.

import * as THREE from 'three';

const NATO_GREEN = 0x4d5a3c, SAND = 0xc2a97d, LIGHT_GREY = 0xa7abad, DARK_GREY = 0x3e4246;

// Systems: the product's own housing, panel, launcher or turret.
const SYSTEMS = {
  radar: 0xedeeec, radar_s: 0xb7a98a, radar_a800: 0xc8b48e, radar_a400: 0xc9b58f, radar_l: 0x56603f, radar_giraffe: 0x66704f,
  rf: 0xf1f2f2, rf_s: 0x262729, rf_elysion: 0xa9aeb1, rf_l: 0xeeeeee, rf_airfence: 0x1f2124,
  camera: 0xbfc4c6, camera_s: 0x1d1d1f, camera_l: 0xd8dad6,
  acoustic_s: 0xc4c7c9, acoustic: 0x2e3032, acoustic_l: 0xe6e7e5,
  jammer: 0x2c2e30, jammer_s: 0x2f3133, jammer_l: 0xa6aaad, jammer_auds: 0xc2aa7e, jammer_neo: 0x5c6047, jammer_jupiter: 0x5c6047,
  jammer_sf: 0x1e1f21, jammer_mk4: 0x2d2f31, jammer_dgmk3: 0x2b2d2f, jammer_dgtac: 0x232425, jammer_skywiper: 0x34373a, jammer_kvertus: 0x2a2b2d,
  interceptor: 0xa79d6e, interceptor_p1: 0x1e1e1f, interceptor_s: 0xe9e9e7, interceptor_l: 0xbdc1c3,
  missile: 0xc1a87c, missile_s: 0x4c504a, missile_l: 0x5a6a45, missile_rr: 0x5e6146, missile_hvm: 0x4b5640, missile_skysabre: 0x4e5a3d, missile_paladin: 0x4f5e3b,
  laser: 0xe7e8e4, laser_s: SAND, laser_l: 0xbca886, laser_rfdew: 0xe2e3e0,
  gun_l: 0x6b6f5d, gun_skyranger: 0x4e5a3e, gun_gepard: 0x4e5c3e, gun_hmg: 0x5a6146, gun_s: 0x2a2b2a, gun_50: 0x2a2b2a,
};
// What they stand on or ride in, cases and boxes too: NATO green, or tan where the real system goes with desert vehicles.
const VEHICLES = { missile: SAND, laser_s: SAND, laser_l: 0xbca886 };

// Drones: the airframe. A generic type takes the colour of the drone most seen of its kind.
const DJI_DARK = ['mavic3', 'mavic3t', 'mavic3pro'], FPV = ['fpv', 'fo', 'fpv7inch', 'fpv10inch', 'fpv13inch', 'fpvlastmile'];
const DRONES = {
  fw: 0x1e1f21, geran2: 0x1b1c1e, geran3: 0x1b1c1e, shahed136: 0xc5c9cc, shahed131: 0xc5c9cc, gerbera: 0x2a2b2d, // Russian-built are black, Iranian grey
  spotter: 0xd3d6d8, orlan10: 0xd3d6d8, lancet3: 0xd4d7d9, molniya2: 0xececea, kvn: 0xc8b540, // the KVN's square frame is yellow fibreglass
  mohajer6: 0xc9ccce, ababil2: 0xe2e4e5, ch901: 0xcdd0d2, feilong300d: 0xc3c7ca, sunflower200: 0xcfd2d4, asn209: 0xeeefee, asn301: 0xcbced0,
  skywalker: 0xf2f2f0, wingloong2: 0xb9bfc4,
  mini4pro: 0xb8bbbe, matrice30t: 0x3d4044, matrice300: 0x2b2d30, agrast30: 0xd0d3d5, evomax4t: 0x85898d, evo2t: 0xf0641e,
  ...Object.fromEntries(DJI_DARK.map((id) => [id, 0x4a4d51])), ...Object.fromEntries(FPV.map((id) => [id, 0x1c1c1c])),
};

export const paintOf = (def) => (def.kind ? SYSTEMS[def.id] ?? SYSTEMS[def.variantOf] ?? LIGHT_GREY
  : DRONES[def.id] ?? DRONES[def.variantOf] ?? (def.model === 'quad' ? DARK_GREY : LIGHT_GREY));
export const vehiclePaintOf = (def) => VEHICLES[def.id] ?? NATO_GREEN;

// A faint studio reflection on the models only, made by game-view.js, which has the renderer; without one they are simply lit.
let env = null;
export function setModelEnv(texture) { env = texture; }

// A model material: smooth shaded, no glow, both sides drawn as some parts are open shells.
export const modelMat = (color, roughness = 0.6, metalness = 0.15, envMapIntensity = 0.4) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, envMap: env, envMapIntensity, side: THREE.DoubleSide });
