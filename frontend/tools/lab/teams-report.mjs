// The team sheet and its scorecard as one web page, from teams.json (teams.mjs). Opens straight from disk.
//
//   node tools/lab/teams-report.mjs [lab-results/teams.json]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAME_VERSION } from '../../src/sim/config/index.js';
import { CONDITIONS } from '../../src/sim/conditions.js';
import { OUT_DIR } from './lab.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const gbp = (x) => (x == null || !Number.isFinite(x) ? '–' : x >= 1e6 ? `£${(x / 1e6).toFixed(2)}m` : `£${Math.round(x / 1000)}k`);
const pct = (x) => (x == null || !Number.isFinite(x) ? '–' : `${Math.round(100 * x)}%`);
const num = (x, d = 1) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(d));
const avg = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const MODE = { radar: 'Radar', rf: 'RF', eo: 'EO', acoustic: 'Acoustic' };
// protection 0..1 as a cell tint: one blue ramp, stronger for more protection
const tint = (x) => (x == null || !Number.isFinite(x) ? '' : ` style="background: color-mix(in srgb, var(--good) ${Math.round(6 + 60 * Math.max(0, Math.min(1, x)))}%, var(--card))"`);
const cell = (x, extra = '') => `<td class="n"${tint(x)}>${pct(x)}${extra}</td>`;
const table = (head, body) => `<div class="scroll"><table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${body}</table></div>`;

export function writeTeamsPage(jsonPath = resolve(OUT_DIR, 'teams.json')) {
  const d = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const nations = d.raids.filter((r) => r.kind === 'nation'), types = d.raids.filter((r) => r.kind === 'type');
  const name = (r) => esc(r.name) + (r.changed ? ` <span class="chg">${esc(d.label)}</span>` : '');
  const condLabel = (c) => esc(CONDITIONS[c].label);

  const sheet = d.rows.filter((r) => !r.changed).map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${r.modes.map((m) => `<span class="mode m-${m}">${MODE[m]}</span>`).join(' ') || '<span class="muted">none</span>'}</td><td>${esc(r.sensorText)}</td><td class="n">${gbp(r.sensorGbp)}</td><td class="n">${gbp(r.capexGbp)}</td></tr>`).join('');
  const raidRows = (list) => list.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.what)}</td><td class="n">${gbp(x.costUsd * 0.75)}</td></tr>`).join('');
  // The overview: every team ranked by threat-weighted protection over all conditions, with its cost, each condition, and the raid by
  // type it does worst against, so the comparison is one table.
  const typeAvg = (r, x) => avg(d.conditions.map((c) => r.byCond[c].byRaid[x.id].protection));
  const ranked = [...d.rows].sort((a, b) => (b.threat ?? avg(types.map((x) => typeAvg(b, x))) ?? 0) - (a.threat ?? avg(types.map((x) => typeAvg(a, x))) ?? 0));
  const overview = `<h2>Overview</h2>
<p class="muted">Teams ranked by <b>threat-weighted protection</b>: the Russian, Iranian and Chinese raids pooled, each counting by the warhead weight it brings, as the share of all that weight stopped, averaged over the conditions. Each condition is shown with its 95% interval over the seeds. <b>Weakest against</b> is the raid by type it stops least of.</p>
${table(['#', 'Team', 'Senses by', 'Sensors', 'Overall', ...d.conditions.map(condLabel), 'Weakest against'], ranked.map((r, i) => {
    const weak = types.map((x) => [x, typeAvg(r, x)]).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1])[0];
    const overall = r.threat ?? avg(types.map((x) => typeAvg(r, x)));
    return `<tr><td class="n">${i + 1}</td><td>${name(r)}</td><td>${r.modes.map((m) => `<span class="mode m-${m}">${MODE[m]}</span>`).join(' ') || '<span class="muted">none</span>'}</td><td class="n">${gbp(r.sensorGbp)}</td>`
      + `<td class="bar-cell"><div class="bar"><span style="width:${Math.round(100 * Math.max(0, overall ?? 0))}%"></span></div><b>${pct(overall)}</b></td>`
      + `${d.conditions.map((c) => cell(r.byCond[c].threat, r.byCond[c].ci != null ? ` <span class="muted">±${Math.round(100 * r.byCond[c].ci)}</span>` : '')).join('')}`
      + `<td>${weak ? `${esc(weak[0].name)} <span class="muted">${pct(weak[1])}</span>` : '–'}</td></tr>`;
  }).join(''))}
<h3>Against each type of drone</h3>
<p class="muted">Protection against each raid by type, averaged over the conditions, in the same order.</p>
${table(['Team', ...types.map((x) => esc(x.name))], ranked.map((r) => `<tr><td>${name(r)}</td>${types.map((x) => cell(typeAvg(r, x))).join('')}</tr>`).join(''))}`;

  const perCond = d.conditions.map((c, ci) => {
    const raidTable = (list) => table(['Team', ...list.map((x) => esc(x.name))], d.rows.map((r) => `<tr><td>${name(r)}</td>${list.map((x) => cell(r.byCond[c].byRaid[x.id].protection)).join('')}</tr>`).join(''));
    const detail = d.rows.map((r) => {
      const v = (k) => avg(d.raids.map((x) => r.byCond[c].byRaid[x.id][k]));
      return `<tr><td>${name(r)}</td><td class="n">${num(v('leaks'))}</td><td class="n">${pct(v('unseen'))}</td><td class="n">${num(v('seenAt'), 0)} m</td><td class="n">${num(v('stoppedAt'), 0)} m</td><td class="n">${num(v('killedPeople'))} / ${num(v('injured'))}</td><td class="n">${gbp(v('lostGbp'))}</td><td class="n">${num(v('exchange'), 2)}</td></tr>`;
    }).join('');
    const changes = d.changes ? `<h3>Change: ${esc(d.label)}</h3><p class="muted">Points of protection gained (or lost, below zero), same seeds, with the 95% interval. Bold where the interval clears zero.</p>
${table(['Team', ...(nations.length ? ['Threat-weighted'] : []), ...d.raids.map((x) => esc(x.name))], d.changes.map((ch) => {
    const fmtc = (p) => { if (!p) return '<td class="n">–</td>'; const clear = Math.abs(p.mean) > p.ci; return `<td class="n${clear ? (p.mean > 0 ? ' up' : ' down') : ''}">${p.mean > 0 ? '+' : ''}${num(100 * p.mean, 1)} <span class="muted">±${num(100 * p.ci, 1)}</span></td>`; };
    return `<tr><td>${esc(ch.name)}</td>${nations.length ? fmtc(ch.byCond[c].threat) : ''}${d.raids.map((x) => fmtc(ch.byCond[c].byRaid[x.id])).join('')}</tr>`;
  }).join(''))}` : '';
    return `<details${ci === 0 ? ' open' : ''}><summary>${condLabel(c)}</summary>
${nations.length ? `<h3>Nation raids</h3>${raidTable(nations)}` : ''}
${types.length ? `<h3>Raids by type</h3>${raidTable(types)}` : ''}
${changes}
<h3>How they got there</h3>
<p class="muted">Averaged over the raids. <b>Through</b>: strike drones that reached the site or a system, per raid. <b>Never seen</b>: strike drones no sensor ever saw. <b>Seen at</b> and <b>stopped at</b>: typical distance from the site when first seen and when brought down. <b>People</b>: killed / injured per raid. <b>Systems lost</b>: value destroyed per raid. <b>Exchange</b>: enemy £ destroyed per £1 of ammunition, higher is better.</p>
${table(['Team', 'Through', 'Never seen', 'Seen at', 'Stopped at', 'People', 'Systems lost', 'Exchange'], detail)}
</details>`;
  }).join('\n');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Team sheet</title>
