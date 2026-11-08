// The run's statistics, the same wherever they show: the HUD and the wizard during a run (the headline), and the SAPIENT dock's
// Statistics tab and the end card (all of it). Worked out in sim/stats.js; prices in pounds (economy.js).

import { useState } from 'react';
import { money } from '../sim/economy.js';
import { RANGE_BINS, runStats, wavesFlown } from '../sim/stats.js';
import { hex, km as kmOf, useGame, useTick } from './hooks.js';
import './run-stats.css';

const NONE = '–';
const km = (m) => (m == null ? NONE : kmOf(m));
const pct = (k) => (k == null ? NONE : `${Math.round(k * 100)}%`);
const secs = (s) => (s == null ? NONE : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
const cost = (v) => (v == null ? NONE : money(v));
const avg = (sp, f) => (sp ? f(sp.mean) : NONE);
const avgSd = (sp, f) => (sp ? `${f(sp.mean)} ± ${f(sp.sd)}` : NONE);
const span = (sp, f) => (sp ? `${f(sp.min)} to ${f(sp.max)}` : NONE);
const waveName = (n) => (n === 0 ? 'Sandbox' : `Wave ${n}`);
const binName = (i) => (RANGE_BINS[i + 1] ? `${RANGE_BINS[i] / 1000}–${RANGE_BINS[i + 1] / 1000}` : `${RANGE_BINS[i] / 1000}+`);

// The few figures worth following live.
export function StatsHeadline({ stats: s, onOpen }) {
  const d = s.drones;
  const tiles = [
    ['Kill rate', pct(d.launched ? d.killed / d.launched : null), `${d.killed} of ${d.launched} downed`],
    ['Hit rate', pct(s.fire.hitRate), `${s.fire.hits} of ${s.fire.rounds} rounds`],
    ['Downed at', avg(s.range.kill, km), 'mean from the site'],
    ['First seen', avg(s.range.detect, km), 'mean from the site'],
    ['Seen to engaged', avg(s.time.toEngage, secs), 'mean time'],
    ['Per kill', cost(s.cost.perKill), 'rounds fired'],
  ];
  return (
    <div className="st-head">
      <div className="st-tiles">{tiles.map(([k, v, note]) => <div key={k} title={note}><b>{v}</b><span>{k}</span></div>)}</div>
      {onOpen && <button className="st-open" onClick={onOpen}>All statistics</button>}
    </div>
  );
}

function KillRangeChart({ bins }) {
  const top = Math.max(...bins, 1);
  return (
    <figure className="st-chart" aria-label="How far from the site drones were downed">
      <div className="st-bars">
        {bins.map((n, i) => (
          <div key={i} className="st-bar" title={`${n} downed ${binName(i)} km from the site`}>
            <span>{n || ''}</span><i style={{ height: `${(100 * n) / top}%` }} />
          </div>
        ))}
      </div>
      <div className="st-axis">{bins.map((_, i) => <span key={i}>{binName(i)}</span>)}</div>
      <figcaption>Drones downed, by distance from the site (km)</figcaption>
    </figure>
  );
}

const List = ({ rows }) => <dl className="st-list">{rows.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>; // a fixed list, and two rows share a label

function used(e) {
  if (e.fire === 'jam') return e.jam == null ? NONE : `${secs(e.jam)} jamming`;
  return e.fire === 'beam' ? `${e.shots} s of beam` : e.shots;
}

function Effectors({ rows }) {
  return (
    <div className="st-table">
      <table className="mini" id="stats-effectors">
        <thead><tr><th>Effector</th><th>Placed</th><th>Fired</th><th>Hits</th><th>Hit rate</th><th>Kills</th><th>Cost</th><th>Per kill</th><th>Downed at</th><th>Furthest</th><th>Rounds left</th></tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <th scope="row">{e.name}</th><td>{e.placed}</td><td>{used(e)}</td><td>{e.fire === 'guided' ? e.hits : NONE}</td><td>{pct(e.hitRate)}</td><td>{e.kills}</td>
              <td>{e.fire === 'jam' ? 'none' : cost(e.cost)}</td><td>{e.fire === 'jam' ? NONE : cost(e.perKill)}</td><td>{avg(e.range, km)}</td><td>{e.reach ? km(e.reach.max) : NONE}</td>
              <td>{e.rounds ? `${e.rounds.left} of ${e.rounds.of}` : e.fire === 'beam' ? 'Recharges' : NONE}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="11" className="muted">No effectors placed</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Sensors({ rows }) {
  return (
    <div className="st-table">
      <table className="mini" id="stats-sensors">
        <thead><tr><th>Sensor</th><th>Placed</th><th>Drones seen</th><th>Seen first</th><th>First seen at</th><th>From the site</th><th>Seen to engaged</th><th>False alarms</th></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.name}</th><td>{s.placed || NONE}</td><td>{s.seen} ({pct(s.share)})</td><td>{s.first}</td>
              <td title={span(s.range, km)}>{avgSd(s.range, km)}</td><td>{avg(s.site, km)}</td><td>{avg(s.toEngage, secs)}</td><td>{s.falseAlarms}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="8" className="muted">No sensors placed</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Types({ rows }) {
  return (
    <div className="st-table">
      <table className="mini" id="stats-types">
        <thead><tr><th>Drone</th><th>Launched</th><th>Seen</th><th>Downed</th><th>Reached the site</th><th>Hit a system</th><th>Left</th><th>First seen at</th><th>Downed at</th><th>Fired at it</th><th>Attack cost</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <th scope="row"><i style={{ background: hex(t.color) }} />{t.name}</th><td>{t.launched}</td><td>{t.seen}</td><td>{t.killed}</td><td>{t.leaked}</td><td>{t.struck}</td><td>{t.left}</td>
              <td>{avg(t.detect, km)}</td><td>{avg(t.kill, km)}</td><td title={`${t.shots} shots`}>{cost(t.spent)}</td><td>{cost(t.cost)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="11" className="muted">No drones launched yet</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// Everything, for one wave or the whole run.
export function RunStats() {
  const { sim } = useGame();
  const [wave, setWave] = useState(null);
  const waves = wavesFlown(sim.ledger), shown = waves.includes(wave) ? wave : null;
  const s = runStats(sim, shown), d = s.drones, f = s.fire, c = s.cost, whole = shown == null ? '' : ' (whole run)';
  return (
    <div className="run-stats" id="run-stats">
      <div className="st-waves" role="group" aria-label="Which wave">
        {[null, ...waves].map((n) => <button key={n ?? 'all'} className={n === shown ? 'active' : ''} aria-pressed={n === shown} onClick={() => setWave(n)}>{n == null ? 'Whole run' : waveName(n)}</button>)}
      </div>
      <StatsHeadline stats={s} />
      <p className="st-drones"><b>{d.launched}</b> launched · <b>{d.seen}</b> seen · <b>{d.engaged}</b> engaged · <b>{d.killed}</b> downed · <b>{d.leaked}</b> reached the site · <b>{d.struck}</b> hit a system · <b>{d.left}</b> left{d.airborne ? <> · <b>{d.airborne}</b> still flying</> : null}</p>
      <div className="st-cols">
        <section>
          <h3>Engagement</h3>
          <List rows={[['Rounds fired', f.rounds], ['Hits', `${f.hits} (${pct(f.hitRate)})`], ['Rounds per kill', f.roundsPerKill == null ? NONE : f.roundsPerKill.toFixed(1)],
            ['Beam time', secs(f.beamSeconds)], ['Downed by beam', f.beamKills], ['Downed by jamming', f.jamKills], ['False alarms', f.falseAlarms]]} />
          <h3>Timing</h3>
          <List rows={[['First seen to engaged', avgSd(s.time.toEngage, secs)], ['Quickest, slowest', span(s.time.toEngage, secs)], ['First seen to downed', avgSd(s.time.toKill, secs)]]} />
        </section>
        <section>
          <h3>Ranges</h3>
          <List rows={[['Downed, from the site', avgSd(s.range.kill, km)], ['Nearest, furthest', span(s.range.kill, km)], ['Downed, from the shooter', avgSd(s.range.shooter, km)],
            ['First seen, from the site', avgSd(s.range.detect, km)], ['Nearest, furthest', span(s.range.detect, km)]]} />
          <KillRangeChart bins={s.range.bins} />
        </section>
        <section>
          <h3>Cost</h3>
          <List rows={[['Rounds fired', cost(c.fired)], ['Per drone downed', cost(c.perKill)], ['Enemy attack', cost(c.enemy)], ['Enemy destroyed', cost(c.destroyed)],
            ['Rounds per £1 destroyed', c.exchange == null ? NONE : `£${c.exchange.toFixed(2)}`], [`Systems bought${whole}`, cost(c.systems)],
            [`Munitions bought${whole}`, cost(c.bought)], [`Systems lost${whole}`, cost(c.lost)]]} />
        </section>
      </div>
      <h3>Effectors</h3><Effectors rows={s.effectors} />
      <h3>Sensors</h3><Sensors rows={s.sensors} />
      <h3>Drone types</h3><Types rows={s.types} />
      <p className="muted st-note">Distances from the site are along the ground; from a sensor or a shooter, in a straight line. Hit rate counts rounds that reached their target; a laser's beam and a jammer have no rounds. Jamming time is for the whole run. Prices are shown in pounds at £0.75 to the dollar, an assumption.</p>
    </div>
  );
}

// The SAPIENT dock's tab, which follows the run while it is showing.
export function StatsTab({ active }) {
  useTick(active);
  return <RunStats />;
}
