// Where a radar looks, and what its hardware and settings change. A rotating radar covers all round. A fixed-panel radar covers its
// arc per panel, the panels side by side and centred on where it faces, as a compass bearing. Every radar covers a band of elevation,
// from 10° below the horizon unless its low edge is raised, so a drone close overhead can be above the beam. Blanking arcs see nothing.

const BELOW_HORIZON = 10; // degrees the lowest beam sits below the horizon: an assumption, so a radar on a mast can look down on low flyers

// Bands a radar can be built for. Against the band it was designed for, a higher band gives a narrower beam, so better angles, and sees
// small drones a little further, at a higher price, and (from stage A5) loses more in rain. All of it is an assumption except the physics
// that angle error goes with wavelength for the same antenna.
export const BANDS = {
  s: { label: 'S band, 3 GHz', f: [[2.9, 3.1]], price: 0.85 },
  x: { label: 'X band, 9.4 GHz', f: [[9.2, 9.6]], price: 1 },
  ku: { label: 'Ku band, 16 GHz', f: [[15.7, 17.0]], price: 1.15 },
  k: { label: 'K band, 24.5 GHz', f: [[24.45, 24.65]], price: 1.3 },
};
const ghzOf = (f) => (f[0][0] + f[0][1]) / 2;
export const bandOf = (def) => { const g = ghzOf(def.emits[0].f); return g < 6 ? 's' : g < 12 ? 'x' : g < 20 ? 'ku' : 'k'; };
const SMALL_TARGET = 1 / 8; // a small drone's radar cross-section rises with frequency (assumed as its square root): range goes with its fourth root

// Clutter filter: a stronger filter throws away more ground clutter, so fewer false alarms, but low flyers have to be closer to be seen,
// and anything with less radial speed than `blind` (m/s) is filtered out with it. Medium is the catalogue's behaviour. Assumptions.
export const CLUTTER = {
  low: { label: 'Low', lowRange: 1.4, falseAlarm: 2, blind: 0 },
  medium: { label: 'Medium', lowRange: 1, falseAlarm: 1, blind: 0 },
  high: { label: 'High', lowRange: 0.7, falseAlarm: 0.5, blind: 4 },
};
export const blindSpeed = (def) => CLUTTER[def.settings?.clutter]?.blind ?? 0;

const MICRO_DOPPLER_REACH = 0.5; // share of its reach inside which micro-Doppler tells a multirotor from a fixed wing: an assumption
export const classifiesAt = (def, range, reach) => def.microDoppler === 'yes' && range <= reach * MICRO_DOPPLER_REACH;

export const coverArc = (def) => Math.min(360, (def.arc ?? 360) * (def.panels ?? 1));
export const elevationBand = (def) => (def.elevation == null ? null : [def.elevLow ?? -BELOW_HORIZON, def.elevTop ?? def.elevation - BELOW_HORIZON]);
export const lowestEdge = -BELOW_HORIZON;

// A narrower elevation band searches less sky, so it dwells longer on what is left: range goes with the fourth root (search radar equation).
export function beamGain(def) {
  const band = elevationBand(def);
  return band ? Math.pow(def.elevation / (band[1] - band[0]), 0.25) : 1;
}
// Range and angle changes from building a radar for another band, against the band its catalogue entry uses.
export const bandRange = (band, def) => Math.pow(ghzOf(BANDS[band].f) / ghzOf(def.emits[0].f), SMALL_TARGET);
export const bandSharpness = (band, def) => ghzOf(def.emits[0].f) / ghzOf(BANDS[band].f);

const within = (az, [from, to]) => ((az - from + 360) % 360) <= ((to - from + 360) % 360); // clockwise from `from` to `to`

// Is a direction, as a compass bearing and an elevation in degrees, inside what this system covers? Only radars, and jammers with a
// sector antenna, are limited here.
export function inCover(def, az, el) {
  if (def.kind !== 'radar' && def.kind !== 'jammer') return true;
  const arc = coverArc(def);
  if (arc < 360 && Math.abs(((((az - (def.facing ?? 0)) % 360) + 540) % 360) - 180) > arc / 2) return false;
  if (def.blank && def.blank.some((b) => within(az, b))) return false;
  const band = elevationBand(def);
  return !band || (el >= band[0] && el <= band[1]);
}

// Does a system at `from` cover the ground direction to `to` ({ x, z }, scene units)?
export const inArcOf = (def, from, to) => inCover(def, ((Math.atan2(to.x - from.x, from.z - to.z) * 180) / Math.PI + 360) % 360, 0);

// Everything that changes what a system covers, for caches of drawn and predicted range.
export const coverKey = (def) => `${coverArc(def)}|${def.facing}|${elevationBand(def)}|${def.blank}|${def.lowRange}`;

// Blanking arcs as typed, "from-to" compass bearings, comma separated, or as saved, [[from, to], ...]. Up to 3, whole degrees.
// Returns the clean list, or undefined if any part is not one.
export function parseArcs(value) {
  const number = (x) => (/^\s*\d{1,3}\s*$/.test(x) ? Number(x) : NaN);
  const parts = typeof value === 'string' ? value.split(',').filter((p) => p.trim()).map((p) => p.split('-').map(number)) : value;
  if (!Array.isArray(parts) || parts.length > 3) return undefined;
  for (const p of parts) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((x) => Number.isInteger(x) && x >= 0 && x < 360) || p[0] === p[1]) return undefined;
  }
  return parts.map(([a, b]) => [a, b]);
}
export const arcsText = (arcs) => (Array.isArray(arcs) ? arcs.map(([a, b]) => `${a}-${b}`).join(', ') : '');

// This system as it would stand at pos, facing as a placed one would. A new object, so the definition it is given is never changed.
export function standingAt(def, centre, pos) {
  const placed = Object.create(def);
  Object.defineProperty(placed, 'facing', { value: def.settings?.facing ?? outwardFrom(centre, pos) }); // defined, as a placed unit's facing is a getter
  return placed;
}

// The compass bearing from the centre of what is defended out to a spot, to the nearest 5°: the way a radar faces unless told otherwise.
export function outwardFrom(centre, pos) {
  const east = pos.x - centre.x, north = centre.z - pos.z;
  if (!east && !north) return 0;
  return (Math.round(((Math.atan2(east, north) * 180) / Math.PI + 360) / 5) * 5) % 360;
}
