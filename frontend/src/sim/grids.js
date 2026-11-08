// The national grids real maps can be on. Great Britain's northings stop at 1,300 km and Estonia's start at 6,365 km, so a position says
// for itself which grid it is on. A world's identity and everything else that carries an easting and northing needs no extra field.

import { bngToWgs84, gridRef as bngRef, onGrid as onBng, parseGridRef, wgs84ToBng } from './bng.js';
import { lest97Ref, lest97ToWgs84, onLest97, wgs84ToLest97 } from './lest97.js';
import { mgrsRef } from './mgrs.js';

const EAST_NORTH = /^\s*E?\s*(\d{4,7}(?:\.\d+)?)\s*E?\s*[,\s]\s*N?\s*(\d{4,7}(?:\.\d+)?)\s*N?\s*$/i;
const LAT_LON = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS]?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW]?)\s*$/i;
const FIRST_ESTONIAN_NORTH = 6000000;

export const isEstonian = (n) => n >= FIRST_ESTONIAN_NORTH;
export const onGrid = (e, n) => (isEstonian(n) ? onLest97(e, n) : onBng(e, n));
export const gridRef = (e, n, figures = 6) => (isEstonian(n) ? lest97Ref(e, n, figures) : bngRef(e, n, figures));
export const toLatLon = (e, n) => (isEstonian(n) ? lest97ToWgs84(e, n) : bngToWgs84(e, n));
// The same place as an MGRS reference, which works anywhere.
export const mgrsAt = (e, n, figures = 6) => { const { lat, lon } = toLatLon(e, n); return mgrsRef(lat, lon, figures); };

// The grid a world is on, for positions that may fall just past the part of it a site can use, as tile corners at a border do.
export const gridFor = (n) => (isEstonian(n) ? wgs84ToLest97 : wgs84ToBng);

// A GPS position on whichever grid covers it. Elsewhere it comes back off every grid, so onGrid refuses it.
export function fromLatLon(lat, lon) {
  const estonian = wgs84ToLest97(lat, lon);
  return onLest97(estonian.e, estonian.n) ? estonian : wgs84ToBng(lat, lon);
}

// A grid reference, eastings then northings in metres, or latitude then longitude in decimal degrees.
// Gives { e, n }, which may be off the grid (check with onGrid), or null if it cannot be read.
export function parsePosition(text) {
  const grid = parseGridRef(text);
  if (grid) return grid;
  const metres = EAST_NORTH.exec(text || '');
  if (metres) {
    const first = Number(metres[1]), second = Number(metres[2]);
    return isEstonian(first) && !isEstonian(second) ? { e: second, n: first } : { e: first, n: second }; // Estonian surveyors write the northing first
  }
  const degrees = LAT_LON.exec(text || '');
  if (!degrees) return null;
  const [, lat, ns, lon, ew] = degrees;
  if ((lat.startsWith('-') && ns) || (lon.startsWith('-') && ew)) return null; // "-1.7 W" could mean either side of Greenwich
  const latitude = (/s/i.test(ns) ? -1 : 1) * Number(lat), longitude = (/w/i.test(ew) ? -1 : 1) * Number(lon);
  return Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ? null : fromLatLon(latitude, longitude);
}
