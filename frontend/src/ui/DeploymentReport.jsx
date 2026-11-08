// The end-of-deployment report: how it ended, what it stopped, what got through and what it cost. The run's statistics follow it.

import { money } from '../sim/economy.js';

const TITLE = { site: 'SITE LOST', patrol: 'PATROL LOST', ended: 'DEPLOYMENT ENDED' };

export function DeploymentReport({ report: r }) {
  const c = r.cost;
  return (
    <div id="deployment-report">
      <h1>{TITLE[r.outcome]}</h1>
      <p>{r.outcome === 'ended' ? 'You ended the deployment' : 'You held out'} after <b>{r.waves}</b> full wave(s).</p>
      <p id="report-drones"><b>{r.launched}</b> drones launched · <b>{r.intercepted}</b> intercepted · <b>{r.leaked}</b> got through · <b>{r.left}</b> turned away</p>

      <h2>Cost of the defence</h2>
      <p id="report-cost">Systems {money(c.systems)} · munitions {money(c.munitions)} · <b>total {money(c.spent)}</b>{c.lost > 0 && <> · systems lost worth {money(c.lost)}</>}</p>
      <p className="muted">The enemy attack cost {money(c.enemy)}, of which {money(c.destroyed)} was destroyed{c.perIntercept != null && `; munitions came to ${money(c.perIntercept)} per drone intercepted`}.</p>

      <h2>Own losses</h2>
      <p id="report-losses">{r.outcome === 'patrol' ? 'Patrol' : 'Site'} integrity {Math.round(r.health * 100)}%{r.lost.length ? ` · lost ${r.lost.map((l) => `${l.n} ${l.name}`).join(', ')}` : ' · no systems lost'}</p>
    </div>
  );
}
