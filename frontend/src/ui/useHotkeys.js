// Keyboard shortcuts. Typing into a field never triggers them.

import { useEffect } from 'react';
import { TOOLBAR } from '../sim/config/index.js';
import { view } from '../render/view.js';
import { useAccount } from './account/pack.js';
import { mapName, nextBaseMap, nextGrid } from './MapControls.jsx';
import { useGame } from './hooks.js';

export function useHotkeys() {
  const game = useGame(), covered = useAccount()?.covered; // under the profile or login page
  useEffect(() => {
    if (covered) return undefined;
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) || e.target.isContentEditable) return;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl+C, Ctrl+P and the like belong to the browser, and a card's Space to the card
      if (e.key === ' ' && (tag === 'BUTTON' || tag === 'SUMMARY')) return; // Space presses the focused button or opens the section, and nothing else
      const replay = game.getReplay();
      const reviewing = replay && replay.active();
      if (e.key === 'ArrowLeft' && replay) { replay.stepBack(); e.preventDefault(); return; }
      if (e.key === 'ArrowRight' && replay) { replay.stepForward(); e.preventDefault(); return; }
      if (e.key === ' ') {
        e.preventDefault();
        if (reviewing) replay.togglePlay();
        else game.setSpeed(game.clock.speed === 0 ? game.clock.lastSpeed || 1 : 0);
        return;
      }
      if (e.key === 'Escape') { if (view.eye) game.lookFrom(null); else if (view.mapPanel) game.setViewOption('mapPanel', false); else if (game.getTool()) game.setTool(game.getTool()); else if (game.catalogue()) game.openCatalogue(game.catalogue(), false); else game.select(null); return; }
      if (e.key === 'r' || e.key === 'R') { game.setViewOption('rings', !view.rings); return; }
      if (e.key === 't' || e.key === 'T') { game.setViewOption('truth', !view.truth); return; }
      if (e.key === 'l' || e.key === 'L') { game.setViewOption('labels', !view.labels); return; }
      if (e.key === 'x' || e.key === 'X') { game.setTool('sell'); return; }
      if (e.key === '9') { game.setTool('people'); return; }
      if (e.key === 'p' || e.key === 'P') { game.setViewOption('planView', !view.planView); return; }
      if (game.sim.state.terrainSeed.startsWith('pack:')) {
        if (e.key === 'g' || e.key === 'G') { game.setViewOption('mapGrid', nextGrid(view.mapGrid)); return; }
        if (e.key === 'c' || e.key === 'C') { game.setViewOption('mapContours', !view.mapContours); return; }
        if (e.key === 'm' || e.key === 'M') {
          const next = nextBaseMap(view.baseMap, game.mapSource(game.sim.state.terrainSeed));
          game.setViewOption('baseMap', next);
          game.toast(`Map: ${mapName(next, game.sim.state.terrainSeed)}`);
          return;
        }
      }
      const group = TOOLBAR.find((g) => g.key === e.key);
      if (group) game.cycleTool(group);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [game, covered]);
}
