// Any box on screen, with a title bar to drag it by and a button that shrinks it to that bar. With the button focused, the arrow
// keys move it (Shift for bigger steps) and Home puts it back; so does a double-click on the bar. It stays mounted while shrunk,
// so nothing inside loses its place.

import { useState } from 'react';
import { useMovable } from './useMovable.js';
import './movable.css';

export function Movable({ title, className = 'panel', startMin = false, children, ...rest }) {
  const { style, handle } = useMovable();
  const [min, setMin] = useState(startMin);
  return (
    <div className={`${className}${min ? ' minimised' : ''}`} data-movable style={style} {...rest}>
      <div className="mv-bar" title="Drag to move. Double-click, or Home on its button, to put it back." {...handle}>
        <span className="mv-title">{title}</span>
        <button type="button" className="mv-min" aria-expanded={!min} aria-label={`${min ? 'Show' : 'Minimise'} ${title}`} title={min ? 'Show' : 'Minimise'} onClick={() => setMin((m) => !m)} />
      </div>
      {children}
    </div>
  );
}
