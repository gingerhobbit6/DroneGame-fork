import { useEffect, useRef } from 'react';
import { DRONES } from '../../sim/config/index.js';
import { typicalAltitude } from '../../sim/site-range.js';
import { view } from '../../render/view.js';
import { useAnimation, useGame, useTick } from '../hooks.js';
import { ThreatOptions } from '../ThreatOptions.jsx';
import { COVER_FILL, createPlanCanvas } from './plan-canvas.js';
import { zoneShare } from '../coverage.js';

export function PlanTab({ active }) {
  useTick(active);
  const game = useGame();
  const { sim } = game;
  const canvas = useRef(null), plan = useRef(null);
  const coverageOn = view.coverageOn; // kept in the view settings, so the wizard can show the drone type it is talking about
  const threat = view.coverageThreat ?? Object.keys(DRONES)[0];
  useEffect(() => {
    plan.current = createPlanCanvas(canvas.current, sim);
    return () => plan.current.dispose();
  }, [sim]);
  useAnimation(active, () => plan.current.draw(coverageOn ? threat : null), 200);
  return (
    <>
      <div className="plan-tools">
        <label><input type="checkbox" id="cov-on" checked={coverageOn} onChange={(e) => game.setViewOption('coverageOn', e.target.checked)} /> Sensor coverage for</label>
        <select id="cov-threat" value={threat} onChange={(e) => game.setViewOption('coverageThreat', e.target.value)}>
          <ThreatOptions text={(d) => `${d.name} (${d.rfEmitter ? 'radio link' : 'no radio link'}, ${Math.round(typicalAltitude(d))} m)`} />
        </select>
        <span className="cov-key" id="cov-legend">{coverageOn && <>
          {['Not seen', 'Seen by 1 sensor', 'By 2 or more'].map((t, i) => <span key={t}><i style={{ background: COVER_FILL[i] }} />{t}</span>)}
          <b> · {Math.round(zoneShare(sim, threat, view.zone) * 100)}% of {view.zone?.closed ? 'your area' : 'the build area'} seen</b>
        </>}</span>
      </div>
      <canvas id="plan" ref={canvas} />
      <div className="plan-note">{coverageOn ? 'North up, scroll to zoom. Each square shows how many sensors would see this type of drone there, at its usual height, more than half the time. Dots are sensors and squares are weapons. Untick the box for the full plan with ranges, links and tracks.' : <>North up, scroll to zoom. Circles are each node's range, lines are links to the fusion node (bright when a message has just been sent), red lines are active engagement tasks, crosses are fused tracks drawn where the fusion node believes they are (gold = confirmed, orange = coasting, grey = tentative; circle = position error), faint lines are bearings no track has claimed, wedges show where cameras are pointing, grey dots are drones nobody has (truth overlay).</>}</div>
    </>
  );
}
