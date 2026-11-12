// Defending an area or a patrol, opened from the Controls menu. One panel at a time: the area to defend, which strike drones attack
// in place of the station, or the patrol, its route and its planner. The view remembers which is open (view.defend).

import { view } from '../render/view.js';
import { useGame, useTick } from './hooks.js';
import { ZonePanel } from './ZonePanel.jsx';

// Open or close a defence panel. Opening the area starts drawing it if none is drawn yet; closing it, or moving to the patrol, stops.
export function toggleDefend(game, mode) {
  const drawing = game.getTool() === 'zone';
  if (view.defend === mode) { if (drawing) game.setTool('zone'); game.setViewOption('defend', null); return; }
  game.setViewOption('mapPanel', false);
  if (mode === 'area' && !view.zone?.closed && !game.sim.designLocked() && !drawing) game.setTool('zone');
  if (mode !== 'area' && drawing) game.setTool('zone');
  game.setViewOption('defend', mode);
}

export function DefendPanel() {
  useTick();
  const game = useGame();
  if (!view.defend || !game.sim.state.started || view.mapPanel) return null;
  return <ZonePanel mode={view.defend} onClose={() => toggleDefend(game, view.defend)} />;
}
