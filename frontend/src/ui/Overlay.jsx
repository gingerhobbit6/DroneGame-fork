// The start screen before deployment, and the game over card.

import { useState } from 'react';
import { ECONOMY, PEOPLE } from '../sim/config/index.js';
import { money } from '../sim/economy.js';
import { cleanSeed } from '../game.js';
import { view } from '../render/view.js';
import { parseWorldId } from '../sim/world-pack.js';
import { Debrief } from './assistant/Debrief.jsx';
import { DeploymentReport } from './DeploymentReport.jsx';
import { RunStats } from './RunStats.jsx';
import { useGame, useTick } from './hooks.js';
import { WorldPicker } from './WorldPicker.jsx';
import { ConditionsPicker } from './ConditionsPicker.jsx';
import { PackPicker } from './account/PackPicker.jsx';
import { Movable } from './Movable.jsx';

const STAGES = [['1. See', 'Place sensors'], ['2. Stop', 'Place effectors'], ['3. Connect', 'Network it all'], ['4. Prove', 'Rehearse, then fight']];

function StartCard({ openDock }) {
  const game = useGame();
  const { sim, commands } = game;
  const [seed, setSeed] = useState(sim.state.seed);
  const onRealMap = !!parseWorldId(sim.state.terrainSeed); // after leaving one, its world string is no use as a terrain seed
  const [terrain, setTerrain] = useState(onRealMap ? '1' : sim.state.terrainSeed);
  const [realWorld, setRealWorld] = useState(null); // a world string, once a real map and start point are chosen
  const [wantReal, setWantReal] = useState(!!view.startAt || onRealMap);
  const [guiding, setGuiding] = useState(false); // the guide starts here on a real map, because where to defend comes first
  const deploy = () => {
    const s = cleanSeed(seed.trim());
    if (wantReal) {
      const problem = commands.deploy(s, realWorld);
      if (problem) { game.toast(problem); return false; }
      history.replaceState(null, '', `?seed=${encodeURIComponent(s)}`); // the site never goes in a URL
      return true;
    }
    const t = cleanSeed(terrain.trim());
    commands.deploy(s, t);
    history.replaceState(null, '', `?seed=${encodeURIComponent(s)}&terrain=${encodeURIComponent(t)}`);
    return true;
  };
  const notChosen = wantReal && !realWorld;
  const onSiteStep = guiding && wantReal;
  const guide = () => {
    if (wantReal && !guiding) { setGuiding(true); return; }
    if (deploy()) game.setViewOption('wizard', 'open');
  };
  return (
    <Movable className={wantReal ? 'card welcome picking' : 'card welcome'} title="Start">
      <div className="wz-debrief-head">SITE GUARD</div>
      <h1>Defend a site</h1>
      <p className="lead">You place and network sensors and weapons, from a deployment pack or on a {money(ECONOMY.budget)} budget, then watch your system try to find and stop inbound drones. The heart of it is the gap between where drones really are and where your system believes they are.</p>
      {!wantReal && <div className="stages">{STAGES.map(([head, text]) => <div key={head}><b>{head}</b>{text}</div>)}</div>}
      <p className="muted">A game and a teaching tool. Most figures are vendor claims or labelled assumptions, so do not base real decisions on it.</p>
      <WorldPicker wantReal={wantReal} onWantReal={setWantReal} onWorld={setRealWorld} guiding={onSiteStep} onStopGuiding={() => setGuiding(false)} />
      <PackPicker />
      <div className="start-conditions"><ConditionsPicker id="start-conditions" /></div>
      <details className="seeds">
        <summary>Advanced: scenario and terrain seeds</summary>
        <div className="seed-row">
          <label htmlFor="seed-input">Scenario seed</label>
          <input id="seed-input" type="text" spellCheck="false" maxLength={64} value={seed} onChange={(e) => setSeed(e.target.value)} />
          <button id="btn-seed-random" title="Pick a random seed" onClick={() => setSeed(String(Math.floor(Math.random() * 900000) + 100000))}>Random</button>
        </div>
        <div className="seed-row">
          <label htmlFor="terrain-input">Terrain seed</label>
          <input id="terrain-input" type="text" spellCheck="false" maxLength={64} value={terrain} onChange={(e) => setTerrain(e.target.value)} />
        </div>
        <p className="muted seed-note">The same scenario seed and laydown give the same attack every time. The terrain seed changes the ground (hills, woods, power lines) without changing the attack.</p>
      </details>
      <div className="start-actions">
        <button id="btn-guide" className="wz-go" disabled={onSiteStep && notChosen} onClick={guide}>{!onSiteStep ? 'Guide me through it' : notChosen ? 'Needs a ready map first' : 'Defend here and carry on'}</button>
        <button id="btn-deploy" disabled={notChosen} onClick={deploy}>{notChosen ? 'Choose where to defend' : 'I know the game, just deploy'}</button>
        {openDock && <button id="btn-load-saved" className="quiet" disabled={notChosen} onClick={() => { if (deploy()) openDock('saved'); }}>Load a saved laydown</button>}
      </div>
    </Movable>
  );
}

const casualtySummary = (groups) => Object.entries(PEOPLE)
  .filter(([id]) => groups.some((g) => g.protection === id))
  .map(([id, level]) => {
    const here = groups.filter((g) => g.protection === id);
    const count = (sev) => here.reduce((sum, g) => sum + g.hits.filter((i) => g.down[i] === sev).length, 0);
    return `${level.name.toLowerCase()} ${count(2)} killed and ${count(1)} injured of ${here.reduce((sum, g) => sum + g.count, 0)}`;
  }).join(', ');

function GameOverCard({ onReview }) {
  const { sim, commands, saver } = useGame();
  const { state } = sim;
  return (
    <Movable className="card game-over" title="Results">
      <div>
        <DeploymentReport report={sim.report()} />
        {sim.people.length > 0 && <p id="casualty-summary">Simulated <b>{state.killed}</b> killed and <b>{state.injured}</b> injured of {sim.people.reduce((sum, g) => sum + g.count, 0)}: {casualtySummary(sim.people)}. Each warhead's lethal and injury radii come from assumed figures (see Sources), not real data.</p>}
        {saver.message() && <p id="save-status" className="muted">{saver.message()}</p>}
        <button id="btn-restart" className="primary" onClick={() => commands.reset('keep')}>Retry with the same laydown</button>{' '}
        <button id="btn-restart-clear" onClick={() => commands.reset('clear')}>Clear map</button>
      </div>
      <Debrief onReview={onReview} />
      <RunStats />
    </Movable>
  );
}

export function Overlay({ openDock }) {
  useTick();
  const [reviewing, setReviewing] = useState(false);
  const game = useGame();
  const { state } = game.sim;
  if (state.over) {
    if (reviewing) {
      const back = () => { game.getReplay()?.exit(); setReviewing(false); };
      return <button id="btn-results" className="primary" onClick={back}>Back to the results</button>;
    }
    return <div id="overlay"><GameOverCard onReview={() => setReviewing(true)} /></div>;
  }
  if (reviewing) setReviewing(false); // a new run has started
  if (!state.started) return <div id="overlay"><StartCard openDock={openDock} /></div>;
  return null;
}
