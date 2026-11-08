// The whole page: the 3D canvas, with panels around it. Class names and ids match style.css.

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
import { Tuning, Legend, Toast, Approvals } from './Panels.jsx';
import { Sandbox } from './Sandbox.jsx';
import { Overlay } from './Overlay.jsx';
import { Dock } from './dock/Dock.jsx';
import { UnitPanel } from './UnitPanel.jsx';
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
  const [tuningOpen, setTuningOpen] = useState(false);
  const openDock = (tab) => { setDockTab(tab); setDockOpen(true); };
  useHotkeys();
  return (
    <>
      <GameCanvas />
      <div id="left-col">
        <Hud openDock={openDock} />
        <Toolbar />
      </div>
      <Minimap />
      <GameMapControls />
      <ControlPanel onToggleDock={() => setDockOpen((o) => !o)} onToggleTuning={() => setTuningOpen((o) => !o)} onSandbox={() => setTuningOpen(false)} />
      <Tuning open={tuningOpen} />
      <WizardButton />
      <Dock open={dockOpen} onClose={() => setDockOpen(false)} tab={dockTab} onTab={setDockTab} />
      <UnitPanel />
      <EyeBar />
      <ToolPicker />
      <Sandbox />
      <Legend />
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
