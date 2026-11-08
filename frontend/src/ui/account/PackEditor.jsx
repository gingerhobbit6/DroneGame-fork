// Building a deployment pack: a unit's name, size and callsign, and the real systems, vehicles and people assigned to it.

import { useState } from 'react';
import { ECHELONS, PEOPLE, PEOPLE_LIMITS, STRUCTURES, TOOLBAR, UNIT_LIMITS, PATROL_VEHICLES } from '../../sim/config/index.js';
import { money } from '../../sim/economy.js';
import { km as kmOf } from '../hooks.js';
import { NumberInput } from '../NumberInput.jsx';
import { UnitField } from '../UnitEditor.jsx';
import { fieldsFor, setSetting, settingValue, unitCost, unitDef } from '../../sim/unit-config.js';
import { TextField, useRequest } from './parts.jsx';
import { bump, describeTotals, packTotals, withSettings } from './pack.js';

const CALLSIGN = /^[A-Za-z0-9][A-Za-z0-9 -]{0,11}$/; // Callsign in backend/app/schemas.py
const km = (m) => kmOf(m, true);

function Stepper({ label, count, onChange }) {
  return (
    <span className="acct-step">
      <button type="button" aria-label={`One fewer ${label}`} disabled={!count} onClick={() => onChange(-1)}>−</button>
      <output aria-label={`${label}: how many`}>{count}</output>
      <button type="button" aria-label={`One more ${label}`} disabled={count >= UNIT_LIMITS.count} onClick={() => onChange(1)}>+</button>
    </span>
  );
}

function Line({ title, detail, price, count, onChange }) {
  return (
    <div className={`acct-line${count ? ' on' : ''}`}>
      <div><b>{title}</b><span>{detail}</span></div>
      {price ? <span className="acct-price">{price}</span> : <span />}
      <Stepper label={title} count={count} onChange={onChange} />
    </div>
  );
}

// The settings every one of a line's systems is placed with: the same fields as a placed system's own panel.
function LineSettings({ id, settings = {}, onChange }) {
  const fields = fieldsFor(id), changed = Object.keys(settings).length;
  if (!fields.length) return null;
  const def = unitDef(id, settings);
  return (
    <details className="acct-settings">
      <summary>Settings for each {STRUCTURES[id].product}{changed ? `: ${changed} changed` : ''}</summary>
      {fields.map((f) => (
        <UnitField key={f.key} field={f} id={id} prefix={`pack-${id}`} value={settingValue(def, f)} changed={settings[f.key] != null}
          onChange={(v) => { const next = { ...settings }; setSetting(next, f, id, v); onChange(next); return settingValue(unitDef(id, next), f); }} />
      ))}
    </details>
  );
}

