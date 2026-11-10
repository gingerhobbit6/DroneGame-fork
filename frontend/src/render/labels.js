// Name tags: HTML labels pinned over points in the 3D scene.

import { Vector3 } from 'three';

export const hexCss = (c) => '#' + c.toString(16).padStart(6, '0');
// Labels are redrawn every frame: writing an unchanged value still replaces the text node or restyles the element, so only changes are written.
export const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
export const setStyle = (el, key, value) => { if (el.style[key] !== value) el.style[key] = value; };

// Which tag wins where two overlap: the selected system or drone, then drones, then tracks, then systems and people.
const rank = (el) => (el.classList.contains('selected') ? 0 : el.classList.contains('dlabel') ? 1 : el.classList.contains('tlabel') ? 2 : 3);
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export function createLabels(layer, camera) {
  const p = new Vector3();
  const shown = new Set(); // replay may place a live tag again, so keep each element only once
  return {
    beginFrame() { shown.clear(); }, // drawing may be skipped while the profile covers the scene
    make(text, colour, cls) {
      const el = document.createElement('div');
      el.className = cls; el.textContent = text; el.style.borderColor = colour;
      layer.appendChild(el);
      return el;
    },
    place(el, x, y, z, show, dx = 0) { // dx: pixels to the right of the point
      p.set(x, y, z).project(camera);
      if (!show || p.z >= 1) { setStyle(el, 'display', 'none'); return; }
      setStyle(el, 'display', 'block');
      setStyle(el, 'left', ((p.x + 1) / 2) * innerWidth + dx + 'px');
      setStyle(el, 'top', ((1 - p.y) / 2) * innerHeight + 'px');
      shown.add(el);
    },
    // Hides each tag that would cover one that ranks above it, so a cluster of systems or drones shows a few readable tags and
    // the symbols under them, not a pile of tags. Measure every rectangle before changing display, to avoid repeated layouts.
    declutter() {
      const placed = [...shown].filter((el) => el.style.display !== 'none').sort((a, b) => rank(a) - rank(b));
      shown.clear();
      const measured = placed.map((el) => ({ el, rect: el.getBoundingClientRect() }));
      const kept = [], hidden = [];
      for (const { el, rect } of measured) {
        if (kept.some((k) => overlaps(rect, k))) hidden.push(el);
        else kept.push(rect);
      }
      for (const el of hidden) setStyle(el, 'display', 'none');
    },
  };
}
