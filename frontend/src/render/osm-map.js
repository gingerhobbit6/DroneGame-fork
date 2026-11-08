// A demo map picture: live OpenStreetMap tiles laid over the ground. It only changes what the ground looks like. Heights, trees,
// buildings and the rules all stay as generated, so the map does not match them.
// shortcut: a fixed area and one zoom, needing internet, and the picture does not affect sight lines. Real map packs replace this (docs/REAL_MAPPING_PLAN.md).

import * as THREE from 'three';
import { WORLD } from '../sim/config/index.js';

export const OSM = { lat: 51.42, lon: -1.73, zoom: 12, halfMetres: WORLD.radius, canvas: 2400, // zoom 12: about 9 x 9 tiles across 54 km
  url: 'https://tile.openstreetmap.org' };
const FULL_ROUND = 156543.03392; // metres per pixel at the equator, at zoom 0, for 256 px tiles

// The tiles that cover the square, and where each one goes on a canvas of `size` pixels.
export function tilesFor({ lat, lon, zoom, halfMetres, canvas: size }) {
  const scale = 256 * 2 ** zoom;
  const px = ((lon + 180) / 360) * scale;
  const rad = (lat * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale;
  const half = halfMetres / ((FULL_ROUND * Math.cos(rad)) / 2 ** zoom); // pixels at this latitude
  const k = size / (2 * half);
  const tiles = [];
  for (let y = Math.floor((py - half) / 256); y <= Math.floor((py + half) / 256); y++) {
    for (let x = Math.floor((px - half) / 256); x <= Math.floor((px + half) / 256); x++) {
      tiles.push({ x, y, zoom, left: (x * 256 - (px - half)) * k, top: (y * 256 - (py - half)) * k, size: 256 * k });
    }
  }
  return tiles;
}

export function createOsmMap(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = OSM.canvas;
  const g = canvas.getContext('2d');
  g.fillStyle = '#e8e4da'; g.fillRect(0, 0, OSM.canvas, OSM.canvas);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // the scene's lights dim a map, so some of it is added back as its own light
  const material = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 1, metalness: 0 });
  let loading = null;

  function fetchTile(tile) {
    return new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.referrerPolicy = 'strict-origin-when-cross-origin'; // OSM's tile policy asks for a referrer, and the page's own policy sends none
      image.onload = () => { g.drawImage(image, tile.left, tile.top, tile.size, tile.size); resolve(true); };
      image.onerror = () => resolve(false);
      image.src = `${OSM.url}/${tile.zoom}/${tile.x}/${tile.y}.png`;
    });
  }

  // Resolves with how many tiles failed, out of how many. Tiles stay cached by the browser, and each is asked for once per page.
  function load() {
    if (!loading) {
      const tiles = tilesFor(OSM);
      loading = Promise.all(tiles.map(fetchTile)).then((results) => {
        texture.needsUpdate = true;
        const failed = results.filter((ok) => !ok).length;
        if (failed) loading = null; // the next try can fetch them again
        return { failed, total: tiles.length };
      });
    }
    return loading;
  }

  return { canvas, material, load };
}
