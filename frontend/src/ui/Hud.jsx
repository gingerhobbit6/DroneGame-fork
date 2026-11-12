// What the run has done so far: site integrity, the budget, kills, hits on your own systems, casualties and ammunition, with the
// spend below it. A deployment pack has no budget to run out of, so the budget then shows only in the sandbox.

import { SITE, ECONOMY, DRONES, ADAPT } from '../sim/config/index.js';
import { enemyCost, money } from '../sim/economy.js';
import { parseWorldId, worldLabel } from '../sim/world-pack.js';
import { liveStats } from '../sim/stats.js';
import { StatsHeadline } from './RunStats.jsx';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Movable } from './Movable.jsx';
import { AttackMix, mixLabel } from './AttackMix.jsx';
import { useArmed, useGame, useTick } from './hooks.js';
import { ICONS, Icon } from './icons.jsx';
import { toggleDefend } from './DefendPanel.jsx';
import { useAccount } from './account/pack.js';
import { view as gameView } from '../render/view.js';

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

// The run's own buttons, all half width: area or patrol defence, Plan and Statistics (each opening its view of the SAPIENT panel),
// the enemy (which drones attack), changing the deployment pack, the sandbox, and starting again. Whatever is open is lit. Each opens its pane beside this one,
// one at a time: opening one closes the others, and its own button closes it again.
function RunActions({ onView, shownView, onSandbox }) {
  const game = useGame(), { sim, commands } = game;
  const defend = gameView.defend; // the defence panel open now, if any
  const account = useAccount(), pack = account?.activeUnit;
  const { state } = sim;
  const clear = useArmed(); // it throws the laydown away
  const [mixOpen, setMixOpen] = useState(false);
  const closeOthers = (keep) => { // the sandbox is left as it is: leaving it resets the run
    if (keep !== 'defend' && gameView.defend) toggleDefend(game, gameView.defend);
    if (keep !== 'enemy') setMixOpen(false);
    if (keep !== 'dock' && (shownView === 'plan' || shownView === 'stats')) onView(shownView);
  };
  const defendIn = (mode) => { closeOthers('defend'); toggleDefend(game, mode); };
  const view = (id, label, hint) => (
    <button id={`btn-${id}`} className={`with-icon${shownView === id ? ' on' : ''}`} aria-pressed={shownView === id} title={hint} onClick={() => { closeOthers('dock'); onView(id); }}><Icon path={ICONS[id]} size={16} />{label}</button>
  );
  return (
    <>
      <div className="hud-actions">
        <button id="btn-defend-area" className={`with-icon choice${defend === 'area' ? ' on' : ''}`} aria-pressed={defend === 'area'} title="Draw the area strike drones attack, in place of the station" onClick={() => defendIn('area')}><Icon path={ICONS.zone} size={16} />Area defence</button>
        <button id="btn-defend-patrol" className={`with-icon choice${defend === 'patrol' ? ' on' : ''}`} aria-pressed={defend === 'patrol'} title="Draw a patrol route and plan who carries what" onClick={() => defendIn('patrol')}><Icon path={ICONS.patrol} size={16} />Patrol defence</button>
        {view('plan', 'Plan', 'Top-down map: every system, its range and links, engagements and tracks')}
        {view('stats', 'Statistics', 'Hit rate, kill ranges, costs and more')}
        <button id="btn-attack" className={`with-icon${mixOpen ? ' on' : ''}`} title={`The enemy: which drones the waves send (${mixLabel(state.attack)}). Locked once the first wave starts.`} aria-expanded={mixOpen} onClick={() => { closeOthers('enemy'); setMixOpen((o) => !o); }}><Icon path={ICONS.attack} size={16} />Enemy</button>
        {account && <button id="btn-pack" className="with-icon" title={`Choose another deployment pack, or none, from your profile${pack ? `. Now: ${pack.name}` : ''}`} onClick={account.openProfile}><Icon path={ICONS.pack} size={16} />Change pack</button>}
        <button id="btn-sandbox" className={`with-icon${state.sandbox ? ' on' : ''}`} aria-pressed={state.sandbox} title={state.sandbox ? 'In the sandbox: press again to leave it, which resets the run' : 'Try attacks against your laydown without risking the site'} onClick={() => { if (state.sandbox) commands.exitSandbox(); else { closeOthers('sandbox'); commands.enterSandbox(); onSandbox?.(); } }}>
          <Icon path={ICONS.sandbox} size={16} />Sandbox
        </button>
        <button id="btn-reset" className="with-icon" title="Start the run again with the same laydown, wiring and seed" onClick={() => { if (state.started) commands.reset('keep'); }}><Icon path={ICONS.reset} size={16} />Reset run</button>
        <button id="btn-clear" className="with-icon danger" title="Remove every system, refund the budget and go back to before wave 1" disabled={!sim.structures.length && !state.wave} onClick={state.started ? clear.confirm('clear', () => commands.reset('clear')) : undefined}><Icon path={ICONS.clear} size={16} />{clear.armed ? 'Sure? Click again' : 'Clear map'}</button>
      </div>
      {mixOpen && createPortal(<AttackMix onClose={() => setMixOpen(false)} />, document.body)}{/* its own pane, beside this one, not inside it */}
    </>
  );
}

export function Hud({ openDock, onView = openDock, shownView, onSandbox }) {
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
      {onView && <RunActions onView={onView} shownView={shownView} onSandbox={onSandbox} />}
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
