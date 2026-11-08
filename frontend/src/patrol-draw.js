// Drawing a patrol route: click each waypoint from the start, then double-click to finish at the end. The route being drawn lives in
// the view settings as { points, done }, and a finished one goes to the simulation, which adds the soldiers and their escort.

import { MAX_WAYPOINTS, planOf } from './sim/patrol.js';

const DOUBLE_CLICK = 1.5; // scene units, 30 m

export function addRoutePoint(route, x, z) {
  const points = route && !route.done ? route.points : [], last = points.at(-1);
  if (last && Math.hypot(x - last[0], z - last[1]) < DOUBLE_CLICK) return points.length >= 2 ? { points, done: true } : route;
  const next = [...points, [x, z]];
  return { points: next, done: next.length >= MAX_WAYPOINTS };
}

// A click while drawing. A new route replaces the old one but keeps its vehicles, corridor and formation. A refused one is wiped.
export function patrolClicker({ sim, commands, view, toast, setTool, bump }) {
  let kept = null; // [column, plan] of the patrol being redrawn
  return (x, z) => {
    if (sim.designLocked()) { toast('The patrol is locked once the first wave starts'); return; }
    const old = sim.getPatrol();
    if (!view.route && old) { kept = [old.column, planOf(old)]; commands.setPatrol(null); }
    view.route = addRoutePoint(view.route, x, z);
    if (!view.route.done) { bump(); return; }
    const refused = kept ? commands.setPatrol(view.route.points, ...kept) : commands.setPatrol(view.route.points);
    view.route = null; kept = null;
    toast(refused || 'Patrol set. It walks to the end and back from the first wave. Set its corridor, formation and vehicles in the Area panel');
    setTool('patrol');
  };
}
