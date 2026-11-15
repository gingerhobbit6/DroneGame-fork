// Small statistics for comparing designs and for knowing when enough runs have been made.

const T95 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042]; // two-sided 95% t value by degrees of freedom
// Past the table the value steps down at 40, 60 and 120, holding the last (larger) one in between, so an interval is never too narrow.
export const tCrit = (df) => (df < 1 ? Infinity : df <= 30 ? T95[df] : df < 40 ? 2.042 : df < 60 ? 2.021 : df < 120 ? 2.000 : df < Infinity ? 1.980 : 1.960);

export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export const sd = (a) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
// Half-width of the 95% confidence interval on the mean.
export const ci = (a) => (a.length < 2 ? Infinity : (tCrit(a.length - 1) * sd(a)) / Math.sqrt(a.length));
export const summary = (a) => ({ n: a.length, mean: mean(a), sd: sd(a), ci: ci(a) });

// Paired differences (same seeds for both designs, so the attack is the same): mean of a-b and its CI half-width.
export function paired(a, b) {
  const d = a.map((x, i) => x - b[i]);
  return { mean: mean(d), ci: ci(d), n: d.length };
}

// Spearman rank correlation: do two ways of scoring the same designs put them in the same order?
const ranks = (a) => {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
};
export function spearman(a, b) {
  if (a.length < 3) return NaN;
  const ra = ranks(a), rb = ranks(b), ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : NaN;
}

// Grid convergence index (Roache) for three step sizes with a constant ratio r: f1 fine, f2 medium, f3 coarse.
// Returns the observed order, the extrapolated value, and the GCI of the fine and medium results as fractions of the answer.
export function gci(f1, f2, f3, r = 2, Fs = 1.25) {
  const e21 = f2 - f1, e32 = f3 - f2;
  if (e21 === 0 && e32 === 0) return { p: NaN, ext: f1, gciFine: 0, gciMedium: 0, note: 'identical at every step' };
  let p = Math.log(Math.abs(e32 / e21)) / Math.log(r), note = '';
  if (!Number.isFinite(p) || p <= 0 || e21 * e32 < 0) { p = 1; note = 'not a smooth trend, so first order is assumed'; }
  p = Math.min(p, 4);
  const ext = f1 + (f1 - f2) / (r ** p - 1);
  const denom = Math.abs(f1) || 1;
  return { p, ext, gciFine: (Fs * Math.abs(e21)) / denom / (r ** p - 1), gciMedium: (Fs * Math.abs(e32)) / Math.abs(f2 || 1) / (r ** p - 1), note };
}

// A time-step study read honestly. rows: [{ dt, mean, ci }] for three step sizes, each the mean of a few seeded runs. The grid
// convergence maths assumes smooth answers, so it is used only when both changes between steps are larger than the seeds' own scatter
// (the 95% interval of a difference of two means) and the steps are in a constant ratio. `same` says no two steps can be told apart.
export function stepStudy(rows) {
  const [coarse, mid, fine] = [...rows].sort((a, b) => b.dt - a.dt);
  const gaps = [[mid, fine], [coarse, mid], [coarse, fine]].map(([a, b]) => ({ diff: Math.abs(a.mean - b.mean), noise: Math.hypot(a.ci, b.ci) }));
  const real = gaps.map((x) => x.diff > x.noise), diff = Math.max(...gaps.map((x) => x.diff)), noise = Math.max(...gaps.map((x) => x.noise));
  if (!real.some(Boolean)) return { same: true, diff, noise, why: '', gci: null };
  const r = coarse.dt / mid.dt;
  const why = Math.abs(r - mid.dt / fine.dt) > 1e-6 * r ? 'the steps are not in a constant ratio' : real[0] && real[1] ? '' : 'one of the two changes is within the scatter';
  return { same: false, diff, noise, why, gci: why ? null : gci(fine.mean, mid.mean, coarse.mean, r) };
}
