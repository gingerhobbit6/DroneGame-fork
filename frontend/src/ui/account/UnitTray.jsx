// The deployment pack tray: the kit of the unit deployed from the profile, to drag onto the map. Counts come from the map itself,
// so selling a system puts it back in the tray. They are the limit too: while a pack is deployed, only its kit can be placed.

import { useState } from 'react';
import { PATROL_VEHICLES, PEOPLE, STRUCTURES, TOOLBAR, carries } from '../../sim/config/index.js';
import { useGame } from '../hooks.js';
import { PanelHead, SystemCard, dragProps, onKeys } from '../SystemCard.jsx';
import { remaining, useAccount } from './pack.js';
import { Movable } from '../Movable.jsx';

const LIME = 0xc6ff00;
const toPlace = (l) => (l.left ? `${l.left} of ${l.count} to place` : `All ${l.count} placed`);

// A vehicle is parked with one of the pack's systems on board, chosen here, and then dragged or clicked like a system.
function VehicleCard({ game, line, systems, locked }) {
  const fits = systems.filter((l) => carries(line.id, l.id));
  const [chosen, setChosen] = useState(null);
  const system = (fits.find((l) => l.id === chosen) ?? fits.find((l) => l.left) ?? fits[0])?.id;
  const v = PATROL_VEHICLES[line.id], usable = !!system && !locked;
  const pick = () => { if (usable) game.pickFromTray(system, line.id); };
  return (
    <div className="tray-vehicle">
      {fits.length > 0 ? (
        <label>{v.name} carrying <select aria-label={`What the ${v.name} carries`} value={system} onChange={(e) => setChosen(e.target.value)}>
          {fits.map((l) => <option key={l.id} value={l.id}>{STRUCTURES[l.id].product}</option>)}
        </select></label>
      ) : <span className="muted">Nothing in this pack fits on a {v.name}.</span>}
      <div role="button" tabIndex={0} data-tray-vehicle={line.id} aria-pressed={!!system && game.getTool() === system && game.toolVehicle() === line.id}
        aria-disabled={!usable || undefined} className={`pick-card tray-line${line.left ? '' : ' used'}`}
        title={system ? `Drag the ${v.name} with its ${STRUCTURES[system].product} onto the map, or click it and then click the map` : v.desc}
        onClick={pick} onKeyDown={onKeys(pick)} {...dragProps(game, { system, vehicle: line.id }, usable)}>
        <b>{v.name}</b>{system && <span className="pick-price">{STRUCTURES[system].product}</span>}
        <span className="tray-left">{line.count == null ? 'Click it, then click the map' : toPlace(line)}</span>
      </div>
    </div>
  );
}

export function UnitTray({ withWizard }) {
  const game = useGame(), account = useAccount();
  const unit = account?.activeUnit;
  if (!unit) return null;
  const left = remaining(unit.assets, game.sim), tool = game.getTool();
  const systems = left.systems.filter((l) => STRUCTURES[l.id]), people = left.people; // a system a later version drops is skipped
  const locked = game.sim.designLocked();
  return (
    <Movable id="tool-picker" title="Deployment pack" className={`panel${withWizard ? ' with-wizard' : ''}`} role="region" aria-label={`Deployment pack: ${unit.name}`}>
      <PanelHead title={`${unit.callsign ? `${unit.callsign}: ` : ''}${unit.name}`} color={LIME} onHide={() => game.openCatalogue('unit', false)} />
      <p className="pick-hint">Drag each item onto the map to deploy it. The count shows what is still to place. A system or vehicle can also be clicked, then placed by clicking the map.</p>
      <button type="button" id="btn-edit-pack" onClick={account.editPack}>Edit this pack</button>
      {systems.length > 0 && <p className="opt-h">Sensors and effectors</p>}
      <div className="pick-list">
        {systems.map((l) => (
          <SystemCard key={l.id} id={l.id} pressed={l.id === tool && !game.toolVehicle()} onPick={() => game.pickFromTray(l.id)} className={`tray-line${l.left ? '' : ' used'}`}>
            <span className="tray-left">{toPlace(l)}</span>
          </SystemCard>
        ))}
      </div>
      {people.length > 0 && <p className="opt-h">People</p>}
      <div className="pick-list">
        {people.map((g, i) => (
          <div key={i} className={`pick-card tray-line${g.left ? '' : ' used'}`} data-tray-people={i} title={PEOPLE[g.protection].desc} {...dragProps(game, { people: { count: g.count, protection: g.protection } }, !locked)}>
            <b>{g.count} people</b><span className="pick-price">{PEOPLE[g.protection].name}</span>
            <span className="tray-left">{g.left ? 'Drag onto the map' : 'Placed'}</span>
          </div>
        ))}
      </div>
      {left.vehicles.length > 0 && (
        <>
          <p className="opt-h">Vehicles</p>
          <p className="muted">Each is parked with a system from this pack on board, raised to its mast height. Vehicles in the patrol&apos;s column count too.</p>
          <div className="pick-list">
            {left.vehicles.map((l) => <VehicleCard key={l.id} game={game} line={l} systems={systems} locked={locked} />)}
          </div>
        </>
      )}
      {!systems.length && !people.length && !left.vehicles.length && <p className="muted">This pack is empty. Add kit to it from your profile.</p>}
    </Movable>
  );
}

// Vehicles from Place systems: each with the system it carries, chosen here, dragged or clicked onto the map like a system. With a
// pack, its vehicles and systems still to place; without one, every vehicle and any system it can carry.
export function VehiclePicker({ withWizard }) {
  const game = useGame(), unit = useAccount()?.activeUnit, locked = game.sim.designLocked();
  const left = unit ? remaining(unit.assets, game.sim) : null;
  const systems = left ? left.systems.filter((l) => STRUCTURES[l.id]) : TOOLBAR.flatMap((g) => g.classes).map((id) => ({ id, left: 1 }));
  const vehicles = left ? left.vehicles : Object.keys(PATROL_VEHICLES).map((id) => ({ id, left: 1 }));
  return (
    <Movable id="tool-picker" title="Vehicles" className={`panel${withWizard ? ' with-wizard' : ''}`} role="region" aria-label="Park a vehicle with a system on board">
      <PanelHead title="Vehicles" color={0xd99a00} onHide={() => game.openCatalogue('vehicles', false)} />
      <p className="pick-hint">Choose what each carries, then drag it onto the map, or click it and then click the map. Its system is raised to the vehicle&apos;s mast height. Place another system on a parked vehicle to add it, up to three.</p>
      {vehicles.length ? <div className="pick-list">{vehicles.map((l) => <VehicleCard key={l.id} game={game} line={l} systems={systems} locked={locked} />)}</div>
        : <p className="muted">Your pack has no vehicles. Add them from your profile.</p>}
    </Movable>
  );
}
