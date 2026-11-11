// Keyboard shortcuts. Typing into a field never triggers them.

import { useEffect } from 'react';
import { TOOLBAR } from '../sim/config/index.js';
import { u } from '../sim/units.js';
import { isCameraKey } from '../render/camera-moves.js';
import { view } from '../render/view.js';
import { useAccount } from './account/pack.js';
import { mapName, nextBaseMap, nextGrid } from './MapControls.jsx';
import { useGame } from './hooks.js';

const FOCUS_DISTANCE = u(500); // F brings the camera this close to the selected system

export function useHotkeys() {
  const game = useGame(), covered = useAccount()?.covered; // under the profile or login page
  useEffect(() => {
    if (covered) return undefined;
    let swallowed = false; // Space was taken as the pause key, so its key-up is taken too
    // A click leaves its button focused, and Space then pressed it again: the pause key set the speed, launched more drones or
    // answered a "Sure?". So Space stays the pause key on the button the pointer last pressed, until Tab moves the focus by keyboard.
    // (:focus-visible cannot tell the two apart: it turns true on a clicked button as soon as any key goes down.)
    let clicked = null;
    const onPoint = (e) => { clicked = e.target.closest ? e.target.closest('button, summary') : null; };
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (e.key === 'Tab') clicked = null;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) || e.target.isContentEditable) return;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl+C, Ctrl+P and the like belong to the browser, and a card's Space to the card
      if (e.key === ' ' && (tag === 'BUTTON' || tag === 'SUMMARY') && e.target !== clicked) return; // Space presses a button reached by keyboard, and nothing else
      const camera = game.getView();
      if (isCameraKey(e.code)) { camera?.keys?.press(e.code, true); e.preventDefault(); return; } // held, it moves the camera every frame
      if (e.key === 'n' || e.key === 'N') { camera?.northUp(); return; }
      if (e.key === 'h' || e.key === 'H') { camera?.fitLaydown(); return; }
      if (e.key === 'f' || e.key === 'F') { // the selected drone, if its panel is open, else the selected system
        const at = (view.drone && !view.drone.dead ? view.drone : view.selected)?.pos;
        if (at) camera?.centreOn(at.x, at.z, FOCUS_DISTANCE);
        return;
      }
      const replay = game.getReplay();
      const reviewing = replay && replay.active();
      if (e.key === 'ArrowLeft' && replay) { replay.stepBack(); e.preventDefault(); return; }
      if (e.key === 'ArrowRight' && replay) { replay.stepForward(); e.preventDefault(); return; }
      if (e.key === ' ') {
        e.preventDefault(); // and so a button the mouse left focused is not pressed as well
        swallowed = true;
        if (reviewing) replay.togglePlay();
        else game.setSpeed(game.clock.speed === 0 ? game.clock.lastSpeed || 1 : 0);
        return;
      }
      if (e.key === 'Escape') { if (view.eye) game.lookFrom(null); else if (view.mapPanel) game.setViewOption('mapPanel', false); else if (game.getTool()) game.setTool(game.getTool()); else if (game.catalogue()) game.openCatalogue(game.catalogue(), false); else { game.select(null); game.selectDrone(null); } return; }
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
    // A key let go anywhere stops the camera, even in a text box; so does leaving the window, which sends no key-up.
    const onUp = (e) => {
      if (e.key === ' ' && swallowed) { swallowed = false; e.preventDefault(); } // some browsers press the button when the key comes up
      game.getView()?.keys?.press(e.code, false);
    };
    const stop = () => game.getView()?.keys?.release();
    addEventListener('pointerdown', onPoint, true);
    addEventListener('keydown', onKey);
    addEventListener('keyup', onUp);
    addEventListener('blur', stop);
    return () => { removeEventListener('pointerdown', onPoint, true); removeEventListener('keydown', onKey); removeEventListener('keyup', onUp); removeEventListener('blur', stop); stop(); };
  }, [game, covered]);
}
