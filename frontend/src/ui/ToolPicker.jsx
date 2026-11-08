// Opens beside the toolbar: the real systems of the kind clicked, to drag onto the map, and the settings the next one is placed with.
// The deployment pack tray opens in the same place.

import { useEffect, useState } from 'react';
import { DRONES, STRUCTURES, TOOLBAR, WORLD } from '../sim/config/index.js';
import { money } from '../sim/economy.js';
import { predictRange, usesPath } from '../sim/site-range.js';
import { standingAt } from '../sim/sensor-model.js';
import { terrainState } from '../sim/terrain.js';
import { fieldsFor, settingValue, unitDef } from '../sim/unit-config.js';
import { view } from '../render/view.js';
import { km, useGame, useTick } from './hooks.js';
import { UnitField } from './UnitEditor.jsx';
import { PeoplePicker } from './PeoplePicker.jsx';
import { PanelHead, SystemCard } from './SystemCard.jsx';
import { UnitTray } from './account/UnitTray.jsx';
import { useAccount } from './account/pack.js';
import { Movable } from './Movable.jsx';


// What the spot under the cursor really gets, against the open-field figure.
function AtCursor({ def, spot, centre }) {
  if (!spot || !usesPath(def)) return null;
  const p = predictRange(standingAt(def, centre, spot), DRONES.fpv, terrainState.data, spot.x * WORLD.metresPerUnit, spot.z * WORLD.metresPerUnit);
  return <div className="up-summary" id="picker-here">At the cursor: <b>{km(p.mean)}</b>, {km(p.min)} to {km(p.max)}, seeing {Math.round(p.covered * 100)}% of the open-field area</div>;
}

function Settings({ tool }) {
  const game = useGame();
  const settings = game.loadoutFor(tool), def = unitDef(tool, settings);
  return (
    <>
      <p className="up-desc">{STRUCTURES[tool].desc}</p>
      <div className="up-summary">Next one placed: <b>{(def.range / 1000).toFixed(1)} km</b> in an open field · <b>{money(def.cost)}</b></div>
      <AtCursor def={def} spot={game.cursor?.()} centre={game.sim.state.zoneCentre} />
      {fieldsFor(tool).map((f) => (
        <UnitField
          key={`${tool}-${f.key}`}
          field={f} id={tool} prefix="place" value={settingValue(def, f)} changed={settings[f.key] != null}
          onChange={(v) => { game.setLoadout(tool, f, v); return settingValue(unitDef(tool, game.loadoutFor(tool)), f); }}
        />
      ))}
    </>
  );
}

export function ToolPicker() {
  useTick();
  const game = useGame();
  const tool = game.getTool(), open = game.catalogue(), withWizard = view.wizard === 'open';
  const [peopleHidden, setPeopleHidden] = useState(false);
  useEffect(() => { if (tool !== 'people') setPeopleHidden(false); }, [tool]);
  if (tool === 'people') return peopleHidden || withWizard ? null : <PeoplePicker onHide={() => setPeopleHidden(true)} />;
  if (!game.sim.state.started) return null;
  if (open === 'unit') return <UnitTray withWizard={withWizard} />;
  const group = TOOLBAR.find((g) => g.kind === open);
  if (!group) return null;
  return <KindList game={game} group={group} tool={tool} withWizard={withWizard} />;
}

// One kind's list: every real system of that kind, or with a deployment pack deployed, only what the pack holds and how many are left.
function KindList({ game, group, tool, withWizard }) {
  const account = useAccount(), kit = game.sim.state.kit;
  const classes = kit ? group.classes.filter((id) => kit[id]) : group.classes;
  const left = (id) => kit[id] - game.sim.structures.filter((s) => s.def.id === id).length;
  const picked = classes.includes(tool) ? tool : null;
  return (
    <Movable id="tool-picker" title={group.name} className={`panel${withWizard ? ' with-wizard' : ''}`} role="region" aria-label={`Choose a ${group.name}`}>
      <PanelHead title={kit ? `${group.name}: ${classes.length} in your pack` : `${group.name}: ${group.classes.length} real systems`} color={STRUCTURES[picked ?? classes[0] ?? game.toolChoice(group)].color} onHide={() => game.openCatalogue(group.kind, false)} />
      <p className="pick-hint" id="pick-hint">
        {picked
          ? <><b>{STRUCTURES[picked].product}</b> is picked: click the map to place one{kit ? '' : ', as many times as you like'}. Or drag any card onto the map.</>
          : classes.length ? <>Drag a system onto the map to place it there. Or click one, then click the map.</>
            : <>Your deployment pack holds no {group.name.toLowerCase()} systems.</>}
      </p>
      {kit && account?.editPack && <button type="button" id="btn-edit-pack" onClick={account.editPack}>{classes.length ? 'Edit this pack' : 'Add some to the pack'}</button>}
      <div className="pick-list">
        {classes.map((id) => (
          <SystemCard key={id} id={id} pressed={id === tool} onPick={() => { if (id !== tool) game.setTool(id); }} className={kit && left(id) <= 0 ? 'tray-line used' : undefined}>
            {kit && <span className="tray-left">{left(id) > 0 ? `${left(id)} of ${kit[id]} to place` : `All ${kit[id]} placed`}</span>}
          </SystemCard>
        ))}
      </div>
      {picked && <Settings tool={picked} />}
      <p className="muted">Click a placed system to change it, or to rename it. Esc closes this list.</p>
    </Movable>
  );
}
