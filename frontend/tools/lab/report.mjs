// Turns the saved results in lab-results/ into one web page that shows what has converged: node tools/lab/lab.mjs report
// The page is a single file with no outside links, so it opens anywhere.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT_DIR } from './lab.mjs';

const read = (name) => { const p = resolve(OUT_DIR, name); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };

export function makeReport(args) {
  const given = args.in ? read(args.in) : null;
  const data = { search: given?.kind === 'search' ? given : given ? null : read('search.json') || read('search-quick.json'), evolve: given?.kind === 'evolve' ? given : given ? null : read('overnight.json') || read('evolve.json'), seeds: read('seeds.json'), timestep: read('timestep.json') };
  if (!data.search && !data.evolve && !data.seeds && !data.timestep) { console.log('No results yet in lab-results/. Run a search, seeds or timestep study first.'); return; }
  const out = resolve(OUT_DIR, 'report.html');
  writeFileSync(out, PAGE.replace('/*DATA*/', `const DATA = ${JSON.stringify(data).replace(/</g, '\\u003c')};`));
  console.log('wrote', out);
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bombadil design convergence</title>
<style>
:root { --bg:#fff; --fg:#17202c; --mut:#5c6878; --line:#d8dee6; --card:#f5f7fa; --c1:#2864d8; --c2:#d86a28; --c3:#2a9d6a; --c4:#8a4fd1; --c5:#c2398a; --c6:#7a8a00; --ok:#2a9d6a; }
@media (prefers-color-scheme: dark) { :root { --bg:#0e1420; --fg:#e4eaf2; --mut:#97a3b4; --line:#2a3445; --card:#161e2c; --c1:#6a9bff; --c2:#ff9a5c; --c3:#4cc790; --c4:#b88aff; --c5:#ff7ac0; --c6:#c6d34a; } }
* { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui,Segoe UI,sans-serif; }
main { max-width:1000px; margin:0 auto; padding:20px 16px 60px; } h1 { font-size:24px; margin:0 0 4px; } h2 { font-size:18px; margin:34px 0 6px; }
p.sub { color:var(--mut); margin:0 0 10px; } .card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px 14px; margin:10px 0; }
.kpis { display:flex; flex-wrap:wrap; gap:10px; } .kpi { flex:1 1 140px; } .kpi b { display:block; font-size:24px; } .kpi span { color:var(--mut); font-size:13px; }
svg { width:100%; height:auto; display:block; } svg text { fill:var(--mut); font-size:11px; } svg .ax { stroke:var(--line); } svg .grid { stroke:var(--line); stroke-dasharray:2 3; }
table { border-collapse:collapse; width:100%; font-size:13px; } th,td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--line); } th { color:var(--mut); font-weight:600; }
td.n,th.n { text-align:right; font-variant-numeric:tabular-nums; } .legend { display:flex; flex-wrap:wrap; gap:4px 14px; font-size:13px; color:var(--mut); margin:4px 0; }
.legend i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:5px; } .note { color:var(--mut); font-size:13px; }
svg .hit { cursor:crosshair; } svg .hit:hover { stroke:var(--fg); stroke-width:1.5; }
#tip { position:fixed; display:none; pointer-events:none; z-index:10; background:var(--fg); color:var(--bg); padding:5px 9px; border-radius:6px; font-size:12px; line-height:1.4; max-width:320px; box-shadow:0 2px 8px rgba(0,0,0,.25); }
</style></head><body><main id="app"></main>
<script>
/*DATA*/
const COL = ['--c1','--c2','--c3','--c4','--c5','--c6'], css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-'), el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d; };
const app = document.getElementById('app');
const GBP = 0.75; // the game keeps prices in dollars, as its sources quote them, and shows them in pounds at this one rate (src/sim/economy.js)
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Hovering (or touching) a data point shows its values.
const tipBox = document.createElement('div'); tipBox.id = 'tip'; document.body.append(tipBox);
const showTip = (e) => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (!t) { tipBox.style.display = 'none'; return; }
  tipBox.textContent = t.getAttribute('data-tip'); tipBox.style.display = 'block';
  const w = tipBox.offsetWidth, h = tipBox.offsetHeight;
  tipBox.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX + 12)) + 'px';
  tipBox.style.top = Math.max(4, e.clientY - h - 10) + 'px';
};
document.addEventListener('pointermove', showTip); document.addEventListener('pointerdown', showTip);

