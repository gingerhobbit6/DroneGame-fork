// Pop-up panes open beside the pane whose button opened them: to the right of the Run panel, or to the left of the Controls panel,
// level with its top, wherever that pane has been dragged. A phone keeps each pane's own place (mobile.css).

import { useLayoutEffect } from 'react';

export const CONTROLS = 'right-col';
// The Run panel, or the sandbox panel beside it while it is open, so a pop-up from the Run panel never covers the sandbox.
export const RUN = () => (document.querySelector('#sandbox:not(.hidden)') ? 'sandbox' : 'hud-top-left');

// Place `el` beside the pane with id `anchor`: `side` 'right' puts its left edge just right of that pane, 'left' its right edge just
// left of it. `stretch` keeps the pane's own bottom (a pane that fills the height), otherwise its height is capped to the screen.
export function placeBeside(el, anchor, side = 'right', { gap = 10, stretch = false, off = false } = {}) {
  if (el && off) { Object.assign(el.style, { left: '', right: '', top: '', bottom: '', maxHeight: '' }); return; } // made bigger: its own CSS
  const a = document.getElementById(typeof anchor === 'function' ? anchor() : anchor)?.getBoundingClientRect();
  if (!el || !a || innerWidth <= 760) return;
  const w = el.offsetWidth, top = Math.max(a.top, 12);
  const left = side === 'right' ? Math.min(a.right + gap, innerWidth - w - 12) : Math.max(12, a.left - gap - w);
  Object.assign(el.style, { left: `${left}px`, right: 'auto', top: `${top}px` });
  if (!stretch) Object.assign(el.style, { bottom: 'auto', maxHeight: `${innerHeight - top - 12}px` });
}

// The same, each time any of `deps` changes, for the pane with id `id`.
export function useBeside(id, anchor, side, deps, opts) {
  useLayoutEffect(() => { placeBeside(document.getElementById(id), anchor, side, opts); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
