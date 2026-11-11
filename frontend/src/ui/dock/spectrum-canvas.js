// Who uses which frequencies, and where your jamming overlaps your own links.

import { COMMS, SPECTRUM, STRUCTURES, overlaps } from '../../sim/config/index.js';
import { hex, sharpCanvas } from '../hooks.js';
import { nodeList } from './network-canvas.js';

const F0 = 0.05, F1 = 30;

const jammersOf = (net) => [...net.nodes.values()].filter((n) => n.def.kind === 'jammer');

function usedCellBands(net) { // cellular band id -> nodes using it
  const used = new Map();
  for (const n of nodeList(net)) if (n.uplink === 'cellular') used.set(n.cellBand, [...(used.get(n.cellBand) || []), n]);
  if (net.fusion.uplinks.has('cellular')) used.set(net.fusion.cellBand, [...(used.get(net.fusion.cellBand) || []), { short: 'FUSION' }]);
  return used;
}

// Each jamming band that overlaps a cellular band one of your links uses.
export function jamConflicts(net) {
  const out = [], used = usedCellBands(net);
  for (const j of jammersOf(net)) for (const id of j.jamBands) for (const [cid, list] of used) {
    if (overlaps(SPECTRUM.bands[id].f, COMMS.cellular.bands[cid].f)) out.push({ j, id, cid, list });
  }
  return out;
}

export function drawSpectrum(cv, net) {
  const g = cv.getContext('2d');
  const { w: W, h: H } = sharpCanvas(cv, g) ?? {};
  if (!W) return;
  g.clearRect(0, 0, W, H); g.fillStyle = '#0a1120'; g.fillRect(0, 0, W, H);
  const L = 128, R = 10, T0 = 22, B = 26, span = Math.log10(F1 / F0);
  const X = (f) => L + (Math.log10(Math.max(f, F0) / F0) / span) * (W - L - R);
  g.font = '10px system-ui'; g.textAlign = 'center';
  for (const f of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20]) {
    g.strokeStyle = '#1c2b46'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(f), T0 - 4); g.lineTo(X(f), H - B); g.stroke();
    g.fillStyle = '#7f93b2'; g.fillText(f >= 1 ? f + ' GHz' : f * 1000 + ' MHz', X(f), H - B + 14);
  }
  const nodes = nodeList(net), jammers = jammersOf(net), usedBands = usedCellBands(net);
  const starlinkUsed = nodes.some((n) => n.uplink === 'starlink') || net.fusion.uplinks.has('starlink');
  const radars = [...net.nodes.values()].filter((n) => n.def.emits && n.def.emits.length);
  const rows = [
    { label: 'Enemy links', items: Object.values(SPECTRUM.bands).map((b) => ({ label: b.label, f: b.f, colour: '#ff6e40', active: true })) },
    { label: 'Your jamming', items: jammers.flatMap((j) => [...j.jamBands].map((id) => ({ label: `${j.short} ${SPECTRUM.bands[id].label}`, f: SPECTRUM.bands[id].f, colour: '#7c4dff', active: j.mode === 'Jam' }))) },
    { label: 'Your cellular', items: [...usedBands].map(([id, list]) => ({ label: `${COMMS.cellular.bands[id].label.split(' (')[0]} · ${list.length}`, f: COMMS.cellular.bands[id].f, colour: '#ffab40', active: true })) },
    { label: 'Your Starlink', items: starlinkUsed ? [{ label: 'Ku uplink', f: [COMMS.starlink.band[0]], colour: '#b388ff', active: true }, { label: 'Ku downlink', f: [COMMS.starlink.band[1]], colour: '#b388ff', active: true }] : [] },
    { label: 'Your radars', items: radars.map((r) => ({ label: r.short, f: r.def.emits[0].f, colour: hex(r.def.color), active: true })) },
    { label: 'RF detector hears', items: [...new Set(nodes.filter((n) => n.def.kind === 'rf').map((n) => n.def.id))].map((id) => ({ label: STRUCTURES[id].name, f: STRUCTURES[id].listens, colour: '#00e676', active: true, faint: true })) },
  ];
  const rh = (H - T0 - B) / rows.length;
  for (const { j, id, cid } of jamConflicts(net)) { // red stripes where jamming overlaps your cellular
    for (const [a0, a1] of SPECTRUM.bands[id].f) for (const [b0, b1] of COMMS.cellular.bands[cid].f) {
      const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
      if (lo < hi) { g.fillStyle = j.mode === 'Jam' ? 'rgba(244,67,54,0.38)' : 'rgba(244,67,54,0.18)'; g.fillRect(X(lo), T0, Math.max(X(hi) - X(lo), 3), H - T0 - B); }
    }
  }
  rows.forEach((row, i) => {
    const y = T0 + i * rh;
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent'; g.fillRect(L, y, W - L - R, rh);
    g.fillStyle = '#9fb2cf'; g.textAlign = 'right'; g.font = '11px system-ui'; g.fillText(row.label, L - 8, y + rh / 2 + 4);
    row.items.forEach((it, k) => {
      const lane = row.items.length > 1 ? (k % 2) : 0, h = row.items.length > 1 ? rh / 2 - 3 : rh - 10, yy = y + 4 + lane * (rh / 2 - 1);
      for (const [a, b] of it.f) {
        const x0 = X(a), x1 = Math.max(X(b), x0 + 4);
        g.fillStyle = it.colour; g.globalAlpha = it.faint ? 0.3 : it.active ? 0.9 : 0.35; g.fillRect(x0, yy, x1 - x0, h); g.globalAlpha = 1;
        g.fillStyle = '#fff'; g.font = '9px system-ui'; g.textAlign = 'left';
        if (x1 - x0 > 28) g.fillText(it.label, x0 + 3, yy + h - 3); else g.fillText(it.label, x1 + 3, yy + h - 3);
      }
    });
  });
}
