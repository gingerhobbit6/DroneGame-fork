// The side panel of the Network tab: configuration for what is selected, its link stats, and the packets on its wire.

import { pounds } from '../../sim/economy.js';
import { useRef, useState } from 'react';
import { COMMS, SPECTRUM } from '../../sim/config/index.js';
import { annotate } from '../sapient-help.js';
import { hex, useGame } from '../hooks.js';
import { linkColour, TYPE_COLOUR } from './network-canvas.js';

const BANDS = Object.entries(COMMS.cellular.bands);
export const stateWord = (info) => (info && info.up ? (info.quality < 0.6 ? 'degraded' : 'up') : 'DOWN');

function FusionConfig({ net, commands, locked }) {
  return (
    <>
      <h4>Fusion node</h4>
      <p className="muted">Every message passes through it, so it is the weak point. Give it more than one way in.</p>
      {['starlink', 'cellular'].map((k) => (
        <label className="opt" key={k}>
          <input type="checkbox" data-fus={k} checked={net.fusion.uplinks.has(k)} disabled={locked} onChange={(e) => commands.wireFusion(k, e.target.checked)} /> {COMMS[k].name} terminal <span className="muted">{pounds(COMMS[k].cost)}</span>
        </label>
      ))}
      <label className="opt">Cellular band{' '}
        <select data-fusband="" value={net.fusion.cellBand} disabled={locked} onChange={(e) => commands.setFusionCellBand(e.target.value)}>
          {BANDS.map(([id, b]) => <option key={id} value={id}>{b.label}</option>)}
        </select>
      </label>
    </>
  );
}

function NodeConfig({ n, commands, locked }) {
  return (
    <>
      <h4 style={{ borderLeft: `4px solid ${hex(n.def.color)}`, paddingLeft: 6 }}>{n.name}</h4>
      <div className="muted">{n.def.sapient.nodeType.replace('NODE_TYPE_', '')} · {n.mode}</div>
      <div className="opt-h">Network terminal</div>
      {n.def.networked === false && <div className="muted crew-note">Worked by its crew, off the network: it cannot be wired, and fires or jams at what its crew can see.</div>}
      {n.def.networked !== false && [['', 'None'], ['starlink', `Starlink ${pounds(COMMS.starlink.cost)}`], ['cellular', `Cellular ${pounds(COMMS.cellular.cost)}`]].map(([k, l]) => (
        <label className="opt" key={k}>
          <input type="radio" name="uplink" value={k} checked={(n.uplink || '') === k} disabled={locked} onChange={() => commands.wireNode(n, k || null)} /> {l}
        </label>
      ))}
      {n.def.networked !== false && <label className="opt">Cellular band{' '}
        <select data-band="" value={n.cellBand} disabled={locked} onChange={(e) => commands.setCellBand(n, e.target.value)}>
          {BANDS.map(([id, b]) => <option key={id} value={id}>{b.label}</option>)}
        </select>
      </label>}
      {n.jamBands && (
        <>
          <div className="opt-h">Jamming bands</div>
          {n.def.fitted.map((id) => (
            <label className="opt" key={id}>
              <input type="checkbox" data-jam={id} checked={n.jamBands.has(id)} onChange={(e) => commands.toggleJamBand(n, id, e.target.checked)} /> {SPECTRUM.bands[id].label}
            </label>
          ))}
          <div className="muted">Jamming 868/915 MHz also hits Band 8 cellular links nearby. See the Spectrum tab.</div>
        </>
      )}
    </>
  );
}

function LinkStats({ n, comms }) {
  const st = comms.linkStats(n.nodeId), info = comms.nodeLink(n), path = comms.pathFor(n);
  return (
    <div className="lstats">
      <div>Status <b style={{ color: linkColour(info) }}>{stateWord(info)}</b>{!info.up && <> <span className="muted">{info.reason}</span></>}</div>
      <div>Via <b>{info.via || ''}</b></div>
      {path.ok
        ? <>
            <div>Latency <b>{Math.round(path.latency * 1000)} ms</b> · loss <b>{(path.loss * 100).toFixed(1)}%</b></div>
            <div>Capacity <b>{(info.capacity / 1e6).toFixed(1)} Mbit/s</b> · used <b>{Math.round(st.utilisation * 100)}%</b></div>
          </>
        : <div className="muted">{path.reason}</div>}
      <div>Sent <b>{st.sent}</b> · dropped <b>{st.dropped}</b>{st.lastReason && <> <span className="muted">({st.lastReason})</span></>}</div>
    </div>
  );
}

