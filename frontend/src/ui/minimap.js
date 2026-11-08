// A top-down map centred on the station: shaded relief, the build zone, every system with its range, the fused tracks,
// the real drones (when the truth overlay is on) and the camera's field of view. Click or drag to move the camera there.

import { DRONES, WORLD, BUILD, SITE } from '../sim/config/index.js';
import { BEARINGS, predictRange, usesPath } from '../sim/site-range.js';
import { terrainState } from '../sim/terrain.js';
import { hereU, clamp } from '../sim/units.js';
import { hexCss } from '../render/labels.js';
import { trackColour } from '../render/belief-view.js';
import { view } from '../render/view.js';

// The outline of what a system really reaches from where it stands. Weapons that fly over the ground get a plain circle.
function traceRange(g, s, x, y, px) {
  g.beginPath();
  if (!usesPath(s.def)) { g.arc(x, y, px(s.def.range), 0, Math.PI * 2); return; }
  const m = WORLD.metresPerUnit;
  predictRange(s.def, DRONES.fpv, terrainState.data, s.pos.x * m, s.pos.z * m).first.forEach((r, i) => {
    const b = (i / BEARINGS) * Math.PI * 2;
    g.lineTo(x + Math.sin(b) * px(r), y - Math.cos(b) * px(r));
  });
  g.closePath();
}

export function createMinimap(sim, canvas, camera, controls) {
  const mm = { span: WORLD.radius - 500, drag: false };
  const g = canvas.getContext('2d');
  const mmXY = (xm, zm) => [(xm / mm.span + 1) * canvas.width / 2, (zm / mm.span + 1) * canvas.width / 2];
  let tick = 0;

  function draw() {
    if ((++tick & 1) !== 0) return;
    const w = canvas.width, mpu = WORLD.metresPerUnit, data = terrainState.data;
    const px = (metres) => (metres / mm.span) * (w / 2);
    g.fillStyle = '#0a1120'; g.fillRect(0, 0, w, w);
    if (terrainState.hillshade) {
      const half = px(data.R);
      g.globalAlpha = 0.85; g.drawImage(terrainState.hillshade, w / 2 - half, w / 2 - half, 2 * half, 2 * half); g.globalAlpha = 1;
    }
    const [ox, oy] = mmXY(0, 0);
    const ring = (r, col, dash) => {
      g.beginPath(); g.arc(ox, oy, px(r), 0, Math.PI * 2); g.strokeStyle = col; g.setLineDash(dash || []); g.lineWidth = 1; g.stroke(); g.setLineDash([]);
    };
    if (!sim.siteIsFree()) { // a drawn area or a patrol is the site, and you can build anywhere
      ring(BUILD.maxDist, 'rgba(92,123,176,0.9)', [3, 3]);
      ring(WORLD.spawnDist, 'rgba(255,255,255,0.18)', [2, 4]);
      ring(SITE.radius, 'rgba(255,82,82,0.95)');
    }
    if (view.zone) { // the area to defend
      g.beginPath();
      view.zone.points.forEach(([x, z]) => g.lineTo(...mmXY(x * mpu, z * mpu)));
      if (view.zone.closed) g.closePath();
      g.strokeStyle = '#c6ff00'; g.lineWidth = 1.5; g.stroke();
    }
    if (view.me) { const [x, y] = mmXY(view.me.x * mpu, view.me.z * mpu); g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fillStyle = '#2979ff'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
    if (view.spot) { const [x, y] = mmXY(view.spot.x * mpu, view.spot.z * mpu); g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.strokeStyle = '#c6ff00'; g.lineWidth = 2; g.stroke(); }
    for (const s of sim.structures) {
      const [x, y] = mmXY(s.pos.x * mpu, s.pos.z * mpu);
      const selected = s === view.selected;
      if (view.rings || selected) { traceRange(g, s, x, y, px); g.strokeStyle = hexCss(s.def.color) + (selected ? 'ff' : '66'); g.lineWidth = selected ? 2 : 1; g.stroke(); }
      g.fillStyle = hexCss(s.def.color); g.fillRect(x - 3, y - 3, 6, 6);
    }
    g.fillStyle = '#ffffff'; g.fillRect(ox - 2, oy - 2, 4, 4);
    for (const tr of sim.net.tracks.values()) {
      if (!tr.est) continue;
      const [x, y] = mmXY(tr.est.east, -tr.est.north);
      g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 4, y); g.lineTo(x, y + 4); g.lineTo(x - 4, y); g.closePath();
      g.strokeStyle = hexCss(trackColour(tr)); g.lineWidth = 1.2; g.stroke();
    }
    if (view.truth && view.replayT == null) {
      for (const d of sim.drones) {
        const [x, y] = mmXY(d.pos.x * mpu, d.pos.z * mpu);
        if (x < 0 || y < 0 || x > w || y > w) continue;
        g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2);
        g.fillStyle = d.detected ? hexCss(d.def.color) : '#6b7686'; g.fill();
      }
    }
    // the camera's view
    const [cx, cy] = mmXY(camera.position.x * mpu, camera.position.z * mpu);
    const ang = Math.atan2(controls.target.x - camera.position.x, controls.target.z - camera.position.z);
    const h = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect), len = w * 0.22;
    g.beginPath(); g.moveTo(cx, cy);
    g.lineTo(cx + Math.sin(ang - h / 2) * len, cy + Math.cos(ang - h / 2) * len);
    g.lineTo(cx + Math.sin(ang + h / 2) * len, cy + Math.cos(ang + h / 2) * len);
    g.closePath(); g.fillStyle = 'rgba(255,255,255,0.13)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = '#9fb2cf'; g.font = '600 10px system-ui, sans-serif'; g.fillText('N', w / 2 - 3, 11);
    g.fillStyle = '#7f93b2'; g.fillText(`${(mm.span / 1000).toFixed(1)} km`, 5, w - 6);
  }

  function goTo(e) {
    const r = canvas.getBoundingClientRect(), mpu = WORLD.metresPerUnit;
    const tx = (((e.clientX - r.left) / r.width) * 2 - 1) * (mm.span / mpu), tz = (((e.clientY - r.top) / r.height) * 2 - 1) * (mm.span / mpu);
    const dx = tx - controls.target.x, dz = tz - controls.target.z, dy = hereU(tx, tz) - controls.target.y;
    controls.target.x += dx; controls.target.z += dz; controls.target.y += dy;
    camera.position.x += dx; camera.position.z += dz; camera.position.y += dy;
  }
  canvas.addEventListener('pointerdown', (e) => { mm.drag = true; canvas.setPointerCapture(e.pointerId); goTo(e); });
  canvas.addEventListener('pointermove', (e) => { if (mm.drag) goTo(e); });
  canvas.addEventListener('pointerup', () => { mm.drag = false; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); mm.span = clamp(mm.span * (e.deltaY > 0 ? 1.15 : 0.87), 1500, WORLD.radius + 2000); }, { passive: false });

  return { draw };
}
