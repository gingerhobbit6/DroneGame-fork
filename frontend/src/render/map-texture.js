// The map on a real world's ground. Everything is painted into one canvas, so grid lines and roads always follow the ground,
// and a smaller copy serves the minimap and the Plan tab. Nothing here can reach the rules.

import * as THREE from 'three';
import { wgs84ToBng } from '../sim/bng.js';
import { gridFor, toLatLon } from '../sim/grids.js';
import { band, fromUtm, squareLetters, toUtm, utmZone } from '../sim/mgrs.js';
import { latLonOf } from '../sim/world-pack.js';
import { contourLines, topoPixels } from './topo.js';

const SIZE = 4096, SMALL = 1024, PREVIEW = 192, PREVIEW_SPAN = 6000, TILE_REFRESH_MS = 400;
const OSM_URL = 'https://tile.openstreetmap.org', OSM_ZOOM = 14;
const MAX_TILES = 4096, MAX_TILE_REQUESTS = 16, MAX_BITMAP_DIM = 8192, MAX_BITMAP_PIXELS = 8192 * 8192;
let bitmapTurn = Promise.resolve(); // previews and a live repaint must not decode several large pictures at once
async function withBitmapTurn(draw) {
  const previous = bitmapTurn;
  let release;
  bitmapTurn = new Promise((resolve) => { release = resolve; });
  await previous;
  try { return await draw(); } finally { release(); }
}
const ROADS = [['Motorway', 34, '#4d9de0'], ['Primary', 27, '#3fbf6f'], ['A Road', 24, '#e15554'], ['B Road', 20, '#f0a33a'], ['Minor', 12, '#ffffff'], ['Local', 7, '#dddddd'], ['Restricted', 7, '#cccccc']]; // widths in metres on the ground

const roadStyle = (cls) => ROADS.find(([start]) => cls.startsWith(start));
const tileLon = (x, z) => (x / 2 ** z) * 360 - 180;
const tileLat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
const usesSatellite = (baseMap) => baseMap === 'satellite' || baseMap === 'hybrid';
const onDarkGround = (baseMap) => usesSatellite(baseMap) || baseMap === 'dark';
// The light and dark maps are the pack's OS map recoloured, so they work offline and need no other map provider.
const RESTYLE = {
  light: [['saturation', '#000'], ['screen', '#3a3a3a']],
  dark: [['saturation', '#000'], ['difference', '#fff'], ['multiply', '#8ea4c8'], ['lighter', '#0e1626']],
};
function restyle({ g, size }, steps) {
  for (const [mode, colour] of steps) { g.globalCompositeOperation = mode; g.fillStyle = colour; g.fillRect(0, 0, size, size); }
  g.globalCompositeOperation = 'source-over';
}

// The OSM tiles over a world, and where three of each tile's corners land on the national grid.
export function tilesOver({ north, south, east, west }, zoom = OSM_ZOOM, toGrid = wgs84ToBng) {
  if (![north, south, east, west].every(Number.isFinite) || north < south || east < west ||
      Math.abs(north) > 85 || Math.abs(south) > 85 || east > 180 || west < -180 ||
      !Number.isInteger(zoom) || zoom < 0 || zoom > 20) throw new Error('This map has invalid tile bounds.');
  const scale = 2 ** zoom, col = (lon) => Math.floor(((lon + 180) / 360) * scale);
  const row = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * scale); };
  const x0 = col(west), x1 = Math.min(col(east), scale - 1), y0 = row(north), y1 = row(south);
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  if (![x0, x1, y0, y1, width, height].every(Number.isSafeInteger) ||
      x0 < 0 || y0 < 0 || x1 >= scale || y1 >= scale || width <= 0 || height <= 0 || width * height > MAX_TILES) {
    throw new Error('This map requests too many tiles.');
  }
  const tiles = [];
  for (let yi = 0; yi < height; yi++) {
    for (let xi = 0; xi < width; xi++) {
      const x = x0 + xi, y = y0 + yi;
      tiles.push({
        x, y, zoom,
        origin: toGrid(tileLat(y, zoom), tileLon(x, zoom)), right: toGrid(tileLat(y, zoom), tileLon(x + 1, zoom)), down: toGrid(tileLat(y + 1, zoom), tileLon(x, zoom)),
      });
    }
  }
  return tiles;
}

function tileImage(tile) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'strict-origin-when-cross-origin'; // OSM's tile policy asks for a referrer, and the page's own policy sends none
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = `${OSM_URL}/${tile.zoom}/${tile.x}/${tile.y}.png`;
  });
}

