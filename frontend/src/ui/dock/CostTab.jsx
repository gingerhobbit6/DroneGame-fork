// How deep the magazines are, and what you have spent against what the attack cost the enemy.

import { COMMS, DRONES, ECONOMY, STRUCTURES } from '../../sim/config/index.js';
import { enemyCost, pounds } from '../../sim/economy.js';
import { magazineWord } from '../../sim/magazine.js';
import { hex, useGame, useTick } from '../hooks.js';
import { ResupplyButton } from '../ResupplyButton.jsx';
import { SourceLinks } from './SourceLinks.jsx';

const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
const pct = (v) => ((100 * v) / ECONOMY.budget).toFixed(1) + '%';

function LaydownTable({ net, ledger }) {
  const owned = {};
  for (const s of net.nodes.values()) if ((s.def.role === 'sensor' || s.def.role === 'effector') && s.def.id !== 'perimeter') (owned[s.def.id] = owned[s.def.id] || []).push(s.def.cost);
  const terminals = ['starlink', 'cellular'].filter((k) => ledger.terminals[k] > 0);
  const lost = sum(ledger.lost);
  const empty = !Object.keys(owned).length && !terminals.length && !lost;
  return (
    <table className="mini">
      <thead><tr><th>System</th><th>Count</th><th>Each</th><th>Total</th></tr></thead>
      <tbody>
        {Object.entries(owned).map(([id, costs]) => <tr key={id}><td>{STRUCTURES[id].name}</td><td>{costs.length}</td><td>{new Set(costs).size > 1 ? 'varies' : pounds(costs[0])}</td><td>{pounds(sum(costs))}</td></tr>)}
        {terminals.map((k) => <tr key={k}><td>{COMMS[k].name} terminal</td><td>{ledger.terminals[k]}</td><td>{pounds(COMMS[k].cost)}</td><td>{pounds(ledger.terminals[k] * COMMS[k].cost)}</td></tr>)}
        {lost > 0 && <tr><td colSpan="4" className="muted" style={{ color: '#ff8a80' }}>Lost to enemy strikes: {lost} system{lost > 1 ? 's' : ''} worth {pounds(ledger.lostValue)} ({Object.entries(ledger.lost).map(([id, n]) => n + ' ' + STRUCTURES[id].name).join(', ')})</td></tr>}
        {empty && <tr><td colSpan="4" className="muted">Nothing placed yet</td></tr>}
      </tbody>
    </table>
  );
}

function MagazineDepth({ structures, packed }) {
  const armed = structures.filter((s) => s.def.magazine);
  const launchers = armed.filter((s) => s.def.fire !== 'beam');
  const shown = (s, n) => (s.def.fire === 'beam' ? `${Math.ceil(n)} s` : n);
  return (
    <div className="sys" id="magazine-depth">
      <div className="sys-h"><b>Magazine depth</b> <span className="muted">{sum(launchers.map((s) => s.rounds))} rounds ready, {sum(launchers.map((s) => s.storage))} in storage</span></div>
      <table className="mini">
        <thead><tr><th>System</th><th>Magazine</th><th>Storage</th><th>Fired</th><th>State</th></tr></thead>
        <tbody>
          {armed.map((s) => <tr key={s.nodeId}><td>{s.short}</td><td>{shown(s, s.rounds)} / {shown(s, s.def.magazine)}</td><td>{s.def.fire === 'beam' ? 'Recharges' : s.storage}</td><td>{shown(s, s.fired)}</td><td>{magazineWord(s, s.def)}</td></tr>)}
          {!armed.length && <tr><td colSpan="5" className="muted">No launchers or lasers placed yet</td></tr>}
        </tbody>
      </table>
      <ResupplyButton />
      <div className="muted">Sensors and jammers use no rounds. {packed ? 'With a deployment pack the budget is no limit, so the magazines are: every shot is counted in the cost below.' : 'Every shot also comes out of the budget below, so you can run out of either.'} You can resupply between waves.</div>
    </div>
  );
}

