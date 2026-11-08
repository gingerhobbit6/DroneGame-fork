// The wire diagram. Click a system to configure it, click Starlink or Cellular to wire it, click a wire to tap it.

import { pounds } from '../../sim/economy.js';
import { useEffect, useRef, useState } from 'react';
import { COMMS } from '../../sim/config/index.js';
import { useAnimation, useGame, useTick } from '../hooks.js';
import { BAD_COLOUR, createNetworkCanvas, nodeList } from './network-canvas.js';
import { NetworkSide } from './NetworkSide.jsx';

export function NetworkTab({ active }) {
  useTick(active);
  const game = useGame();
  const { sim, commands } = game;
  const { net } = sim;
  const [sel, setSel] = useState(null); // { kind: 'node' | 'fusion' | 'wire', id }
  const [pace, setPace] = useState(1.2);
  const canvas = useRef(null), diagram = useRef(null);
  const latest = useRef({ sel, active, pace });
  latest.current = { sel, active, pace };

  useEffect(() => {
    diagram.current = createNetworkCanvas(canvas.current, net, {
      getSel: () => latest.current.sel, isVisible: () => latest.current.active, getPace: () => latest.current.pace,
    });
    return () => diagram.current.dispose();
  }, [net]);
  useAnimation(active, () => diagram.current.draw());

  const pos = (e) => { const r = canvas.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onMove = (e) => {
    const hit = diagram.current.hitTest(pos(e));
    diagram.current.setHover(hit.box && hit.box.kind === 'element' ? hit.box.id : null);
    canvas.current.style.cursor = hit.box || hit.wire ? 'pointer' : 'default';
  };
  const onClick = (e) => {
    const { box, wire } = diagram.current.hitTest(pos(e));
    if (box && box.kind === 'element' && box.id !== 'internet') { // wire the selected system (or the fusion node) to this network
      if (sel && sel.kind === 'fusion') commands.wireFusion(box.id, !net.fusion.uplinks.has(box.id));
      else if (sel) { const n = net.nodes.get(sel.id); if (n) commands.wireNode(n, n.uplink === box.id ? null : box.id); }
      else game.toast('Select a system first, then click Starlink or Cellular to wire it');
    } else if (box && box.kind === 'node') setSel({ kind: 'node', id: box.id });
    else if (box && box.kind === 'fusion') setSel({ kind: 'fusion', id: 'fusion' });
    else if (!box) setSel(wire && wire.node ? { kind: 'wire', id: wire.node.nodeId } : wire ? { kind: 'fusion', id: 'fusion' } : null);
  };

  // run to the next packet (on the selected wire if there is one), then pause
  const stepToPacket = () => {
    const comms = net.comms, id = sel && sel.kind !== 'fusion' ? sel.id : null;
    const before = comms.packets.length ? comms.packets[comms.packets.length - 1].n : 0;
    game.setSpeed(0);
    for (let i = 0; i < 2000; i++) {
      sim.run(1);
      const last = comms.packets.length ? comms.packets[comms.packets.length - 1] : null;
      if (last && last.n > before && (!id || last.nodeId === id)) break;
    }
    game.bump();
  };

  const nodes = nodeList(net);
  const s = nodes.filter((n) => n.uplink === 'starlink').length + (net.fusion.uplinks.has('starlink') ? 1 : 0);
  const c = nodes.filter((n) => n.uplink === 'cellular').length + (net.fusion.uplinks.has('cellular') ? 1 : 0);
  const loose = sim.unwired().length;
  return (
    <>
      <div className="net-tools">
        <button id="net-auto" className="primary" title="Connect every unwired system: cellular where a tower reaches well, otherwise Starlink" onClick={() => commands.autoWire()}>Auto-wire</button>
        <button id="net-clear" onClick={() => commands.clearAll()}>Clear wires</button>
        <button id="net-step" title="Run the simulation until the next packet is sent, then pause (on the selected wire, if one is selected)" onClick={stepToPacket}>Step to next packet</button>
        <label className="muted">Pulse speed <input type="range" id="net-pace" min="0.3" max="3" step="0.1" value={pace} onChange={(e) => setPace(Number(e.target.value))} /></label>
        <span id="net-cost" className="muted">
          Terminals: {s} Starlink + {c} cellular = <b>{pounds(s * COMMS.starlink.cost + c * COMMS.cellular.cost)}</b>
          {loose > 0 && <> · <span style={{ color: BAD_COLOUR }}>{loose} system{loose > 1 ? 's' : ''} unwired</span></>}
        </span>
      </div>
      <div className="net-main">
        <canvas id="net-canvas" ref={canvas} onMouseMove={onMove} onClick={onClick} />
        <NetworkSide sel={sel} />
      </div>
      <div className="plan-note">Wires run from each system to Starlink or the cellular network; the fusion node needs its own terminals. Both ends must be up for a message to get through. Click a system, then click Starlink or Cellular to wire it. Click a wire to tap it and see its packets.</div>
    </>
  );
}