// A square of the national grid on a canvas: { g, west, top, span, size, px (metres to pixels) }.
function frameOf(g, west, top, span, size) {
  return { g, west, top, span, size, px: (metres) => (metres / span) * size };
}

export async function paintPictures(f, pictures, layer, still) {
  const { g, west, top, span, px } = f;
  for (const p of pictures) {
    if (![p.west, p.top, p.width, p.height].every(Number.isFinite) || p.width <= 0 || p.height <= 0 ||
        p.width > 80000 || p.height > 80000) throw new Error('This map has invalid picture dimensions.');
    if (p.layer !== layer || p.west >= west + span || p.west + p.width <= west || p.top <= top - span || p.top - p.height >= top) continue;
    // decoded at the size it is drawn: an OS piece is 4000 px across, and most of those pixels would be thrown away
    const w = Math.max(Math.ceil(px(p.width)), 1), h = Math.max(Math.ceil(px(p.height)), 1);
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w > MAX_BITMAP_DIM || h > MAX_BITMAP_DIM || w * h > MAX_BITMAP_PIXELS) {
      throw new Error('This map requests an oversized picture.');
    }
    await withBitmapTurn(async () => {
      if (!still()) return;
      const bitmap = await createImageBitmap(p.blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }).catch(() => null); // a picture the browser cannot read is left out, not the whole map
      if (!bitmap) return;
      try {
        if (still()) g.drawImage(bitmap, px(p.west - west), px(top - p.top), w, h); // a newer choice must not be drawn over
      } finally { bitmap.close(); }
    });
    if (!still()) return;
  }
}

// Each tile is stretched by its own corners, because OSM's squares sit at an angle to the national grid.
// Tiles go on as they arrive, over the old map, so a slow connection shows the new one filling in rather than nothing.
async function paintLive({ g, west, top, px }, data, still, onTile) {
  const corner = (x, z) => latLonOf(data.geo, x, -z);
  const a = corner(-data.R, -data.R), b = corner(data.R, data.R), c = corner(data.R, -data.R), d = corner(-data.R, data.R);
  const tiles = tilesOver({ north: Math.max(a.lat, c.lat), south: Math.min(b.lat, d.lat), east: Math.max(b.lon, c.lon), west: Math.min(a.lon, d.lon) }, OSM_ZOOM, gridFor(data.geo.n0));
  let failed = 0;
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(MAX_TILE_REQUESTS, tiles.length) }, async () => {
    while (still() && next < tiles.length) {
      const tile = tiles[next++], image = await tileImage(tile);
      if (!still()) return;
      if (!image) { failed++; continue; }
      const { origin, right, down } = tile, k = px(1) / 256;
      g.setTransform((right.e - origin.e) * k, (origin.n - right.n) * k, (down.e - origin.e) * k, (origin.n - down.n) * k, px(origin.e - west), px(top - origin.n));
      g.drawImage(image, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      onTile();
    }
  }));
  return { failed, total: tiles.length };
}

// Road and name positions are metres from the pack's centre.
function packToFrame({ west, top, px }, data) {
  const worldWest = data.geo.e0 - data.R, worldTop = data.geo.n0 + data.R;
  const dx = data.geo.e0 - data.geo.packEast, dz = data.geo.packNorth - data.geo.n0;
  return { atX: (v) => px(v - dx + data.R + worldWest - west), atZ: (v) => px(v - dz + data.R + top - worldTop) };
}

function paintRoads(f, features, data) {
  const { g, px } = f, { atX, atZ } = packToFrame(f, data);
  g.lineCap = 'round'; g.lineJoin = 'round'; g.globalAlpha = 0.85;
  for (const [cls, points] of features.roads || []) {
    const style = roadStyle(String(cls));
    if (!style) continue;
    g.lineWidth = px(style[1]); g.strokeStyle = style[2];
    g.beginPath();
    points.forEach(([x, z], i) => { if (i) g.lineTo(atX(x), atZ(z)); else g.moveTo(atX(x), atZ(z)); });
    g.stroke();
  }
  g.globalAlpha = 1;
}

