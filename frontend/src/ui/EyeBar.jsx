// While watching from a system's mast: which system, what it is engaging, and the way back to the map.

import { view } from '../render/view.js';
import { useGame, useTick } from './hooks.js';
import { Movable } from './Movable.jsx';

export function EyeBar() {
  useTick();
  const game = useGame(), s = view.eye;
  if (!s) return null;
  const t = s.task && !s.task.drone.dead ? s.task.drone : null;
  return (
    <Movable id="eye-bar" title="Ground view" role="status">
      Ground view from <b>{s.short}</b>{t ? `, engaging a ${t.def.name}` : ''} · drag to look round
      <button id="eye-back" onClick={() => game.lookFrom(null)}>Back to the map (Esc)</button>
    </Movable>
  );
}