function People({ groups, onChange }) {
  const set = (i, change) => onChange(groups.map((g, j) => (j === i ? { ...g, ...change } : g)));
  return (
    <fieldset>
      <legend>People: each line is one group, placed together</legend>
      {groups.map((g, i) => (
        <div className="acct-people" key={i}>
          <NumberInput aria-label="People in the group" min={1} max={PEOPLE_LIMITS.perGroup} step={1} value={g.count}
            onCommit={(v) => set(i, { count: Math.min(Math.round(v), PEOPLE_LIMITS.perGroup) })} />
          <select aria-label="Protection" value={g.protection} onChange={(e) => set(i, { protection: e.target.value })}>
            {Object.entries(PEOPLE).map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}
          </select>
          <button type="button" className="acct-ghost danger" aria-label="Remove this group" onClick={() => onChange(groups.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="acct-ghost" disabled={groups.length >= UNIT_LIMITS.peopleGroups} onClick={() => onChange([...groups, { count: 8, protection: 'open' }])}>Add a group of people</button>
    </fieldset>
  );
}

export function PackEditor({ api, pack, onSaved, onCancel }) {
  const [draft, setDraft] = useState(() => structuredClone(pack));
  const { busy, error, setError, run } = useRequest();
  const assets = draft.assets, totals = packTotals(assets);
  const count = (lines, id) => lines.find((l) => l.id === id)?.count ?? 0;
  const setAssets = (change) => setDraft((d) => ({ ...d, assets: { ...d.assets, ...change } }));
  const save = (e) => {
    e.preventDefault();
    const callsign = draft.callsign?.trim() || null;
    if (callsign && !CALLSIGN.test(callsign)) { setError('A callsign is up to 12 letters, digits, spaces or dashes.'); return; }
    if (assets.systems.length > UNIT_LIMITS.lines) { setError(`A pack holds at most ${UNIT_LIMITS.lines} different systems.`); return; }
    const body = { name: draft.name.trim(), echelon: draft.echelon, callsign, assets };
    run(async () => onSaved(await (draft.id ? api.units.replace(draft.id, body) : api.units.create(body))));
  };
  return (
    <form className="acct-box" onSubmit={save} aria-label="Deployment pack">
      <h3>{draft.id ? 'Edit deployment pack' : 'New deployment pack'}<button type="button" className="acct-ghost" onClick={onCancel}>Cancel</button></h3>
      <div className="acct-three">
        <TextField label="Unit name" hint="Such as 2 Troop, 12 Regiment RA" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} required maxLength={100} autoFocus />
        <label className="acct-field">Size
          <select value={draft.echelon} onChange={(e) => setDraft({ ...draft, echelon: e.target.value })}>
            {Object.entries(ECHELONS).map(([id, e]) => <option key={id} value={id}>{e.name}</option>)}
          </select>
        </label>
        <TextField label="Callsign" hint="Optional" value={draft.callsign ?? ''} onChange={(callsign) => setDraft({ ...draft, callsign })} maxLength={12} />
      </div>
      <div className="acct-editor">
        <div>
          <fieldset>
            <legend>Sensors and effectors: real systems, from the game&apos;s catalogue</legend>
            {TOOLBAR.map((group) => (
              <div key={group.kind}>
                <p className="acct-kind">{group.name}</p>
                <div className="acct-lines">
                  {group.classes.map((id) => {
                    const def = STRUCTURES[id], line = assets.systems.find((l) => l.id === id);
                    return (
                      <div key={id}>
                        <Line title={def.product} detail={`${def.role === 'sensor' ? 'Sensor' : 'Effector'} · ${km(unitDef(id, line?.settings).range)}${def.shotCost ? ` · ${money(def.shotCost)} a shot` : ''}`}
                          price={money(unitCost(id, line?.settings))} count={line?.count ?? 0} onChange={(by) => setAssets({ systems: bump(assets.systems, id, by) })} />
                        {line && <LineSettings id={id} settings={line.settings} onChange={(s) => setAssets({ systems: withSettings(assets.systems, id, s) })} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </fieldset>
          <fieldset>
            <legend>Vehicles</legend>
            <div className="acct-lines">
              {Object.entries(PATROL_VEHICLES).map(([id, v]) => (
                <Line key={id} title={v.name} detail={v.desc} count={count(assets.vehicles, id)} onChange={(by) => setAssets({ vehicles: bump(assets.vehicles, id, by) })} />
              ))}
            </div>
          </fieldset>
          <People groups={assets.people} onChange={(people) => setAssets({ people })} />
        </div>
        <aside className="acct-sum">
          <dl>
            <dt>Sensors</dt><dd>{totals.sensors}</dd>
            <dt>Effectors</dt><dd>{totals.effectors}</dd>
            <dt>Vehicles</dt><dd>{totals.vehicles}</dd>
            <dt>People</dt><dd>{totals.people}</dd>
            <dt>Systems cost</dt><dd>{money(totals.cost)}</dd>
          </dl>
          <p className="acct-muted">{describeTotals(totals)}. With a pack deployed the budget is no limit: the pack and the magazines are, and the cost shows in the end-of-deployment report.</p>
          {error && <p className="acct-error" role="alert">{error}</p>}
          <button className={`acct-go${busy ? ' busy' : ''}`} disabled={busy || !draft.name.trim()}>{busy ? 'Saving' : 'Save pack'}</button>
        </aside>
      </div>
    </form>
  );
}
