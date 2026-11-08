// British National Grid: grid references, and turning a GPS position into easting and northing and back.

const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'; // the grid has no I

export const onGrid = (e, n) => e >= 0 && e < 700000 && n >= 0 && n < 1300000;

export function parseGridRef(text) {
  const match = /^\s*([A-HJ-Za-hj-z]{2})\s*(\d*)\s*(\d*)\s*$/.exec(text || '');
  if (!match) return null;
  const [, letters, first, second] = match;
  const digits = first + second;
  if (digits.length % 2 || digits.length > 10 || (second && first.length !== second.length)) return null;
  const a = LETTERS.indexOf(letters[0].toUpperCase()), b = LETTERS.indexOf(letters[1].toUpperCase());
  const east = ((a - 2 + 25) % 5) * 5 + (b % 5), north = 19 - Math.floor(a / 5) * 5 - Math.floor(b / 5);
  if (east > 6 || north < 0 || north > 12) return null;
  const half = digits.length / 2, scale = 10 ** (5 - half);
  return { e: east * 100000 + (half ? Number(digits.slice(0, half)) * scale : 0), n: north * 100000 + (half ? Number(digits.slice(half)) * scale : 0) };
}

export function gridRef(e, n, figures = 6) {
  if (!onGrid(e, n)) return 'off the grid';
  const a = Math.floor((19 - Math.floor(n / 100000)) / 5) * 5 + Math.floor((Math.floor(e / 100000) + 10) / 5);
  const b = ((19 - Math.floor(n / 100000)) * 5) % 25 + Math.floor(e / 100000) % 5;
  return `${LETTERS[a]}${LETTERS[b]} ${digitsIn(e, figures)} ${digitsIn(n, figures)}`;
}

// Half a reference's figures: where in its 100 km square a point lies. MGRS writes them the same way (mgrs.js).
export const digitsIn = (v, figures) => String(Math.floor((v % 100000) / 10 ** (5 - figures / 2))).padStart(figures / 2, '0');

// GPS (WGS 84) to the grid, by the published Helmert shift. Good to about 5 m, which is finer than a laptop's location.
export function wgs84ToBng(latDeg, lonDeg) {
  const rad = Math.PI / 180, lat = latDeg * rad, lon = lonDeg * rad;
  const a84 = 6378137, e84 = 0.00669437999014;
  const nu84 = a84 / Math.sqrt(1 - e84 * Math.sin(lat) ** 2);
  const x = nu84 * Math.cos(lat) * Math.cos(lon), y = nu84 * Math.cos(lat) * Math.sin(lon), z = nu84 * (1 - e84) * Math.sin(lat);
  const s = 1 + 20.4894e-6, sec = rad / 3600, rx = -0.1502 * sec, ry = -0.247 * sec, rz = -0.8421 * sec;
  const X = -446.448 + s * (x - rz * y + ry * z), Y = 125.157 + s * (rz * x + y - rx * z), Z = -542.06 + s * (-ry * x + rx * y + z);

  const a = 6377563.396, b = 6356256.909, e2 = 1 - (b * b) / (a * a), p = Math.hypot(X, Y);
  let phi = Math.atan2(Z, p * (1 - e2));
  for (let i = 0; i < 8; i++) phi = Math.atan2(Z + (e2 * a * Math.sin(phi)) / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), p);
  return transverseMercator(phi, Math.atan2(Y, X), { a, b, f0: 0.9996012717, phi0: 49 * rad, lam0: -2 * rad, e0: 400000, n0: -100000 }); // the national grid's own origin
}

// Transverse Mercator by the series OS publishes, on any ellipsoid (a, b) and origin. Angles in radians. MGRS uses it too (mgrs.js).
export function transverseMercator(phi, lambda, { a, b, f0, phi0, lam0, e0, n0 }) {
  const e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b), sinP = Math.sin(phi), cosP = Math.cos(phi), tanP = Math.tan(phi);
  const nu = (a * f0) / Math.sqrt(1 - e2 * sinP * sinP), rho = (a * f0 * (1 - e2)) / (1 - e2 * sinP * sinP) ** 1.5, eta2 = nu / rho - 1;
  const dp = phi - phi0, sp = phi + phi0;
  const M = b * f0 * ((1 + n + 1.25 * n * n + 1.25 * n ** 3) * dp - (3 * n + 3 * n * n + 2.625 * n ** 3) * Math.sin(dp) * Math.cos(sp)
    + (1.875 * n * n + 1.875 * n ** 3) * Math.sin(2 * dp) * Math.cos(2 * sp) - (35 / 24) * n ** 3 * Math.sin(3 * dp) * Math.cos(3 * sp));
  const dl = lambda - lam0, t2 = tanP * tanP;
  const northing = M + n0 + (nu / 2) * sinP * cosP * dl ** 2 + (nu / 24) * sinP * cosP ** 3 * (5 - t2 + 9 * eta2) * dl ** 4 + (nu / 720) * sinP * cosP ** 5 * (61 - 58 * t2 + t2 * t2) * dl ** 6;
  const easting = e0 + nu * cosP * dl + (nu / 6) * cosP ** 3 * (nu / rho - t2) * dl ** 3 + (nu / 120) * cosP ** 5 * (5 - 18 * t2 + t2 * t2 + 14 * eta2 - 58 * t2 * eta2) * dl ** 5;
  return { e: easting, n: northing };
}

// The grid back to GPS, by stepping towards the answer through wgs84ToBng, so the two always agree. Only used to draw on a map.
export const bngToWgs84 = (e, n) => fromGrid(wgs84ToBng, e, n, 49 + n / 111000, -2 + (e - 400000) / 70000);

// Steps a first guess (lat, lon) towards the point that toGrid maps to (e, n). MGRS goes back the same way (mgrs.js).
export function fromGrid(toGrid, e, n, lat, lon) {
  const STEP = 0.001;
  for (let i = 0; i < 5; i++) {
    const here = toGrid(lat, lon), east = toGrid(lat, lon + STEP), north = toGrid(lat + STEP, lon);
    const a = (east.e - here.e) / STEP, b = (north.e - here.e) / STEP, c = (east.n - here.n) / STEP, d = (north.n - here.n) / STEP;
    const det = a * d - b * c, de = e - here.e, dn = n - here.n;
    lon += (d * de - b * dn) / det;
    lat += (a * dn - c * de) / det;
  }
  return { lat, lon };
}

// The 100 km squares that ground this far around a point touches, worked out as the map builder does.
export function squaresAround(e, n, half) {
  const SQUARE = 100000, found = new Set(), down = (v) => Math.floor(v / SQUARE) * SQUARE;
  for (let x = down(e - half); x < e + half; x += SQUARE) {
    for (let y = down(n - half); y < n + half; y += SQUARE) if (onGrid(x, y)) found.add(gridRef(x, y).slice(0, 2));
  }
  return [...found].sort();
}
