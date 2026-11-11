// The smaller panels: tuning, legend, toasts and the operator's approval cards.

import { useEffect, useRef, useState } from 'react';
import { ADAPT, DRONES, WORLD } from '../sim/config/index.js';
import { hex, useGame, useTick } from './hooks.js';
import { NumberInput } from './NumberInput.jsx';
import { Movable } from './Movable.jsx';

export function Tuning({ open }) {
  const { commands } = useGame();
  const adaptField = (label, key, step) => (
    <label>{label}<NumberInput value={ADAPT[key]} step={step} onCommit={(v) => commands.setAdapt(key, v)} /></label>
  );
  return (
    <Movable id="tuning" title="Tuning" className={`panel${open ? '' : ' hidden'}`}>
      <div className="label">GAME</div>
      {/* 20 at most: a slip such as 1000 had the frame loop run its cap of steps on every frame, and the page crawled */}
      <label>Time scale (x)<NumberInput value={WORLD.timeScale} step={0.5} min={0.5} max={20} onCommit={(v) => { WORLD.timeScale = v; }} /></label>
      <div className="muted" style={{ margin: '6px 0' }}>Ranges, prices and drone figures are in the SAPIENT panel, Sources tab.</div>
      <div className="label">ENEMY LEARNING (per wave)</div>
      {adaptField('Evade gain', 'evadePerWave', 0.01)}
      {adaptField('Jam resist gain', 'jamResistPerWave', 0.01)}
    </Movable>
  );
}

const LEGEND = [
  [hex(DRONES.spotter.color), 'Fixed-wing spotter drone: high, orbits, hard to jam, boosts strikes'],
  [hex(DRONES.fo.color), 'Fibre-optic strike drone: slower, flown down a fibre line, so no radio and no jamming'],
  [hex(DRONES.fpv.color), 'First-person-view strike drone: a pilot flies it by live video over radio. Fast, agile, can be jammed'],
  [hex(DRONES.fw.color), 'Fixed-wing strike drone: fast, high, flies itself with no radio link, partly jammable'],
  ['#5f7596', 'Real drones (sandbox) take the colour of their type'],
  ['#8a94a3', 'Grey ghost: real drone no sensor has (truth overlay)'],
  ['#ff8080', 'Air track symbol: a fused track (yellow clover frame = unclassified, red peaked frame = named by a camera, with a rotor over a multirotor; dashed = tentative, dimmer = coasting). Faint unless Highlight tracks is ticked'],
];
export function Legend() {
  return (
    <Movable id="hud-bottom-left" title="Legend" startMin>
      <div className="label">THREATS</div>
      {LEGEND.map(([c, text]) => <div key={c}><i style={{ background: c }} />{text}</div>)}
      <div className="hint">Click a system or drone for details · drag to move · right-drag or Shift-drag to turn · scroll or pinch to zoom</div>
    </Movable>
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
  return <div id="toast" role="status" aria-live="polite" className={show ? 'show' : ''}>{text}</div>;
}

export function Approvals() {
  useTick();
  const { sim, commands } = useGame();
  const list = sim.net.pendingRequests;
  return (
    <Movable id="approval" title="Authorise engagement" className={`panel${list.length ? '' : ' hidden'}`}>
      {list.map((r) => (
        <div className="req" key={r.id}>
          <div className="req-h">AUTHORISE ENGAGEMENT?</div>
          <div>{r.text}</div>
          <div className="req-b">
            <button className="primary" onClick={() => commands.decide(r.id, true)}>Approve</button>
            <button onClick={() => commands.decide(r.id, false)}>Deny</button>
          </div>
        </div>
      ))}
    </Movable>
  );
}
