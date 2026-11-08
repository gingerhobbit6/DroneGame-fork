// Pause and rewind: the scrub bar, its event markers, and the banner shown while reviewing.

import { useMemo } from 'react';
import { fmtTime, useGame, useTick } from './hooks.js';

const MARKER = { kill: '#66bb6a', leak: '#ff5252', spotter: '#ffd600', lost: '#ff9100', casualty: '#e040fb', miss: '#90a4ae', patrol: '#40c4ff', empty: '#ffcf66' };

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
  return (
    <>
      <div id="timeline" className="panel">
        <div className="tl-row">
          <button id="tl-live" className="primary" title="Back to the live run" onClick={act((r) => r.exit())}>LIVE</button>
          <button id="tl-back" title="Back 0.5 s (Left arrow)" onClick={act((r) => r.stepBack())}>◀|</button>
          <button id="tl-play" title="Play the replay" onClick={act((r) => r.togglePlay())}>{reviewing && replay.review.playing ? '❚❚' : '▶'}</button>
          <button id="tl-fwd" title="Forward 0.5 s (Right arrow)" onClick={act((r) => r.stepForward())}>|▶</button>
          <div className="tl-track">
            <input id="tl-range" type="range" min="0" max={Math.max(n - 1, 0)} step="1" value={Math.max(i, 0)} onChange={(e) => { if (replay) { replay.enter(Number(e.target.value)); game.bump(); } }} />
            <div id="tl-events"><Markers rec={rec} n={n} /></div>
          </div>
          <span id="tl-time">{f ? fmtTime(f.t) : '0:00'}</span>
        </div>
      </div>
      <div id="review-banner" className={reviewing && f ? '' : 'hidden'}>
        {reviewing && f && <>REPLAY <b>{fmtTime(f.t)}</b> · wave {f.wave} · budget ${Math.round(f.budget).toLocaleString('en-US')} · kills {f.kills} · leaks {f.leaks}</>}
      </div>
    </>
  );
}
