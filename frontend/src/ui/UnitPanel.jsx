// What the selected system is and what it is doing, with a Configure side to change it. Click one on the map, or use its
// button in the Nodes tab. Every figure comes from the code the simulation runs, so the panel cannot disagree with it.

import { useState } from 'react';
import { COMMS, DRONES, DRONE_CLASSES, SENSING, SPECTRUM, WORLD } from '../sim/config/index.js';
import { money } from '../sim/economy.js';
import { magazineWord, reloadsInFight } from '../sim/magazine.js';
import { burnTime, hitChance, layTime } from '../sim/hit-chance.js';
import { ERROR_AT_LIMIT, predictRange, reachFor, usesPath } from '../sim/site-range.js';
import { arcsText, coverArc, elevationBand } from '../sim/sensor-model.js';
import { CHANNELS, IDENTIFY_PX, RECOGNISE_PX, hasZoom } from '../sim/camera-model.js';
import { LIBRARIES, covers, libraryKnows } from '../sim/rf-model.js';
import { terrainState } from '../sim/terrain.js';
import { fmtTime, hex, useGame, useTick } from './hooks.js';
import { view } from '../render/view.js';
import { stateWord } from './dock/NetworkSide.jsx';
import { SiteRange } from './SiteRange.jsx';
import { UnitEditor } from './UnitEditor.jsx';

const km = (metres) => `${(metres / 1000).toFixed(1)} km`;
const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const names = (ids) => ids.map((id) => DRONES[id].name).join(', ');
const PD_AT_REACH = Math.round(100 / (1 + Math.pow(1 / SENSING.pdEdge, SENSING.pdSlope)));

function Row({ label, children }) {
  return <div className="up-row"><span>{label}</span><span>{children}</span></div>;
}

// What it is doing now, from the live system or from the moment being reviewed.
function statusText(s, sim, moment) {
  const def = s.def;
  const mode = moment ? moment.mode : s.mode;
  const live = !moment && (s.task || s.cue);
  const target = moment ? moment.trackShort : live && sim.net.tracks.get(live.trackId)?.short;
  const word = def.magazine && magazineWord(moment || s, def);
  if (word === 'Reloading') return `Reloading, ${Math.ceil((moment || s).reload)} s left`;
  if (word === 'EMPTY') return 'Out of rounds';
  if (mode === 'Jam') return 'Jamming';
  if (mode === 'Standby') return 'Standing by';
  if (def.role === 'effector') return target ? `Engaging ${target}` : 'Ready';
  if (mode === 'Track') return target ? `Tracking ${target}` : 'Tracking';
  if (mode === 'Search') return 'Searching';
  return `Detecting, scanning every ${def.sapient.interval} s`;
}

// What one round or second of beam costs, and how many the budget still covers: a second limit, on top of the magazine.
function PerShot({ def, state, frame }) {
  if (state.sandbox) return <>{money(def.shotCost)}<span className="muted">Free in the sandbox</span></>;
  const covers = Math.floor((frame ? frame.budget : state.budget) / def.shotCost);
  if (!covers) return <>{money(def.shotCost)} <span className="warn">OUT OF BUDGET: cannot fire</span></>;
  return <>{money(def.shotCost)}<span className="muted">Budget covers {def.fire === 'beam' ? `${covers.toLocaleString('en-US')} s` : plural(covers, 'shot')}</span></>;
}

// Every system has these rows, in this order, with figures of its own kind. now is the live system or the moment being reviewed,
// which records the magazine but not the scans, the jamming or the time to the next shot.
function Stores({ s, now, state, frame }) {
  const def = s.def;
  if (def.role === 'sensor') {
    return (
      <>
        <Row label="Magazine">No rounds: a sensor fires nothing</Row>
        {!frame && <Row label="Scans">{(s.scanId || 0).toLocaleString('en-US')} made, {plural(s.detections || 0, 'detection')}</Row>}
        <Row label="Scan period">{def.sapient.interval} s</Row>
        <Row label="Per use">No cost</Row>
      </>
    );
  }
  if (!def.magazine) {
    return (
      <>
        <Row label="Magazine">No rounds: unlimited while powered</Row>
        {!frame && <Row label="Jamming">{Math.round(s.jamTime || 0).toLocaleString('en-US')} s so far</Row>}
        <Row label="Reload">None needed</Row>
        <Row label="Per use">No cost</Row>
      </>
    );
  }
  const word = magazineWord(now, def);
  const shown = word === 'Ready' ? <span className="muted">{!frame && s.cd > 0 ? `Next shot in ${s.cd.toFixed(1)} s` : 'Ready'}</span> : <span className="warn"> {word}</span>;
  if (def.fire === 'beam') {
    return (
      <>
        <Row label="Stored beam">{Math.ceil(now.rounds)} / {def.magazine} s{shown}</Row>
        <Row label="Fired">{now.fired.toLocaleString('en-US')} s of beam</Row>
        <Row label="In storage">None: it recharges</Row>
        <Row label="Recharge">{def.reloadTime} s from empty, only while not firing</Row>
        <Row label="Per second"><PerShot def={def} state={state} frame={frame} /></Row>
      </>
    );
  }
  return (
    <>
      <Row label="Magazine">{now.rounds} / {def.magazine} rounds{shown}</Row>
      <Row label="Fired">{plural(now.fired, 'round')}</Row>
      <Row label="In storage">{plural(now.storage, 'round')}{state.sandbox ? ', not used up in the sandbox' : ''}</Row>
      <Row label="Reload">{def.reloadTime} s to fill the magazine{reloadsInFight(def) ? '' : ', only once the wave is over'}, {def.cooldown} s between shots</Row>
      <Row label="Per round"><PerShot def={def} state={state} frame={frame} /></Row>
    </>
  );
}

