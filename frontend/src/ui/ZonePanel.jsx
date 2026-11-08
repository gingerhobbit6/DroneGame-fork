// Drawing the area to defend from the map rail, with or without the wizard. Once it is closed, this is what strike drones attack.

import { closeZone, undoZonePoint } from '../zone.js';
import { view } from '../render/view.js';
import { zoneScores } from './coverage.js';
import { useGame } from './hooks.js';
import { PatrolColumn } from './PatrolColumn.jsx';
import { PatrolPlan } from './PatrolPlan.jsx';

// How much of the area is seen, for each drone type, with the strongest first.
export function CoverageBars({ scores, gap }) {
  return (
    <div className="wz-bars">
      {[...scores].reverse().map((s) => (
        <div key={s.id} className={s === gap ? 'gap' : ''}>
          <div className="wz-bar-label"><span>{s.name}, {s.height} m</span><b>{Math.round(s.share * 100)}%</b></div>
          <div className="wz-bar"><i style={{ width: `${s.share * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export const ATTACK_NOTE = 'Strike drones attack spots inside the area, in place of the station. FPV and FO strikes can still turn on a loud emitter.';

export function ZonePanel({ onClose }) {
  const game = useGame();
  const zone = view.zone, closed = !!zone?.closed, drawing = game.getTool() === 'zone';
  const count = zone && !closed ? zone.points.length : 0;
  const locked = game.sim.designLocked();
  const set = (z) => game.setViewOption('zone', z);
  const draw = () => { if (!drawing) game.setTool('zone'); };
  const finish = () => { set(closeZone(zone)); game.setTool('zone'); };
  const redraw = () => { set(null); draw(); };
  const patrol = game.sim.getPatrol(), walking = game.getTool() === 'patrol';
  const drawRoute = () => { game.setViewOption('route', null); game.setTool('patrol'); };
  const clearPatrol = () => { game.commands.setPatrol(null); game.bump(); };

  return (
    <div id="zone-panel" className="panel" role="dialog" aria-label="Area to defend">
      <button id="zone-panel-close" aria-label="Close" onClick={onClose}>×</button>
      <b>Area to defend</b>
      {drawing && <p>Click the map to mark each corner, then double-click to close it.{count > 0 && ` ${count} point${count > 1 ? 's' : ''} so far.`}</p>}
      {!drawing && closed && <p>How much of your area your sensors can see, for each drone type:</p>}
      {!drawing && closed && <CoverageBars scores={zoneScores(game.sim, zone)} />}
      {!drawing && !closed && <p>{count ? 'Drawing is paused.' : 'No area drawn, so drones attack the station. Draw one anywhere on the map to defend that instead, and build anywhere.'}</p>}
      {!locked && <div className="wz-actions">
        {drawing && <button id="zone-finish" className="wz-go" disabled={count < 3} onClick={finish}>Close the area</button>}
        {!drawing && !closed && <button id="zone-draw" className="wz-go" onClick={draw}>{count ? 'Keep drawing' : 'Draw an area'}</button>}
        {!drawing && closed && <button id="zone-redraw" onClick={redraw}>Redraw</button>}
        {drawing && count > 0 && <button id="zone-undo" onClick={() => set(undoZonePoint(zone))}>Undo point</button>}
        {zone && <button id="zone-clear" onClick={() => set(null)}>Clear</button>}
      </div>}
      <p className="muted">{locked ? 'Locked until you reset the run.' : ATTACK_NOTE}</p>
      <b>Or protect a patrol</b>
      <p>{walking ? 'Click the map for each waypoint from the start, then double-click to finish at the end.' : patrol ? `${patrol.group.count} soldiers walk the blue route from the first wave, escorted by:` : 'Soldiers walk a route to its end and back, escorted by vehicles you choose, carrying sensors and weapons, and the drones hunt them.'}</p>
      {patrol && !walking && <PatrolColumn patrol={patrol} locked={locked} />}
      {patrol && !walking && <PatrolPlan patrol={patrol} locked={locked} />}
      {!locked && <div className="wz-actions">
        <button id="patrol-draw" onClick={drawRoute}>{walking ? 'Stop drawing' : patrol ? 'Redraw the route' : 'Draw a patrol route'}</button>
        {patrol && <button id="patrol-clear" onClick={clearPatrol}>Clear the patrol</button>}
      </div>}
    </div>
  );
}
