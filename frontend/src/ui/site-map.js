// The map on the start screen, drawn by Leaflet: pan and zoom, click where to defend, and see what this computer already has.
// Leaflet stays here, as it draws flat tiles in the page. The game's 3D ground has its own map (render/map-texture.js).

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { WORLD } from '../sim/config/index.js';
import { parseGridRef } from '../sim/bng.js';
import { fromLatLon, onGrid, toLatLon } from '../sim/grids.js';
import { ESTONIA } from '../sim/lest97.js';
import { BUILT_HALF } from '../sim/world-pack.js';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// EOxCloudless is free for non-commercial use only (CC BY-NC-SA 4.0), so it must go if this app ever makes money.
const EOX = 'https://tiles.maps.eox.at/wmts/1.0.0';
const EOX_OPTIONS = { maxNativeZoom: 14, maxZoom: 19, attribution: '<a href="https://cloudless.eox.at" target="_blank" rel="noopener noreferrer">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)' };
const OSM_CREDIT = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
const satelliteTiles = () => L.tileLayer(`${EOX}/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg`, EOX_OPTIONS);
const labelTiles = () => L.tileLayer(`${EOX}/overlay_bright_3857/default/g/{z}/{y}/{x}.png`, { maxZoom: 19, attribution: `Labels: ${OSM_CREDIT}, rendering © EOX` });
const WORLD_VIEW = [48, 5], WORLD_ZOOM = 2;
const CHOICE_KEY = 'site-guard-start-map';
const PICTURE = 1024; // pixels across a pack's offline picture
export const NO_LIVE_MAP = 'No live map';
export const MAP_STYLES = ['Street', 'Light', 'Dark', 'Satellite', 'Hybrid', NO_LIVE_MAP];
const CLOSE_ENOUGH = 9; // a zoom where the world's square can be seen
const NAMES_FROM = 8, LETTERS_FROM = 5; // further out, a pack's name would cover its square, and square letters would pile up

// The same colours as .site-legend in map-panel.css.
const PACK = '#1f6fd6', LIDAR = '#12b886', OS = '#f08c00', SITE = '#e53935';
const OS_SQUARE = 100000;

const onMap = (e, n) => { const { lat, lon } = toLatLon(e, n); return [lat, lon]; };
const square = (e, n, half) => [onMap(e - half, n + half), onMap(e + half, n + half), onMap(e + half, n - half), onMap(e - half, n - half)];
const outline = (corners, options) => L.polygon(corners, { interactive: false, ...options }); // a click must reach the map through it

// Names can come from an imported pack file, so they go on the map as text, never HTML.
function asText(text) {
  const content = document.createElement('span');
  content.textContent = text;
  return content;
}
const label = (text, where, className = '') => L.tooltip({ permanent: true, direction: 'center', className: `map-tag ${className}` }).setLatLng(where).setContent(asText(text));

function remembered(storage) { try { return storage?.getItem(CHOICE_KEY); } catch { return null; } }
function remember(storage, name) { try { storage?.setItem(CHOICE_KEY, name); } catch { /* only a convenience */ } }

