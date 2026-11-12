// The purchase bar: one row per kind of system, then vehicles, people and Remove, each with its icon. A row opens its list beside
// the toolbar (to its left), to drag onto the map.

import { BUILD, PATROL_VEHICLES, STRUCTURES, TOOLBAR } from '../sim/config/index.js';
import { money } from '../sim/economy.js';
import { hex, useGame, useTick } from './hooks.js';
import { remaining, useAccount } from './account/pack.js';
import { Movable } from './Movable.jsx';
import { ICONS, Icon } from './icons.jsx';

const cheapest = (group) => Math.min(...group.classes.map((id) => STRUCTURES[id].cost));

function PackRow() {
  const game = useGame(), unit = useAccount()?.activeUnit;
  if (!unit) return null;
  return (
    <button data-catalogue="unit" className={`tool tool-pack${game.catalogue() === 'unit' ? ' active' : ''}`} aria-expanded={game.catalogue() === 'unit'}
      title="Your deployment pack: its kit, ready to drag onto the map" onClick={() => game.openCatalogue('unit')}>
      <div className="n"><Icon path={ICONS.pack} size={14} />Deployment pack</div><div className="c" />
      <div className="k">{unit.callsign ? `${unit.callsign} · ` : ''}{unit.name}</div>
    </button>
  );
}

// Vehicles: park a Patria, Hilux or THeMIS with a system on board. With a pack, only the pack's vehicles.
function VehicleRow() {
  const game = useGame(), unit = useAccount()?.activeUnit, open = game.catalogue() === 'vehicles';
  const left = unit ? remaining(unit.assets, game.sim).vehicles.reduce((n, l) => n + l.left, 0) : null;
  return (
    <button data-catalogue="vehicles" className={`tool tool-vehicle${open ? ' active' : ''}`} aria-expanded={open}
      title="Park a vehicle with a system on board, raised to its mast height" onClick={() => game.openCatalogue('vehicles')}>
      <div className="n"><Icon path={ICONS.vehicle} size={14} />Vehicles</div><div className="c" />
      <div className="k">{left == null ? Object.values(PATROL_VEHICLES).map((v) => v.name.split(' ').pop()).join(', ') : `${left} in your pack to place`}</div>
    </button>
  );
}

export function Toolbar() {
  useTick();
  const game = useGame();
  const tool = game.getTool(), budget = game.sim.state.budget, open = game.catalogue(), kit = game.sim.state.kit;
  const packed = game.sim.state.packed, refund = Math.round(BUILD.sellRefund * 100); // with a pack there is no budget, so no refund to show
  return (
    <Movable id="toolbar" title="Place systems">
      <PackRow />
      {TOOLBAR.map((group) => {
        const picked = group.classes.includes(tool) ? STRUCTURES[tool] : null, from = cheapest(group);
        return (
          <div className="tool-row" key={group.kind} data-kind={group.kind}>
            <button
              data-catalogue={group.kind}
              aria-expanded={open === group.kind}
              className={`tool${open === group.kind ? ' active' : ''}${budget < from && !game.sim.state.packed ? ' poor' : ''}`}
              style={{ borderLeftColor: hex(STRUCTURES[game.toolChoice(group)].color) }}
              title={`${group.name}: click to see the ${group.classes.length} real systems, then drag one onto the map. Key ${group.key}.`}
              onClick={() => game.openCatalogue(group.kind)}
            >
              <div className="n"><Icon path={ICONS[group.kind] ?? ICONS.engage} size={14} />{group.name}</div><div className="c">{picked ? money(picked.cost) : `from ${money(from)}`}</div>
              <div className="k">[{group.key}] {picked ? picked.product : kit ? `${group.classes.filter((id) => kit[id]).length} in your pack` : `${group.classes.length} real systems`}</div>
            </button>
          </div>
        );
      })}
      <VehicleRow />
      <button data-tool="people" className={`tool${tool === 'people' ? ' active' : ''}`} title="Place groups of simulated people, to see what an attack would do to them" onClick={() => game.setTool('people')}>
        <div className="n"><Icon path={ICONS.people} size={14} />People</div><div className="c">{game.sim.people.reduce((sum, g) => sum + g.count, 0) || ''}</div><div className="k">[9] simulated</div>
      </button>
      <button id="tool-sell" className={`tool${tool === 'sell' ? ' active' : ''}`} onClick={() => game.setTool('sell')}
        title={packed ? 'Click a system on the map to take it off, back into your pack' : `Click a system on the map to take it off, with ${refund}% of its price back`}>
        <div className="n"><Icon path={ICONS.clear} size={14} />Remove</div>
        <div className="c">{packed ? '' : `${refund}% back`}</div><div className="k">[X] then click a system</div>
      </button>
    </Movable>
  );
}
