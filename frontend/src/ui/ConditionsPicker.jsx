// The light and weather the run is fought in. Like the attack, it can change until the first wave starts.

import { CONDITIONS } from '../sim/conditions.js';
import { useGame } from './hooks.js';

export function ConditionsPicker({ id = 'conditions' }) {
  const game = useGame();
  const { sim, commands } = game;
  const change = (e) => { const problem = commands.setConditions(e.target.value); if (problem) game.toast(problem); };
  return (
    <label title="Visible cameras fade at dusk and night. Rain and haze cut cameras, lasers and the higher radar bands, and drown acoustic sensors. Locked once the first wave starts.">
      Conditions{' '}
      <select id={id} value={sim.state.conditions} disabled={sim.designLocked()} onChange={change}>
        {Object.entries(CONDITIONS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
      </select>
    </label>
  );
}
