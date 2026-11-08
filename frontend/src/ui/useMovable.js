// Lets a panel be dragged out of the way: spread `handle` on what you drag it by, and `style` and data-movable on the panel.
// A double-click, Home, or the window changing size, sends it back home. The arrow keys move it while the handle has focus.

import { useEffect, useRef, useState } from 'react';

const MARGIN = 12;
const STEPS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// Where a panel goes, kept fully on screen. It is anchored to the nearer edge, so a longer panel grows into the free space.
// It keeps its width, and leaves the column or corner it was laid out in.
export function placed(x, y, box, w, h) {
  const left = Math.max(0, Math.min(x, w - box.width));
  const top = Math.max(0, Math.min(y, h - box.height));
  const bottom = h - top - box.height;
  const across = { position: 'fixed', left, right: 'auto', width: box.width, transform: 'none' };
  return top < bottom
    ? { ...across, top, bottom: 'auto', maxHeight: h - top - MARGIN }
    : { ...across, top: 'auto', bottom, maxHeight: h - bottom - MARGIN };
}

export function useMovable() {
  const [style, setStyle] = useState(null);
  const drag = useRef(null), moved = useRef(false);
  useEffect(() => {
    const home = () => setStyle(null);
    addEventListener('resize', home);
    return () => removeEventListener('resize', home);
  }, []);
  const boxOf = (el) => el.closest('[data-movable]').getBoundingClientRect();
  const handle = {
    onPointerDown(e) {
      const button = e.target.closest('button');
      if (e.button !== 0 || (button && button !== e.currentTarget)) return; // buttons inside the handle still click
      const box = boxOf(e.currentTarget);
      drag.current = { x: e.clientX, y: e.clientY, left: box.left, top: box.top, box };
      moved.current = false;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e) {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!moved.current && Math.hypot(dx, dy) < 4) return; // a click, not a drag
      moved.current = true;
      setStyle(placed(d.left + dx, d.top + dy, d.box, innerWidth, innerHeight));
    },
    onPointerUp() { drag.current = null; },
    onDoubleClick(e) { if (!e.target.closest('button')) setStyle(null); },
    onKeyDown(e) {
      const step = STEPS[e.key];
      if (!step && e.key !== 'Home') return;
      e.preventDefault(); e.stopPropagation(); // not the game's own arrow keys
      if (!step) { setStyle(null); return; }
      const box = boxOf(e.currentTarget), k = e.shiftKey ? 64 : 16;
      setStyle(placed(box.left + step[0] * k, box.top + step[1] * k, box, innerWidth, innerHeight));
    },
  };
  return { style, handle, wasDragged: () => moved.current };
}
