// Rules of engagement: which of your weapons may fire at which drone type in the attack. Untick a box to keep that weapon for other
// drones. The fusion node applies a rule once a sensor has named the drone: a camera or an RF library naming its model settles it; a
// multirotor or fixed-wing airframe alone does only if every drone of that airframe in the attack is barred. Crews know what they see.

import { useState } from 'react';
import { DRONES, STRUCTURES } from '../../sim/config/index.js';
import { UNKNOWN, setRule, valueRules } from '../../sim/engage-rules.js';
import { pounds } from '../../sim/economy.js';
import { useGame } from '../hooks.js';

const shotCost = (id) => STRUCTURES[id].shotCost ?? 0;

export function RulesTab() {
  const { sim, commands } = useGame();
  const [, redraw] = useState(0);
  const rules = sim.engageRules();
  const effectors = [...new Set(sim.structures.filter((s) => s.def.role === 'effector').map((s) => s.def.id))].sort((a, b) => shotCost(b) - shotCost(a));
  const attack = [...new Set(sim.state.attack ?? [])].filter((id) => DRONES[id]);
  const set = (next) => { commands.setEngageRules(next); redraw((n) => n + 1); };
  const allowed = (e, d) => !(rules[e] ?? []).includes(d);

  if (!effectors.length) return <div className="sys note">Place some weapons first. Their rules appear here, one row each.</div>;
  return (
    <>
      <div className="sys note">
        Untick a box to stop that weapon firing at that drone type, so costly rounds are kept for the drones worth them.
        The fusion node can only hold fire once a sensor has named the drone (a camera, or an RF detector that knows its link); until then it counts as Unidentified.
        Crews firing by eye always know what they see. The rules stay when you start a new run.
      </div>
      <div className="net-tools">
        <button id="rules-value" title="Bar every pairing where one shot costs more than the drone" onClick={() => set(valueRules(effectors, attack, shotCost))}>Only where a shot costs less than the drone</button>
        <button id="rules-clear" onClick={() => set({})}>Allow everything</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="rules-grid" id="rules-grid">
          <thead>
            <tr>
              <th>Weapon <span className="muted">(a shot)</span></th>
              {attack.map((d) => <th key={d} title={`${DRONES[d].name}: ${pounds(DRONES[d].cost)} each`}>{DRONES[d].label ?? DRONES[d].name}<br /><span className="muted">{pounds(DRONES[d].cost)}</span></th>)}
              <th title="A track no sensor has named yet">Unidentified</th>
            </tr>
          </thead>
          <tbody>
            {effectors.map((e) => (
              <tr key={e}>
                <td>{STRUCTURES[e].name} <span className="muted">{pounds(shotCost(e))}</span></td>
                {[...attack, UNKNOWN].map((d) => (
                  <td key={d} style={{ textAlign: 'center' }}>
                    <input type="checkbox" data-rule={`${e}:${d}`} aria-label={`${STRUCTURES[e].name} may fire at ${d === UNKNOWN ? 'unidentified drones' : DRONES[d].name}`}
                      checked={allowed(e, d)} onChange={(ev) => set(setRule(rules, e, d, ev.target.checked))} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
