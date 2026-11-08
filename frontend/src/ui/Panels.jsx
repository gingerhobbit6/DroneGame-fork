// The smaller panels: tuning, legend, toasts and the operator's approval cards.

import { useEffect, useRef, useState } from 'react';
import { ADAPT, WORLD } from '../sim/config/index.js';
import { useGame, useTick } from './hooks.js';
import { NumberInput } from './NumberInput.jsx';
import { useMovable } from './useMovable.js';

export function Tuning({ open }) {
  const { commands } = useGame();
  const adaptField = (label, key, step) => (
    <label>{label}<NumberInput value={ADAPT[key]} step={step} onCommit={(v) => commands.setAdapt(key, v)} /></label>
  );
  return (
    <div id="tuning" className={`panel${open ? '' : ' hidden'}`}>
      <div className="label">GAME</div>
      <label>Time scale (x)<NumberInput value={WORLD.timeScale} step={0.5} min={0.5} onCommit={(v) => { WORLD.timeScale = v; }} /></label>
      <div className="muted" style={{ margin: '6px 0' }}>Ranges, prices and drone figures are in the SAPIENT panel, Sources tab.</div>
      <div className="label">ENEMY LEARNING (per wave)</div>
      {adaptField('Evade gain', 'evadePerWave', 0.01)}
      {adaptField('Jam resist gain', 'jamResistPerWave', 0.01)}
    </div>
  );
}

const LEGEND = [
  ['#ffd600', 'Fixed-wing spotter drone: high, orbits, hard to jam, boosts strikes'],
  ['#ff9100', 'Fibre-optic strike drone: slower, flown down a fibre line, so no radio and no jamming'],
  ['#ff1744', 'First-person-view strike drone: a pilot flies it by live video over radio. Fast, agile, can be jammed'],
  ['#d500f9', 'Fixed-wing strike drone: fast, high, flies itself with no radio link, partly jammable'],
  ['#5f7596', 'Real drones (sandbox) take the colour of their type'],
  ['#8a94a3', 'Grey ghost: real drone no sensor has (truth overlay)'],
  ['#ff8080', 'Air track symbol: a fused track (yellow clover frame = unclassified, red peaked frame = named by a camera, with a rotor over a multirotor; dashed = tentative, dimmer = coasting). Faint unless Highlight tracks is ticked'],
];
export function Legend() {
  return (
    <details id="hud-bottom-left" className="panel">
      <summary>Legend</summary>
      <div className="label">THREATS</div>
      {LEGEND.map(([c, text]) => <div key={c}><i style={{ background: c }} />{text}</div>)}
      <div className="hint">Click a system for details · drag to move · right-drag or Shift-drag to turn · scroll or pinch to zoom</div>
    </details>
  );
}

export function Toast() {
  const game = useGame();
  const [{ text, show }, setToast] = useState({ text: '', show: false });
  const timer = useRef(0);
  useEffect(() => game.onToast((msg) => {
    setToast({ text: msg, show: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2600);
  }), [game]);
  return <div id="toast" className={show ? 'show' : ''}>{text}</div>;
}

export function Approvals() {
  useTick();
  const { sim, commands } = useGame();
  const list = sim.net.pendingRequests;
  const { style, handle } = useMovable();
  return (
    <div id="approval" className={`panel${list.length ? '' : ' hidden'}`} data-movable style={style} {...handle}>
      {list.map((r) => (
        <div className="req" key={r.id}>
          <div className="req-h" title="Drag to move. Double-click to put it back.">AUTHORISE ENGAGEMENT?</div>
          <div>{r.text}</div>
          <div className="req-b">
            <button className="primary" onClick={() => commands.decide(r.id, true)}>Approve</button>
            <button onClick={() => commands.decide(r.id, false)}>Deny</button>
          </div>
        </div>
      ))}
    </div>
  );
}
