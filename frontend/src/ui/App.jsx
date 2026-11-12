// The whole page: the 3D canvas, with panels around it. Class names and ids match style.css.

import { Mark } from './account/parts.jsx';
import { PRODUCT } from '../sim/config/index.js';
import { DefendPanel } from './DefendPanel.jsx';
import { useEffect, useRef, useState } from 'react';
import { GameContext, useGame, useTick } from './hooks.js';
import { useHotkeys } from './useHotkeys.js';
import { EyeBar } from './EyeBar.jsx';
import { Hud } from './Hud.jsx';
import { Toolbar } from './Toolbar.jsx';
import { ControlPanel } from './ControlPanel.jsx';
import { Minimap } from './Minimap.jsx';
import { MapControls } from './MapControls.jsx';
import { Timeline } from './Timeline.jsx';
import { Toast, Approvals } from './Panels.jsx';
import { Sandbox } from './Sandbox.jsx';
import { Overlay } from './Overlay.jsx';
import { Dock, viewOf } from './dock/Dock.jsx';
import { UnitPanel } from './UnitPanel.jsx';
import { DronePanel } from './DronePanel.jsx';
import { ToolPicker } from './ToolPicker.jsx';
import { Wizard, WizardButton } from './assistant/Wizard.jsx';

// Owns the canvas: the Three.js scene stays imperative, because per-frame updates should not go through React.
function GameCanvas() {
  const game = useGame();
  const canvas = useRef(null), labels = useRef(null);
  useEffect(() => { game.attach(canvas.current, labels.current); }, [game]);
  return (
    <>
      <canvas id="game" ref={canvas} />
      <div id="labels" ref={labels} />
    </>
  );
}

// The map buttons belong to a game in progress, not the start screen.
function GameMapControls() {
  useTick();
  return useGame().sim.state.started ? <MapControls /> : null;
}

function Screen() {
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState('nodes');
  const [menuOpen, setMenuOpen] = useState(false); // on a narrow screen the controls fold away behind a menu button
  const openDock = (tab) => { setMenuOpen(false); setDockTab(tab); setDockOpen(true); };
  // a view's own button: opens it in place of whatever view is open, or closes it if it is the one open
  const shownView = dockOpen ? viewOf(dockTab) : null;
  const toggleView = (id) => { if (shownView === id) setDockOpen(false); else openDock(id); };
  useHotkeys();
  return (
    <>
      <GameCanvas />
      <div id="left-col">
        <div id="brand-bar" aria-label={PRODUCT.name}><Mark size={44} /><span className="brand-name">{PRODUCT.name.toUpperCase()}</span><small className="brand-version">v{PRODUCT.version}</small></div>
        <Hud openDock={openDock} onView={toggleView} shownView={shownView} onSandbox={() => setMenuOpen(false)} />
        <Minimap />
        <div id="map-rail-slot" />{/* the map buttons, in a grid under the overview map (MapControls) */}
      </div>
      <GameMapControls />
      <DefendPanel />
      <button id="btn-menu" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>{menuOpen ? '✕' : '☰'}</button>
      <div id="right-col">
        <ControlPanel menuOpen={menuOpen} onView={toggleView} shownView={shownView} />
        <Toolbar />
      </div>
      <WizardButton />
      <Dock open={dockOpen} onClose={() => setDockOpen(false)} tab={dockTab} />
      <UnitPanel />
      <DronePanel />
      <EyeBar />
      <ToolPicker />
      <Sandbox />
      <Toast />
      <Approvals />
      <Timeline />
      <Wizard openDock={openDock} closeDock={() => setDockOpen(false)} />
      <Overlay openDock={openDock} />
    </>
  );
}

export function App({ game }) {
  return (
    <GameContext.Provider value={game}>
      <Screen />
    </GameContext.Provider>
  );
}
