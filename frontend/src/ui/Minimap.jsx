import { useEffect, useRef } from 'react';
import { createMinimap } from './minimap.js';
import { useGame, useTick } from './hooks.js';
import { Movable } from './Movable.jsx';

// The minimap's drawing and mouse handling stay in minimap.js: it needs the live camera, and draws every other frame.
export function Minimap() {
  useTick();
  const game = useGame();
  const canvas = useRef(null);
  const view = game.getView();
  useEffect(() => {
    if (!view) return undefined;
    const map = createMinimap(game.sim, canvas.current, view.camera, view.controls);
    return game.onFrame(map.draw);
  }, [game, view]);
  return (
    <Movable id="minimap" title="Overview map">
      <canvas id="minimap-canvas" ref={canvas} width="226" height="226" title="Top-down view. Click or drag to move the camera there; scroll to zoom the map." />
    </Movable>
  );
}
