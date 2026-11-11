// Pause and rewind: the scrub bar, its event markers, and the banner shown while reviewing. Above the bar, the fusion node's
// latest warnings; in it, a note while the clock is stopped.

import { useMemo } from 'react';
import { fmtTime, useGame, useTick } from './hooks.js';
import { Movable } from './Movable.jsx';
import { WORLD } from '../sim/config/index.js';
import { pounds } from '../sim/economy.js';
import { bus } from '../sim/sapient.js';

const MARKER = { kill: '#66bb6a', leak: '#ff5252', spotter: '#ffd600', lost: '#ff9100', casualty: '#e040fb', miss: '#90a4ae', patrol: '#40c4ff', empty: '#ffcf66' };
const ALERT_ROWS = 3, ALERT_SECONDS = 20; // an alert stays about this long on screen, at any game speed

// The fusion node's newest warning and critical alerts up to `now`, oldest first. It raises them to the operator screen, which is
// this one, and they were only ever listed in the Messages tab. An engagement request has its own card.
export function recentAlerts(now, speed) {
  const keep = ALERT_SECONDS * WORLD.timeScale * Math.max(speed, 1), rows = [];
  for (let i = bus.entries.length - 1; i >= 0 && rows.length < ALERT_ROWS; i--) {
    const e = bus.entries[i], a = e.type === 'alert' && e.msg.alert;
    if (e.t > now) continue; // while rewinding, only what had been raised by then
    if (now - e.t > keep) break; // the log is in time order
    if (a && a.alert_type !== 'ALERT_TYPE_INFORMATION' && !a.description.startsWith('Engagement request')) rows.push(e);
  }
  return rows.reverse();
}

function Markers({ rec, n }) {
  // only needs redrawing when the history or the events change; a full history keeps its length but drops its oldest frames
  const t0 = n ? rec.frames[0].t : 0;
  return useMemo(() => {
    const total = n ? rec.frames[n - 1].t - t0 : 0;
    if (!total) return null;
    return rec.events.filter((e) => MARKER[e.type] && e.t >= t0).map((e, i) => (
      <i key={i} style={{ left: `${((100 * (e.t - t0)) / total).toFixed(2)}%`, background: MARKER[e.type] }} title={`${e.text} (${fmtTime(e.t)})`} />
    ));
  }, [rec, n, t0, rec.events.length]);
}

export function Timeline() {
  useTick();
  const game = useGame();
  const { rec } = game.sim;
  const replay = game.getReplay();
  const n = rec.frames.length;
  const reviewing = !!replay && replay.active();
  const i = reviewing ? replay.frameIndex() : n - 1;
  const f = i >= 0 ? rec.frames[i] : null;
  const act = (fn) => () => { if (replay) { fn(replay); game.bump(); } };
  const { state, net } = game.sim;
  const alerts = state.started ? recentAlerts(reviewing && f ? f.t : state.time, game.clock.speed) : [];
  const paused = state.started && !state.over && !reviewing && game.clock.speed === 0;
  return (
    <>
      <Movable id="timeline" title="Timeline" className={paused ? 'panel paused' : 'panel'}>
        <div id="tl-alerts" role="log" aria-label="Warnings from the fusion node">
          {alerts.map((e) => (
            <div key={e.seq} className={e.msg.alert.alert_type === 'ALERT_TYPE_CRITICAL' ? 'crit' : 'warn'} title={e.msg.alert.description}><span>{fmtTime(e.t)}</span> {e.msg.alert.description}</div>
          ))}
        </div>
        <div className="tl-row">
          <button id="tl-live" className="primary" title="Back to the live run" onClick={act((r) => r.exit())}>LIVE</button>
          <button id="tl-back" title="Back 0.5 s (Left arrow)" onClick={act((r) => r.stepBack())}>◀|</button>
          <button id="tl-play" title="Play the replay" onClick={act((r) => r.togglePlay())}>{reviewing && replay.review.playing ? '❚❚' : '▶'}</button>
          <button id="tl-fwd" title="Forward 0.5 s (Right arrow)" onClick={act((r) => r.stepForward())}>|▶</button>
          <div className="tl-track">
            <input id="tl-range" type="range" min="0" max={Math.max(n - 1, 0)} step="1" value={Math.max(i, 0)} onChange={(e) => { if (replay) { replay.enter(Number(e.target.value)); game.bump(); } }} />
            <div id="tl-events"><Markers rec={rec} n={n} /></div>
          </div>
          {/* in the row, so the box is no taller while paused: it sits just under the SAPIENT panel */}
          {paused && <b id="tl-paused" role="status" title={net.pendingRequests.length ? 'The clock is stopped until you answer the engagement request.' : 'The clock is stopped. Press Space, or the play button in Controls, to carry on.'}>PAUSED</b>}
          <span id="tl-time">{f ? fmtTime(f.t) : '0:00'}</span>
        </div>
      </Movable>
      <div id="review-banner" className={reviewing && f ? '' : 'hidden'}>
        {reviewing && f && <>REPLAY <b>{fmtTime(f.t)}</b> · wave {f.wave} · budget {pounds(f.budget)} · kills {f.kills} · leaks {f.leaks}</>}
      </div>
    </>
  );
}