// A simple line/point chart. series: [{name, color, pts:[[x,y,err?]], line:bool}]
function chart({ series, xLabel, yLabel, xTicks, yMin, yMax, xFmt = (x) => x, band }) {
  const W = 900, H = 330, L = 54, R = 16, T = 12, B = 44;
  const xs = series.flatMap((s) => s.pts.map((p) => p[0])), ys = series.flatMap((s) => s.pts.flatMap((p) => [p[1] - (p[2] || 0), p[1] + (p[2] || 0)]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = yMin ?? Math.floor(Math.min(...ys)), y1 = yMax ?? Math.ceil(Math.max(...ys));
  const X = (x) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R), Y = (y) => H - B - ((y - y0) / (y1 - y0 || 1)) * (H - T - B);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  for (let i = 0; i <= 5; i++) { const v = y0 + ((y1 - y0) * i) / 5; s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + f(v, y1 - y0 < 6 ? 1 : 0) + '</text>'; }
  for (const t of xTicks || [...new Set(xs)]) s += '<text x="' + X(t) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + xFmt(t) + '</text>';
  s += '<line class="ax" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/><line class="ax" x1="' + L + '" x2="' + L + '" y1="' + T + '" y2="' + (H - B) + '"/>';
  s += '<text x="' + (L + (W - L - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + xLabel + '</text><text transform="translate(13 ' + (T + (H - T - B) / 2) + ') rotate(-90)" text-anchor="middle">' + yLabel + '</text>';
  if (band) s += '<rect x="' + L + '" y="' + Y(band[1]) + '" width="' + (W - L - R) + '" height="' + Math.max(0, Y(band[0]) - Y(band[1])) + '" fill="' + css('--ok') + '" opacity="0.12"/>';
  for (const se of series) {
    const c = css(se.color);
    if (se.line !== false && se.pts.length > 1) s += '<polyline fill="none" stroke="' + c + '" stroke-width="2" points="' + se.pts.map((p) => X(p[0]) + ',' + Y(p[1])).join(' ') + '"/>';
    for (const p of se.pts) {
      if (p[2]) s += '<line stroke="' + c + '" stroke-width="1.5" x1="' + X(p[0]) + '" x2="' + X(p[0]) + '" y1="' + Y(p[1] - p[2]) + '" y2="' + Y(p[1] + p[2]) + '"/>';
      const tip = p[3] ?? ((se.label || se.name) + ': ' + xFmt(p[0]) + ', ' + f(p[1], 2) + (p[2] ? ' +-' + f(p[2], 2) : ''));
      s += '<circle cx="' + X(p[0]) + '" cy="' + Y(p[1]) + '" r="3.5" fill="' + c + '"/><circle class="hit" cx="' + X(p[0]) + '" cy="' + Y(p[1]) + '" r="9" fill="transparent" data-tip="' + esc(tip) + '"/>';
    }
  }
  return s + '</svg>';
}
const legend = (items) => '<div class="legend">' + items.map(([n, c]) => '<span><i style="background:' + css(c) + '"></i>' + n + '</span>').join('') + '</div>';
const section = (title, sub, body) => { const d = el('<h2>' + title + '</h2><p class="sub">' + sub + '</p>'); app.append(...d.childNodes); if (body) { const c = el('<div class="card"></div>'); c.firstChild.innerHTML = body; app.append(c.firstChild); } };

app.append(...el('<h1>Design convergence</h1><p class="sub">Fewest vehicle sites for the most waves under a £5.25M budget, and how sure the answer is.</p>').childNodes);

const S = DATA.search;
if (S) {
  const done = S.byK.filter((b) => b.final);
  const best = done.reduce((m, b) => (b.final.mean > m.final.mean ? b : m), done[0]);
  const kneeK = S.knee;
  const knee = done.find((b) => b.k === kneeK);
  section('Answer', 'Each point is the best layout found for that number of vehicle sites, played on ' + S.seeds.length + ' seeds (bars are the 95% interval across seeds).',
    '<div class="kpis"><div class="kpi"><b>' + (kneeK ?? '-') + ' sites</b><span>fewest within ' + f(Math.max(2, best.final.ci), 1) + ' waves of the best</span></div>' +
    '<div class="kpi"><b>' + f(knee?.final.mean) + ' waves</b><span>at ' + kneeK + ' sites (+-' + f(knee?.final.ci) + ')</span></div>' +
    '<div class="kpi"><b>' + f(best.final.mean) + ' waves</b><span>best, at ' + best.k + ' sites</span></div>' +
    '<div class="kpi"><b>' + S.runs + ' runs</b><span>in ' + f(S.seconds / 60, 0) + ' min on ' + S.workers + ' cores</span></div></div>' +
    chart({ series: [{ name: 'best layout', color: '--c1', pts: done.map((b) => [b.k, b.final.mean, b.final.ci]) }], xLabel: 'vehicle sites (radars, guns and interceptors; jammers are placed on their own)', yLabel: 'waves survived', xFmt: (x) => x, yMin: 0, band: [best.final.mean - Math.max(2, best.final.ci), best.final.mean + 0] }) +
    '<p class="note">The green band is within ' + f(Math.max(2, best.final.ci), 1) + ' waves of the best. ' + (S.preset === 'quick' ? 'This was a quick run: short games and few layouts, so treat the shape, not the numbers.' : '') + '</p>');

  // convergence of the best score as the search goes on
  const stages = S.byK[0].history.map((h) => h.stage);
  section('Is the search still improving?', 'Best score found at each stage, for each number of sites. Early stages use short games, so the scores are not comparable with the later ones; the later stages are all at full length.',
    legend(S.byK.map((b, i) => [b.k + ' sites', COL[i % 6]])) +
    chart({ series: S.byK.map((b, i) => ({ name: b.k, color: COL[i % 6], pts: b.history.map((h, j) => [j, h.best]) })), xLabel: 'stage: ' + stages.map((s, j) => j + '=' + s).join(', '), yLabel: 'best score (waves)', xTicks: stages.map((_, j) => j), yMin: 0 }));

  // convergence in design space
  const rel = (h) => { const v = Object.values(h.params || {}).map((p) => p.rel); return v.reduce((a, b) => a + b, 0) / (v.length || 1); };
  section('Are the designs settling on one layout?', 'How spread out the leading layouts still are, as a fraction of each number\\'s allowed range (0 = the leaders are identical). A falling line means the search is homing in on one design.',
    legend(S.byK.map((b, i) => [b.k + ' sites', COL[i % 6]])) +
    chart({ series: S.byK.map((b, i) => ({ name: b.k, color: COL[i % 6], pts: b.history.map((h, j) => [j, rel(h)]) })), xLabel: 'stage', yLabel: 'spread of leaders (0 = identical)', xTicks: stages.map((_, j) => j), yMin: 0 }));

  // a table of what each best layout is
  const P = ['R','rot','radars','p1','hmg2','jam','rho1','rho2'];
  section('The best layout for each number of sites', 'Ring is the radius the vehicles stand on; the jammers go on two rings outside it.',
    '<table><tr><th class="n">sites</th><th class="n">waves</th><th class="n">cost</th><th>what is on them</th><th>ring m</th><th>radars</th><th>P1</th><th>2nd gun</th><th>jammers</th></tr>' +
    done.map((b) => '<tr><td class="n">' + b.k + '</td><td class="n">' + f(b.final.mean) + ' +-' + f(b.final.ci) + '</td><td class="n">£' + f(b.final.capex * GBP / 1e6, 2) + 'M</td><td>' + (S.pareto.find((p) => p.k === b.k)?.what || '') + '</td><td>' + b.final.params.R + '</td><td>' + b.final.params.radars + '</td><td>' + b.final.params.p1 + '</td><td>' + b.final.params.hmg2 + '</td><td>' + b.final.params.jam + '</td></tr>').join('') + '</table>');

  // are short games a fair guide?
  const cor = S.byK.flatMap((b) => b.correlations.map((c) => '<tr><td class="n">' + b.k + '</td><td>' + c.from + '</td><td>' + c.to + '</td><td class="n">' + f(c.rho, 2) + '</td><td class="n">' + c.n + '</td></tr>')).join('');
  section('Do short games rank layouts like full ones?', 'The rank correlation between a layout\\'s score in a short game and its score at full length (1 = same order, 0 = no relation). Low values mean the early cuts may have dropped good layouts.',
    '<table><tr><th class="n">sites</th><th>short game</th><th>compared with</th><th class="n">rank correlation</th><th class="n">layouts</th></tr>' + cor + '</table>');
}

const E = DATA.evolve;
if (E) {
  const fin = E.finalists.filter((f) => f.heldOut != null), best = fin[0];
  const bySites = {};
  for (const f of fin) if (!bySites[f.sites] || f.heldOut > bySites[f.sites].heldOut) bySites[f.sites] = f;
  const sitesList = Object.keys(bySites).map(Number).sort((a, b) => a - b);
  const last = E.history.at(-1), capNote = fin.filter((f) => f.atCap > 0).length;
  section('Overnight search against ' + (E.attack ? E.attack.length + ' drone types' : 'the generic drones'),
    'Searched for ' + f(E.seconds / 3600, 1) + ' hours on ' + E.workers + ' cores: ' + E.evals + ' layouts tried, ' + E.runs + ' games played. The numbers below are from five seeds the search never saw.',
    '<div class="kpis"><div class="kpi"><b>' + f(best?.heldOut) + ' waves</b><span>best layout, ' + (best ? best.sites + ' sites' : '') + '</span></div>' +
    '<div class="kpi"><b>' + E.cells.length + ' kinds</b><span>of layout kept, by sites, main weapon and cost</span></div>' +
    '<div class="kpi"><b>' + f(last.qd, 0) + '</b><span>quality-diversity score at the end</span></div>' +
    '<div class="kpi"><b>' + capNote + '</b><span>layouts still standing at the ' + E.cap + '-wave limit' + (capNote ? ' (raise --cap)' : '') + '</span></div></div>');

  const hist = E.history.filter((h) => h.evals > 0);
  const first = hist[0], lastH = hist.at(-1), meanEnd = lastH.cells ? lastH.qd / lastH.cells : 0;
  section('Kinds, quality and diversity: what the numbers mean', 'How to read the headline figures.',
    '<p><b>Kinds kept (' + E.cells.length + ').</b> Every layout is sorted into a kind by three things: how many vehicle sites it has, which type of weapon (gun, interceptor, missile, heavy) holds most of the money, and its cost band (under £1.9M, £1.9M to £3.4M, over £3.4M). Each kind keeps only its best layout so far, and a new layout replaces it only by beating it. So the search keeps a map of what works, instead of collapsing onto one design. Kinds with nothing legal and decent found stay empty.</p>' +
    '<p><b>Quality.</b> How well one layout does: its mean waves survived over the five guide seeds, with a tiny deduction for money spent so that of two equal layouts the cheaper wins. Best quality was ' + f(lastH.best) + ' waves; the mean over all kept layouts was ' + f(meanEnd) + ' (low, because many kinds are cheap or weak).</p>' +
    '<p><b>Diversity.</b> How many different kinds are filled: here ' + lastH.cells + '.</p>' +
    '<p><b>Quality-diversity score (' + f(lastH.qd, 0) + ').</b> The sum of every kept layout\\'s quality. That is the same as kinds kept x mean quality (' + lastH.cells + ' x ' + f(meanEnd) + '). It rises when a kept layout improves and also when a new kind is filled, even by a weak layout, which adds its score but lowers the mean. Flat means the search has stopped finding better layouts or new kinds, which is why it is the convergence measure.</p>' +
    '<p><b>Where the growth came from.</b> The score went from ' + f(first.qd, 0) + ' (' + first.cells + ' kinds, mean ' + f(first.qd / first.cells) + ') to ' + f(lastH.qd, 0) + ' (' + lastH.cells + ' kinds, mean ' + f(meanEnd) + '). Most of that came from filling more kinds; the best single layout moved from ' + f(first.best) + ' to ' + f(lastH.best) + ' waves.</p>' +
    '<p class="note">These are guide-seed numbers, so slightly optimistic. The waves-on-unseen-seeds figures in the tables below are the ones to believe.</p>');

  section('Has the search settled?', 'The sum of the scores of every kept layout (quality-diversity) and the best single score, over time. Both rise while the search is still finding better or new kinds of layout, and go flat when it has stopped.',
    legend([['quality-diversity (plotted / 10)', '--c1'], ['best layout (waves)', '--c2'], ['kinds kept', '--c3'], ['mean of kept layouts (plotted x 10)', '--c4']]) +
    chart({ series: [
      { name: 'qd', color: '--c1', pts: hist.map((h) => [h.t / 3600, h.qd / 10, 0, f(h.t / 3600, 2) + ' h: quality-diversity ' + f(h.qd, 0) + ' (plotted as ' + f(h.qd / 10, 1) + ')']) },
      { name: 'best', color: '--c2', pts: hist.map((h) => [h.t / 3600, h.best, 0, f(h.t / 3600, 2) + ' h: best layout ' + f(h.best, 2) + ' waves']) },
      { name: 'cells', color: '--c3', pts: hist.map((h) => [h.t / 3600, h.cells, 0, f(h.t / 3600, 2) + ' h: ' + h.cells + ' kinds kept, ' + h.evals + ' layouts tried']) },
      { name: 'mean', color: '--c4', pts: hist.map((h) => [h.t / 3600, h.mean * 10, 0, f(h.t / 3600, 2) + ' h: mean of kept layouts ' + f(h.mean, 2) + ' waves (plotted as ' + f(h.mean * 10, 1) + ')']) }], xLabel: 'hours', yLabel: 'score', yMin: 0, xFmt: (x) => f(x, 1) }));

  // fewest sites vs waves, from unseen seeds
  section('Sites against waves survived', 'The best layout found for each number of vehicle sites, on unseen seeds (bars are the 95% interval).',
    chart({ series: [{ name: 'best', color: '--c1', pts: sitesList.map((k) => [k, bySites[k].heldOut, bySites[k].heldOutCi || 0, k + ' sites: ' + f(bySites[k].heldOut) + ' waves +-' + f(bySites[k].heldOutCi || 0) + ', £' + f(bySites[k].capex * GBP / 1e6, 2) + 'M. ' + bySites[k].what]) }], xLabel: 'vehicle sites (radars, guns and missiles; remote jammers and detectors are not counted)', yLabel: 'waves survived', yMin: 0, xTicks: sitesList }));

  // the map of what was found
  const fams = ['gun', 'interceptor', 'missile', 'heavy', 'none'], cellBest = {};
  for (const c of E.cells) { const [k, fam] = c.cell.split('|'); const key = fam + '|' + k; if (!cellBest[key] || c.score > cellBest[key]) cellBest[key] = c.score; }
  const mx = Math.max(1, ...Object.values(cellBest)), ks = [2,3,4,5,6,7,8,9,10];
  section('What was found: main weapon against number of sites', 'The best score in each kind of layout (guns, interceptors, missiles, or self-propelled heavy weapons holding most of the money). Empty squares are kinds the search found nothing for.',
    '<table><tr><th>main weapon</th>' + ks.map((k) => '<th class="n">' + k + ' sites</th>').join('') + '</tr>' +
    fams.map((fam) => '<tr><td>' + fam + '</td>' + ks.map((k) => { const v = cellBest[fam + '|' + k]; return '<td class="n" style="background:' + (v ? 'color-mix(in srgb, ' + css('--c1') + ' ' + Math.round(10 + 60 * v / mx) + '%, transparent)' : 'transparent') + '">' + (v ? f(v, 1) : '') + '</td>'; }).join('') + '</tr>').join('') + '</table>');

  // the best of each kind, as one point: what it cost against how many waves it survived on seeds the search never saw
  const FAM_COL = { gun: '--c1', interceptor: '--c2', missile: '--c3', heavy: '--c4', none: '--c6' };
  const famsUsed = fams.filter((fm) => fin.some((x) => x.family === fm));
  const cMin = Math.min(...fin.map((x) => x.capex)) * GBP / 1e6, cMax = Math.max(...fin.map((x) => x.capex)) * GBP / 1e6, cStep = cMax - cMin > 4 ? 1 : 0.5;
  const cTicks = []; for (let t = Math.ceil(cMin / cStep) * cStep; t <= cMax + 1e-9; t += cStep) cTicks.push(+t.toFixed(2));
  // what was spent for each £1 of enemy drones destroyed, worked out as the Cost tab in the game does
  const perPound = (x) => (x == null ? '' : '£' + f(x, 2));
  section('Cost against waves survived, on unseen seeds', 'One point for each of the ' + fin.length + ' best kinds (sites, main weapon and cost band), played on five seeds the search never saw. Colour is the main weapon; bars are the 95% interval over the seeds. Hover a point for its layout and its cost per £1 of enemy systems destroyed, worked out as the game\\'s Cost tab does: what was spent on shots, and on shots plus the systems themselves, for each £1 of enemy drones stopped. Under £1 means the defence destroys more than it spends.',
    legend(famsUsed.map((fm) => [fm, FAM_COL[fm]])) +
    chart({
      series: famsUsed.map((fm) => ({ name: fm, color: FAM_COL[fm], line: false, pts: fin.filter((x) => x.family === fm).map((x) => [x.capex * GBP / 1e6, x.heldOut, x.heldOutCi || 0,
        x.sites + ' sites, ' + fm + ': ' + f(x.heldOut, 1) + ' waves +-' + f(x.heldOutCi || 0, 1) + ', build £' + f(x.capex * GBP / 1e6, 2) + 'M' +
        (x.perPound != null ? '. Per £1 of enemy systems destroyed: ' + perPound(x.perPoundShots) + ' of shots, ' + perPound(x.perPound) + ' with the systems (' + f(x.kills, 0) + ' drones stopped)' : '') + '. ' + x.what]) })),
      xLabel: 'cost of building the laydown (£ million)', yLabel: 'waves survived (unseen seeds)', yMin: 0, xTicks: cTicks, xFmt: (x) => '£' + x + 'M' }));

  section('The best layouts', 'Scores are waves on unseen seeds, with the 95% interval across them. Guide is the score on the seeds the search learned from; a big gap between the two means the layout was lucky.',
    '<table><tr><th class="n">sites</th><th>main weapon</th><th class="n">waves</th><th class="n">guide</th><th class="n">cost</th><th class="n" title="spent on shots / spent on shots and systems, per £1 of enemy drones destroyed">per £1 destroyed</th><th>what is on them</th></tr>' +
    fin.slice(0, 25).map((x) => '<tr><td class="n">' + x.sites + '</td><td>' + x.family + '</td><td class="n">' + f(x.heldOut) + ' +-' + f(x.heldOutCi) + '</td><td class="n">' + f(x.guide) + '</td><td class="n">£' + f(x.capex * GBP / 1e6, 2) + 'M</td><td class="n">' + (x.perPound != null ? perPound(x.perPoundShots) + ' / ' + perPound(x.perPound) : '') + '</td><td>' + x.what.replace(/^\d+ vehicles at \d+ m: /, '') + '</td></tr>').join('') + '</table>');

  const leaks = {};
  for (const x of fin.slice(0, 12)) for (const [t, n] of Object.entries(x.leaked || {})) leaks[t] = (leaks[t] || 0) + n;
  if (Object.keys(leaks).length) section('What still gets through', 'Drones that reached the site in the first game of each of the best layouts, by type. These are what the layouts still cannot stop.',
    '<table><tr><th>drone</th><th class="n">leaked</th></tr>' + Object.entries(leaks).sort((a, b) => b[1] - a[1]).map(([t, n]) => '<tr><td>' + t + '</td><td class="n">' + n + '</td></tr>').join('') + '</table>');
}

if (DATA.seeds) {
  const d = DATA.seeds, last = d.series.at(-1);
  section('How many seeds are enough?', 'The 95% interval on the mean wave as seeds are added; it should shrink about with the square root of the number of seeds. Target: +-' + d.tol + ' waves.',
    chart({ series: [{ name: 'mean', color: '--c1', pts: d.series.map((p) => [p.n, p.mean, Number.isFinite(p.ci) ? p.ci : 0]) }], xLabel: 'seeds', yLabel: 'mean wave and 95% interval', band: [last.mean - d.tol, last.mean + d.tol] }) +
    '<p class="note">After ' + last.n + ' seeds: ' + f(last.mean, 1) + ' +-' + f(last.ci, 1) + ' waves.</p>');
}

if (DATA.timestep) {
  const d = DATA.timestep, g = d.gci;
  section('Does a finer time step change the answer?', 'The same layout and seeds at three step sizes. If the answers agree, the coarsest step that agrees is safe to use.',
    '<table><tr><th class="n">step (s)</th><th class="n">mean wave</th><th class="n">leaks per wave</th><th class="n">run time (s)</th></tr>' +
    d.rows.map((r) => '<tr><td class="n">' + r.dt + '</td><td class="n">' + f(r.mean, 2) + ' +-' + f(r.ci, 2) + '</td><td class="n">' + f(r.leakRate, 3) + '</td><td class="n">' + f(r.runSeconds, 0) + '</td></tr>').join('') + '</table>' +
    (g ? '<p class="note">Grid convergence index: order ' + f(g.p, 2) + ', extrapolated to a zero step ' + f(g.ext, 2) + ' waves, uncertainty of the finest result ' + f(100 * g.gciFine, 1) + '%. ' + (g.note || '') + '</p>' : ''));
}
</script></body></html>`;