// What this jammer's active bands do to one type of drone.
function jamEffect(s, drone) {
  const links = drone.links || {}, reactive = s.def.technique === 'reactive';
  if (reactive && !libraryKnows(s.def, drone)) return 'not known to its library';
  const hit = [];
  if (links.control && s.jamBands.has(links.control)) hit.push('control');
  if (links.video && s.jamBands.has(links.video)) hit.push('video');
  if (links.gnss && s.jamBands.has('gnss') && !reactive) hit.push('navigation');
  if (!hit.length || drone.jamResist >= 1) return 'not affected';
  return hit.join(', ') + (drone.jamResist > 0 ? `, resists ${Math.round(drone.jamResist * 100)}%` : '');
}

function Engages({ s }) {
  const def = s.def;
  if (s.jamBands) {
    return (
      <>
        {[...s.jamBands].map((id) => SPECTRUM.bands[id].label).join(', ') || <span className="warn">No bands set</span>}
        <span className="up-reach muted">{DRONE_CLASSES.map((d) => [<span key={d.id}>{d.name}</span>, <span key={`${d.id}-effect`}>{jamEffect(s, d)}</span>])}</span>
      </>
    );
  }
  if (def.engagePolicy === 'fixed-wing') return 'Kept for fixed-wing tracks, or something unidentified that gets close';
  return def.engages ? names(def.engages) : 'Any drone';
}

function RangeRow({ s, net, live }) {
  const def = s.def;
  const tr = live && s.task && net.tracks.get(s.task.trackId);
  const here = (d) => predictRange(def, d, terrainState.data, s.pos.x * WORLD.metresPerUnit, s.pos.z * WORLD.metresPerUnit);
  if (def.role !== 'sensor') {
    return (
      <Row label="Range">
        {km(def.range)} in an open field{usesPath(def) ? `, ${km(here(DRONES.fpv).mean)} here on average` : ', the same anywhere'}
        {tr && tr.est ? `, target at ${km(net.distToTrack(s, tr))}` : ''}
      </Row>
    );
  }
  return (
    <Row label="Range">
      <span className="up-reach3">
        <span className="muted">Against</span><span className="muted">Open field</span><span className="muted">Here</span>
        {DRONE_CLASSES.map((d) => {
          const reach = reachFor(def, d);
          return [<span key={d.id}>{d.name}</span>, <span key={`${d.id}-open`}>{reach ? km(reach) : 'cannot hear'}</span>, <span key={`${d.id}-here`}>{reach ? km(here(d).mean) : ''}</span>];
        })}
      </span>
      <span className="muted">About {PD_AT_REACH}% chance a scan at that range{def.fov ? ', once cued' : ''}. Here is the average around this spot at the drone's usual height. See the Range side.</span>
    </Row>
  );
}

// The odds against each drone it would take, close in and at its limit, from the code the simulation runs.
function Odds({ def }) {
  const drones = DRONE_CLASSES.filter((d) => !def.engages || def.engages.includes(d.id));
  const beam = def.fire === 'beam';
  const cell = (d, range) => (beam ? `${burnTime(def, d, range).toFixed(1)} s` : `${Math.round(hitChance(def, d, range) * 100)}%`);
  return (
    <Row label={beam ? 'Time to burn' : 'Chance a shot hits'}>
      <span className="up-reach3">
        <span className="muted">Against</span><span className="muted">Close</span><span className="muted">At limit</span>
        {drones.map((d) => {
          const hits = beam ? 1 : Math.ceil(d.hp / def.damage);
          return [<span key={d.id}>{d.name}{hits > 1 ? `, ${hits} hits` : ''}</span>, <span key={`${d.id}-near`}>{cell(d, 0)}</span>, <span key={`${d.id}-far`}>{cell(d, def.range)}</span>];
        })}
      </span>
      <span className="muted">{beam ? `${layTime(def) ? `Plus ${layTime(def)} s to swing onto each new drone first. ` : ''}Drones that evade take longer, and they get better at it each wave.${def.rfBeam ? '' : ' Rain and haze shorten its reach.'}` : 'On a good track. A poor track lowers it, and drones get harder to hit each wave.'}</span>
    </Row>
  );
}

