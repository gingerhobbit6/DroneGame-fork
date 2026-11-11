// Draws the wire diagram: systems, their wires to Starlink or cellular, and packets travelling along them as pulses.
// Returns { draw, hitTest, dispose }.

import { hex, sharpCanvas } from '../hooks.js';

const NODE_W = 82, NODE_H = 26;
const ELEMENT_COLOUR = { starlink: '#b388ff', cellular: '#ffab40', internet: '#90a4ae' };
export const TYPE_COLOUR = {
  detection_report: '#4fc3f7', status_report: '#8fa6cc', task: '#ffb74d', task_ack: '#ffe0b2', alert: '#ff5252',
  alert_ack: '#ff8a80', registration: '#81c784', registration_ack: '#c5e1a5', error: '#ff1744',
};
const GOOD = '#66bb6a', WARN = '#ffb300', BAD = '#ef5350', IDLE = '#5c6b86';
export const linkColour = (info) => (!info ? IDLE : !info.up ? BAD : info.quality < 0.6 ? WARN : GOOD);
export const BAD_COLOUR = BAD;
export const nodeList = (net) => [...net.nodes.values()].filter((n) => (n.def.role === 'sensor' || n.def.role === 'effector') && n.def.id !== 'perimeter');

const top = (b) => ({ x: b.x + b.w / 2, y: b.y });
const bottom = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h });
const lineOf = (a, b) => [a, b];
function curve(a, b, n = 18) { // a vertical S-curve from a to b
  const pts = [], my = (a.y + b.y) / 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push({ x: u * u * u * a.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * my + 3 * u * t * t * my + t * t * t * b.y });
  }
  return pts;
}
export function pointAlong(pts, f) {
  if (pts.length < 2) return null;
  let total = 0; const segs = [];
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segs.push(l); total += l; }
  let d = f * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i]) { const t = segs[i] ? d / segs[i] : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t }; }
    d -= segs[i];
  }
  return pts[pts.length - 1];
}