// One pack's pictures as a single image. shortcut: laid straight on the map, so it sits up to about 1.5 degrees off true in the far east and west of Britain. Fine for choosing a spot, because a click is converted from its real latitude and longitude.
async function packPicture(decoded, layer) {
  const { header } = decoded.pack, west = header.east - header.half, top = header.north + header.half, k = PICTURE / (2 * header.half);
  const paper = document.createElement('canvas');
  paper.width = paper.height = PICTURE;
  const g = paper.getContext('2d');
  if (!g) return null;
  for (const p of decoded.pictures.filter((x) => x.layer === layer)) {
    const w = Math.ceil(p.width * k), h = Math.ceil(p.height * k);
    const bitmap = await createImageBitmap(p.blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' });
    g.drawImage(bitmap, (p.west - west) * k, (top - p.top) * k, w, h);
    bitmap.close();
  }
  return paper.toDataURL('image/jpeg', 0.8);
}

// onPick({ e, n }) hears about a click on the map, and onChange(state()) about a change of style or layers.
export function createSiteMap(container, { onPick, onChange = () => {}, storage = globalThis.localStorage }) {
  const map = L.map(container, { minZoom: 2, maxZoom: 18, worldCopyJump: true }).setView(WORLD_VIEW, WORLD_ZOOM);
  const tiles = (className) => L.tileLayer(TILES, {
    className, maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', // OSM's tile policy asks for a referrer, and the page's own policy sends none
    attribution: OSM_CREDIT,
  });
  const satellite = satelliteTiles(), hybridPhoto = satelliteTiles(), hybridLabels = labelTiles();
  const street = tiles(''), light = tiles('tile-light'), dark = tiles('tile-dark');
  const bases = { Street: street, Light: light, Dark: dark, Satellite: satellite, Hybrid: L.layerGroup([hybridPhoto, hybridLabels]), [NO_LIVE_MAP]: L.layerGroup() };
  const packs = [], drawn = new Set(); // summaries are enough to draw the map outlines
  const offline = { osmap: L.layerGroup(), satellite: L.layerGroup() };
  const layers = { packs: L.layerGroup().addTo(map), lidar: L.layerGroup().addTo(map), downloads: L.layerGroup().addTo(map), ...offline };
  let style = bases[remembered(storage)] ? remembered(storage) : 'Street';
  let picturePack = null, pictureEpoch = 0;

  const state = () => ({ style, layers: Object.fromEntries(Object.entries(layers).map(([name, group]) => [name, map.hasLayer(group)])) });
  function setLayer(name, on) {
    if (on) layers[name].addTo(map); else layers[name].remove();
    onChange(state());
  }

  // Pictures are only made once they are asked for, as they take a moment.
  async function fill(layer, decoded, epoch) {
    const url = await packPicture(decoded, layer);
    if (!url || epoch !== pictureEpoch) return;
    const { header } = decoded.pack, corners = square(header.east, header.north, header.half);
    offline[layer].addLayer(L.imageOverlay(url, L.latLngBounds(corners)));
  }
  const opened = new Set();
  for (const layer of Object.keys(offline)) {
    offline[layer].on('add', () => {
      if (opened.has(layer)) return;
      opened.add(layer);
      if (picturePack) fill(layer, picturePack, pictureEpoch);
    });
  }

  const showOffline = () => { if (!map.hasLayer(offline.osmap)) setLayer('osmap', true); };
  bases[style].addTo(map);
  if (style === NO_LIVE_MAP) showOffline();
  for (const layer of [street, light, dark, satellite, hybridPhoto, hybridLabels]) layer.once('tileerror', showOffline); // no internet: the packs still show
  map.on('click', ({ latlng }) => { const { lat, lng } = latlng.wrap(); onPick({ ...fromLatLon(lat, lng), lat, lon: lng }); }); // markElsewhere() needs lat and lon for a spot off the grid

  const labelsForZoom = () => {
    container.classList.toggle('map-near', map.getZoom() >= NAMES_FROM);
    container.classList.toggle('map-far', map.getZoom() < LETTERS_FROM);
  };
  map.on('zoomend', labelsForZoom);
  labelsForZoom();
  let marks = [], refused = null;
  const setPictures = (decoded) => {
    if (picturePack === decoded) return;
    picturePack = decoded;
    pictureEpoch++;
    for (const group of Object.values(offline)) group.clearLayers();
    if (decoded) for (const layer of opened) fill(layer, decoded, pictureEpoch);
  };
  return {
    map,
    state,
    setLayer,
    setPictures,
    setStyle(name) {
      if (!bases[name] || name === style) return;
      bases[style].remove();
      bases[name].addTo(map);
      style = name;
      remember(storage, name);
      if (name === NO_LIVE_MAP) showOffline();
      onChange(state());
    },
    showWorld() { map.setView(WORLD_VIEW, WORLD_ZOOM); },
    showLoaded() {
      if (packs.length) map.fitBounds(L.latLngBounds(packs.flatMap((h) => square(h.east, h.north, h.half))).pad(0.2));
    },
    // Show where a map pack can be used, and how much of it has lidar heights. Far out a 30 km square is too small to see or
    // click, so a dot of a fixed size stands in for it, and clicking the dot goes there.
    addPack(entry) {
      const header = entry.pack?.header || entry;
      const { east, north, half, lidarHalf = 0, name } = header;
      if (![east, north, half, lidarHalf].every(Number.isSafeInteger) || !onGrid(east, north) || half <= 0 || half > 40000 || lidarHalf < 0 || lidarHalf > half) return;
      const key = entry.hash || entry.pack?.hash || entry.pack?.header?.gridsSha256 || entry;
      if (drawn.has(key)) return;
      drawn.add(key);
      packs.push(header);
      outline(square(east, north, half), { color: PACK, weight: 2, fillOpacity: 0.08 }).addTo(layers.packs);
      if (lidarHalf) outline(square(east, north, lidarHalf), { color: LIDAR, weight: 1, fillColor: LIDAR, fillOpacity: 0.2 }).addTo(layers.lidar);
      label(String(name || 'Map pack').slice(0, 80), onMap(east, north + half), 'map-tag-name').addTo(layers.packs);
      L.circleMarker(onMap(east, north), { radius: 7, color: '#fff', weight: 2, fillColor: PACK, fillOpacity: 1, className: 'pack-dot', bubblingMouseEvents: false })
        .bindTooltip(asText(String(name || 'Map pack').slice(0, 80))).on('click', () => onPick({ e: east, n: north })).addTo(layers.packs);
      if (entry.pack) setPictures(entry); // direct callers may supply a decoded pack
    },
    // Show what is already on this computer: 100 km squares of OS data, { squares: ['SU', ...] }, and Estonia's national files.
    showDownloads(downloads) {
      layers.downloads.clearLayers();
      for (const letters of downloads?.squares || []) {
        const corner = parseGridRef(letters);
        if (!corner) continue;
        const e = corner.e + OS_SQUARE / 2, n = corner.n + OS_SQUARE / 2;
        outline(square(e, n, OS_SQUARE / 2), { color: OS, weight: 1, dashArray: '3 5', fillOpacity: 0.04 }).addTo(layers.downloads).bringToBack();
        label(letters, onMap(e, n), 'map-tag-faint').addTo(layers.downloads);
      }
      if (downloads?.estonia?.heights) {
        const { west, east, south, north } = ESTONIA;
        outline([onMap(west, north), onMap(east, north), onMap(east, south), onMap(west, south)], { color: OS, weight: 1, dashArray: '3 5', fillOpacity: 0.04 }).addTo(layers.downloads).bringToBack();
      }
    },
    // Mark the start point: { e, n }. planned shows the map that building there would make, and move brings it into view, which a
    // choice the player did not make leaves alone.
    show(point, { planned = false, move = true } = {}) {
      marks.forEach((mark) => mark.remove());
      marks = [];
      if (!point) return;
      const world = outline(square(point.e, point.n, WORLD.radius), { color: SITE, weight: 2, fillOpacity: 0.06 }).addTo(map);
      marks.push(world, L.circleMarker(onMap(point.e, point.n), { radius: 5, color: SITE, fillOpacity: 1, interactive: false }).addTo(map));
      if (planned) marks.push(outline(square(Math.floor(point.e / 1000) * 1000, Math.floor(point.n / 1000) * 1000, BUILT_HALF), { color: SITE, weight: 1, dashArray: '6 5', fill: false }).addTo(map));
      if (move && (map.getZoom() < CLOSE_ENOUGH || !map.getBounds().contains(world.getBounds()))) map.fitBounds(world.getBounds().pad(planned ? 1 : 0.5));
    },
    // Mark a spot these maps do not cover, { lat, lon }, leaving any start point as it is.
    markElsewhere(point) {
      refused?.remove();
      refused = point && L.circleMarker([point.lat, point.lon], { radius: 6, color: '#8a94a6', fillOpacity: 0.6, interactive: false }).addTo(map);
      if (point) map.panTo([point.lat, point.lon]);
    },
    remove() { pictureEpoch++; map.remove(); },
  };
}