function jammerLimits(def, arc) {
  const lib = def.library && LIBRARIES[def.library];
  const out = [arc < 360 ? `Jams only through ${arc}° facing ${def.facing ?? 0}°` : 'Jams all round', 'A control link is easier to jam the further the drone is from its operator'];
  if (def.technique === 'reactive') out.push(lib?.knows ? `Reactive: only drones its ${lib.name} library knows, while its receiver hears them` : 'Reactive with no library to follow links by, so it jams nothing');
  if (def.trigger === 'receiver') out.push(lib ? 'Switches itself on when its receiver hears a drone, even with the network down' : 'It has no receiver, so it never switches itself on');
  if (def.trigger === 'manual') out.push('Jams only while you switch it on');
  return out.join('. ');
}

function limitsOf(def) {
  const band = elevationBand(def), arc = coverArc(def);
  const edge = (e) => (e < 0 ? `${-e}° below the horizon` : e > 0 ? `${e}° up` : 'the horizon');
  const looks = def.kind === 'radar' && `${arc < 360 ? `Looks through ${arc}° facing ${def.facing ?? 0}°` : 'Looks all round'}${band ? `, from ${edge(band[0])} to ${edge(band[1])}` : ''}${def.blank ? `, blind over ${arcsText(def.blank)}` : ''}`;
  if (def.lowAlt) return `${looks ? `${looks}. ` : ''}Below ${def.lowAlt} m, a drone moving slower than ${SENSING.clutterSpeed} m/s is lost in ground clutter beyond about ${def.lowRange} m`;
  if (def.fov) return `${def.fov}° search view${hasZoom(def) ? `, ${def.trackFov}° on a cue` : ''}, so it must be pointed. Another sensor cues it. ${CHANNELS[def.channels].label}${def.channels === 'both' ? ' channels' : ' only'}`;
  if (def.fire === 'beam') return 'Needs a clear line of sight, and engages one target at a time';
  if (def.kind === 'jammer') return jammerLimits(def, arc);
  if (def.kind === 'rf') return `Hears ${covers(def).map((b) => SPECTRUM.bands[b].label).join(', ')}${def.ibw === 'narrow' ? `, one at a time, so each once every ${def.sapient.interval} s` : ''}, but not a band your own jammer is jamming within its range`;
  return null;
}

function measuresOf(def) {
  const n = def.sapient.noise, out = [];
  if (n.range != null) out.push(`range ±${n.range} m`);
  out.push(`bearing ±${+n.az.toFixed(2)}°`);
  if (n.el != null) out.push(`elevation ±${+n.el.toFixed(2)}°`);
  else if (def.kind === 'radar') out.push('no height');
  if (def.sapient.velocity) out.push('velocity');
  if (def.kind === 'camera') out.push(`airframe type once the drone covers ${RECOGNISE_PX} pixels, and its model at ${IDENTIFY_PX}`);
  if (def.microDoppler === 'yes') out.push('multirotor or fixed wing, close in');
  if (def.kind === 'rf') out.push(LIBRARIES[def.library].knows ? `the airframe, where its ${LIBRARIES[def.library].name} library knows the link, and the model of a commercial drone` : 'energy in the band, not what it is');
  const text = out.join(', ');
  return text[0].toUpperCase() + text.slice(1);
}

function NetworkRow({ s, comms }) {
  if (s.def.networked === false) return <Row label="Network"><span className="muted">Worked by its crew, off the network: it cannot be wired, and fires or jams at what its crew can see.</span></Row>;
  if (!s.uplink) return <Row label="Network"><span className="warn">No terminal: this system is offline</span></Row>;
  const info = comms.nodeLink(s), path = comms.pathFor(s);
  const via = s.uplink === 'cellular' ? `Cellular ${COMMS.cellular.bands[s.cellBand].label}` : COMMS[s.uplink].name;
  return (
    <Row label="Network">
      {via}, {info.up ? stateWord(info) : <span className="warn">DOWN</span>}
      {s.offline && <span className="warn"> · lost contact</span>}
      <span className="muted">{path.ok ? `${Math.round(path.latency * 1000)} ms · ${(path.loss * 100).toFixed(1)}% loss` : path.reason}</span>
    </Row>
  );
}