function Tap({ n, comms }) {
  const [frozen, setFrozen] = useState(false);
  const [picked, setPicked] = useState(null);
  const held = useRef([]);
  if (!frozen) held.current = comms.packets.filter((p) => p.nodeId === n.nodeId).slice(-40).reverse();
  return (
    <>
      <div className="opt-h">Tap: packets on this wire <button id="net-freeze" className="mini" onClick={() => setFrozen((f) => !f)}>{frozen ? 'Resume' : 'Freeze'}</button></div>
      <div className="pk-list">
        {held.current.map((p) => (
          <div key={p.n} className={`pk${p.dropped ? ' drop' : ''}${picked && picked.n === p.n ? ' sel' : ''}`} onClick={() => setPicked(p)}>
            <i style={{ background: TYPE_COLOUR[p.type] }} />{p.t.toFixed(1)}s {p.toFusion ? '→' : '←'} {p.type} <span className="muted">{p.bytes} B{p.dropped ? ' · ' + p.reason : ` · ${Math.round(p.delay * 1000)} ms`}</span>
          </div>
        ))}
        {!held.current.length && <div className="muted">no packets yet</div>}
      </div>
      <pre className="pk-json">{picked ? annotate(picked.msg).join('\n') : 'Click a packet to read it, with a plain-English note beside each field.'}</pre>
    </>
  );
}

function FusionLinks({ net }) {
  const kinds = ['starlink', 'cellular'].filter((k) => net.fusion.uplinks.has(k));
  return (
    <>
      <div className="opt-h">Fusion links</div>
      <div className="lstats">
        {kinds.map((k) => {
          const i = net.comms.linkFor(net.fusion, k, net.fusion.cellBand);
          return <div key={k}>{COMMS[k].name}: <b style={{ color: linkColour(i) }}>{stateWord(i)}</b> <span className="muted">{i.up ? i.via : i.reason}</span></div>;
        })}
        {!kinds.length && <div className="muted">no terminals: the fusion node hears nothing</div>}
      </div>
    </>
  );
}

export function NetworkSide({ sel }) {
  const { sim, commands } = useGame();
  const { net } = sim;
  const locked = sim.designLocked();
  const n = sel && sel.kind !== 'fusion' ? net.nodes.get(sel.id) : null;
  return (
    <div id="net-side">
      <div id="net-static">
        {sel && sel.kind === 'fusion' && <FusionConfig net={net} commands={commands} locked={locked} />}
        {n && <NodeConfig n={n} commands={commands} locked={locked} />}
        {!n && !(sel && sel.kind === 'fusion') && (
          <>
            <h4>Network design</h4>
            <p className="muted">Click a system to configure it, or a wire to tap it.</p>
            <p className="muted">Terminals: Starlink {pounds(COMMS.starlink.cost)} each, cellular {pounds(COMMS.cellular.cost)} each. {locked ? 'The network is locked: the first wave has started.' : 'You can rewire until the first wave starts.'}</p>
          </>
        )}
      </div>
      <div id="net-live">
        {n && <>
          <div className="opt-h">Link</div>
          {n.uplink ? <LinkStats n={n} comms={net.comms} /> : <div className="lstats"><div className="muted">{n.def.networked === false ? 'Not networked: its crew works it by hand.' : 'No terminal wired: this system is offline.'}</div></div>}
          <Tap key={n.nodeId} n={n} comms={net.comms} />
        </>}
        {sel && sel.kind === 'fusion' && <FusionLinks net={net} />}
      </div>
    </div>
  );
}
