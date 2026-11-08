// Draws the plan view of the laydown. Returns { draw, dispose }.

import { BUILD, DRONES, SITE, WORLD } from '../../sim/config/index.js';
import { bus } from '../../sim/sapient.js';
import { BEARINGS, predictRange, usesPath } from '../../sim/site-range.js';
import { terrainState } from '../../sim/terrain.js';
import { view } from '../../render/view.js';
import { coverageGrid } from '../coverage.js';
import { hex } from '../hooks.js';

const TR_COL = { tentative: '#8a94a3', confirmed: '#ffcc66', coasting: '#ff9800' };
const mpu = () => WORLD.metresPerUnit;

// The outline of what a system really reaches from where it stands, against a small drone. Weapons that fly over the ground get a plain circle.
function traceRange(g, n, X, Y, k) {
  const e = n.pos.x * mpu(), north = -n.pos.z * mpu();
  g.beginPath();
  if (!usesPath(n.def)) { g.arc(X(e), Y(north), (n.def.range || 0) * k, 0, Math.PI * 2); return; }
  predictRange(n.def, DRONES.fpv, terrainState.data, e, -north).first.forEach((r, i) => {
    const b = (i / BEARINGS) * Math.PI * 2;
    g.lineTo(X(e + Math.sin(b) * r), Y(north + Math.cos(b) * r));
  });
  g.closePath();
}

// Not seen, seen by one sensor, seen by two or more: the coverage map's three colours, which the key in PlanTab.jsx matches.
export const COVER_FILL = ['rgba(229,57,53,0.32)', 'rgba(255,193,7,0.32)', 'rgba(102,187,106,0.45)'];