function positionOf(s) {
  const m = WORLD.metresPerUnit;
  const bearing = (((Math.atan2(s.pos.x, -s.pos.z) * 180) / Math.PI) + 360) % 360;
  const mast = s.def.mount != null ? `, mast ${s.def.mount} m` : '';
  return `${Math.round(Math.hypot(s.pos.x, s.pos.z) * m)} m from the site, bearing ${String(Math.round(bearing) % 360).padStart(3, '0')}°${mast}`;
}

function Totals({ def, ledger }) {
  const fired = ledger.shots[def.id];
  const kills = Object.values(ledger.killedBy[def.kind === 'jammer' ? 'jammer' : def.id] || {}).reduce((a, b) => a + b, 0);
  const n = fired ? fired.n : 0;
  const used = def.fire === 'jam' ? '' : `${def.fire === 'beam' ? `${n} s of beam` : plural(n, 'shot')} · `;
  const perKill = fired && kills ? ` · ${money(fired.cost / kills)} a kill` : '';
  const rate = def.fire === 'guided' && n ? ` · ${Math.min(100, Math.round((kills / n) * 100))}% of shots killed` : '';
  return <Row label={`All ${def.short}`}>{used}{plural(kills, 'kill')}{perKill}{rate}</Row>;
}

function UnitCard({ s, game }) {
  const { sim } = game;
  const { net, state, ledger } = sim;
  const def = s.def;
  const replay = game.getReplay();
  const frame = replay && replay.active() ? sim.rec.frames[replay.frameIndex()] : null;
  const moment = frame && frame.structs.find((st) => st.id === s.nodeId);
  const isEffector = def.role === 'effector';
  const limits = limitsOf(def);
  const health = moment ? moment.health : s.health;
  const status = statusText(s, sim, moment);
  const [side, setSide] = useState('details');
  const editing = side === 'configure' && !frame;
  const ranging = side === 'range' && !frame;
  return (
    <div id="unit-panel" className="panel" role="region" aria-label={`Selected system: ${s.short}`}>
      <div className="up-head" style={{ borderLeftColor: hex(def.color) }}>
        <b>{s.short} · {s.custom?.name || def.name}</b>
        {!frame && <button id="unit-eye" className="up-eye" aria-pressed={view.eye === s} title="Watch from the top of its mast: what it engages or tracks, and the drones and rounds coming in" onClick={() => game.lookFrom(view.eye === s ? null : s)}>{view.eye === s ? 'Map view' : 'View from here'}</button>}
        <button id="unit-close" aria-label="Close the Unit panel" title="Close (Esc)" onClick={() => game.select(null)}>×</button>
      </div>
      {frame && <div className="up-review">Reviewing {fmtTime(frame.t)}. Network and totals are hidden, because they are not recorded.</div>}
      {!frame && (
        <div className="up-sides" role="group" aria-label="Panel view">
          <button id="unit-details" aria-pressed={!editing && !ranging} onClick={() => setSide('details')}>Details</button>
          <button id="unit-range" aria-pressed={ranging} onClick={() => setSide('range')}>Range</button>
          <button id="unit-configure" aria-pressed={editing} onClick={() => setSide('configure')}>Configure</button>
        </div>
      )}
      {ranging && <SiteRange s={s} />}
      {editing && <UnitEditor s={s} game={game} />}
      {!editing && !ranging && <>
      <p className="up-desc">{s.custom?.name ? `${def.name}. ` : ''}{def.desc}</p>
      <Row label="Status">{status}</Row>
      <Row label="Health">{Math.max(Math.ceil(health), 0)} / {def.health}</Row>
      <Stores s={s} now={moment || s} state={state} frame={frame} />
      <RangeRow s={s} net={net} live={!frame} />
      {limits && <Row label="Limits">{limits}</Row>}
      {def.role === 'sensor' && <Row label="Measures">{measuresOf(def)}<span className="muted">At best, close in. About {ERROR_AT_LIMIT.toFixed(1)} times that at the limit of its reach, and worse through hills and trees</span></Row>}
      {isEffector && <Row label={s.jamBands ? 'Jamming' : 'Engages'}><Engages s={s} /></Row>}
      {isEffector && !s.jamBands && <Odds def={def} />}
      {!frame && <NetworkRow s={s} comms={net.comms} />}
      <Row label="Position">{positionOf(s)}</Row>
      <Row label="Price">{money(def.cost)}</Row>
      {isEffector && !frame && <Totals def={def} ledger={ledger} />}
      <Row label="Modelled on">{def.ref.analogues.join(', ')}<span className="muted">{def.ref.confidence}</span></Row>
      </>}
    </div>
  );
}

export function UnitPanel() {
  useTick();
  const game = useGame();
  const s = game.getSelected();
  return s ? <UnitCard key={s.nodeId} s={s} game={game} /> : null;
}
