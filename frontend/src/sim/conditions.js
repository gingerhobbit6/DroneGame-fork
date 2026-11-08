// The light and weather a run is fought in. It is an input to the run, like the seed, so it is saved with the laydown and replays.
// A clear day changes nothing. Every factor here is an assumption: the share of its clear-day range a system keeps.
//  - a camera's visible channel fades at dusk and night; a thermal channel works day and night; rain and haze cut both
//  - rain attenuates higher radar bands more, both ways
//  - rain and haze scatter a laser beam; an RF weapon is not affected
//  - rain is noise to an acoustic sensor: about 6 dB more, so half its reach, as a built-up area costs it
import { STRUCTURES } from './config/index.js';
import { thermalSharpness } from './camera-model.js';
import { bandOf } from './sensor-model.js';

export const CONDITIONS = {
  day: { label: 'Clear day', light: 'Daylight', weather: 'Clear', visible: 1, thermal: 1, laser: 1, acoustic: 1, rain: false },
  dusk: { label: 'Dusk', light: 'Dusk', weather: 'Clear', visible: 0.5, thermal: 1, laser: 1, acoustic: 1, rain: false },
  night: { label: 'Night', light: 'Night', weather: 'Clear', visible: 0.1, thermal: 1, laser: 1, acoustic: 1, rain: false },
  rain: { label: 'Rain and haze', light: 'Overcast', weather: 'Rain and haze', visible: 0.5, thermal: 0.6, laser: 0.5, acoustic: 0.5, rain: true },
};
const RAIN_BAND = { s: 1, x: 0.95, ku: 0.85, k: 0.75 }; // radar range kept in rain, by band

// The conditions now. Module state, like the terrain, because range is read in many places that have no world to hand.
export const ENV = { now: 'day' };
export const cleanConditions = (name) => (Object.hasOwn(CONDITIONS, name) ? name : 'day');

// Light a lens gathers against the catalogue's own lens: it goes with the inverse square of the F-number.
const lensLight = (def) => (def.fnumber && STRUCTURES[def.id]?.fnumber ? (STRUCTURES[def.id].fnumber / def.fnumber) ** 2 : 1);

// The share of its clear-day range this system keeps in the conditions now. A camera uses its better channel, and its thermal channel
// is as sharp as its lens and pixels allow.
export function weatherRange(def) {
  const c = CONDITIONS[ENV.now];
  if (def.kind === 'camera') {
    const light = lensLight(def), channels = def.channels ?? 'both';
    const visible = channels === 'thermal' ? 0 : Math.min(1, c.visible * light);
    const thermal = channels === 'visible' ? 0 : Math.min(1, c.thermal * light) * thermalSharpness(def);
    return Math.max(visible, thermal);
  }
  if (def.kind === 'radar') return c.rain ? RAIN_BAND[bandOf(def)] : 1;
  if (def.kind === 'acoustic') return c.acoustic;
  if (def.fire === 'beam' && !def.rfBeam) return c.laser;
  return 1;
}
