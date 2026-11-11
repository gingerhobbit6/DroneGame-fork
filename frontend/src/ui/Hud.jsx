// What the run has done so far: site integrity, the budget, kills, hits on your own systems, casualties and ammunition, with the
// spend below it. A deployment pack has no budget to run out of, so the budget then shows only in the sandbox.

import { SITE, ECONOMY, DRONES, ADAPT } from '../sim/config/index.js';
import { enemyCost, money } from '../sim/economy.js';
import { parseWorldId, worldLabel } from '../sim/world-pack.js';
import { liveStats } from '../sim/stats.js';
import { useGame, useTick } from './hooks.js';
import { StatsHeadline } from './RunStats.jsx';
import { Movable } from './Movable.jsx';

const pct = (v) => (v > 0 ? Math.max(100 * Math.min(v / ECONOMY.budget, 1), 0.6) : 0).toFixed(2) + '%'; // a sliver stays visible
const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);

// Rounds still to fire across every launcher and gun, of all it carries, and how many are loaded now. Lasers recharge, so are left out.
export function ammunition(structures) {
  const armed = structures.filter((s) => s.def.magazine && s.def.fire !== 'beam');
  return { left: sum(armed, (s) => s.rounds + s.storage), total: sum(armed, (s) => s.def.magazine + (s.def.storage || 0)), loaded: sum(armed, (s) => s.rounds), armed: armed.length };
}

function SiteAndBudget({ state, ledger }) {
  const k = state.health / SITE.maxHealth;
  return (
    <>
      <div className="label">SITE INTEGRITY <b id="health-num" className="budget-num">{Math.round(k * 100)}%</b></div>
      <div className="bar"><div id="health-fill" style={{ width: (k * 100).toFixed(0) + '%', background: k > 0.6 ? '#4caf50' : k > 0.3 ? '#ffb300' : '#e53935' }} /></div>
      {(state.sandbox || !state.packed) && (
        <>
          <div className="label" style={{ marginTop: 8 }}>BUDGET LEFT <b id="budget" className="budget-num">{money(state.budget)}</b></div>
          <div className="budget-bar" title="The whole budget: systems bought (blue), shots fired (red), and what is left (green)">
            <span className="b-capex" style={{ width: pct(ledger.capex) }} /><span className="b-shots" style={{ width: pct(ledger.consumables) }} /><span className="b-left" />
          </div>
        </>
      )}
    </>
  );
}

export function Hud({ openDock }) {
  useTick();
  const { sim } = useGame();
  const { state, ledger } = sim;
  const spot = sim.spotterBonus();
  const next = state.sandbox ? state.sbLevel : state.waveActive ? state.wave : state.wave + 1; // the wave these numbers apply to: in the sandbox, the level chosen there
  const adapted = (type) => {
    const def = DRONES[type], kk = (next - 1) * (def.adapt ?? 1);
    return Math.max(Math.min(ADAPT.evadeFloor, def.evade), def.evade * (1 - ADAPT.evadePerWave * kk)).toFixed(2);
  };
  const destroyed = enemyCost(ledger.killed), ammo = ammunition(sim.structures), stats = liveStats(sim);
  const lost = sum(Object.values(ledger.lost), (n) => n);
  return (
    <Movable id="hud-top-left" title="Run">
      <SiteAndBudget state={state} ledger={ledger} />
      <div className="stats">
        <span>Wave <b id="wave">{state.wave}</b></span>
        <span>Kills <b id="kills">{state.kills}</b></span>
        <span>Leaks <b id="leaks">{state.leaks}</b></span>
      </div>
      {(stats.drones.struck > 0 || lost > 0) && ( // from the first one, so the box stays short until there is something to say
        <div className="stats" id="hud-systems" title="Drones that came down on one of your own systems and not on the site, and the systems they destroyed. Neither counts as a kill or a leak.">
          <span>Hit your systems <b id="struck">{stats.drones.struck}</b></span>
          <span>Lost <b id="lost">{lost}</b></span>
        </div>
      )}
      <div className="stats" title="Simulated, from assumed figures in the Sources tab. Not real casualty data.">
        <span>People killed <b id="killed">{state.killed}</b></span>
        <span>Injured <b id="injured">{state.injured}</b></span>
      </div>
      <div className="stats" id="hud-ammo" title="Rounds left in every launcher and gun, of all they carry, and how many are loaded now. Lasers recharge.">
        {ammo.armed ? <span>Ammunition <b>{ammo.left}</b> of {ammo.total} left · {ammo.loaded} loaded</span> : <span>Ammunition: no launchers or guns placed</span>}
      </div>
      {stats.drones.launched > 0 && <StatsHeadline stats={stats} onOpen={openDock && (() => openDock('stats'))} />}
      <div className="hud-spend" id="hud-spend">Spent {money(ledger.capex + ledger.consumables)}: systems {money(ledger.capex)}, shots and rounds {money(ledger.consumables)}</div>
      <div id="status" className="hint">
        {spot > 0 && <><span className="warn">Fixed-wing spotter on station: strikes +{Math.round(spot * 100)}%</span><br /></>}
        Enemy attack cost {money(enemyCost(ledger.launched))}
        {ledger.consumables > 0 && destroyed > 0 && ` · £${(ledger.consumables / destroyed).toFixed(2)} of shots per £1 destroyed`}<br />
        Enemy evasion (1.00 = easy to hit): first-person-view {adapted('fpv')} · fixed-wing {adapted('fw')}<br />
        Seed {state.seed} · {parseWorldId(state.terrainSeed) ? worldLabel(state.terrainSeed) : `Terrain ${state.terrainSeed}`}
      </div>
    </Movable>
  );
}
