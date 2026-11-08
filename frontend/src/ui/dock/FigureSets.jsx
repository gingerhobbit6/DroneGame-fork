// Saved sets of tuned figures, shown at the top of the Sources tab. A set holds only what differs from the researched values.

import { useState } from 'react';
import { GAME_VERSION, exportFigures } from '../../sim/config/index.js';
import { attemptWith, useArmed, useGame, useLoad } from '../hooks.js';

export function FigureSets({ active, onApplied }) {
  const { api, commands } = useGame();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const { data, error, reload } = useLoad(() => api.figureSets.list(), active);
  const remove = useArmed(), apply = useArmed();

  const attempt = attemptWith(setNote, reload);
  const save = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    attempt(() => api.figureSets.create({ name, figures: exportFigures(), game_version: GAME_VERSION }), `Saved "${name.trim()}".`).then((ok) => { if (ok) setName(''); });
  };
  const applySet = (row) => attempt(async () => {
    const saved = await api.figureSets.get(row.id);
    commands.applyFigures(saved.figures);
    onApplied();
  }, `Applied "${row.name}".`);

  return (
    <div className="sys" id="figure-sets">
      <div className="sys-h"><b>Saved sets of figures</b></div>
      <form className="saved-form" onSubmit={save}>
        <input id="figset-name" type="text" maxLength={100} placeholder="Name your changes" value={name} onChange={(e) => setName(e.target.value)} />
        <button id="figset-save" type="submit" disabled={!name.trim()}>Save changes</button>
      </form>
      {note && <div id="figset-note" className="saved-note">{note}</div>}
      {error && <div id="figset-error" className="saved-error">{error} <button className="mini" onClick={reload}>Try again</button></div>}
      {data && data.map((row) => (
        <div className="figset-row" key={row.id}>
          <span>{row.name}</span>
          <span>
            <button className="mini" onClick={apply.confirm(row.id, () => applySet(row))}>{apply.armed === row.id ? 'Replace figures?' : 'Apply'}</button>
            <button className="mini" onClick={remove.confirm(row.id, () => attempt(() => api.figureSets.remove(row.id), `Deleted "${row.name}".`))}>{remove.armed === row.id ? 'Sure?' : 'Delete'}</button>
          </span>
        </div>
      ))}
    </div>
  );
}