export function CostTab({ active }) {
  useTick(active);
  const { sim } = useGame();
  const { net, ledger, state } = sim;
  const launched = enemyCost(ledger.launched), destroyed = enemyCost(ledger.killed);
  const capex = ledger.capex, shots = ledger.consumables, spend = capex + shots;
  return (
    <>
      <MagazineDepth structures={sim.structures} packed={state.packed} />
      {!state.packed && <div className="sys">
        <div className="sys-h"><b>Budget</b> <span className="muted">{pounds(ECONOMY.budget)} for the whole run</span></div>
        <div className="budget-bar"><span className="b-capex" style={{ width: pct(capex) }} /><span className="b-shots" style={{ width: pct(shots) }} /></div>
        <div className="muted">Systems {pounds(capex)} ({pct(capex)}) · shots and rounds bought {pounds(shots)} ({pct(shots)}) · <b>left {pounds(state.budget)}</b></div>
      </div>}
      <div className="sys">
        <div className="sys-h"><b>Cost exchange</b></div>
        <div><span className="k">Enemy attack</span> {pounds(launched)} launched, {pounds(destroyed)} of it destroyed</div>
        <div><span className="k">Defence</span> {pounds(spend)} ({pounds(capex)} systems + {pounds(shots)} shots)</div>
        <div><span className="k">Per £1 destroyed</span> {destroyed ? `£${(shots / destroyed).toFixed(2)} of shots · £${(spend / destroyed).toFixed(2)} including systems` : '–'}</div>
        <div className="muted">Under 1.00 means each pound of shots destroys more than a pound of enemy hardware. Jammers cost nothing per use; {sum(ledger.killedBy.jammer || {})} kills so far came from jamming.</div>
      </div>
      <div className="sys"><div className="sys-h"><b>Laydown</b></div><LaydownTable net={net} ledger={ledger} /></div>
      <div className="sys">
        <div className="sys-h"><b>Shots fired</b></div>
        <table className="mini">
          <thead><tr><th>Effector</th><th>Per shot</th><th>Shots</th><th>Spent</th><th>Kills</th><th>Per kill</th></tr></thead>
          <tbody>
            {Object.values(STRUCTURES).filter((d) => d.shotCost > 0).map((d) => {
              const fired = ledger.shots[d.id] || { n: 0, cost: 0 }, kills = sum(ledger.killedBy[d.id] || {});
              return <tr key={d.id}><td>{d.name}</td><td>{pounds(d.shotCost)}</td><td>{fired.n}</td><td>{pounds(fired.cost)}</td><td>{kills}</td><td>{kills ? pounds(fired.cost / kills) : '–'}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
      <div className="sys">
        <div className="sys-h"><b>Enemy attack</b> <span className="muted">cost to the attacker per drone</span></div>
        <table className="mini">
          <thead><tr><th>Drone</th><th>Each</th><th>Launched</th><th>Destroyed</th><th>Leaked</th><th>Left</th><th>Attack cost</th></tr></thead>
          <tbody>
            {Object.values(DRONES).filter((d) => !d.variantOf || ledger.launched[d.id]).map((d) => {
              const l = ledger.launched[d.id] || 0;
              return <tr key={d.id}><td><i style={{ background: hex(d.color) }} />{d.name}</td><td>{pounds(d.cost)}</td><td>{l}</td><td>{ledger.killed[d.id] || 0}</td><td>{ledger.leaked[d.id] || 0}</td><td>{ledger.escaped[d.id] || 0}</td><td>{pounds(l * d.cost)}</td></tr>;
            })}
          </tbody>
        </table>
        <div className="muted">Leaked = reached the site. Left = a spotter that withdrew after its time on station, or a strike that drifted away.</div>
      </div>
      <div className="sys">
        <div className="sys-h"><b>Where the enemy costs come from</b></div>
        {Object.values(DRONES).map((d) => (
          <div className="cost-src" key={d.id}>
            <b>{d.name}</b> {pounds(d.cost)}: {d.costRef.note} <span className="conf">{d.costRef.confidence}</span><br /><SourceLinks sources={d.costRef.sources} />
          </div>
        ))}
      </div>
    </>
  );
}
