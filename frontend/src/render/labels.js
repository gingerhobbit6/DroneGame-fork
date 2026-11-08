// Name tags: HTML labels pinned over points in the 3D scene.

import { Vector3 } from 'three';

export const hexCss = (c) => '#' + c.toString(16).padStart(6, '0');
// Labels are redrawn every frame: writing an unchanged value still replaces the text node or restyles the element, so only changes are written.
export const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const setStyle = (el, key, value) => { if (el.style[key] !== value) el.style[key] = value; };

export function createLabels(layer, camera) {
  const p = new Vector3();
  return {
    make(text, colour, cls) {
      const el = document.createElement('div');
      el.className = cls; el.textContent = text; el.style.borderColor = colour;
      layer.appendChild(el);
      return el;
    },
    place(el, x, y, z, show) {
      p.set(x, y, z).project(camera);
      if (!show || p.z >= 1) { setStyle(el, 'display', 'none'); return; }
      setStyle(el, 'display', 'block');
      setStyle(el, 'left', ((p.x + 1) / 2) * innerWidth + 'px');
      setStyle(el, 'top', ((1 - p.y) / 2) * innerHeight + 'px');
    },
  };
}
