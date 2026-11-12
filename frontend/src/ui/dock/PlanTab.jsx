// The top-down map, twice. Plan: where every system stands, its range, its link to the fusion node, engagements and tracks.
// Propagation (in EM Spectrum): the same map with how far sensors and jammers reach over the real ground: sensor coverage for a
// chosen drone type, and the ground each jammer's signal covers. Both can hide categories of system.

import { useEffect, useRef } from 'react';
import { DRONES } from '../../sim/config/index.js';
import { typicalAltitude } from '../../sim/site-range.js';
import { view } from '../../render/view.js';
import { useAnimation, useGame, useTick } from '../hooks.js';
import { ThreatOptions } from '../ThreatOptions.jsx';
import { COVER_FILL, PLAN_CATEGORIES, createPlanCanvas } from './plan-canvas.js';
import { zoneShare } from '../coverage.js';

const PLAN_NOTE = 'North up, scroll to zoom. Circles are each node’s range, lines are links to the fusion node (bright when a message has just been sent), red lines are active engagement tasks, crosses are fused tracks drawn where the fusion node believes they are (gold = confirmed, orange = coasting, grey = tentative; circle = position error), faint lines are bearings no track has claimed, wedges show where cameras are pointing, grey dots are drones nobody has (truth overlay).';

function MapPane({ active, propagation }) {
  useTick(active);
  const game = useGame();
  const { sim } = game;
  const canvas = useRef(null), plan = useRef(null);
  const coverageOn = propagation && view.coverageOn; // kept in the view settings, so the wizard can show the drone type it is talking about
  const jamming = propagation && view.jamShown !== false;
  const threat = view.coverageThreat ?? Object.keys(DRONES)[0];
  const hidden = view.planHidden ?? []; // the categories unticked below, kept in the view settings
  useEffect(() => {
    plan.current = createPlanCanvas(canvas.current, sim);
    return () => plan.current.dispose();
  }, [sim]);
  useAnimation(active, () => plan.current.draw(coverageOn ? threat : null, hidden, { jamming }), 200);
  const show = (id, on) => game.setViewOption('planHidden', on ? hidden.filter((h) => h !== id) : [...hidden, id]);
  const p = propagation ? 'prop' : 'plan';
  return (
    <>
      {propagation && (
        <div className="plan-tools">
          <label><input type="checkbox" id="cov-on" checked={coverageOn} onChange={(e) => game.setViewOption('coverageOn', e.target.checked)} /> Sensor coverage for</label>
          <select id="cov-threat" value={threat} onChange={(e) => game.setViewOption('coverageThreat', e.target.value)}>
            <ThreatOptions text={(d) => `${d.name} (${d.rfEmitter ? 'radio link' : 'no radio link'}, ${Math.round(typicalAltitude(d))} m)`} />
          </select>
          <label><input type="checkbox" id="jam-on" checked={jamming} onChange={(e) => game.setViewOption('jamShown', e.target.checked)} /> Jamming</label>
          <span className="cov-key" id="cov-legend">{coverageOn && <>
            {['Not seen', 'Seen by 1 sensor', 'By 2 or more'].map((t, i) => <span key={t}><i style={{ background: COVER_FILL[i] }} />{t}</span>)}
            <b> · {Math.round(zoneShare(sim, threat, view.zone) * 100)}% of {view.zone?.closed ? 'your area' : 'the build area'} seen</b>
          </>}{jamming && <span><i style={{ background: '#ff52523a', outline: '1px solid #ff7a7a' }} />Jammed ground</span>}</span>
        </div>
      )}
      <div className="plan-tools" id={`${p}-filter`} role="group" aria-label="Show on the map">
        <span className="muted">Show</span>
        {PLAN_CATEGORIES.map(([id, label]) => <label key={id}><input type="checkbox" data-plan-show={id} checked={!hidden.includes(id)} onChange={(e) => show(id, e.target.checked)} /> {label}</label>)}
      </div>
      <canvas id={p} ref={canvas} />
      <div className="plan-note">{!propagation ? PLAN_NOTE
        : coverageOn ? 'North up, scroll to zoom. Each square shows how many sensors would see this type of drone there, at its usual height, more than half the time, with the ground in the way. Dots are sensors and squares are weapons.'
          : 'North up, scroll to zoom. Red shading is the ground each jammer’s signal reaches, following the terrain: solid while it is jamming, dashed while it listens. Tick Sensor coverage to map what your sensors see of a drone type.'}</div>
    </>
  );
}

export const PlanTab = ({ active }) => <MapPane active={active} />;
export const PropagationTab = ({ active }) => <MapPane active={active} propagation />;