// Place names, larger places first, skipping any that would overlap one drawn. At about 13 m a canvas pixel, 24 px is letters 300 m tall.
const NAME_PX = { Large: 24, Medium: 17 };
export function paintNames(f, features, data) {
  const { g } = f, { atX, atZ } = packToFrame(f, data), kept = [];
  const names = (features.names || []).filter(([, kind, height]) => NAME_PX[height] && kind !== 'Landform').sort((a, b) => NAME_PX[b[2]] - NAME_PX[a[2]]);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.fillStyle = '#fff';
  for (const [text, , height, x, z] of names) {
    const size = NAME_PX[height], name = String(text), cx = atX(x), cy = atZ(z);
    g.font = `600 ${size}px system-ui`; // canvas text, never HTML: names come from the pack file
    const w = g.measureText(name).width / 2 + 4, h = size / 2 + 2, box = [cx - w, cy - h, cx + w, cy + h];
    if (kept.some((k) => box[0] < k[2] && box[2] > k[0] && box[1] < k[3] && box[3] > k[1])) continue;
    kept.push(box); g.strokeText(name, cx, cy); g.fillText(name, cx, cy);
  }
  g.textAlign = 'start'; g.textBaseline = 'alphabetic';
}

function paintContours(f, lines, data, baseMap, withLabels) {
  const { g, west, top, px } = f, onPhoto = onDarkGround(baseMap);
  const worldWest = data.geo.e0 - data.R, worldTop = data.geo.n0 + data.R;
  const ax = (x) => px(x + worldWest - west), az = (z) => px(z + top - worldTop);
  const stroke = (list, width, colour) => {
    g.lineWidth = Math.max(px(width), 0.6); g.strokeStyle = colour;
    g.beginPath();
    for (let s = 0; s < list.length; s += 4) { g.moveTo(ax(list[s]), az(list[s + 1])); g.lineTo(ax(list[s + 2]), az(list[s + 3])); }
    g.stroke();
  };
  g.lineCap = 'round';
  stroke(lines.minor, 5, onPhoto ? 'rgba(255,240,190,0.5)' : 'rgba(120,75,35,0.55)');
  stroke(lines.index, 11, onPhoto ? 'rgba(255,240,190,0.9)' : 'rgba(105,60,25,0.9)');
  if (!withLabels) return;
  g.font = '600 18px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  for (const { level, x, z, angle } of lines.labels) {
    g.save();
    g.translate(ax(x), az(z)); g.rotate(angle);
    g.lineWidth = 7; g.strokeStyle = onPhoto ? 'rgba(0,0,0,0.8)' : 'rgba(255,250,235,0.95)'; g.fillStyle = onPhoto ? '#fff0be' : '#693c19';
    g.strokeText(String(level), 0, 0); g.fillText(String(level), 0, 0);
    g.restore();
  }
  g.textAlign = 'start'; g.textBaseline = 'alphabetic';
}

// Past a border the national map can be blank. The pack outlines that ground ('beyond', rings in metres from the pack's middle), and it is
// shaded from the heights there, with contours, so it still shows the lie of the land.
export function paintBeyond(f, data, rings, topo) {
  if (!Array.isArray(rings) || !rings.length) return;
  const { g, west, top, px } = f, { atX, atZ } = packToFrame(f, data);
  g.save();
  g.beginPath();
  for (const ring of rings) if (Array.isArray(ring)) ring.forEach(([x, z], i) => (i ? g.lineTo(atX(x), atZ(z)) : g.moveTo(atX(x), atZ(z))));
  g.clip('evenodd');
  g.drawImage(topo.picture, px(data.geo.e0 - data.R - west), px(top - data.geo.n0 - data.R), px(2 * data.R), px(2 * data.R));
  paintContours(f, topo.lines, data, 'os', true);
  g.restore();
}

function gridLabel(g, text, x, y) {
  g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.fillStyle = '#0b3ea8';
  g.strokeText(text, x, y); g.fillText(text, x, y);
}
const kmDigits = (v) => String(Math.floor(v / 1000) % 100).padStart(2, '0');

function paintGrid({ g, west, top, span, size, px }) {
  const label = (text, x, y) => gridLabel(g, text, x, y);
  g.font = '600 16px system-ui'; g.textBaseline = 'bottom'; g.lineJoin = 'round';
  for (let e = Math.ceil(west / 1000) * 1000; e <= west + span; e += 1000) {
    g.strokeStyle = 'rgba(30,110,255,0.45)'; g.lineWidth = e % 10000 ? 1.5 : 3;
    g.beginPath(); g.moveTo(px(e - west), 0); g.lineTo(px(e - west), size); g.stroke();
    const n = Math.ceil((top - span) / 1000) * 1000 + 1000;
    for (let v = n; v < top; v += 5000) label(kmDigits(e), px(e - west) + 6, px(top - v));
  }
  for (let n = Math.ceil((top - span) / 1000) * 1000; n <= top; n += 1000) {
    g.strokeStyle = 'rgba(30,110,255,0.45)'; g.lineWidth = n % 10000 ? 1.5 : 3;
    g.beginPath(); g.moveTo(0, px(top - n)); g.lineTo(size, px(top - n)); g.stroke();
    for (let v = Math.ceil(west / 1000) * 1000 + 1000; v < west + span; v += 5000) label(kmDigits(n), px(v - west) + 6, px(top - n) - 2);
  }
  g.textBaseline = 'alphabetic';
}

