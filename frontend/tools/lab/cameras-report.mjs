// Puts the camera comparison (lab-results/cameras.json, from cameras.mjs) at the top of the lab report the game's Lab tab opens.
// The section sits between markers, so running this again replaces it.   node tools/lab/cameras-report.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT_DIR, fmt } from './lab.mjs';

const GBP = 0.75, START = '<!-- cameras -->', END = '<!-- /cameras -->';
const c = JSON.parse(readFileSync(resolve(OUT_DIR, 'cameras.json'), 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const money = (usd) => (usd >= 1e6 ? `£${fmt((usd * GBP) / 1e6, 2)}M` : `£${Math.round((usd * GBP) / 1000)}k`);
const base = c.rows[0], top = Math.max(...c.rows.map((r) => r.waves + (Number.isFinite(r.ci) ? r.ci : 0)));
const W = 520, bar = (r) => {
  const x = (v) => (Math.max(0, v) / top) * W, lo = x(r.waves - r.ci), hi = x(r.waves + r.ci);
  return `<svg viewBox="0 0 ${W + 10} 18" role="img" aria-label="${esc(r.name)}: ${fmt(r.waves)} waves, plus or minus ${fmt(r.ci)}"><rect x="0" y="4" width="${x(r.waves)}" height="10" rx="2" fill="var(--c1)"></rect>${Number.isFinite(r.ci) ? `<line x1="${lo}" x2="${hi}" y1="9" y2="9" stroke="var(--fg)" stroke-width="1.5"></line>` : ''}</svg>`;
};
const rows = c.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">£${Math.round(r.cameraGbp / 1000)}k</td><td class="n">${money(r.capex)}</td><td class="n"><b>${fmt(r.waves)}</b> ±${fmt(r.ci)}</td><td class="n">${r.waves >= base.waves ? '+' : ''}${fmt(r.waves - base.waves)}</td><td class="n">${fmt(r.leaks)}</td><td class="n">£${fmt(r.perPound, 2)}</td><td style="min-width:200px">${bar(r)}</td></tr>`).join('');
const html = `${START}
<main class="cameras">
<h1>Cameras: one SPYKE against Overview PodViews</h1>
<p class="sub">${c.rows[0].games} unseen seeds per variant (${c.seeds[0]} to ${c.seeds.at(-1)}), up to wave ${c.max}, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Each variant is the brief's V11 laydown (10 vehicles with machine guns, 4 EchoGuard radars, 3 P1 interceptors, 12 jammers) with only the cameras added to its vehicles, spread round the ring.</p>
<div class="card"><table>
<thead><tr><th>Variant</th><th class="n">Cameras</th><th class="n">Whole laydown</th><th class="n">Waves reached</th><th class="n">Against none</th><th class="n">Leaks a game</th><th class="n">Spent per £1 destroyed</th><th>Waves, with the 95% interval</th></tr></thead>
<tbody>${rows}</tbody></table>
<p class="note">Waves reached is the mean wave a game ended on, with its 95% interval: where two intervals overlap, the seeds cannot tell those variants apart. Spent per £1 destroyed counts the systems and every shot. Each variant's laydown is in the Lab tab's list, as "cameras …", to open on the map.</p></div>
<div class="card">
<p><b>How the two cameras are modelled.</b> <b>SPYKE</b> (Quell, £300,000) stares at a fixed 79° by 57° view facing out from the site, so it needs no cue and never turns; its six mirror-steered locating cameras are modelled as up to six drones located each half-second look, the nearest first, each to 0.05° of bearing. It reaches 1.8 km for the game's 0.35 m reference drone, which is Quell's 1.3 km for a DJI Mini 3 Pro scaled by size; the game scales a camera's reach in proportion to a drone's size, so it gives SPYKE more against big drones than Quell quotes (about 4 km for a Matrice 300, against 2.6 km). It is visible light only. <b>PodView</b> (Overview, now £30,000 each in the game) has a 10° view that sweeps until a radar track cues it, then zooms to 1.2° and fixes range with its laser rangefinder.</p>
<p class="note">Neither camera shoots. In this game a camera adds bearings to the fused track and names the drone, so the effectors fire on better tracks. One SPYKE covers 79° of the 360° round the site, so it sees only the waves that come through its sector. The attack is the game's default four generic drone types.</p>
</div>
</main>
${END}`;
const file = resolve(OUT_DIR, 'report.html');
let page = readFileSync(file, 'utf8');
const a = page.indexOf(START), b = page.indexOf(END);
page = a >= 0 ? page.slice(0, a) + html + page.slice(b + END.length) : page.replace('<main id="app">', `${html}\n<main id="app">`);
writeFileSync(file, page);
console.log('camera section written to', file);
