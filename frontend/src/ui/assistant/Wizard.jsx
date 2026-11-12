// The wizard: a popup that guides a new player from an empty site to the first wave, and the button that opens it.
// Where it is up to is worked out from the game each time, so loading a laydown or selling a radar moves it. Once a run
// starts it steps back: there are no tips during a wave, so the run plays like a simulation.

import { useEffect, useRef, useState } from 'react';
import { DRONES } from '../../sim/config/index.js';
import { view } from '../../render/view.js';
import { useGame, useTick } from '../hooks.js';
import { STEP_IDS, firstOpen, stepStatus, undone } from './guide.js';
import { STEPS } from './steps.jsx';
import { useMovable } from '../useMovable.js';
import { liveStats } from '../../sim/stats.js';
import { StatsHeadline } from '../RunStats.jsx';

const DOCK_TAB = { network: 'network', coverage: 'propagation', refine: 'systems' };
const Icon = () => <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 8 L13 4" /><circle cx="8" cy="8" r="1" /></svg>;

export function WizardButton() {
  useTick();
  const game = useGame();
  const { started, over } = game.sim.state;
  if (!started || over) return null;
  const open = view.wizard === 'open';
  return <button id="btn-wizard" className={open ? 'on' : ''} onClick={() => game.setViewOption('wizard', open ? 'closed' : 'open')}><Icon /> {open ? 'Close the wizard' : 'Open the wizard'}</button>;
}

function Why({ items }) {
  return (
    <details className="wz-why">
      <summary>Why this step?</summary>
      {items.map(([q, a]) => <p key={q}><b>{q}</b><br />{a}</p>)}
    </details>
  );
}

function MovedBack({ id, onGo, onStay }) {
  const { sim } = useGame();
  const noRadar = id === 'sensors' && !sim.structures.some((s) => s.def.kind === 'radar');
  const text = {
    sensors: noRadar ? ['You removed your only radar', 'Your other sensors give direction but no range, so tracks will be vague. Add a radar, or carry on if that is the test you want.'] : ['Your sensors have changed', 'You now have only one kind of sensor, so it will miss what the others would have seen.'],
    effectors: ['A drone type has no answer now', 'Something you removed was the only answer to one of the drone types.'],
    network: ['Something is offline', 'A system has no link, so it cannot report or be tasked.'],
  }[id];
  return (
    <>
      <h2>{text[0]}</h2>
      <p>{text[1]}</p>
      <div className="wz-actions">
        <button className="wz-go" onClick={onGo}>Go back to that step</button>
        <button onClick={onStay}>Carry on</button>
      </div>
    </>
  );
}

// Opened during a run: what got through so far, and only what can still change.
function RunCard({ openDock }) {
  const { sim } = useGame(), { state, ledger } = sim, stats = liveStats(sim);
  const leaks = Object.entries(ledger.leaked).filter(([, n]) => n > 0);
  return (
    <>
      <h2>Wave {state.wave} {state.waveActive ? 'in progress' : 'held'}</h2>
      <p>{leaks.length ? `Got through so far: ${leaks.map(([type, n]) => `${n} ${DRONES[type].name}`).join(', ')}.` : 'Nothing has reached the site so far.'}</p>
      {stats.drones.launched > 0 && <StatsHeadline stats={stats} onOpen={() => openDock('stats')} />}
      <p>The laydown is locked for this run, but you can still change engagement authority and jam bands. Reset run starts again with the same systems.</p>
    </>
  );
}

export function Wizard({ openDock, closeDock }) {
  useTick();
  const game = useGame();
  const { sim } = game;
  const { started, over, wave } = sim.state;
  const [step, setStep] = useState(0);
  const [moved, setMoved] = useState(null);
  const passed = useRef({}), before = useRef({});
  const { style, handle, wasDragged } = useMovable();
  const open = view.wizard === 'open', live = wave > 0, count = sim.structures.length;
  const status = stepStatus(sim, view.zone);
  const id = STEP_IDS[step], { title, Body, why, optional } = STEPS[id];

  const goTo = (target) => { setMoved(null); setStep(STEP_IDS.indexOf(target)); };
  const next = () => { passed.current[id] = true; setMoved(null); setStep((s) => Math.min(s + 1, STEP_IDS.length - 1)); };

  // opening it lands on the step the game is really at
  useEffect(() => { if (open) setStep(firstOpen(stepStatus(sim, view.zone), passed.current)); }, [open, sim]);

  // the run has started, so it steps back
  useEffect(() => { if (live) game.setViewOption('wizard', 'closed'); else passed.current = {}; }, [live, game]);

  // show the panel each step talks about, and drop an old suggestion
  useEffect(() => {
    if (!open || live) return;
    if (DOCK_TAB[id]) openDock(DOCK_TAB[id]); else closeDock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, live]);
  useEffect(() => { if (view.spot) game.setViewOption('spot', null); }, [game, id, count, open, live]);

  // a new laydown starts the guide again, whether or not it is showing
  useEffect(() => {
    const restart = ({ kept, loading }) => { if (!kept && !loading) { passed.current = {}; setMoved(null); setStep(0); } };
    sim.on('reset', restart);
    return () => sim.off('reset', restart);
  }, [sim]);

  // something finished has come undone
  useEffect(() => {
    const gone = undone(before.current, status);
    before.current = status;
    if (!open || live) return;
    if (gone && count && STEP_IDS.indexOf(gone) < step) setMoved(gone);
    else if (moved && status[moved]) setMoved(null);
  });

  if (!started || over || view.wizard === 'closed') return null;
  if (view.wizard === 'collapsed') {
    return (
      <button id="wizard-pill" data-movable style={style} {...handle} onClick={() => { if (!wasDragged()) game.setViewOption('wizard', 'open'); }}>
        <Icon /><span>{live ? `Wave ${wave}` : `Step ${step + 1} of ${STEP_IDS.length}: ${title}`}</span><b>Open</b>
      </button>
    );
  }
  return (
    <section id="wizard" className="panel" aria-label="Bombadil wizard" data-movable style={style}>
      <div className="wz-head" title="Drag to move. Double-click to put it back." {...handle}>
        <Icon />
        <span>{live ? 'THE RUN IS LIVE' : moved ? `BACK TO STEP ${STEP_IDS.indexOf(moved) + 1} OF ${STEP_IDS.length}` : `STEP ${step + 1} OF ${STEP_IDS.length}${optional ? ' · OPTIONAL' : ''}`}</span>
        <button aria-label="Collapse the wizard" title="Collapse" onClick={() => game.setViewOption('wizard', 'collapsed')}>_</button>
        <button aria-label="Close the wizard" title="Close" onClick={() => game.setViewOption('wizard', 'closed')}>×</button>
      </div>
      {live ? <RunCard openDock={openDock} /> : (
        <>
          <div className="wz-progress">
            {STEP_IDS.map((sid, i) => <button key={sid} aria-label={`Step ${i + 1}: ${STEPS[sid].title}`} title={STEPS[sid].title} className={i <= step ? 'on' : ''} onClick={() => goTo(sid)} />)}
          </div>
          {moved
            ? <MovedBack id={moved} onGo={() => goTo(moved)} onStay={() => setMoved(null)} />
            : (
              <>
                <h2 aria-live="polite">{title}</h2>
                <Body next={next} goTo={goTo} openDock={openDock} passed={passed.current} status={status} />
                <Why items={why} />
              </>
            )}
        </>
      )}
    </section>
  );
}
