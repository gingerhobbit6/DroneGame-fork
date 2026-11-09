// Try attacks against the laydown without risking the site.

import { useState } from 'react';
import { THREAT_GROUPS } from '../sim/config/index.js';
import { money } from '../sim/economy.js';
import { clamp } from '../sim/units.js';
import { hex, useGame, useTick } from './hooks.js';
import { useMovable } from './useMovable.js';

const COMPASS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
const LEVELS = [1, 2, 3, 4, 5, 6, 8, 10];
const START_COUNT = '3', MAX_COUNT = 30;
const howMany = (n) => clamp(Math.round(Number(n) || 1), 1, MAX_COUNT);

// One threat: tick it to add it to the attack, then say how many.
function ThreatRow({ drone, count, onCount }) {
  return (
    <div className="sb-threat">
      <label>
        <input type="checkbox" data-threat={drone.id} checked={count != null} onChange={(e) => onCount(e.target.checked ? START_COUNT : null)} />
        <i style={{ background: hex(drone.color) }} />{drone.name}
      </label>
      {count != null && <input type="number" data-count={drone.id} min="1" max={MAX_COUNT} aria-label={`How many ${drone.name}`} value={count} onChange={(e) => onCount(e.target.value)} />}
    </div>
  );
}

export function Sandbox() {
  useTick();
  const { sim, commands } = useGame();
  const { state, drones } = sim;
  const { style, handle } = useMovable();
  const [mix, setMix] = useState({ fpv: START_COUNT }); // drone type -> how many, for the types ticked
  const [form, setForm] = useState({ dir: '0', gap: '4' });
  const [small, setSmall] = useState(false); // shrunk to its title and live figures, to watch an attack
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setCount = (id, n) => setMix(({ [id]: _, ...rest }) => (n == null ? rest : { ...rest, [id]: n }));
  const tickAll = (group) => setMix((m) => ({ ...Object.fromEntries(group.drones.map((d) => [d.id, START_COUNT])), ...m })); // counts already typed stay
  const total = Object.values(mix).reduce((sum, n) => sum + howMany(n), 0);
  const launch = () => Object.entries(mix).forEach(([type, n]) => commands.launchSandboxAttack({
    type, bearingDeg: form.dir, count: howMany(n), gap: Math.max(Number(form.gap) || 0, 0),
  }));
  return (
    <>
      <div id="sandbox" className={`panel${state.sandbox ? '' : ' hidden'}`} data-movable style={style}>
        <button id="sb-minimise" aria-expanded={!small} aria-label={small ? 'Expand the sandbox panel' : 'Minimise the sandbox panel'} title={small ? 'Expand' : 'Minimise'} onClick={() => setSmall(!small)}>{small ? '▢' : '–'}</button>
        <h3 title="Drag to move. Double-click to put it back." {...handle}>SANDBOX</h3>
        {state.sandbox && !small && <>{/* hidden outside the sandbox, so its rows need not re-render every refresh */}
        <div className="note">Attack your laydown without consequences: the site and your systems cannot be damaged and shots are free. Leaving resets the run and keeps your laydown, so you can still place and wire systems here.</div>
        <label>Enemy has adapted to wave{' '}
          <select id="sb-level" value={state.sbLevel} onChange={(e) => commands.setSandboxLevel(Number(e.target.value))}>
            {LEVELS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="row"><button id="sb-wave" className="primary" onClick={() => commands.launchSandboxWave()}>Launch that wave's attack</button></div>
        <div className="label" style={{ marginTop: 8 }}>CUSTOM ATTACK: TICK ANY MIX OF THREATS</div>
        {THREAT_GROUPS.map((group, i) => {
          const ticked = group.drones.filter((d) => mix[d.id] != null).length;
          return (
            <details key={group.name} open={i === 0}>
              <summary>{group.name}{ticked ? ` (${ticked} ticked)` : ''}</summary>
              {group.drones.map((d) => <ThreatRow key={d.id} drone={d} count={mix[d.id]} onCount={(n) => setCount(d.id, n)} />)}
              <div className="row"><button data-tick-all={group.name} onClick={() => tickAll(group)}>Tick all of these</button></div>
            </details>
          );
        })}
        <label>From <select id="sb-dir" value={form.dir} onChange={set('dir')}>{COMPASS.map(([n, b]) => <option key={n} value={b}>{n}</option>)}<option value="rand">Random</option></select></label>
        <label>Seconds apart, per type <input id="sb-gap" type="number" min="0" max="60" value={form.gap} onChange={set('gap')} /></label>
        <div className="row">
          <button id="sb-launch" className="primary" disabled={!total} onClick={launch}>Launch {total} drone{total === 1 ? '' : 's'}</button>
          <button id="sb-untick" disabled={!total} onClick={() => setMix({})}>Untick all</button>
          <button id="sb-clear" onClick={() => commands.clearSandboxDrones()}>Clear drones</button>
          <button id="sb-exit" onClick={() => commands.exitSandbox()}>Exit sandbox</button>
        </div>
        </>}
        <div id="sb-info" className="note">{state.sbQueue.length} drone(s) queued · {drones.length} in the air · shots fired (free here) {money(state.sbSpent)} · leaks {state.leaks}</div>
      </div>
      <div id="sandbox-banner" className={state.sandbox ? '' : 'hidden'}>SANDBOX: the site cannot be damaged. Exit sandbox to reset.</div>
    </>
  );
}
