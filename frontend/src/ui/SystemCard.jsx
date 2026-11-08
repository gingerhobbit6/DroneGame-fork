// One real system in a list, to drag onto the map or click and then click the map. A div, not a button, because Firefox will not
// start a drag from a button.

import { DRONES, STRUCTURES } from '../sim/config/index.js';
import { money } from '../sim/economy.js';
import { reachFor } from '../sim/site-range.js';
import { unitDef } from '../sim/unit-config.js';
import { DRAG_TYPE } from '../drag.js';
import { useGame } from './hooks.js';

const km = (m) => `${(m / 1000).toFixed(1)} km`;
// A sensor's range is against a small drone: the second figure shows how much further it sees a large one. A missile cannot engage
// anything closer than its minimum range.
export const reachText = (def) => (def.role === 'sensor' ? `${km(def.range)} small drone · ${km(reachFor(def, DRONES.spotter))} large`
  : def.minRange ? `${km(def.minRange)} to ${km(def.range)}` : km(def.range));

// Starts a drag of `item` ({ system } or { people }), so the map can place it where it is let go.
export function dragProps(game, item, enabled = true) {
  if (!enabled) return { draggable: false };
  return {
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(item)); e.dataTransfer.effectAllowed = 'copy'; game.startDrag(item); },
    onDragEnd: () => game.endDrag(),
  };
}

export const onKeys = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

export function SystemCard({ id, pressed, onPick, children, className = '', disabled = false }) {
  const game = useGame();
  const def = unitDef(id, game.loadoutFor(id)), c = STRUCTURES[id];
  const poor = game.sim.state.budget < def.cost;
  return (
    <div role="button" tabIndex={0} data-pick={id} aria-pressed={pressed} aria-disabled={disabled || undefined}
      className={`pick-card${poor ? ' poor' : ''}${className ? ` ${className}` : ''}`}
      title={`Drag ${c.product} onto the map, or click it and then click the map`}
      onClick={onPick} onKeyDown={onKeys(onPick)} {...dragProps(game, { system: id }, !disabled)}>
      <b>{c.product}</b><span className="pick-price">{money(def.cost)}</span>
      <span>{reachText(def)}{c.shotCost ? ` · ${money(c.shotCost)}/shot` : ''}</span>
      <span className="muted">{c.ref.confidence}</span>
      {children}
    </div>
  );
}

// The heading of a list beside the toolbar, coloured like its systems, with a button that closes it.
export function PanelHead({ title, color, onHide }) {
  return (
    <div className="up-head" style={{ borderLeftColor: `#${color.toString(16).padStart(6, '0')}` }}>
      <b>{title}</b>
      <button id="picker-close" aria-label="Close this list" title="Close this list" onClick={onHide}>×</button>
    </div>
  );
}
