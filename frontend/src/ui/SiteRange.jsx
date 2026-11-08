// The Range side of the Unit panel: what this system reaches from where it stands, compared with an open field, and why, along any bearing.

import { useState } from 'react';
import { DRONES, WORLD } from '../sim/config/index.js';
import { BEARINGS, ERROR_AT_LIMIT, pathReport, predictRange, reachFor, usesPath } from '../sim/site-range.js';
import { terrainState } from '../sim/terrain.js';
import { km } from './hooks.js';

const db = (x) => `${x.toFixed(1)} dB`;
const POLAR = 90, PROFILE = { w: 280, h: 120, top: 6, bottom: 16 };

const polarPoint = (bearing, radius) => {
  const rad = (bearing * Math.PI) / 180;
  return [radius * Math.sin(rad), -radius * Math.cos(rad)];
};

// North is up. The circle is the open field, the shape is what this spot really gets, and the line is the bearing being examined.
function Polar({ p, bearing, onPick }) {
  const scale = POLAR / (p.open || 1);
  const shape = Array.from(p.first, (r, i) => polarPoint((i * 360) / BEARINGS, r * scale).map((c) => c.toFixed(1)).join(',')).join(' ');
  const [x, y] = polarPoint(bearing, POLAR);
  const pick = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left - box.width / 2, py = e.clientY - box.top - box.height / 2;
    onPick((Math.round((Math.atan2(px, -py) * 180) / Math.PI) + 360) % 360);
  };
  return (
    <svg id="sr-polar" viewBox="-100 -100 200 200" role="img" aria-label="Predicted range on each bearing, against the open-field range" onClick={pick}>
      <circle className="sr-open" r={POLAR} />
      <circle className="sr-grid" r={POLAR / 2} />
      <polygon className="sr-here" points={shape} />
      <line className="sr-bearing" x1="0" y1="0" x2={x} y2={y} />
      <text className="sr-north" x="0" y="-92" textAnchor="middle">N</text>
    </svg>
  );
}

// A slice through the ground along the bearing: the ground, what stands on it, the straight path, and the zone a radio path needs kept clear.
function Profile({ r }) {
  const { w, h, top, bottom } = PROFILE;
  const heights = r.points.flatMap((q) => [q.ground, q.top, q.ray + q.zone, q.ray - q.zone]);
  const lo = Math.min(...heights), hi = Math.max(...heights), span = Math.max(hi - lo, 10);
  const px = (d) => (d / r.D) * w;
  const py = (y) => top + (1 - (y - lo) / span) * (h - top - bottom);
  const line = (fn) => r.points.map((q) => `${px(q.d).toFixed(1)},${py(fn(q)).toFixed(1)}`).join(' ');
  const base = `${w},${h - bottom} 0,${h - bottom}`;
  return (
    <svg id="sr-profile" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Path profile over ${km(r.D)}`}>
      <polygon className="sr-cover" points={`${line((q) => q.top)} ${base}`} />
      <polygon className="sr-ground" points={`${line((q) => q.ground)} ${base}`} />
      {r.ghz && <polyline className="sr-zone" points={line((q) => q.ray + q.zone)} />}
      {r.ghz && <polyline className="sr-zone" points={line((q) => q.ray - q.zone)} />}
      <polyline className="sr-ray" points={line((q) => q.ray)} />
      {r.blocker && <circle className="sr-block" cx={px(r.blocker.d)} cy={py(r.points.reduce((best, q) => (Math.abs(q.d - r.blocker.d) < Math.abs(best.d - r.blocker.d) ? q : best)).top)} r="3" />}
      <text className="sr-axis" x="0" y={h - 4}>0</text>
      <text className="sr-axis" x={w} y={h - 4} textAnchor="end">{km(r.D)}</text>
    </svg>
  );
}

function Breakdown({ r, def, unbroken }) {
  const bearing = def.sapient.noise?.az;
  return (
    <div className="sr-table">
      {r.ghz != null && <><span>Band used</span><span>{r.ghz.toFixed(1)} GHz</span></>}
      {r.free != null && <><span>Free-space loss</span><span>{db(r.free)}</span></>}
      {r.loss && <><span>Over the ground</span><span>+{db(r.loss.diffraction)}</span></>}
      {r.loss && <><span>Trees{r.loss.canopy ? `, ${Math.round(r.loss.canopy)} m deep` : ''}</span><span>+{db(r.loss.foliage)}</span></>}
      <span>Mast, drone height</span><span>{r.mast} m, {Math.round(r.alt)} m</span>
      <span>Blocked by</span><span>{r.blocker ? `${r.blocker.what} at ${km(r.blocker.d)}, ${Math.round(r.blocker.above)} m above the path` : 'nothing'}</span>
      <span>Unbroken cover</span><b>{km(unbroken)} of {km(r.open)}</b>
      {bearing != null && <><span>Bearing error</span><span>±{bearing}° close in, ±{(bearing * ERROR_AT_LIMIT).toFixed(1)}° at its limit</span></>}
      {def.kind === 'acoustic' && <span className="muted sr-wide">Sound bends over hills, so only its weakening is applied, not a blocked path.</span>}
    </div>
  );
}

export function SiteRange({ s }) {
  const def = s.def, world = terrainState.data, m = WORLD.metresPerUnit;
  const threats = Object.values(DRONES).filter((d) => reachFor(def, d));
  const [threatId, setThreat] = useState(threats.some((d) => d.id === 'fpv') ? 'fpv' : threats[0]?.id);
  const [picked, setPicked] = useState(null);
  const x = s.pos.x * m, z = s.pos.z * m;
  if (!usesPath(def)) return <p className="up-desc" id="sr-guided">It flies to its target over hills and trees, so where it stands does not change its {km(def.range)} range. It still needs a sensor to find the target.</p>;
  const threat = DRONES[threatId];
  const p = predictRange(def, threat, world, x, z);
  const bearing = picked ?? p.worst;
  const r = pathReport(def, threat, world, x, z, bearing);
  const unbroken = p.first[Math.round((bearing / 360) * BEARINGS) % BEARINGS];
  return (
    <div id="site-range">
      <div className="up-summary">
        <b>{km(p.open)}</b> in an open field. Here: <b>{km(p.mean)}</b> on average, {km(p.min)} to {km(p.max)}, seeing {Math.round(p.covered * 100)}% of that area.
        {p.limited && <span className="muted"> Stopped by the edge of the map in some directions.</span>}
      </div>
      <div className="up-field">
        <label htmlFor="sr-threat">Against</label>
        <select id="sr-threat" value={threatId} onChange={(e) => setThreat(e.target.value)}>
          {threats.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <Polar p={p} bearing={bearing} onPick={setPicked} />
      <div className="up-field">
        <label htmlFor="sr-bearing">Bearing {String(Math.round(bearing)).padStart(3, '0')}°{picked == null ? ', the worst' : ''}</label>
        <input id="sr-bearing" className="sr-slider" type="range" min="0" max="359" step="1" value={Math.round(bearing) % 360} onChange={(e) => setPicked(Number(e.target.value))} />
      </div>
      <Profile r={r} />
      <Breakdown r={r} def={def} unbroken={unbroken} />
    </div>
  );
}
