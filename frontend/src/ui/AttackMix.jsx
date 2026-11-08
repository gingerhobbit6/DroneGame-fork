// Which drones the waves send: tick any mix, grouped by where they come from. Saved with the laydown, and locked once the first
// wave starts, like the laydown.

import { DRONES, THREAT_GROUPS } from '../sim/config/index.js';
import { DEFAULT_MIX, isDefaultMix } from '../sim/attack-mix.js';
import { hex, useGame, useTick } from './hooks.js';
import { Movable } from './Movable.jsx';

// A short name for the mix, for the button that opens this.
export function mixLabel(mix) {
  if (isDefaultMix(mix)) return 'generic types';
  const origins = [...new Set(mix.map((id) => DRONES[id].origin ?? 'Generic'))];
  return `${mix.length} type${mix.length === 1 ? '' : 's'}${origins.length <= 2 ? `, ${origins.join(' and ')}` : ''}`;
}

export function AttackMix({ onClose }) {
  useTick();
  const game = useGame();
  const { sim, commands } = game;
  const mix = sim.state.attack, ticked = new Set(mix), locked = sim.designLocked();
  const set = (ids) => { const problem = commands.setAttack(ids); if (problem) game.toast(problem); };
  const toggle = (id, on) => set(on ? [...mix, id] : mix.filter((x) => x !== id));
  return (
    <Movable id="attack-mix" title="Attack" role="region" aria-label="Which drones attack">
      <div className="up-head">
        <b>Which drones attack</b>
        <button id="attack-close" aria-label="Close" title="Close" onClick={onClose}>×</button>
      </div>
      <p className="note">
        Tick any mix. Waves keep their size and timing, and the drones you tick take turns in the place of their type: first-person-view,
        fibre-optic, fixed-wing or spotter. A type with nothing ticked is filled by your other strike drones, and spotters only come if you tick one.
      </p>
      {locked && <p className="note warn">Locked once the first wave starts, so the run stays comparable.</p>}
      {THREAT_GROUPS.map((group, i) => {
        const n = group.drones.filter((d) => ticked.has(d.id)).length;
        return (
          <details key={group.name} open={i === 0 || n > 0}>
            <summary>{group.name}{n ? ` (${n} ticked)` : ''}</summary>
            {group.drones.map((d) => (
              <label key={d.id} className="am-threat">
                <input type="checkbox" data-attack={d.id} checked={ticked.has(d.id)} disabled={locked} onChange={(e) => toggle(d.id, e.target.checked)} />
                <i style={{ background: hex(d.color) }} />{d.name}
              </label>
            ))}
            <div className="row">
              <button data-attack-all={group.name} disabled={locked} onClick={() => set([...mix, ...group.drones.map((d) => d.id)])}>Tick all of these</button>
              <button data-attack-only={group.name} disabled={locked} onClick={() => set(group.drones.map((d) => d.id))}>Only these</button>
            </div>
          </details>
        );
      })}
      <div className="row">
        <button id="attack-generic" disabled={locked || isDefaultMix(mix)} onClick={() => set(DEFAULT_MIX)}>Back to the generic types</button>
      </div>
    </Movable>
  );
}