// MGRS, in the UTM zone of the map's middle, carried across the whole map. Its lines sit at an angle to the national grid the map is
// drawn on, so each goes through points worked out every few km. Each 100 km square is named once, in the middle of what shows of it.
// shortcut: one zone for the whole map, as no pack yet straddles a zone edge; split the lines at the edge if one ever does.
function paintMgrs({ g, west, top, span, px }, data) {
  const STEP = 5000, toGrid = gridFor(data.geo.n0), zone = utmZone(toLatLon(data.geo.e0, data.geo.n0).lon);
  const at = (e, n) => { const { lat, lon } = fromUtm(zone, e, n), p = toGrid(lat, lon); return [px(p.e - west), px(top - p.n)]; };
  const corners = [[west, top], [west + span, top], [west, top - span], [west + span, top - span]].map(([e, n]) => { const c = toLatLon(e, n); return toUtm(c.lat, c.lon, zone); });
  const e0 = Math.floor(Math.min(...corners.map((c) => c.e)) / 1000) * 1000, e1 = Math.max(...corners.map((c) => c.e));
  const n0 = Math.floor(Math.min(...corners.map((c) => c.n)) / 1000) * 1000, n1 = Math.max(...corners.map((c) => c.n));
  if (![e0, e1, n0, n1].every((v) => Number.isFinite(v) && Math.abs(v) < 10000000) ||
      e1 < e0 || n1 < n0 || e1 - e0 > 150000 || n1 - n0 > 150000) {
    throw new Error('This map has invalid MGRS bounds.');
  }
  const along = (from, to) => { const list = []; for (let v = from; v < to; v += STEP) list.push(v); return [...list, to]; };
  const line = (points) => { g.beginPath(); points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
  g.strokeStyle = 'rgba(30,110,255,0.45)'; // faint enough to read the map through, as on a printed one
  for (let e = e0; e <= e1; e += 1000) { g.lineWidth = e % 10000 ? 1.5 : 3; line(along(n0, n1).map((n) => at(e, n))); }
  for (let n = n0; n <= n1; n += 1000) { g.lineWidth = n % 10000 ? 1.5 : 3; line(along(e0, e1).map((e) => at(e, n))); }
  g.font = '600 16px system-ui'; g.textBaseline = 'bottom'; g.lineJoin = 'round';
  for (let e = e0; e <= e1; e += 1000) for (let v = Math.ceil(n0 / 5000) * 5000; v < n1; v += 5000) { const [x, y] = at(e, v); gridLabel(g, kmDigits(e), x + 6, y); }
  for (let n = n0; n <= n1; n += 1000) for (let v = Math.ceil(e0 / 5000) * 5000 + 2000; v < e1; v += 5000) { const [x, y] = at(v, n); gridLabel(g, kmDigits(n), x + 6, y - 2); }
  g.font = '700 28px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let sx = Math.floor(e0 / 100000) * 100000; sx < e1; sx += 100000) {
    for (let sy = Math.floor(n0 / 100000) * 100000; sy < n1; sy += 100000) {
      const e = (Math.max(sx, e0) + Math.min(sx + 100000, e1)) / 2, n = (Math.max(sy, n0) + Math.min(sy + 100000, n1)) / 2, [x, y] = at(e, n);
      gridLabel(g, `${zone}${band(fromUtm(zone, e, n).lat)} ${squareLetters(zone, e, n)}`, x, y);
    }
  }
  g.textAlign = 'start'; g.textBaseline = 'alphabetic';
}

