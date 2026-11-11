// The patrol planner: one patrol, dismounted or mounted. Every soldier and vehicle that can carry a system is a marker of the same
// size, standing where it walks or drives in the formation, to scale. Click one to see what it carries and add more from the pack
// (or the catalogue, with no pack). The pack can fill the patrol for you; going beyond it is allowed, with a warning. Every change
// rebuilds the patrol on the same route (sim/patrol.js), so it is only open before the first wave. The working is in patrol-bearers.js.

import { useState } from 'react';
import { ESCORT_CARRIERS, MAX_ESCORTS, MAX_ESCORT_GAP, MAX_ESCORT_SIDE, MOUNTS, PATROL_TYPES, STRUCTURES } from '../sim/config/index.js';
import { FORMATIONS } from '../sim/formation.js';
import { planOf } from '../sim/patrol.js';
import { CORRIDOR } from '../sim/route.js';
import { pounds } from '../sim/economy.js';
import { view } from '../render/view.js';
import { useGame } from './hooks.js';
import { useAccount } from './account/pack.js';
import { Movable } from './Movable.jsx';
import { NumberInput } from './NumberInput.jsx';
import { DEFAULT_SPACING, VEHICLE_SHAPES, bearers, carryProblem, fill, giveTo, overPack, packLeft, relay, takeOff, typeProblem } from './patrol-bearers.js';

const TOKEN = 46, PAD = 54; // marker size and margin, in pixels
const CLASS = { 1: 'light', 2: 'medium', 3: 'heavy' };

// The formation to scale, close enough that no two markers overlap, with a ruler in metres from the lead.
function Formation({ list, plan, selected, onSelect }) {
  if (!list.length) return <p className="muted pp-empty">{plan.type === 'mounted' ? 'No vehicles yet: add one below, or fill the patrol from your pack.' : 'No soldiers in the patrol.'}</p>;
  const near = Math.max(1, plan.type === 'dismounted' && plan.formation === 'staggered' ? plan.spacing / 2 : plan.spacing);
  const px = Math.max(1, (TOKEN + 8) / near);
  const xs = list.map((b) => b.along), ys = list.map((b) => b.across);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const X = (a) => PAD + (maxX - a) * px, Y = (c) => PAD + 14 + (c - minY) * px; // the lead on the left, walking or driving that way
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => s * px >= 56) ?? 200;
  const ticks = [];
  for (let m = Math.ceil(minX / step) * step; m <= maxX; m += step) ticks.push(m);
  return (
    <div className="pp-view" style={{ width: (maxX - minX) * px + 2 * PAD, height: (maxY - minY) * px + 2 * PAD + 14 }}>
      {ticks.map((m) => <span key={m} className="pp-tick" style={{ left: X(m) }}>{m === 0 ? '← lead' : `${m} m`}</span>)}
      {list.map((b) => (
        <button key={b.key} type="button" data-bearer={b.key} className={`pp-bearer ${b.kind}${b.systems.length ? ' carrying' : ''}${selected === b.key ? ' selected' : ''}`}
          style={{ left: X(b.along), top: Y(b.across) }} title={`${b.name}${b.systems.length ? `: ${b.systems.map((id) => STRUCTURES[id].name).join(', ')}` : ''}`}
          aria-label={`${b.name}, carrying ${b.systems.length ? b.systems.map((id) => STRUCTURES[id].name).join(' and ') : 'nothing'}`} onClick={() => onSelect(selected === b.key ? null : b.key)}>
          <b>{b.label}</b><small>{b.systems.length}/{b.slots}</small>
        </button>
      ))}
    </div>
  );
}

