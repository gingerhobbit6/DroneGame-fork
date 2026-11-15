// The lab's statistics (tools/lab/stats.mjs) against textbook values: a search that runs overnight is only as good as these.

import { describe, expect, it } from 'vitest';
import { ci, gci, mean, paired, sd, spearman, stepStudy, summary, tCrit } from '../tools/lab/stats.mjs';

describe('the two-sided 95% t value', () => {
  it('matches the printed table at the degrees of freedom every table lists', () => {
    const table = { 1: 12.706, 2: 4.303, 4: 2.776, 5: 2.571, 10: 2.228, 20: 2.086, 30: 2.042, 40: 2.021, 60: 2.000, 120: 1.980 };
    for (const [df, t] of Object.entries(table)) expect(tCrit(Number(df)), `df ${df}`).toBe(t);
    expect(tCrit(Infinity)).toBe(1.960);
    expect(tCrit(0)).toBe(Infinity); // one sample says nothing about spread
  });

  it('is never smaller than the true value between the listed ones, and never rises with more samples', () => {
    const exact = { 31: 2.0395, 35: 2.0301, 39: 2.0227, 45: 2.0141, 50: 2.0086, 59: 2.0010, 80: 1.9901, 100: 1.9840, 119: 1.9801, 200: 1.9719, 1000: 1.9623 };
    for (const [df, t] of Object.entries(exact)) expect(tCrit(Number(df)), `df ${df}`).toBeGreaterThanOrEqual(t);
    for (let df = 2; df <= 300; df++) expect(tCrit(df), `df ${df}`).toBeLessThanOrEqual(tCrit(df - 1));
    expect(tCrit(1e9)).toBeLessThan(2); // and it does not stay wide for ever
  });
});

describe('mean, spread and interval', () => {
  it('use the sample standard deviation and the t value for n - 1', () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12);
    // 1..5: sd 1.5811, standard error 0.7071, t(4) 2.776
    expect(ci([1, 2, 3, 4, 5])).toBeCloseTo(2.776 * Math.sqrt(2.5 / 5), 12);
    expect(ci([1, 2, 3, 4, 5])).toBeCloseTo(1.963, 3);
    expect(summary([1, 2, 3, 4, 5])).toMatchObject({ n: 5, mean: 3 });
  });

  it('say so when there is too little to go on', () => {
    expect(mean([])).toBeNaN();
    expect(sd([7])).toBeNaN();
    expect(ci([7])).toBe(Infinity);
    expect(ci([])).toBe(Infinity);
    expect(ci([3, 3, 3])).toBe(0);
  });
});

describe('paired differences', () => {
  it('are taken seed by seed, a minus b', () => {
    const d = paired([10, 12, 9, 14], [8, 11, 9, 10]); // differences 2, 1, 0, 4
    expect(d.n).toBe(4);
    expect(d.mean).toBe(1.75);
    expect(d.ci).toBeCloseTo((3.182 * Math.sqrt(8.75 / 3)) / 2, 12);
    expect(paired([1, 2, 3], [2, 3, 4])).toMatchObject({ mean: -1, ci: 0 });
  });
});

describe('Spearman rank correlation', () => {
  it('is 1 for the same order, -1 for the opposite, whatever the sizes of the numbers', () => {
    expect(spearman([1, 2, 3, 4], [10, 100, 1000, 1e6])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4], [9, 7, 2, -50])).toBeCloseTo(-1, 12);
  });

  it('gives tied values the mean of their ranks', () => {
    expect(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7])).toBeCloseTo(0.8207826816681233, 12); // the worked example in SciPy's manual
  });

  it('has no answer for fewer than three pairs, or when one side never varies', () => {
    expect(spearman([1, 2], [2, 1])).toBeNaN();
    expect(spearman([1, 2, 3], [4, 4, 4])).toBeNaN();
  });
});

describe('the grid convergence index', () => {
  it('recovers the order and the zero-step answer of an exactly second-order series', () => {
    const f = (h) => 1 + 0.5 * h * h, g = gci(f(1), f(2), f(4), 2);
    expect(g.p).toBeCloseTo(2, 12);
    expect(g.ext).toBeCloseTo(1, 12);
    expect(g.gciFine).toBeCloseTo((1.25 * 1.5) / 1.5 / 3, 12);
    expect(g.gciMedium).toBeCloseTo((1.25 * 6) / 3 / 3, 12);
    expect(g.note).toBe('');
  });

  it('matches the worked example in NASA\'s guide to grid convergence', () => {
    const g = gci(0.97050, 0.96854, 0.96178, 2);
    expect(g.p).toBeCloseTo(1.786, 3);
    expect(g.ext).toBeCloseTo(0.97130, 5);
    expect(100 * g.gciFine).toBeCloseTo(0.1031, 3);
    expect(100 * g.gciMedium).toBeCloseTo(0.3562, 3);
  });

  it('falls back to first order, and says so, when the answers do not move one way', () => {
    const g = gci(10, 12, 11, 2); // up, then down
    expect(g.p).toBe(1);
    expect(g.note).toMatch(/first order/);
    expect(gci(5, 5, 5)).toMatchObject({ ext: 5, gciFine: 0, note: 'identical at every step' });
  });
});

describe('a time-step study', () => {
  const rows = (means, cis, dts = [0.1, 0.05, 0.025]) => dts.map((dt, i) => ({ dt, mean: means[i], ci: Array.isArray(cis) ? cis[i] : cis }));

  it('gives no order or GCI when the steps differ by less than the seeds\' own scatter', () => {
    const s = stepStudy(rows([20.1, 20.4, 19.9], 1.5));
    expect(s.same).toBe(true);
    expect(s.gci).toBeNull();
    expect(s.diff).toBeCloseTo(0.5, 12);
    expect(s.noise).toBeCloseTo(Math.hypot(1.5, 1.5), 12);
  });

  it('cannot tell steps apart from one run each', () => {
    expect(stepStudy(rows([9, 3, 1], Infinity))).toMatchObject({ same: true, gci: null });
  });

  it('works out the order when both changes are real and the ratio is constant, in whatever order the rows come', () => {
    const s = stepStudy(rows([9, 3, 1.5], 0.1)); // coarse to fine: 1 + 0.5 h^2 at h = 4, 2, 1
    expect(s.same).toBe(false);
    expect(s.gci.p).toBeCloseTo(2, 9);
    expect(s.gci.ext).toBeCloseTo(1, 9);
    expect(stepStudy(rows([9, 3, 1.5], 0.1).reverse()).gci).toEqual(s.gci);
  });

  it('gives no order when the steps are not in a constant ratio', () => {
    const s = stepStudy(rows([9, 3, 1.5], 0.1, [0.1, 0.05, 0.02]));
    expect(s).toMatchObject({ same: false, gci: null });
    expect(s.why).toMatch(/constant ratio/);
  });

  it('gives no order when only one of the two changes is real', () => {
    const s = stepStudy(rows([14, 10.05, 10], 0.2));
    expect(s).toMatchObject({ same: false, gci: null });
    expect(s.why).toMatch(/scatter/);
  });

  it('sees a slow drift that no neighbouring pair shows', () => {
    const s = stepStudy(rows([12, 11, 10], [0.8, 0.8, 0.8])); // each step moves 1 (noise 1.13), end to end 2
    expect(s).toMatchObject({ same: false, gci: null });
  });
});
