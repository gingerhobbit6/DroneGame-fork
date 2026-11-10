// @vitest-environment jsdom
// Replay can place a live label again, and covered frames may never draw. Neither should leave stale label work behind.

import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { createLabels } from '../src/render/labels.js';

const camera = new PerspectiveCamera();
camera.updateMatrixWorld();
const makeLabels = () => createLabels(document.createElement('div'), camera);
const place = (labels, el) => labels.place(el, 0, 0, -5, true);
function tag(cls = 'slabel', x = 0) {
  const el = document.createElement('div');
  el.className = cls;
  el.getBoundingClientRect = vi.fn(() => ({ left: x, top: 0, right: x + 60, bottom: 14 }));
  return el;
}

describe('label frame lifecycle', () => {
  it('keeps a system label placed by both the live view and replay', () => {
    const labels = makeLabels(), el = tag();
    place(labels, el);
    place(labels, el);
    labels.declutter();
    expect(el.style.display).toBe('block');
    expect(el.getBoundingClientRect).toHaveBeenCalledTimes(1);
  });

  it('discards labels from covered frames even when declutter is skipped', () => {
    const labels = makeLabels(), stale = tag(), current = tag();
    for (let frame = 0; frame < 1000; frame++) {
      labels.beginFrame();
      place(labels, stale);
    }
    labels.beginFrame();
    place(labels, current);
    labels.declutter();
    expect(stale.getBoundingClientRect).not.toHaveBeenCalled();
    expect(current.style.display).toBe('block');
  });

  it('measures all labels before hiding overlaps', () => {
    const labels = makeLabels(), first = tag('dlabel'), hidden = tag(), last = tag('slabel', 200);
    last.getBoundingClientRect.mockImplementation(() => {
      expect(hidden.style.display).toBe('block'); // hiding it now would invalidate this layout read
      return { left: 200, top: 0, right: 260, bottom: 14 };
    });
    for (const el of [first, hidden, last]) place(labels, el);
    labels.declutter();
    expect(hidden.style.display).toBe('none');
    expect(first.style.display).toBe('block');
    expect(last.style.display).toBe('block');
  });

  it('does not measure a label hidden by replay after its live placement', () => {
    const labels = makeLabels(), el = tag();
    place(labels, el);
    labels.place(el, 0, 0, -5, false);
    labels.declutter();
    expect(el.getBoundingClientRect).not.toHaveBeenCalled();
    expect(el.style.display).toBe('none');
  });
});
