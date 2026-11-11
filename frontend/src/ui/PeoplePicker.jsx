// Opens beside the toolbar with the People tool: the size, role and protection of the next group, and the groups already placed.
// The wizard's people step shows the same controls.

import { PEOPLE, PEOPLE_LIMITS, PEOPLE_ROLES } from '../sim/config/index.js';
import { view } from '../render/view.js';
import { hex, useGame } from './hooks.js';
import { NumberInput } from './NumberInput.jsx';
import { Movable } from './Movable.jsx';

const LOOK_DISTANCE = 4; // scene units: close enough to make out each person

export function PeopleChoice() {
  const game = useGame();
  const { sim, commands } = game;
  const choice = view.people, locked = sim.designLocked();
  const set = (change) => { Object.assign(view.people, change); game.bump(); };
  return (
    <>
      <label className="people-count">People in the group
        <NumberInput id="people-count" value={choice.count} min={1} max={PEOPLE_LIMITS.perGroup} step={1} onCommit={(v) => set({ count: Math.min(Math.max(Math.round(v), 1), PEOPLE_LIMITS.perGroup) })} />
      </label>
      <div className="pick-list" role="group" aria-label="Who they are">
        {Object.entries(PEOPLE_ROLES).map(([id, role]) => (
          <button key={id} data-role={id} aria-pressed={id === (choice.role ?? 'civilian')} onClick={() => set({ role: id })}>
            <b>{role.name}</b>
            <span>{role.desc}</span>
          </button>
        ))}
      </div>
      <div className="pick-list" role="group" aria-label="Protection">
        {Object.entries(PEOPLE).map(([id, level]) => (
          <button key={id} data-protection={id} aria-pressed={id === choice.protection} onClick={() => set({ protection: id })}>
            <b>{level.name}</b>
            <span>{level.desc}</span>
          </button>
        ))}
      </div>
      <p className="muted">{locked ? 'The laydown is locked once the first wave starts.' : 'Click the map to place them. They cost nothing. Strikes on a drawn area can aim at them, and a blast nearby can hurt them.'} Casualties come from assumed figures in the Sources tab, not real data.</p>
      {sim.people.length > 0 && (
        <ul className="people-list">
          {sim.people.map((g) => (
            <li key={g.id}>
              <span>{g.hits.length > 0 ? `${g.count - g.hits.length} of ${g.count}` : g.count} {PEOPLE_ROLES[g.role ?? 'civilian'].name.toLowerCase()} · {PEOPLE[g.protection].name}</span>
              <button data-look={g.id} title="Fly the camera to this group" onClick={() => game.getView()?.centreOn(g.x, g.z, LOOK_DISTANCE)}>Look</button>
              {!locked && <button data-remove={g.id} aria-label={`Remove the group of ${g.count}`} title="Remove this group" onClick={() => commands.removePeople(g.id)}>×</button>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function PeoplePicker({ onHide }) {
  return (
    <Movable id="tool-picker" title="People" role="region" aria-label="Place simulated people">
      <div className="up-head" style={{ borderLeftColor: hex(PEOPLE[view.people.protection].color) }}>
        <b>People: place a group</b>
        <button id="picker-close" aria-label="Hide this list" title="Hide this list. Keep clicking the map to place." onClick={onHide}>×</button>
      </div>
      <PeopleChoice />
    </Movable>
  );
}
