// The Military Grid Reference System: UTM on WGS 84, with letters for each 100 km square. It covers the world, so every real map can
// show it, not only Great Britain's and Estonia's own grids. Northern hemisphere only, as every map pack is.

import { transverseMercator } from './bng.js';

const COLUMNS = 'ABCDEFGHJKLMNPQRSTUVWXYZ', ROWS = 'ABCDEFGHJKLMNPQRSTUV', BANDS = 'CDEFGHJKLMNPQRSTUVWX'; // no I or O
const RAD = Math.PI / 180, WGS84 = { a: 6378137, b: 6356752.314245, f0: 0.9996, phi0: 0, e0: 500000, n0: 0 };

// shortcut: leaves out the wider zones round Norway and Svalbard, as no map pack is there; add them if one ever is.
export const utmZone = (lon) => Math.floor((lon + 180) / 6) + 1;

// A zone can be given, to carry one zone's grid a little past its edge, as a map that straddles two does.
export function toUtm(lat, lon, zone = utmZone(lon)) {
  return { zone, ...transverseMercator(lat * RAD, lon * RAD, { ...WGS84, lam0: (zone * 6 - 183) * RAD }) };
}

// Back to latitude and longitude by stepping towards the answer through toUtm, as bngToWgs84 does, so the two always agree.
export function fromUtm(zone, e, n) {
  const STEP = 0.001;
  let lat = n / 111000, lon = zone * 6 - 183 + (e - 500000) / (111000 * Math.cos(lat * RAD));
  for (let i = 0; i < 5; i++) {
    const here = toUtm(lat, lon, zone), east = toUtm(lat, lon + STEP, zone), north = toUtm(lat + STEP, lon, zone);
    const a = (east.e - here.e) / STEP, b = (north.e - here.e) / STEP, c = (east.n - here.n) / STEP, d = (north.n - here.n) / STEP;
    const det = a * d - b * c, de = e - here.e, dn = n - here.n;
    lon += (d * de - b * dn) / det;
    lat += (a * dn - c * de) / det;
  }
  return { lat, lon };
}

export const band = (lat) => BANDS[Math.min(BANDS.length - 1, Math.floor((lat + 80) / 8))];

// The two letters of a 100 km square. Column letters run in three sets that repeat every three zones; row letters start five on in even zones.
export function squareLetters(zone, e, n) {
  return COLUMNS[((zone - 1) % 3) * 8 + Math.floor(e / 100000) - 1] + ROWS[(Math.floor(n / 100000) + (zone % 2 ? 0 : 5)) % 20];
}

// Such as "35V NF 123 678", with as many figures as a national grid reference.
export function mgrsRef(lat, lon, figures = 6) {
  const { zone, e, n } = toUtm(lat, lon);
  const part = (v) => String(Math.floor((v % 100000) / 10 ** (5 - figures / 2))).padStart(figures / 2, '0');
  return `${zone}${band(lat)} ${squareLetters(zone, e, n)} ${part(e)} ${part(n)}`;
}
