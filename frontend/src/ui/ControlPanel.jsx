// Top right: starting waves, game speed, view toggles, engagement authority, and opening the other panels.

import { useEffect, useState } from 'react';
import { FUSION } from '../sim/config/index.js';
import { view } from '../render/view.js';
import { useArmed, useGame, useTick } from './hooks.js';
import { ResupplyButton } from './ResupplyButton.jsx';
import { AttackMix, mixLabel } from './AttackMix.jsx';
import { ConditionsPicker } from './ConditionsPicker.jsx';
import { SpeedControl } from './SpeedControl.jsx';
import { Movable } from './Movable.jsx';

export function ControlPanel({ onToggleDock, onToggleTuning, onSandbox }) {
  useTick();
  const game = useGame();
  const { sim, commands } = game;
  const { state } = sim;

  useEffect(() => { document.body.classList.toggle('track-hi', view.trackHi); });

  const clear = useArmed(); // it throws the laydown away
  const end = useArmed(); // it ends the run
  const [mixOpen, setMixOpen] = useState(false);

  const toggle = (id, key, label, title) => (
    <label title={title}><input type="checkbox" id={id} checked={view[key]} onChange={(e) => game.setViewOption(key, e.target.checked)} /> {label}</label>
  );

  return (
    <>
    <Movable id="hud-top-right" title="Controls">
      <button id="btn-wave" className="primary" disabled={state.waveActive || state.over || state.sandbox} onClick={() => commands.startWave()}>
        {state.sandbox ? 'Exit sandbox to start' : state.waveActive ? `Wave ${state.wave} in progress` : `Start wave ${state.wave + 1}`}
      </button>
      <ResupplyButton />
      {state.wave > 0 && !state.over && (
        <button id="btn-end" title="Stand the deployment down now and see its report" onClick={end.confirm('end', () => commands.endDeployment())}>{end.armed ? 'Sure? Click again' : 'End deployment'}</button>
      )}
      <SpeedControl />
      <label><input type="checkbox" id="auto" checked={state.autoStart} onChange={(e) => commands.setAutoStart(e.target.checked)} /> Auto-start next wave</label>
      {toggle('rings', 'rings', 'Show ranges (R)')}
      {toggle('truth', 'truth', 'Truth overlay (T)', "On: every drone is drawn where it really is (grey if no sensor has it). Off: you only see what the fusion node believes.")}
      {toggle('labels-toggle', 'labels', 'Labels (L)', 'Name tags on every system and drone')}
      {toggle('symbols-toggle', 'symbols', 'Map symbols', 'NATO symbols in place of the drone and system models when zoomed out')}
      {toggle('track-hi', 'trackHi', 'Highlight tracks', "Tracks are drawn faint grey so they don't crowd the view. Tick to colour them by classification.")}
      {toggle('trails', 'trails', 'Drone trails', 'A line behind every drone of where it has flown. With the truth overlay, where it really flew; without it, the path of its track.')}
      <label title="Who decides to engage. SAPIENT has no weapon-release message, so this is a C2 policy."> Engagement authority
        <select id="authority" value={FUSION.authority} onChange={(e) => commands.setAuthority(e.target.value)}>
          <option value="auto">Automatic</option><option value="costly">Ask for costly shots</option><option value="all">Ask for every engagement</option>
        </select>
      </label>
      <ConditionsPicker />
      <button id="btn-attack" title="Choose which drones the waves send. Locked once the first wave starts." aria-expanded={mixOpen} onClick={() => setMixOpen((o) => !o)}>Attack: {mixLabel(state.attack)}</button>
      <button id="btn-sandbox" title="Try attacks against your laydown without risking the site" onClick={() => { if (state.sandbox) commands.exitSandbox(); else { commands.enterSandbox(); onSandbox(); } }}>
        {state.sandbox ? 'Exit sandbox' : 'Sandbox'}
      </button>
      <div className="row">
        <button id="btn-reset" title="Start the run again with the same laydown, wiring and seed" onClick={() => { if (state.started) commands.reset('keep'); }}>Reset run</button>
        <button id="btn-clear" className="danger" title="Remove every system, refund the budget and go back to before wave 1" disabled={!sim.structures.length && !state.wave} onClick={state.started ? clear.confirm('clear', () => commands.reset('clear')) : undefined}>{clear.armed ? 'Sure? Click again' : 'Clear map'}</button>
      </div>
      <button id="btn-sapient" onClick={onToggleDock}>SAPIENT</button>
      <button id="btn-tuning" onClick={onToggleTuning}>Tuning</button>
    </Movable>
    {mixOpen && <AttackMix onClose={() => setMixOpen(false)} />}
    </>
  );
}
