// The lab's team sheet and fixed raids (tools/lab/teams.mjs, raids.mjs): every team is a legal laydown, a raid is the same on one
// seed and different on another, and protection is the share of warhead weight stopped.
import { describe, it, expect, beforeAll } from 'vitest';
import { RAIDS, raidQueue, raidCost, scoreGame, summarise, pooled, protectionChange } from '../tools/lab/raids.mjs';
import { TEAMS, teamDesign, sensorGbp, SENSOR_BUDGET_GBP } from '../tools/lab/teams.mjs';
import { problem } from '../tools/lab/model.mjs';
import { DRONES } from '../src/sim/config/index.js';

beforeAll(() => { process.env.LAB_MAX_SENSORS = '2'; });

describe('fixed raids', () => {
  it('sends what each raid lists, in time order, the same on one seed and not on another', () => {
    for (const raid of RAIDS) {
      const q = raidQueue(raid, 7);
      expect(q.length).toBe(raid.groups.reduce((s, g) => s + g.n, 0));
      for (const g of raid.groups) expect(q.filter((x) => x.type === g.type).length).toBe(g.n);
      expect(q.every((x, i) => i === 0 || q[i - 1].t <= x.t)).toBe(true);
      expect(raidQueue(raid, 7)).toEqual(q);
      expect(raidQueue(raid, 8)).not.toEqual(q);
    }
  });

  it('scores protection as the share of warhead weight stopped, leaving spotters out', () => {
    const f = (type, end) => ({ type, end, site: 900, seenSite: 3000 });
    const game = { flights: [f('shahed136', 'killed'), f('shahed136', 'leaked'), f('fpv7inch', 'struck'), f('fpv7inch', 'killed'), f('orlan10', 'left')],
      killed: 1, injured: 2, lostValue: 40000, damage: 31, shots: 1000, destroyed: 35700, launched: 171400, capex: 1e6 };
    const s = scoreGame(game), w = DRONES.shahed136.damage, v = DRONES.fpv7inch.damage;
    expect(s.protection).toBeCloseTo(1 - (w + v) / (2 * w + 2 * v));
    expect(s.leaks).toBe(2);
    expect(scoreGame({ invalid: 'x' })).toBeNull();
    const sum = summarise([s, s, null]);
    expect(sum.games).toBe(2); expect(sum.invalid).toBe(1);
    expect(sum.exchange).toBeCloseTo(35.7);
    expect(protectionChange([0.5, null], [0.6, 0.9]).mean).toBeCloseTo(0.1);
    expect(pooled([s, { ...s, total: 100, through: 0 }])).toBeCloseTo(1 - s.through / (s.total + 100));
    expect(pooled([s, null])).toBeNull();
  });
});

describe('team sheet', () => {
  it('sends nation raids of named types for about $1m each, and type raids of named types', () => {
    for (const r of RAIDS) for (const g of r.groups) expect(DRONES[g.type].variantOf, `${r.id} ${g.type}`).toBeTruthy(); // a named type, not a generic one
    for (const r of RAIDS.filter((x) => x.kind === 'nation')) expect(Math.abs(raidCost(r) - 1e6), r.id).toBeLessThan(10000);
    expect(RAIDS.filter((x) => x.kind === 'nation').map((x) => x.id)).toEqual(['russia', 'iran', 'china']);
  });

  it('builds every team as a legal laydown with the same effectors', () => {
    const effectors = (d) => d.vehicles.flatMap((v) => v.sys.map(([id]) => id)).filter((id) => !id.startsWith('radar') && !id.startsWith('camera')).sort().join();
    const base = effectors(teamDesign([]));
    for (const t of TEAMS) {
      const d = teamDesign(t.sensors);
      expect(problem(d), t.name).toBeNull();
      expect(effectors(d), t.name).toBe(base);
      const placed = [...d.vehicles.flatMap((v) => v.sys.map(([id]) => id)), ...d.remote.map(([id]) => id)];
      for (const s of t.sensors) expect(placed.filter((id) => id === s.id).length, `${t.name} ${s.id}`).toBe(s.n);
      if (t.sensors.length) expect(Math.abs(sensorGbp(t.sensors) - SENSOR_BUDGET_GBP) / SENSOR_BUDGET_GBP, `${t.name} spends about the same`).toBeLessThan(0.15);
      expect(teamDesign(t.sensors, 'night').conditions).toBe('night');
    }
  });
});