export function createMapTexture(renderer, relief) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const small = document.createElement('canvas');
  small.width = small.height = SMALL;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // the scene's lights dim a map to about two thirds, so some of it is added back as its own light
  const material = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 1, metalness: 0 });
  let painting = 0;

  // Worked out once for each world, as they take a moment and never change.
  let topo = { data: null };
  function topoOf(data) {
    if (topo.data === data) return topo;
    const picture = document.createElement('canvas');
    picture.width = picture.height = data.N;
    picture.getContext('2d').putImageData(new ImageData(topoPixels(data), data.N, data.N), 0, 0);
    topo = { data, picture, lines: contourLines(data) };
    return topo;
  }

  // The last base map, before lines and names: switching those on or off starts again from it rather than decoding every picture again.
  // Kept by the pack's own pictures and features, as the source object around them is made afresh for each paint.
  const base = { canvas: null, data: null, pictures: null, features: null, baseMap: null };
  const isBase = (data, source, baseMap) => base.data === data && base.pictures === source.pictures && base.features === source.features && base.baseMap === baseMap;
  function keepBase(data, source, baseMap) {
    base.canvas ??= Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
    base.canvas.getContext('2d').drawImage(canvas, 0, 0);
    Object.assign(base, { data, pictures: source.pictures, features: source.features, baseMap });
  }

  async function paintBase(f, data, source, baseMap, still, onTile) {
    const { g, west, top, px, size } = f, worldX = px(data.geo.e0 - data.R - west), worldZ = px(top - data.geo.n0 - data.R), world = px(2 * data.R);
    if (baseMap === 'live') return paintLive(f, data, still, onTile);
    g.fillStyle = '#e8e4da'; g.fillRect(0, 0, size, size);
    if (baseMap === 'relief') { g.drawImage(relief(data), worldX, worldZ, world, world); return {}; }
    if (baseMap === 'topo') { g.drawImage(topoOf(data).picture, worldX, worldZ, world, world); return {}; }
    await paintPictures(f, source.pictures, usesSatellite(baseMap) ? 'satellite' : 'osmap', still);
    // only a pack with ground past a border has outlines, and the topography takes about a second to work out
    if (!usesSatellite(baseMap) && still() && source.features?.beyond?.length) paintBeyond(f, data, source.features.beyond, topoOf(data));
    if (RESTYLE[baseMap] && still()) restyle(f, RESTYLE[baseMap]);
    return {};
  }

  // options: { baseMap: 'os' | 'light' | 'dark' | 'satellite' | 'hybrid' | 'topo' | 'relief' | 'live', roads, grid: 'national' | 'mgrs' | false, contours }.
  // Resolves with { failed, total } for a live map, or { stale: true } if a newer choice took over.
  async function paint(data, source, options) {
    const ticket = ++painting, still = () => ticket === painting;
    const f = frameOf(canvas.getContext('2d'), data.geo.e0 - data.R, data.geo.n0 + data.R, 2 * data.R, SIZE);
    const roads = options.roads || options.baseMap === 'hybrid';
    let shown = 0;
    const onTile = () => { // uploading a canvas this size is slow, so not for every tile
      if (performance.now() - shown < TILE_REFRESH_MS) return;
      shown = performance.now();
      texture.needsUpdate = true;
    };
    let layer = {};
    if (isBase(data, source, options.baseMap)) f.g.drawImage(base.canvas, 0, 0);
    else {
      layer = await paintBase(f, data, source, options.baseMap, still, onTile);
      if (!still()) return { stale: true };
      if (options.baseMap !== 'live') keepBase(data, source, options.baseMap); // a live map is fetched again, so missing tiles get another try
    }
    if (options.contours || options.baseMap === 'topo') paintContours(f, topoOf(data).lines, data, options.baseMap, true);
    if (roads) paintRoads(f, source.features, data);
    if (options.grid === 'mgrs') paintMgrs(f, data);
    else if (options.grid) paintGrid(f);
    if (roads) paintNames(f, source.features, data);
    texture.needsUpdate = true;
    small.getContext('2d').drawImage(canvas, 0, 0, SMALL, SMALL);
    return layer;
  }

  // A small picture of each map around the site, for the switcher. The live map has none, as drawing one would tell OpenStreetMap
  // where the site is before the player has chosen to use it.
  async function previews(data, source, ids) {
    const found = {};
    for (const id of ids) {
      if (id === 'live') continue;
      const picture = document.createElement('canvas');
      picture.width = picture.height = PREVIEW;
      const f = frameOf(picture.getContext('2d'), data.geo.e0 - PREVIEW_SPAN / 2, data.geo.n0 + PREVIEW_SPAN / 2, PREVIEW_SPAN, PREVIEW);
      await paintBase(f, data, source, id, () => true);
      if (id === 'topo') paintContours(f, topoOf(data).lines, data, id, false);
      if (id === 'hybrid') paintRoads(f, source.features, data);
      found[id] = picture.toDataURL('image/jpeg', 0.8);
    }
    return found;
  }

  return { material, small, paint, previews };
}