// getSel() is { kind, id } or null, isVisible() says whether anyone can see pulses, getPace() is seconds per pulse
export function createNetworkCanvas(cv, net, { getSel, isVisible, getPace }) {
  const comms = net.comms, g = cv.getContext('2d');
  let boxes = [], wires = [], layoutCache = null, hover = null;
  const pulses = [];
  let linkInfo = new Map(), linkT = 0;

  function layout(W, H) {
    const els = {
      starlink: { id: 'starlink', x: W * 0.2 - 62, y: 18, w: 124, h: 34 },
      internet: { id: 'internet', x: W * 0.5 - 50, y: 18, w: 100, h: 34 },
      cellular: { id: 'cellular', x: W * 0.8 - 62, y: 18, w: 124, h: 34 },
    };
    const fusion = { id: 'fusion', x: W * 0.5 - 75, y: Math.max(112, H * 0.24), w: 150, h: 40 };
    const nodeY = Math.max(170, H * 0.5);
    const all = nodeList(net), sensors = all.filter((n) => n.def.role === 'sensor'), effectors = all.filter((n) => n.def.role === 'effector');
    const place = (list, x0, x1, y0) => list.map((n, i) => {
      const cols = Math.max(1, Math.floor((x1 - x0) / (NODE_W + 8)));
      // close the rows up to fit, or a system below the canvas could not be clicked
      const step = Math.max(NODE_H + 4, Math.min(NODE_H + 36, (H - y0 - 8) / Math.ceil(list.length / cols)));
      return { id: n.nodeId, node: n, x: x0 + (i % cols) * (NODE_W + 8), y: y0 + Math.floor(i / cols) * step, w: NODE_W, h: NODE_H };
    });
    return { els, fusion, nodes: [...place(sensors, 12, W / 2 - 10, nodeY), ...place(effectors, W / 2 + 10, W - 12, nodeY)] };
  }

  function refreshLinks() {
    const now = performance.now();
    if (now - linkT < 500) return;
    linkT = now;
    linkInfo = new Map();
    for (const n of nodeList(net)) linkInfo.set(n.nodeId, n.uplink ? comms.nodeLink(n) : null);
  }

  function box(b, label, colour, opts = {}) {
    g.fillStyle = opts.fill || '#10192b'; g.strokeStyle = colour; g.lineWidth = opts.selected ? 3 : 1.5;
    g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 5); g.fill(); g.stroke();
    g.fillStyle = '#eef3fb'; g.font = '600 11px system-ui'; g.textAlign = 'center'; g.fillText(label, b.x + b.w / 2, b.y + (opts.sub ? b.h / 2 - 1 : b.h / 2 + 4));
    if (opts.sub) { g.fillStyle = '#9fb2cf'; g.font = '10px system-ui'; g.fillText(opts.sub, b.x + b.w / 2, b.y + b.h / 2 + 11); }
  }
  function wire(pts, colour, width) {
    g.strokeStyle = colour; g.lineWidth = width;
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
  }

  function draw() {
    const { w: W, h: H } = sharpCanvas(cv, g) ?? {};
    if (!W) return;
    refreshLinks();
    const sel = getSel();
    const L = layout(W, H);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0a1120'; g.fillRect(0, 0, W, H);
    boxes = []; wires = [];

    // the networks themselves
    wire(lineOf(bottom(L.els.starlink), top(L.els.internet)), '#3a4a6b', 3);
    wire(lineOf(bottom(L.els.cellular), top(L.els.internet)), '#3a4a6b', 3);
    wire(lineOf({ x: L.els.starlink.x + L.els.starlink.w, y: 35 }, { x: L.els.internet.x, y: 35 }), '#3a4a6b', 3);
    wire(lineOf({ x: L.els.internet.x + L.els.internet.w, y: 35 }, { x: L.els.cellular.x, y: 35 }), '#3a4a6b', 3);

    // the fusion node's terminals
    const fusionWires = {};
    for (const kind of ['starlink', 'cellular']) {
      if (!net.fusion.uplinks.has(kind)) continue;
      const pts = curve(top(L.fusion), bottom(L.els[kind]));
      fusionWires[kind] = pts;
      wire(pts, linkColour(comms.linkFor(net.fusion, kind, net.fusion.cellBand)), 3);
      wires.push({ id: 'fusion:' + kind, pts, fusion: kind });
    }

    // each system's wire
    const nodeBoxes = new Map();
    for (const nb of L.nodes) {
      nodeBoxes.set(nb.id, nb);
      const n = nb.node, info = linkInfo.get(n.nodeId);
      if (n.uplink) {
        const pts = curve(top(nb), bottom(L.els[n.uplink]));
        const selected = sel && sel.kind === 'wire' && sel.id === n.nodeId;
        wire(pts, linkColour(info), selected ? 4 : Math.max(1.5, 1 + (info ? info.quality * 1.5 : 0)));
        wires.push({ id: n.nodeId, pts, node: n });
        nb.pts = pts;
      }
    }

    // boxes on top of the wires
    const all = nodeList(net);
    for (const [k, b] of Object.entries(L.els)) {
      const used = k === 'internet' ? '' : `${all.filter((n) => n.uplink === k).length} systems`;
      box(b, k === 'starlink' ? 'Starlink' : k === 'cellular' ? 'Cellular' : 'Internet', ELEMENT_COLOUR[k], { sub: used, selected: hover === k });
      boxes.push({ ...b, kind: 'element' });
    }
    const fusionInfo = comms.fusionLink('starlink');
    box(L.fusion, 'Fusion node', fusionInfo.up ? GOOD : BAD, { selected: sel && sel.kind === 'fusion', sub: [...net.fusion.uplinks].map((k) => (k === 'starlink' ? 'Starlink' : 'Cellular')).join(' + ') || 'no terminal' });
    boxes.push({ ...L.fusion, kind: 'fusion' });
    for (const nb of L.nodes) {
      const n = nb.node, info = linkInfo.get(n.nodeId);
      const selected = sel && (sel.kind === 'node' || sel.kind === 'wire') && sel.id === n.nodeId;
      box(nb, n.short, hex(n.def.color), { selected, sub: n.offline ? 'LOST CONTACT' : n.uplink ? (info && !info.up ? 'link down' : n.mode) : 'no link', fill: n.offline || !n.uplink ? '#2a1620' : '#10192b' });
      boxes.push({ ...nb, kind: 'node' });
      if (!n.uplink) { g.fillStyle = BAD; g.beginPath(); g.arc(nb.x + nb.w - 6, nb.y + 6, 3, 0, 7); g.fill(); }
    }

    // pulses: one per packet, travelling node <-> fusion along the wires
    const now = performance.now();
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], f = (now - p.t0) / p.dur;
      if (f >= 1 + (p.drop ? 0.4 : 0)) { pulses.splice(i, 1); continue; }
      const along = Math.min(f, p.drop ? 0.55 : 1);
      const pt = pointAlong(p.path, p.fwd ? along : 1 - along);
      if (!pt) continue;
      g.fillStyle = p.colour; g.globalAlpha = p.drop && f > 0.55 ? Math.max(0, 1 - (f - 0.55) / 0.45) : 1;
      g.beginPath(); g.arc(pt.x, pt.y, p.size, 0, 7); g.fill();
      if (p.drop && f >= 0.55) { g.strokeStyle = BAD; g.lineWidth = 2; g.beginPath(); g.moveTo(pt.x - 6, pt.y - 6); g.lineTo(pt.x + 6, pt.y + 6); g.moveTo(pt.x + 6, pt.y - 6); g.lineTo(pt.x - 6, pt.y + 6); g.stroke(); }
      g.globalAlpha = 1;
    }
    layoutCache = { L, nodeBoxes, fusionWires };
  }

  // a packet becomes a pulse along: node -> its network -> (internet) -> fusion's network -> fusion
  function addPulse(pkt) {
    if (!isVisible() || !layoutCache || pulses.length > 220 || (pulses.length > 120 && Math.random() < 0.6)) return;
    const { L, nodeBoxes, fusionWires } = layoutCache;
    const nb = nodeBoxes.get(pkt.nodeId);
    if (!nb || !nb.pts) return;
    const path = [...nb.pts]; // node -> its network element
    const fk = pkt.hops && pkt.hops.length ? pkt.hops[pkt.hops.length - 1] : nb.node.uplink;
    if (pkt.hops && pkt.hops.includes('internet')) {
      path.push(...lineOf(bottom(L.els[nb.node.uplink]), top(L.els.internet)));
      path.push(...lineOf(top(L.els.internet), bottom(L.els[fk])));
    }
    const fw = fusionWires[fk];
    if (fw) path.push(...[...fw].reverse());
    pulses.push({ path, fwd: pkt.toFusion, colour: TYPE_COLOUR[pkt.type] || '#fff', size: 2.5 + Math.min(3, pkt.bytes / 200), t0: performance.now(), dur: getPace() * 1000, drop: pkt.dropped });
  }
  comms.listeners.add(addPulse);

  const inBox = (b, p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  function nearWire(p) {
    let best = null, bd = 7;
    for (const w of wires) for (const q of w.pts) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = w; } }
    return best;
  }

  return {
    draw,
    // what is under this point: { box } or { wire } or {}
    hitTest(p) {
      const b = boxes.slice().reverse().find((x) => inBox(x, p));
      if (b) return { box: b };
      const w = nearWire(p);
      return w ? { wire: w } : {};
    },
    setHover(id) { hover = id; },
    dispose() { comms.listeners.delete(addPulse); },
  };
}