<style>
:root { --bg: #f6f7f9; --card: #ffffff; --ink: #1b2330; --muted: #6a7585; --line: #dfe3ea; --good: #2f6fdb; --up: #1a7f4b; --down: #b3261e;
  --radar: #b5651d; --rf: #1f7f74; --eo: #6a4cc4; --acoustic: #a8396a; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #12161d; --card: #1a2029; --ink: #e6ebf2; --muted: #95a0b0; --line: #2c3442; --good: #4f8ff7; --up: #4cc38a; --down: #ff7b72; } }
:root[data-theme="dark"] { --bg: #12161d; --card: #1a2029; --ink: #e6ebf2; --muted: #95a0b0; --line: #2c3442; --good: #4f8ff7; --up: #4cc38a; --down: #ff7b72; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 32px 0 6px; } h3 { font-size: 14px; margin: 20px 0 6px; }
.muted { color: var(--muted); } .scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; background: var(--card); border: 1px solid var(--line); font-variant-numeric: tabular-nums; }
th, td { padding: 7px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
th { font-size: 12px; color: var(--muted); font-weight: 600; } td.n { text-align: right; white-space: nowrap; }
.mode { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 12px; font-weight: 600; color: #fff; }
.m-radar { background: var(--radar); } .m-rf { background: var(--rf); } .m-eo { background: var(--eo); } .m-acoustic { background: var(--acoustic); }
.chg { font-size: 12px; color: var(--muted); } .up { color: var(--up); font-weight: 600; } .down { color: var(--down); font-weight: 600; }
.bar-cell { white-space: nowrap; } .bar { display: inline-block; width: 90px; height: 8px; margin-right: 8px; background: var(--line); border-radius: 4px; vertical-align: middle; overflow: hidden; } .bar span { display: block; height: 100%; background: var(--good); }
.note { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; }
details { margin-top: 24px; } summary { cursor: pointer; font-size: 17px; font-weight: 600; padding: 6px 0; }
</style></head><body><main>
<h1>Team sheet</h1>
<p class="muted">Rules version ${esc(GAME_VERSION)} · ${d.seeds.length} seeds per raid · ${d.conditions.map(condLabel).join(', ')} · ${new Date().toISOString().slice(0, 10)}${d.invalid ? ` · <b>${d.invalid} invalid games</b> (${esc(d.firstInvalid)})` : ''}</p>
<p class="note"><b>Every team has the same effectors</b>: ${esc(d.effectors)}. Only the sensors change, and each team spends about ${gbp(d.budgetGbp)} on them, so a difference between two teams is what their sensing is worth for the money.</p>
${overview}
<h2>The teams</h2>
${table(['Team', 'Senses by', 'Sensors', 'Sensor cost', 'Whole build'], sheet)}
${nations.length ? `<h2>Nation raids</h2><p class="muted">About £750k each, of that nation's own types, timed to arrive in the order their tactics put them. Mixes and timings are assumptions from open reporting; China has no combat record to draw on.</p>${table(['Raid', 'What comes', 'Cost'], raidRows(nations))}` : ''}
${types.length ? `<h2>Raids by type</h2><p class="muted">One kind of drone at a time, to show what each sensing mode is good and bad at.</p>${table(['Raid', 'What comes', 'Cost'], raidRows(types))}` : ''}
<h2>By conditions</h2>
<p class="muted">Protection: the share of the raid's warheads, weighted by their damage, that never reached the site or a system. 100% stops everything; 0% is no defence.</p>
${perCond}
</main></body></html>`;
  const page = jsonPath.replace(/\.json$/, '.html');
  writeFileSync(page, html);
  return page;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/lab/teams-report.mjs')) console.log(writeTeamsPage(process.argv[2] ? resolve(process.argv[2]) : undefined));
