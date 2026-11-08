// The patrol's corridor width and its soldiers' formation, before the first wave, and where it is and what the enemy knows once it
// is walking. Changing either rebuilds the patrol on the same route, like the column.

import { PATROL } from '../sim/config/index.js';
import { FORMATIONS } from '../sim/formation.js';
import { planOf } from '../sim/patrol.js';
import { CORRIDOR } from '../sim/route.js';
import { useGame } from './hooks.js';
import { NumberInput } from './NumberInput.jsx';

const PHASE = { home: 'At the start, waiting for the next wave', out: 'Walking out', end: 'Waiting at the end', back: 'Walking back' };

function status(sim, p) {
  const where = p.halted ? 'Halted to fire' : PHASE[p.phase];
  const fix = p.fix ? `the enemy's last fix is ${Math.round(sim.state.time - p.fix.t)} s old` : 'the enemy has no fix on it yet';
  return `${where}, ${p.trips} trip${p.trips === 1 ? '' : 's'} done; ${fix}.`;
}

export function PatrolPlan({ patrol, locked }) {
  const game = useGame();
  if (locked) return <p id="patrol-status">{status(game.sim, patrol)}</p>;
  const apply = (edit) => {
    const p = game.sim.getPatrol(), refused = game.commands.setPatrol(p.route, p.column, { ...planOf(p), ...edit });
    if (refused) game.toast(refused);
    game.bump();
  };
  return (
    <div className="patrol-plan">
      <label>Corridor <NumberInput id="patrol-width" aria-label="Corridor width in metres" value={patrol.width} min={CORRIDOR.min} max={CORRIDOR.max} step={10} onCommit={(v) => apply({ width: Math.round(v) })} /> m wide</label>
      <label>Formation{' '}
        <select id="patrol-formation" value={patrol.formation} onChange={(e) => apply({ formation: e.target.value })}>
          {Object.entries(FORMATIONS).map(([id, f]) => <option key={id} value={id} title={f.desc}>{f.name}</option>)}
        </select>
      </label>
      <p className="muted">{patrol.group.count} soldiers, {PATROL.foot.spacing} m apart. They walk to the end, wait {PATROL.foot.endDelay} s, and walk back. Static systems from the toolbar stand anywhere inside the corridor.</p>
    </div>
  );
}
