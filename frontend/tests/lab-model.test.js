// The lab's rule check and scoring (tools/lab/model.mjs and the pure parts of lab.mjs). A rule the check misses lets a search
// report a layout the game would refuse.

import { afterEach, describe, expect, it } from 'vitest';
import { RULES, V11, clampParam, describe as describeDesign, fromParams, problem } from '../tools/lab/model.mjs';
import { interceptStats, list, parseArgs, scoreOf } from '../tools/lab/lab.mjs';

const veh = (x, z, ...ids) => ({ at: [x, z], sys: ids.map((id) => [id]) });
const one = (...ids) => ({ vehicles: [veh(400, 0, ...ids), veh(-400, 0, 'gun_hmg')] });

afterEach(() => { delete process.env.LAB_MAX_SENSORS; });

describe('the rule check', () => {
  it('passes the brief\'s own layout', () => {
    const d = fromParams(V11, 10), ids = d.vehicles.flatMap((v) => v.sys.map((s) => s[0]));
    expect(problem(d)).toBeNull();
    expect(d.vehicles).toHaveLength(10);
    expect(d.vehicles.every((v) => v.sys[0][0] === 'gun_hmg' && Math.round(Math.hypot(...v.at)) === 450)).toBe(true);
    expect(ids.filter((id) => id === 'radar_s')).toHaveLength(4);
    expect(ids.filter((id) => id === 'interceptor_p1')).toHaveLength(3);
    expect(d.remote).toHaveLength(12);
    expect(describeDesign(d)).toBe('10x gun_hmg, 4x radar_s, 3x interceptor_p1, 12x jammer_sf (remote)');
  });

  it('counts vehicles', () => {
    const ring = (k) => ({ vehicles: Array.from({ length: k }, (_, i) => veh(Math.round(Math.cos(i) * 600), Math.round(Math.sin(i) * 600), 'gun_hmg')) });
    expect(problem(ring(10))).toBeNull(); // one radian apart at 600 m: clear of each other
    expect(problem(ring(11))).toMatch(/11 vehicles/);
  });

  it('knows what a vehicle can carry', () => {
    expect(problem(one('gun_hmg', 'radar_s', 'interceptor_p1'))).toBeNull();
    expect(problem(one('gun_hmg', 'gun_hmg', 'gun_hmg', 'gun_hmg'))).toMatch(/more than 3 systems/);
    expect(problem(one('acoustic'))).toMatch(/acoustic is not vehicle-mountable/);
    expect(problem(one('gun_gepard'))).toBeNull();
    expect(problem(one('gun_gepard', 'gun_hmg'))).toMatch(/rides alone/);
    expect(problem(one('missile_paladin', 'gun_hmg'))).toBeNull();
    expect(problem(one('missile_paladin', 'gun_hmg', 'gun_hmg'))).toMatch(/heavy system/);
  });

  it('allows one sensor a vehicle unless told otherwise', () => {
    expect(RULES.maxSensors).toBe(1);
    expect(problem(one('radar_s', 'rf', 'gun_hmg'))).toMatch(/more than 1 sensor$/);
    process.env.LAB_MAX_SENSORS = '2';
    expect(problem(one('radar_s', 'rf', 'gun_hmg'))).toBeNull();
    expect(problem(one('radar_s', 'rf', 'camera_s'))).toMatch(/more than 2 sensors/);
  });

  it('lets only networked jammers and acoustic or RF detectors stand alone', () => {
    const remote = (id) => problem({ ...one('gun_hmg'), remote: [[id, 0, 700]] });
    for (const id of ['jammer_sf', 'acoustic', 'rf_l']) expect(remote(id), id).toBeNull();
    for (const id of ['gun_hmg', 'radar_s', 'camera', 'jammer_mk4']) expect(remote(id), id).toMatch(/must be a networked jammer/);
  });

  it('keeps every site on the ring and apart from the others', () => {
    expect(problem({ vehicles: [veh(249, 0, 'gun_hmg')] })).toMatch(/249 m is outside/);
    expect(problem({ vehicles: [veh(250, 0, 'gun_hmg')] })).toBeNull();
    expect(problem({ ...one('gun_hmg'), remote: [['jammer_sf', 0, 2501]] })).toMatch(/2501 m is outside/);
    expect(problem({ vehicles: [veh(400, 0, 'gun_hmg'), veh(400, 59, 'gun_hmg')] })).toMatch(/closer than 60 m/);
    expect(problem({ vehicles: [veh(400, 0, 'gun_hmg'), veh(400, 60, 'gun_hmg')] })).toBeNull();
    expect(problem({ ...one('gun_hmg'), remote: [['jammer_sf', 430, 0]] })).toMatch(/closer than 60 m/);
  });
});

describe('the numbers a search varies', () => {
  it('are held in range, and whole where they must be', () => {
    expect(clampParam('R', 9999)).toBe(700);
    expect(clampParam('R', 444)).toBe(440);
    expect(clampParam('radars', 2.6)).toBe(3);
    expect(clampParam('rot', -1)).toBe(0);
    expect(clampParam('rho1', 1.234567)).toBe(1.234567);
  });

  it('never ask for more radars or interceptors than there are vehicles', () => {
    const d = fromParams({ ...V11, radars: 6, p1: 6, hmg2: 0 }, 3);
    expect(d.vehicles.map((v) => v.sys.map((s) => s[0]))).toEqual(Array(3).fill(['gun_hmg', 'radar_s', 'interceptor_p1']));
    expect(problem(d)).toBeNull();
  });
});

describe('scoring', () => {
  it('ranks a lost game by its wave, a standing one above the cap by its health, and an invalid one last', () => {
    expect(scoreOf({ over: true, wave: 17, health: 0 }, 45)).toBe(17);
    expect(scoreOf({ over: false, wave: 45, health: 0.4 }, 45)).toBe(45.4);
    expect(scoreOf({ invalid: 'no room' }, 45)).toBe(-1);
  });

  it('pools the money over the finished games and leaves invalid ones out', () => {
    const games = [
      { perWave: [{ kills: 3 }, { kills: 2 }], spent: 1000, capex: 400, destroyed: 200 },
      { invalid: 'worker exited' },
      { perWave: [{ kills: 1 }], spent: 500, capex: 400, destroyed: 100 },
    ];
    expect(interceptStats(games)).toEqual({ kills: 3, destroyed: 150, perPound: 5, perPoundShots: 700 / 300 });
    expect(interceptStats([{ invalid: 'x' }])).toEqual({ kills: null, destroyed: null, perPound: null, perPoundShots: null });
    expect(interceptStats([{ perWave: [], spent: 400, capex: 400, destroyed: 0 }])).toMatchObject({ kills: 0, perPound: null }); // nothing destroyed: no rate, not a division by zero
  });
});

describe('the command line', () => {
  it('reads flags with and without values, and lists of numbers', () => {
    expect(parseArgs(['search', '--quick', '--sites', '3,4', '--out', 'x.json'])).toEqual({ _: 'search', quick: true, sites: '3,4', out: 'x.json' });
    expect(list('3,4,,10')).toEqual([3, 4, 10]);
    expect(list('a,b', String)).toEqual(['a', 'b']);
  });
});
