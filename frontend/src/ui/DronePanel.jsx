// What a real drone is and what it is doing: click one on the map with the truth overlay on. Follow keeps it in the middle of
// the view. Every figure is read from the drone the simulation flies, so the panel cannot disagree with it.

import { SPECTRUM, WORLD } from '../sim/config/index.js';
import { money } from '../sim/economy.js';
import { hereU } from '../sim/units.js';
import { hex, km, useGame, useTick } from './hooks.js';
import { view } from '../render/view.js';
import { Movable } from './Movable.jsx';

const M = WORLD.metresPerUnit;
const MODES = { approach: 'Flying in', orbit: 'Orbiting on station', egress: 'Leaving after its time on station', home: 'Link lost: turning for home' };
const ENDS = { killed: 'Destroyed', leaked: 'Hit its target', struck: 'Hit a deployed system', left: 'Left the area', missed: 'Struck where the patrol had been' };
const compass = (deg) => `${String(Math.round(((deg % 360) + 360) % 360) % 360).padStart(3, '0')}°`;

function Row({ label, children }) {
  return <div className="up-row"><span>{label}</span><span>{children}</span></div>;
}

export function statusOf(d) {
  if (d.dead) {
    const end = d.log?.end;
    return end === 'killed' && d.log.by ? `Destroyed by ${d.log.by}` : ENDS[end] ?? 'No longer flying';
  }
  return `${MODES[d.mode] ?? d.mode}${d.videoJammed ? ', video jammed' : ''}`;
}

export function linksOf(def) {
  if (def.fibre) return 'None: flown down a fibre-optic cable, so nothing to hear or jam';
  const bands = Object.entries(def.links ?? {}).filter(([, v]) => v).map(([k, v]) => SPECTRUM.bands[v === true ? k : v]?.label ?? v);
  return bands.length ? bands.join(', ') : 'None';
}

function DroneCard({ d, game, centre }) {
  const def = d.def;
  const speed = Math.hypot(d.vel.x, d.vel.z) * M;
  const off = { x: d.pos.x - centre.x, z: d.pos.z - centre.z };
  const following = view.follow && !d.dead;
  return (
    <Movable id="drone-panel" title="Selected drone" role="region" aria-label={`Selected drone: ${def.name}`}>
      <div className="up-head" style={{ borderLeftColor: hex(def.color) }}>
        <b>{def.name}</b>
        {!d.dead && <button className="up-eye" aria-pressed={following} title="Keep this drone in the middle of the view" onClick={() => { view.follow = !following; game.bump(); }}>{following ? 'Stop following' : 'Follow'}</button>}
        <button aria-label="Close the drone panel" title="Close (Esc)" onClick={() => game.selectDrone(null)}>×</button>
      </div>
      <Row label="Status">{statusOf(d)}</Row>
      <Row label="Tracked">{d.track ? `Yes, as ${d.track.short}` : d.dead ? '–' : 'No: no sensor has it'}</Row>
      <Row label="Type">{def.airframe} · {def.role === 'spotter' ? 'reconnaissance' : 'strike'}</Row>
      <Row label="Speed">{Math.round(speed)} m/s ({Math.round(speed * 3.6)} km/h)<span className="muted">Cruises at {def.speed} m/s</span></Row>
      <Row label="Height">{Math.round((d.pos.y - hereU(d.pos.x, d.pos.z)) * M)} m above the ground</Row>
      <Row label="From site">{km(Math.hypot(off.x, off.z) * M)}, bearing {compass((Math.atan2(off.x, -off.z) * 180) / Math.PI)}<span className="muted">Heading {compass(180 - (d.heading * 180) / Math.PI)}</span></Row>
      <Row label="Warhead">{def.warhead ? `${def.warhead} kg` : 'None: it carries a camera'}</Row>
      <Row label="Health">{Math.max(Math.ceil(d.hp), 0)} / {def.hp}</Row>
      <Row label="Radio links">{linksOf(def)}<span className="muted">Resists jamming {Math.round(d.jamResist * 100)}%</span></Row>
      <Row label="Evasion">{d.evade.toFixed(2)}<span className="muted">1.00 is easy to hit</span></Row>
      <Row label="Cost">{money(def.cost)}</Row>
      {def.published && <Row label="Published">{def.published}</Row>}
    </Movable>
  );
}

export function DronePanel() {
  useTick();
  const game = useGame();
  const d = view.drone;
  return d ? <DroneCard d={d} game={game} centre={game.sim.state.zoneCentre} /> : null;
}
