// The laydowns that tools/lab found, with how each did on drone waves it never trained on. Load one to look at it and fly it.
// Nothing here is saved to the account: use the Saved tab to keep one.

import { useState } from 'react';
import { attemptWith, useArmed, useGame, useLoad } from '../hooks.js';
import { money } from '../../sim/economy.js';
import { openLaydown } from './open-laydown.js';

const pound = (x) => `£${x.toFixed(2)}`;

export function LabTab({ active }) {
  const game = useGame();
  const [note, setNote] = useState('');
  const { data, error, reload } = useLoad(() => game.api.lab.list(), active);
  const load = useArmed(), loadHere = useArmed();
  const attempt = attemptWith(setNote, reload);

  const loadRow = (row, here = false) => attempt(async () => openLaydown(game, await game.api.lab.get(row.file), row.name, here), (message) => message);

  return (
    <>
      <div className="sys note">
        Laydowns written by the lab's overnight search, best first. Waves is the mean over drone waves the search never trained on, with its 95% interval.
        Loading one replaces the current run.
        {data?.report && <> <a id="lab-report" href="/api/v1/lab/report" target="_blank" rel="noopener">Open the full convergence report</a>.</>}
      </div>
      {note && <div id="lab-note" className="saved-note">{note}</div>}
      {error && <div id="lab-error" className="saved-error">{error} <button className="mini" onClick={reload}>Try again</button></div>}
      {data && !data.laydowns.length && !error && <div className="muted">No lab laydowns yet. Run <code>npm run lab -- export --from overnight.json</code> in the frontend folder.</div>}
      {data && data.laydowns.length > 0 && (
        <table className="mini" id="lab-list">
          <thead><tr><th>Laydown</th><th>Sites</th><th>Waves</th><th>Cost</th><th title="Spent on shots, and on shots plus systems, for each £1 of enemy drones destroyed (the Magazine depth tab's cost exchange)">Per £1 destroyed</th><th /></tr></thead>
          <tbody>
            {data.laydowns.map((row) => (
              <tr key={row.file}>
                <td title={row.lab?.what || ''}>{row.name}<div className="muted">{row.systems} systems{row.lab?.what ? `: ${row.lab.what}` : ''}</div></td>
                <td>{row.lab?.sites ?? ''}</td>
                <td>{row.lab ? `${row.lab.waves}${row.lab.ci ? ` ±${row.lab.ci}` : ''}` : ''}</td>
                <td>{row.lab?.capex ? money(row.lab.capex) : ''}</td>
                <td>{row.lab?.perPound != null ? `${pound(row.lab.perPoundShots)} / ${pound(row.lab.perPound)}` : ''}</td>
                <td className="saved-actions">
                  <button className="mini" onClick={load.confirm(row.file, () => loadRow(row))}>{load.armed === row.file ? 'Replace run?' : 'Load'}</button>
                  {row.world !== game.sim.state.terrainSeed && <button className="mini load-here" title="Lay it out round this site, on the ground in play now. Systems that cannot stand here are left out." onClick={loadHere.confirm(row.file, () => loadRow(row, true))}>{loadHere.armed === row.file ? 'Replace run?' : 'Load here'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
