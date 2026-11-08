// The Military Grid Reference System, checked against UTM figures from PROJ (pyproj) and known square letters.

import { describe, expect, it } from 'vitest';
import { fromUtm, mgrsRef, squareLetters, toUtm, utmZone } from '../src/sim/mgrs.js';

const PROJ = [ // latitude, longitude, zone, easting, northing
  [38.8895, -77.0353, 18, 323478.06, 4306483.24],
  [59.3772, 28.2019, 35, 568292.79, 6582671.11], // Narva
  [51.4, -1.65, 30, 593910.21, 5695172.64], // Savernake
  [52.94, 0.49, 31, 331334.27, 5868545.05], // Hunstanton
  [59.3, 25.9, 35, 437354.91, 6573975.06], // Tapa
];

describe('MGRS', () => {
  it('projects onto UTM as PROJ does, and back', () => {
    for (const [lat, lon, zone, e, n] of PROJ) {
      const utm = toUtm(lat, lon);
      expect(utm.zone).toBe(zone);
      expect(Math.abs(utm.e - e)).toBeLessThan(0.05);
      expect(Math.abs(utm.n - n)).toBeLessThan(0.05);
      const back = fromUtm(zone, e, n);
      expect(back.lat).toBeCloseTo(lat, 6); // within a few millimetres
      expect(back.lon).toBeCloseTo(lon, 6);
    }
  });
  it('names the zone, band and 100 km square', () => {
    expect(mgrsRef(38.8895, -77.0353, 10)).toBe('18S UJ 23478 06483');
    expect(mgrsRef(59.3772, 28.2019)).toBe('35V NF 682 826');
    expect(mgrsRef(51.4, -1.65).slice(0, 7)).toBe('30U WB '); // Great Britain is in bands U and V
    expect(mgrsRef(48.85826, 2.29451).slice(0, 7)).toBe('31U DQ '); // the Eiffel Tower, in an odd zone
    expect(squareLetters(31, 331334, 5868545)).toBe('CU');
    expect(utmZone(-0.01)).toBe(30);
    expect(utmZone(0.01)).toBe(31);
  });
  it('can carry one zone a little past its edge, for a map that straddles two', () => {
    const own = toUtm(52.9, 0.2), carried = toUtm(52.9, 0.2, 30);
    expect(own.zone).toBe(31);
    expect(carried.zone).toBe(30);
    expect(carried.e).toBeGreaterThan(toUtm(52.9, 0, 30).e); // past zone 30's eastern edge, at 0 degrees
  });
});
