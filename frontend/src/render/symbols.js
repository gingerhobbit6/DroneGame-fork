// NATO map symbols after APP-6(D) / MIL-STD-2525D, as counter-drone displays show at map range, where a true-size model is
// under a pixel and one drawn many times life size reads as a toy. Each symbol is drawn once to a canvas and its texture shared.
// A key is 'affiliation:icon'. friend is our land equipment (a circle); hostile, unknown and pending are air (open at the
// bottom); unseen is the hostile frame in grey, for a drone no sensor has.

import * as THREE from 'three';
import { VIEW_HEIGHT, view } from './view.js';

// A model drawn more than this many times life size gives way to its symbol: a system's from about 1.5 km of zoom, while at a few
// hundred metres it is 2 to 4 times life size and keeps its model.
export const SYMBOL_OVER = 12;
export const SYMBOL_PX = 36; // how big a symbol is drawn on the screen, in pixels
// Whether something drawn this many times life size is shown as its symbol. Never in the ground view, where everything is near.
export const asSymbol = (timesLife) => !view.eye && timesLife > SYMBOL_OVER;

const S = 64, K = 0.38; // the canvas, and its pixels per unit of the 200 x 200 box the standard draws symbols in
const FILL = { friend: '#80e0ff', hostile: '#ff8080', unknown: '#ffff80', pending: '#ffff80', unseen: '#8a94a3' };
const TEXT = { radar: 'RAD', rf: 'RF', camera: 'EO', acoustic: 'ACU', jammer: 'EW', gun: 'GUN', laser: 'LSR' }; // text icons, where no glyph is standard

const hostileAir = (g) => { g.moveTo(45, 150); g.lineTo(45, 70); g.lineTo(100, 20); g.lineTo(155, 70); g.lineTo(155, 150); };
const unknownAir = (g) => {
  g.moveTo(65, 150); g.bezierCurveTo(10, 150, 15, 60, 65, 60);
  g.bezierCurveTo(65, 10, 135, 10, 135, 60); g.bezierCurveTo(185, 60, 190, 150, 135, 150);
};
const UAV = [[-45, -19], [0, 4], [45, -19], [45, -5], [0, 20], [-45, -5]];
const ROTOR = [[-36, -12], [36, 12], [36, -12], [-36, 12]]; // the rotary-wing bow tie
const MISSILE = [[0, -44], [8, -30], [8, 18], [20, 34], [-20, 34], [-8, 18], [-8, -30]];
const shape = (g, y, pts) => { g.beginPath(); for (const [a, b] of pts) g.lineTo(100 + a, y + b); g.fill(); };

function draw(g, aff, icon) {
  const land = aff === 'friend', y = land ? 86 : 95; // where the icon sits: the circle's middle, or low in an air frame's
  g.setTransform(K, 0, 0, K, S / 2 - 100 * K, S / 2 - 86 * K);
  g.lineWidth = 8; g.lineJoin = 'round'; g.strokeStyle = '#000'; g.fillStyle = FILL[aff];
  g.beginPath();
  if (land) g.arc(100, 86, 60, 0, Math.PI * 2);
  else (aff === 'hostile' || aff === 'unseen' ? hostileAir : unknownAir)(g);
  g.fill();
  if (aff === 'pending') g.setLineDash([16, 12]);
  g.stroke();
  g.fillStyle = '#000';
  if (icon === 'rotary') { shape(g, y - 20, ROTOR); shape(g, y + 16, UAV); }
  else if (icon === 'uav' || icon === 'interceptor') shape(g, y, UAV);
  else if (icon === 'missile') shape(g, y, MISSILE);
  else { g.font = 'bold 42px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(TEXT[icon] ?? '?', 100, y + 2); }
}

const textures = new Map(); // key -> texture, shared by every sprite showing it
function texture(key) {
  let t = textures.get(key);
  if (!t) {
    const c = globalThis.document?.createElement('canvas'); // none outside a browser, and no 2D context in tests: the texture stays blank
    const g = c && (c.width = c.height = S, c.getContext('2d'));
    if (g) draw(g, ...key.split(':'));
    t = c ? new THREE.CanvasTexture(c) : new THREE.Texture();
    t.colorSpace = THREE.SRGBColorSpace;
    textures.set(key, t);
  }
  return t;
}

// A symbol that keeps its size on the screen and reads over the ground. Its owner disposes its material and geometry, never the texture.
export function symbolSprite(key, renderOrder) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(key), sizeAttenuation: false, depthTest: false, depthWrite: false }));
  s.geometry = s.geometry.clone(); // its own quad, so freeing a view never frees the one every sprite shares
  s.renderOrder = renderOrder;
  s.userData.symbol = key;
  return s;
}

export function setSymbol(s, key) {
  if (s.userData.symbol === key) return;
  s.material.map = texture(key);
  s.userData.symbol = key;
}

// A fused track's symbol: pending while tentative, unknown until a camera names the airframe, then hostile.
export const trackSymbol = (tr) => (tr.status === 'tentative' ? 'pending:uav'
  : tr.airframe && tr.airframe !== 'Unknown' ? `hostile:${tr.airframe === 'Multirotor' ? 'rotary' : 'uav'}` : 'unknown:uav');
// A true drone's symbol: hostile once a sensor has it, grey while none does.
export const droneSymbol = (def, tracked) => `${tracked ? 'hostile' : 'unseen'}:${def.airframe === 'Multirotor' ? 'rotary' : 'uav'}`;

// The scale that draws a symbol px pixels tall under a parent drawn `parent` times its size.
export const symbolScale = (px = SYMBOL_PX, parent = 1) => (px * VIEW_HEIGHT) / (globalThis.innerHeight || 768) / parent;
