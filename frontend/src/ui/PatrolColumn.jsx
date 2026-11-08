// The patrol's column: each vehicle, the system it carries and where it keeps along the route, ahead of the soldiers or behind.
// Changing it rebuilds the patrol on the same route, so it is only open before the first wave. With a deployment pack that has
// vehicles, the column takes only those, each as many times as the pack has less any parked on the map.

import { MAX_ESCORTS, MAX_ESCORT_GAP, MAX_ESCORT_SIDE, MOUNTS, PATROL, PATROL_VEHICLES, STRUCTURES } from '../sim/config/index.js';
import { useGame } from './hooks.js';
import { useAccount } from './account/pack.js';
import { NumberInput } from './NumberInput.jsx';

const carried = (vehicle) => Object.keys(MOUNTS).filter((id) => MOUNTS[id] <= PATROL_VEHICLES[vehicle].carries);

export function PatrolColumn({ patrol, locked }) {
  const game = useGame(), pack = useAccount()?.activeUnit;
  const column = patrol.column, packed = pack?.assets.vehicles.length ? pack.assets.vehicles : null;
  const spare = (id, row) => { // how many more of this vehicle the pack has for the given row (-1 for a new one)
    if (!packed) return Infinity;
    const parked = game.sim.structures.filter((s) => !s.escort && s.def.vehicle === id).length;
    return (packed.find((l) => l.id === id)?.count ?? 0) - parked - column.filter((e, j) => j !== row && e.vehicle === id).length;
  };
  const choices = (row) => Object.keys(PATROL_VEHICLES).filter((id) => id === column[row]?.vehicle || spare(id, row) > 0);
  const added = Object.keys(PATROL_VEHICLES).find((id) => spare(id, -1) > 0); // with a pack, the first it has spare
  const apply = (next) => {
    const refused = game.commands.setPatrol(patrol.route, next); // the plan is kept
    if (refused) game.toast(refused);
    game.bump();
  };
  const live = () => game.sim.getPatrol().column; // read when acting, as the panel may not have redrawn since the last change
  const change = (i, edit) => apply(live().map((e, j) => {
    if (j !== i) return e;
    const next = { ...e, ...edit };
    return carried(next.vehicle).includes(next.system) ? next : { ...next, system: carried(next.vehicle)[0] }; // a smaller vehicle takes a system it can carry
  }));
  if (locked) return <ul className="people-list">{column.map((e, i) => <li key={i}><span>{PATROL_VEHICLES[e.vehicle].name}: {STRUCTURES[e.system].name}, {Math.abs(e.gap)} m {e.gap < 0 ? 'behind' : 'ahead'}{e.side ? `, ${Math.abs(e.side)} m ${e.side < 0 ? 'left' : 'right'}` : ''}</span></li>)}</ul>;
  return (
    <div className="patrol-column">
      <ul className="people-list">
        {column.map((e, i) => (
          <li key={i} data-escort={i}>
            <select aria-label={`Vehicle ${i + 1}`} value={e.vehicle} onChange={(ev) => change(i, { vehicle: ev.target.value })}>
              {choices(i).map((id) => <option key={id} value={id}>{PATROL_VEHICLES[id].name}{packed && spare(id, i) < 1 ? ' (beyond your pack)' : ''}</option>)}
            </select>
            <select aria-label={`What vehicle ${i + 1} carries`} value={e.system} onChange={(ev) => change(i, { system: ev.target.value })}>
              {carried(e.vehicle).map((id) => <option key={id} value={id}>{STRUCTURES[id].name}</option>)}
            </select>
            <NumberInput id={`escort-gap-${i}`} aria-label={`Metres ahead of the soldiers (behind if negative), vehicle ${i + 1}`} value={e.gap} min={-MAX_ESCORT_GAP} max={MAX_ESCORT_GAP} step={5} onCommit={(v) => change(i, { gap: Math.round(v) })} />
            <NumberInput id={`escort-side-${i}`} aria-label={`Metres to the right of the soldiers (left if negative), vehicle ${i + 1}`} value={e.side ?? 0} min={-MAX_ESCORT_SIDE} max={MAX_ESCORT_SIDE} step={5} onCommit={(v) => change(i, { side: Math.round(v) })} />
            {column.length > 1 && <button aria-label={`Remove vehicle ${i + 1}`} title="Remove this vehicle" onClick={() => apply(live().filter((_, j) => j !== i))}>×</button>}
          </li>
        ))}
      </ul>
      <p className="muted">The first figure is metres ahead of the lead soldier, or behind if negative; the second is metres to the right, or left if negative. These are its place in the formation, which it keeps round turns. Weapons halt the patrol to fire; jammers work on the move. A Mule carries light systems, a Hilux medium ones too, and a Patria anything here.</p>
      {packed && <p className="muted">The column takes your pack&apos;s vehicles: {packed.map((l) => `${l.count} ${PATROL_VEHICLES[l.id].name}`).join(', ')}, less any parked on the map.</p>}
      {column.length < MAX_ESCORTS && (added ? <button id="escort-add" onClick={() => apply([...live(), { vehicle: packed ? added : 'mule', system: 'gun_hmg', gap: -PATROL.foot.escortGap * live().length, side: 0 }])}>Add a vehicle</button>
        : <p className="muted">Every vehicle in your pack is in use.</p>)}
    </div>
  );
}