// The selected marker: what it carries, and every system that could ride in the patrol, greyed out with the reason where it cannot.
function Bearer({ b, plan, left, locked, change }) {
  const ids = Object.keys(MOUNTS).filter((id) => STRUCTURES[id] && (!left || (left.systems[id] ?? 0) > 0 || b.systems.includes(id)));
  const rows = ids.map((id) => ({ id, why: typeProblem(plan.type, id) || carryProblem(b, id) })).sort((x, y) => !!x.why - !!y.why || MOUNTS[x.id] - MOUNTS[y.id]);
  return (
    <div className="pp-bearer-panel" id="pp-selected">
      <div>
        <b>{b.name}</b>
        <ul className="pp-slots">
          {Array.from({ length: b.slots }, (_, k) => (
            <li key={k} className={b.systems[k] ? 'filled' : ''}>
              {b.systems[k] ? <>{STRUCTURES[b.systems[k]].name}{!locked && (b.kind === 'soldier' || b.systems.length > 1) && <button type="button" data-take-off={k} onClick={() => change(takeOff, b, k)}>Take off</button>}</> : 'Room for a system'}
            </li>
          ))}
        </ul>
        {b.kind === 'vehicle' && !locked && (
          <div className="pp-row">
            <label>Ahead <NumberInput id="pp-gap" aria-label="Metres ahead of the middle (behind if negative)" value={b.along} min={-MAX_ESCORT_GAP} max={MAX_ESCORT_GAP} step={5} onCommit={(v) => change('place', b, { gap: Math.round(v) })} /> m</label>
            <label>Right <NumberInput id="pp-side" aria-label="Metres to the right (left if negative)" value={b.across} min={-MAX_ESCORT_SIDE} max={MAX_ESCORT_SIDE} step={5} onCommit={(v) => change('place', b, { side: Math.round(v) })} /> m</label>
            <button type="button" id="pp-remove-vehicle" onClick={() => change('remove', b)}>Take the vehicle off</button>
          </div>
        )}
      </div>
      {!locked && (
        <ul className="pp-offer" aria-label={`Systems ${b.name} could take`}>
          {rows.map(({ id, why }) => (
            <li key={id} className={why ? 'grey' : ''}>
              <span>{STRUCTURES[id].name}<small>{why ?? `${CLASS[MOUNTS[id]]}${left ? ` · ${Math.max(0, left.systems[id] ?? 0)} in the pack` : ` · ${pounds(STRUCTURES[id].cost)}`}`}</small></span>
              <button type="button" data-give={id} disabled={!!why} onClick={() => change(giveTo, b, id)}>Add</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PatrolPlanner({ patrol, locked, onClose }) {
  const game = useGame(), assets = useAccount()?.activeUnit?.assets;
  const [selected, pick] = useState(() => view.patrolBearer ?? null), [shape, setShape] = useState('column');
  const setSelected = (key) => { view.patrolBearer = key; pick(key); }; // kept in the view, so it survives the panel closing
  const plan = planOf(patrol), soldiers = patrol.group.count, column = patrol.column;
  const left = packLeft(assets, game.sim.structures), over = overPack(column, left);
  const list = bearers(column, plan, soldiers), chosen = list.find((b) => b.key === selected);
  const apply = (next, nextPlan = plan, say) => {
    const refused = game.commands.setPatrol(patrol.route, next, nextPlan);
    if (refused || say) game.toast(refused || say);
    game.bump();
    return !refused;
  };
  const change = (what, b, arg) => {
    if (what === 'remove') { setSelected(null); return apply(column.filter((_, at) => at !== b.index), plan, `${b.name} is off the patrol`); }
    if (what === 'place') return apply(column.map((e, at) => (at === b.index ? { ...e, ...arg } : e)));
    const next = what(column, b, arg);
    return apply(next, plan, what === giveTo ? `${b.name} carries the ${STRUCTURES[arg].name}` : 'Taken off');
  };
  const setPlan = (edit, keepShape = shape) => {
    const next = { ...plan, ...edit };
    const kept = column.filter((e) => PATROL_TYPES[next.type].takes.includes(e.vehicle));
    setSelected(null);
    apply(relay(kept, next, soldiers, keepShape), next, kept.length < column.length ? `${column.length - kept.length} carrier${column.length - kept.length > 1 ? 's' : ''} it does not take went back` : undefined);
  };
  const doFill = () => {
    const { column: next, spare } = fill(plan, soldiers, left, shape);
    setSelected(null);
    apply(next, plan, `Filled from your pack${spare ? `: ${spare} system${spare > 1 ? 's' : ''} could not be carried and stay in the pack` : ''}`);
  };
  const addVehicle = (v) => {
    const first = Object.keys(MOUNTS).find((id) => !typeProblem(plan.type, id) && !carryProblem({ kind: 'vehicle', vehicle: v, systems: [], slots: 3 }, id) && (!left || (left.systems[id] ?? 0) > 0));
    if (!first) { game.toast(`Nothing left in your pack that a ${ESCORT_CARRIERS[v].name} can carry`); return; }
    if (apply(relay([...column, { vehicle: v, system: first, gap: 0, side: 0 }], plan, soldiers, shape), plan, `${ESCORT_CARRIERS[v].name} added with the ${STRUCTURES[first].name}: change it below`)) setSelected(`v${column.length}`);
  };
  const type = PATROL_TYPES[plan.type], vehicles = column.filter((e) => e.vehicle !== 'foot').length;

  return (
    <Movable id="patrol-planner" title="Patrol planner" role="dialog" aria-label="Patrol planner">
      <button type="button" id="patrol-planner-close" aria-label="Close" onClick={onClose}>×</button>
      <div className="pp-row">
        <span>This patrol is</span>
        {['dismounted', 'mounted'].map((t) => (
          <label key={t}><input type="radio" name="pp-type" value={t} checked={plan.type === t} disabled={locked} onChange={() => setPlan({ type: t, spacing: DEFAULT_SPACING[t] })} /> {PATROL_TYPES[t].name}</label>
        ))}
        {type.older && <span className="muted">An older mixed patrol: choose one to plan it here.</span>}
      </div>
      <div className="pp-row">
        {plan.type === 'mounted'
          ? <label>Vehicles in <select id="pp-shape" value={shape} disabled={locked} onChange={(e) => { setShape(e.target.value); setPlan({}, e.target.value); }}>{Object.entries(VEHICLE_SHAPES).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
          : <label>Formation <select id="pp-formation" value={plan.formation} disabled={locked} onChange={(e) => setPlan({ formation: e.target.value })}>{Object.entries(FORMATIONS).map(([id, f]) => <option key={id} value={id}>{f.name}</option>)}</select></label>}
        <label>Spacing <input type="range" id="pp-spacing" min={type.spacing[0]} max={type.spacing[1]} step={1} value={plan.spacing} disabled={locked} onChange={(e) => setPlan({ spacing: Number(e.target.value) })} /> <b>{plan.spacing} m</b> between {plan.type === 'mounted' ? 'vehicles' : 'soldiers'}</label>
        <label>Corridor <NumberInput id="pp-width" aria-label="Corridor width in metres" value={plan.width} min={CORRIDOR.min} max={CORRIDOR.max} step={10} onCommit={(v) => setPlan({ width: Math.round(v) })} /> m</label>
      </div>
      <p className="muted">{plan.type === 'mounted' ? `${soldiers} soldiers ride in the vehicles, which drive the route. Each vehicle carries up to 3 systems, one heavy at most; a THeMIS takes light ones, a Hilux medium ones too.` : `${soldiers} soldiers walk the route. Each can carry 2 hand-held systems, and a THeMIS walks beside them with light ones. Anything bigger needs a mounted patrol, so it is greyed out.`} Weapons halt the patrol to fire.</p>
      <div className="pp-wrap"><Formation list={list} plan={plan} selected={selected} onSelect={setSelected} /></div>
      {!locked && (
        <div className="pp-row">
          {left && <button type="button" id="pp-fill" className="wz-go" onClick={doFill} disabled={type.older}>Fill from the pack</button>}
          <button type="button" id="pp-clear" onClick={() => { setSelected(null); apply([], plan, 'Everything is back in the pack'); }}>Clear and do it myself</button>
          {type.takes.filter((v) => v !== 'foot').map((v) => (
            <button key={v} type="button" data-add-vehicle={v} disabled={vehicles >= MAX_ESCORTS} onClick={() => addVehicle(v)}>Add a {ESCORT_CARRIERS[v].name}{left ? ` (${Math.max(0, (left.vehicles[v] ?? 0) - column.filter((e) => e.vehicle === v).length)} left)` : ''}</button>
          ))}
        </div>
      )}
      {over.length > 0 && <p className="pp-warn" role="status">Beyond your pack: {over.map((o) => `${o.over} ${o.name}`).join(', ')}. Allowed, but your pack does not hold them.</p>}
      {chosen ? <Bearer b={chosen} plan={plan} left={left} locked={locked} change={change} /> : <p className="muted">Click a soldier or vehicle to see what it carries and give it systems.</p>}
    </Movable>
  );
}