export function createPlanCanvas(cv, sim) {
  const { net, drones } = sim;
  const g = cv.getContext('2d');
  let viewR = 5000;
  const lastTx = new Map();
  const onMessage = (e) => { lastTx.set(e.from, performance.now()); };
  bus.listeners.add(onMessage);
  const onWheel = (e) => { e.preventDefault(); viewR = Math.min(30000, Math.max(800, viewR * (e.deltaY > 0 ? 1.15 : 1 / 1.15))); }; // 30 km: room for a 25 km NASAMS ring
  const ringStep = () => (viewR > 10000 ? 5000 : 1000); // km rings: every 1 km close in, every 5 km zoomed out
  cv.addEventListener('wheel', onWheel, { passive: false });

  // The coverage map, painted once for each grid worked out into a canvas of one pixel a cell, then drawn as one picture: filling every
  // cell of a 54 km map each time the view is drawn was about 46,000 rectangles every 200 ms, even while paused.
  let cover = { grid: null, canvas: null };
  function coverLayer(c) {
    if (cover.grid === c) return cover.canvas;
    const canvas = cover.canvas ?? document.createElement('canvas'), cg = canvas.getContext('2d');
    canvas.width = canvas.height = c.n;
    for (let j = 0; j < c.n; j++) for (let i = 0; i < c.n; i++) {
      cg.fillStyle = COVER_FILL[Math.min(c.counts[j * c.n + i], 2)];
      cg.fillRect(i, j, 1, 1); // row 0 is the north edge: z is south
    }
    cover = { grid: c, canvas };
    return canvas;
  }

  // coverage: the drone type to map, or null for none
  function draw(coverage) {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const k = Math.min(w, h) / 2 / viewR;
    const X = (e) => w / 2 + e * k, Y = (n) => h / 2 - n * k;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0b1424'; g.fillRect(0, 0, w, h);
    const Rt = terrainState.data ? terrainState.data.R : 0;
    if (terrainState.hillshade) { // shaded relief, north up
      g.imageSmoothingEnabled = true;
      g.drawImage(terrainState.hillshade, X(-Rt), Y(Rt), 2 * Rt * k, 2 * Rt * k);
    }
    if (coverage) {
      const c = coverageGrid(sim, coverage), side = c.n * c.cell * k;
      g.imageSmoothingEnabled = false; // crisp cells, as they were drawn one by one
      g.drawImage(coverLayer(c), X(-c.half), Y(c.half), side, side);
    }
    g.lineWidth = 1; g.font = '10px system-ui'; g.fillStyle = '#5f7391'; g.strokeStyle = '#1c2b46';
    for (let r = ringStep(); r <= viewR * 1.5; r += ringStep()) {
      g.beginPath(); g.arc(w / 2, h / 2, r * k, 0, Math.PI * 2); g.stroke();
      g.fillText(r / 1000 + ' km', w / 2 + r * k + 2, h / 2 - 2);
    }
    g.setLineDash([4, 4]); g.strokeStyle = '#3a527e';
    if (!sim.siteIsFree()) { g.beginPath(); g.arc(w / 2, h / 2, BUILD.maxDist * k, 0, Math.PI * 2); g.stroke(); }
    g.setLineDash([]);
    if (view.zone) { // the area to defend
      g.beginPath();
      view.zone.points.forEach(([x, z]) => g.lineTo(X(x * mpu()), Y(-z * mpu())));
      if (view.zone.closed) g.closePath();
      g.strokeStyle = '#c6ff00'; g.lineWidth = 2; g.setLineDash([8, 6]); g.stroke(); g.setLineDash([]); g.lineWidth = 1;
    }

    const nodes = [...net.nodes.values()].filter((n) => (n.def.role === 'sensor' || n.def.role === 'effector') && n.def.id !== 'perimeter');
    if (!coverage) for (const n of nodes) { // each node's range
      const col = hex(n.def.color);
      traceRange(g, n, X, Y, k);
      if (n.def.role === 'sensor') { g.fillStyle = col + '14'; g.fill(); }
      g.strokeStyle = col + (n.def.role === 'sensor' ? '88' : '66'); g.setLineDash(n.def.role === 'sensor' ? [] : [6, 4]);
      g.stroke(); g.setLineDash([]);
    }
    const now = performance.now();
    if (!coverage) for (const n of nodes) { // links to fusion
      const live = now - (lastTx.get(n.nodeId) || 0) < 300;
      g.strokeStyle = live ? '#ffffffcc' : '#ffffff22'; g.lineWidth = live ? 1.5 : 1;
      g.beginPath(); g.moveTo(X(n.pos.x * mpu()), Y(-n.pos.z * mpu())); g.lineTo(w / 2, h / 2); g.stroke();
    }
    g.lineWidth = 1;
    g.fillStyle = sim.siteIsFree() ? '#9fb2cf' : '#ff5252'; g.beginPath(); g.arc(w / 2, h / 2, sim.siteIsFree() ? 5 : Math.max(SITE.radius * k, 5), 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillText(sim.siteIsFree() ? 'FUSION' : 'FUSION / SITE', w / 2 + 8, h / 2 + 14);
    for (const n of nodes) { // nodes
      const x = X(n.pos.x * mpu()), y = Y(-n.pos.z * mpu());
      g.fillStyle = hex(n.def.color);
      if (n.def.role === 'sensor') { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); } else g.fillRect(x - 5, y - 5, 10, 10);
      if (!coverage) { g.fillStyle = '#dbe4f0'; g.fillText(n.short + (n.def.kind === 'jammer' && n.mode === 'Jam' ? ' [JAM]' : ''), x + 8, y + 3); }
      if (n.def.fov && n.point) { // camera: its current view
        const view = n.view ?? n.def.fov, a = (n.point.az * Math.PI) / 180, half = (view / 2 * Math.PI) / 180, len = (n.def.range * n.def.fov) / view; // zoomed in on a cue, it reaches further
        g.fillStyle = hex(n.def.color) + '33'; g.beginPath(); g.moveTo(x, y);
        g.lineTo(X(n.pos.x * mpu() + len * Math.sin(a - half)), Y(-n.pos.z * mpu() + len * Math.cos(a - half)));
        g.lineTo(X(n.pos.x * mpu() + len * Math.sin(a + half)), Y(-n.pos.z * mpu() + len * Math.cos(a + half))); g.closePath(); g.fill();
      }
      if (n.task && !n.task.drone.dead) { // engagement line
        const d = n.task.drone;
        g.strokeStyle = '#ff5252'; g.beginPath(); g.moveTo(x, y); g.lineTo(X(d.pos.x * mpu()), Y(-d.pos.z * mpu())); g.stroke();
      }
    }
    if (view.truth) { // truth: drones no sensor has, in grey
      g.fillStyle = '#8a94a3';
      for (const d of drones) {
        if (d.detected) continue;
        g.beginPath(); g.arc(X(d.pos.x * mpu()), Y(-d.pos.z * mpu()), 3, 0, Math.PI * 2); g.fill();
      }
    }
    for (const c of net.bearingCandidates()) { // bearings no track has claimed: rays from the sensor
      g.strokeStyle = hex(c.color) + '99'; g.beginPath();
      g.moveTo(X(c.from[0]), Y(c.from[1])); g.lineTo(X(c.from[0] + 3500 * Math.sin(c.az)), Y(c.from[1] + 3500 * Math.cos(c.az))); g.stroke();
    }
    for (const tr of net.tracks.values()) { // fused tracks, drawn where the fusion node believes they are
      if (!tr.est) continue;
      const col = TR_COL[tr.status] || '#ffcc66';
      const x = X(tr.est.east), y = Y(tr.est.north);
      if (tr.estErr) { g.strokeStyle = col + '88'; g.beginPath(); g.arc(x, y, Math.max(tr.estErr * k, 3), 0, Math.PI * 2); g.stroke(); }
      if (view.truth && tr.drone) { // line from belief to truth
        g.strokeStyle = '#8a94a3'; g.beginPath(); g.moveTo(x, y); g.lineTo(X(tr.drone.pos.x * mpu()), Y(-tr.drone.pos.z * mpu())); g.stroke();
      }
      g.strokeStyle = col; g.beginPath(); g.moveTo(x - 4, y - 4); g.lineTo(x + 4, y + 4); g.moveTo(x + 4, y - 4); g.lineTo(x - 4, y + 4); g.stroke();
      if (tr.status !== 'tentative') {
        const cls = tr.model ?? (tr.airframe && tr.airframe !== 'Unknown' ? tr.airframe : 'UAV');
        g.fillStyle = col; g.fillText(`${tr.short} · ${cls}`, x + 7, y + 3);
      }
    }
  }

  return { draw, dispose() { bus.listeners.delete(onMessage); cv.removeEventListener('wheel', onWheel); } };
}
