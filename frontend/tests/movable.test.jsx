// @vitest-environment jsdom
// Every box can be dragged by its title bar, moved with the arrow keys, sent home, and shrunk to its bar without losing its place.

import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Movable } from '../src/ui/Movable.jsx';
import { placed } from '../src/ui/useMovable.js';

const $ = (sel) => document.querySelector(sel);
afterEach(cleanup);

function Counter() {
  const [n, setN] = useState(0);
  return <button id="count" onClick={() => setN(n + 1)}>{n}</button>;
}
const box = () => render(<Movable id="box" title="Box"><Counter /></Movable>);

describe('a movable box', () => {
  it('shrinks to its bar and back, keeping what is inside', () => {
    box();
    fireEvent.click($('#count'));
    const min = $('#box .mv-min');
    expect(min.getAttribute('aria-label')).toBe('Minimise Box');
    fireEvent.click(min);
    expect($('#box').className).toContain('minimised');
    expect(min.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(min);
    expect($('#box').className).not.toContain('minimised');
    expect($('#count').textContent).toBe('1'); // still mounted while shrunk
  });

  it('drags by its bar, and a double-click sends it home', () => {
    box();
    const bar = $('#box .mv-bar');
    fireEvent.pointerDown(bar, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(bar, { clientX: 210, clientY: 110 });
    fireEvent.pointerUp(bar);
    expect($('#box').style.left).toBe('200px');
    expect($('#box').style.position).toBe('fixed');
    fireEvent.doubleClick(bar);
    expect($('#box').style.left).toBe('');
  });

  it('moves with the arrow keys on its button, further with Shift, and Home puts it back', () => {
    box();
    const min = $('#box .mv-min');
    fireEvent.keyDown(min, { key: 'ArrowRight' });
    expect($('#box').style.left).toBe('16px');
    fireEvent.keyDown(min, { key: 'ArrowDown', shiftKey: true });
    expect($('#box').style.top).toBe('64px');
    fireEvent.keyDown(min, { key: 'Home' });
    expect($('#box').style.left).toBe('');
  });
});

describe('placed', () => {
  it('keeps a box on screen, anchored to the nearer edge', () => {
    const b = { width: 300, height: 200 };
    expect(placed(-50, 10, b, 1000, 800)).toMatchObject({ left: 0, top: 10, bottom: 'auto', width: 300 });
    expect(placed(900, 700, b, 1000, 800)).toMatchObject({ left: 700, top: 'auto', bottom: 0 });
  });
});
