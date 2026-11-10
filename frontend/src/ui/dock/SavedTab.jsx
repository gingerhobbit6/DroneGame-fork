// Save the current laydown by name, and load one back. Laydowns live on the backend, so they survive closing the browser.

import { useState } from 'react';
import { GAME_VERSION } from '../../sim/config/index.js';
import { zoneFromSpec } from '../../zone.js';
import { parseWorldId, worldLabel } from '../../sim/world-pack.js';
import { attemptWith, useArmed, useGame, useLoad } from '../hooks.js';
import { openLaydown } from './open-laydown.js';

const when = (iso) => new Date(iso).toLocaleString();

export function SavedTab({ active }) {
  const game = useGame();
  const { sim, commands, api } = game;
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const { data, error, reload } = useLoad(() => api.laydowns.list(), active);
  const load = useArmed(), loadHere = useArmed(), remove = useArmed(), replace = useArmed();
  const count = sim.currentLaydown().structures.length;

  const attempt = attemptWith(setNote, reload);
  const body = (n) => ({ name: n, world: sim.state.terrainSeed, spec: sim.currentLaydown(), game_version: GAME_VERSION });

  const save = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    attempt(() => api.laydowns.create(body(name)), `Saved "${name.trim()}".`).then((ok) => { if (ok) setName(''); });
  };
  const loadRow = (row) => attempt(async () => {
    const saved = await api.laydowns.get(row.id);
    const problem = (await game.ensureWorld(saved.world)) || commands.loadLaydown(saved.spec, saved.world);
    if (problem) return problem;
    game.setViewOption('zone', zoneFromSpec(saved.spec));
    // a real world's site never goes in a URL, as URLs end up in history and logs
    history.replaceState(null, '', parseWorldId(saved.world) ? `?seed=${encodeURIComponent(sim.state.seed)}` : `?seed=${encodeURIComponent(sim.state.seed)}&terrain=${encodeURIComponent(saved.world)}`);
    return saved.game_version === GAME_VERSION ? `Loaded "${saved.name}".` : `Loaded "${saved.name}". It was saved by version ${saved.game_version}, so it may not play the same.`;
  }, (message) => message);

  // A laydown made on other ground, laid out round the site on the ground in play now: a real map, say, for one made on generated ground.
  const loadRowHere = (row) => attempt(async () => {
    const saved = await api.laydowns.get(row.id);
    const problem = commands.loadLaydownHere(saved.spec);
    if (problem) return problem;
    game.setViewOption('zone', zoneFromSpec(saved.spec));
    return `Laid "${saved.name}" out round this site, on this ground.`;
  }, (message) => message);

  // Open a laydown file (one saved by tools/lab, or a spec copied out of the game) without saving it to the account first.
  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { setNote(await openLaydown(game, JSON.parse(await file.text()), file.name)); } catch (err) { setNote(err.message); }
  };

  return (
    <>
      <div className="sys note">Save your laydown and wiring by name. Loading one replaces the current run, and switches to the ground it was made for.</div>
      <label className="saved-import" title="Open a laydown file from disk, such as one written by tools/lab. Replaces the current run.">
        Open a laydown file: <input id="import-laydown" type="file" accept=".json,application/json" onChange={importFile} />
      </label>
      <form className="saved-form" onSubmit={save}>
        <input id="save-name" type="text" maxLength={100} placeholder="Name this laydown" value={name} onChange={(e) => setName(e.target.value)} />
        <button id="save-laydown" className="primary" type="submit" disabled={!name.trim()}>Save {count} system{count === 1 ? '' : 's'}</button>
      </form>
      {note && <div id="saved-note" className="saved-note">{note}</div>}
      {error && <div id="saved-error" className="saved-error">{error} <button className="mini" onClick={reload}>Try again</button></div>}
      {data && !data.length && !error && <div className="muted">Nothing saved yet.</div>}
      {data && data.length > 0 && (
        <table className="mini" id="saved-list">
          <thead><tr><th>Name</th><th>Ground</th><th>Saved</th><th /></tr></thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{worldLabel(row.world)}</td>
                <td>{when(row.updated_at)}</td>
                <td className="saved-actions">
                  <button className="mini" onClick={load.confirm(row.id, () => loadRow(row))}>{load.armed === row.id ? 'Replace run?' : 'Load'}</button>
                  {row.world !== sim.state.terrainSeed && <button className="mini load-here" title={`Lay it out round this site, on the ground in play now, instead of on ${worldLabel(row.world)}. Systems that cannot stand here are left out.`} onClick={loadHere.confirm(row.id, () => loadRowHere(row))}>{loadHere.armed === row.id ? 'Replace run?' : 'Load here'}</button>}
                  <button className="mini" onClick={replace.confirm(row.id, () => attempt(() => api.laydowns.replace(row.id, body(row.name)), `Updated "${row.name}".`))}>{replace.armed === row.id ? 'Overwrite?' : 'Update'}</button>
                  <button className="mini" onClick={remove.confirm(row.id, () => attempt(() => api.laydowns.remove(row.id), `Deleted "${row.name}".`))}>{remove.armed === row.id ? 'Sure?' : 'Delete'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
