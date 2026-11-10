// What a radio detector hears, and the bands a jammer can be fitted for. A drone radiates on the bands of its control and video links
// (SPECTRUM in config/comms.js), and a detector hears it only on a band it covers, and only while none of your own jammers nearby is
// filling that band. A classifier library names the airframe when it knows the family of the drone's link; with none, the detector
// hears energy and nothing more.

import { SPECTRUM, overlaps } from './config/index.js';

// A drone that radiates on a band no source gives, such as a mesh modem, is taken to use the common 2.4 GHz band: an assumption.
const UNKNOWN_BAND = 'control24';
const LINK_BANDS = Object.keys(SPECTRUM.bands).filter((b) => b !== 'gnss'); // drones only receive navigation signals

// Libraries a detector can carry, and the link families each knows (a drone's `protocol`). Every catalogue detector comes with the
// commercial one, as sold. Prices are a share of the detector's own price. All assumptions.
export const LIBRARIES = {
  none: { label: 'None: energy only', name: 'no', knows: null, price: -0.2 },
  commercial: { label: 'Commercial (DJI, Autel)', name: 'commercial', knows: ['commercial'], price: 0 },
  hobby: { label: 'FPV and hobby (ELRS, Crossfire)', name: 'FPV and hobby', knows: ['hobby'], price: 0.15 },
  tactical: { label: 'Tactical (long-range military)', name: 'tactical', knows: ['tactical'], price: 0.25 },
  full: { label: 'Full: all three', name: 'full', knows: ['commercial', 'hobby', 'tactical'], price: 0.4 },
};
export const libraryKnows = (def, droneDef) => !!LIBRARIES[def.library]?.knows?.includes(droneDef.protocol);

export const bandGhz = (id) => (SPECTRUM.bands[id].f[0][0] + SPECTRUM.bands[id].f[0][1]) / 2;

// Every band a jammer can be fitted for. A list of bands, as typed or saved, made clean: from those allowed, once each, in their order, at least one.
export const JAM_BANDS = Object.keys(SPECTRUM.bands);
export function parseBands(value, allowed = JAM_BANDS) {
  if (!Array.isArray(value) || !value.length || !value.every((b) => allowed.includes(b))) return undefined;
  return allowed.filter((b) => value.includes(b));
}

// The bands a drone radiates on.
export function radiates(droneDef) {
  if (!droneDef.rfEmitter) return [];
  const links = droneDef.links || {};
  const bands = [links.control, links.video].filter((b) => LINK_BANDS.includes(b));
  return bands.length ? bands : [UNKNOWN_BAND];
}

// The drone bands this detector covers and monitors, or a jammer's receiver: the link bands it is fitted for.
export const covers = (def) => LINK_BANDS.filter((b) => (def.kind === 'jammer' ? def.fitted.includes(b) : overlaps(SPECTRUM.bands[b].f, def.listens || []) && (!def.monitored || def.monitored.includes(b))));

// The band a detector hears this drone on, or null: the one it can that carries furthest (bandReach). deaf: bands it cannot hear now.
export function heardBand(def, droneDef, deaf) {
  let best = null;
  for (const b of radiates(droneDef)) if (!deaf?.has(b) && covers(def).includes(b) && (!best || bandReach(b, droneDef) > bandReach(best, droneDef))) best = b;
  return best;
}

// How far a drone's link on this band is heard, against the link a detector's range is quoted for: a small first-person-view drone's
// 2.4 GHz control link. In free space, with the same antenna gain on every band, reach goes with wavelength (the Friis equation): a
// 900 MHz link is heard 2.7 times as far, a 5.8 GHz one 0.42 times. A video sender is taken to be 5 dB louder than the return on a
// control link, the 25 dBm against 20 dBm of the link budgets in config/sensors.js, which brings 5.8 GHz video to 0.75. Assumptions.
const QUOTED_BAND = 'control24', VIDEO_LOUDER = 10 ** (5 / 20);
export const bandReach = (band, droneDef) => (bandGhz(QUOTED_BAND) / bandGhz(band)) * (droneDef.links?.video === band ? VIDEO_LOUDER : 1);
