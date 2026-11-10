// A compass on the map rail: its needle points to north on the screen. Pressing it, or N, turns the view so north is up.

import { useEffect, useRef } from 'react';
import { headingOf } from '../render/camera-moves.js';
import { useGame } from './hooks.js';

export function Compass() {
  const game = useGame(), gameView = game.getView(), needle = useRef(null);
  // The needle turns every frame with the camera, so it is set directly rather than by re-rendering
  useEffect(() => {
    if (!gameView?.camera || !game.onFrame) return undefined;
    let shown = null;
    return game.onFrame(() => {
      const turn = Math.round(-headingOf(gameView.camera));
      if (turn !== shown && needle.current) { needle.current.setAttribute('transform', `rotate(${turn} 12 12)`); shown = turn; }
    });
  }, [game, gameView]);
  return (
    <button id="map-compass" aria-label="Turn north up (N)" title="Turn north up (N)" onClick={() => gameView?.northUp?.()}>
      <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
        <g ref={needle}>
          <path d="M12 2.5 15 12H9z" fill="#ff5252" />
          <path d="M12 21.5 9 12h6z" fill="currentColor" opacity="0.7" />
          <text x="12" y="8.6" textAnchor="middle" fontSize="4.6" fontWeight="700" fill="#fff">N</text>
        </g>
      </svg>
    </button>
  );
}
