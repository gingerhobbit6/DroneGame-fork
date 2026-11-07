// What each wizard step says and does. Names, prices and ranges come from the config, so edits cannot make the words wrong.
// Anything that changes the game goes through commands, so a run can still be reproduced.

import { useEffect, useRef } from 'react';
import { useAccount } from '../account/pack.js';
import { BUILD, DRONES, DRONE_CLASSES, ECONOMY, FUSION, SITE, STRUCTURES } from '../../sim/config/index.js';
import { money } from '../../sim/economy.js';
import { view } from '../../render/view.js';
import { closeZone, ringZone, undoZonePoint } from '../../zone.js';
import { zoneScores } from '../coverage.js';
import { ThreatOptions } from '../ThreatOptions.jsx';
import { ATTACK_NOTE, CoverageBars } from '../ZonePanel.jsx';
import { useGame } from '../hooks.js';
import { PeopleStep } from './PeopleStep.jsx';
import { Spotlight } from './Spotlight.jsx';
import { answer, effectorColumns, effectorFor, kindName, kitLeft, sensorChecklist, unanswered, warningAgainst } from './guide.js';
import { suggestSpot } from './spots.js';

const WEAK = 0.5; // below this share of the zone, the wizard calls a drone type a weak spot
const RF_DEAF = DRONE_CLASSES.filter((d) => !d.rfEmitter).map((d) => d.name).join(' and ');
const SENSOR_TEXT = {
  radar: 'Finds most drones. Low flyers hide in clutter until close.',
  rf: `Hears radio links: direction, but no range. Deaf to ${RF_DEAF}.`,
  camera: 'Narrow view, cued by other sensors. Names what it sees.',
  acoustic: 'Listens for engines, so radio silence does not hide a drone. Short reach against quiet ones.',
};
const km = (metres) => `${(metres / 1000).toFixed(1).replace(/\.0$/, '')} km`;
const planned = () => (view.threat ? [DRONES[view.threat]] : DRONE_CLASSES);
const warningText = (def, d) => (warningAgainst(def, d) ? `${Math.round(warningAgainst(def, d))} s` : 'none');

function GoodSpot({ def, label = 'Show me a good spot' }) {
  const game = useGame();
  const show = () => {
    // a system of this kind the player has already picked from the toolbar stands, over the wizard's choice
    const held = STRUCTURES[game.getTool()], use = held && held.kind === def.kind ? held : def;
    if (game.getTool() !== use.id) game.setTool(use.id);
    const spot = suggestSpot(game.sim, use, view.zone);
    game.setViewOption('spot', spot);
    if (!spot) { game.toast(`Nowhere nearby will take a ${use.name}, or the budget is too low`); return; }
    const popup = document.querySelector('#wizard'), panel = document.querySelector('#hud-top-right');
    if (popup && panel) game.reveal(spot.x, spot.z, (popup.getBoundingClientRect().right + panel.getBoundingClientRect().left) / 2, innerHeight / 2); // the popup must not hide it
  };
  return <button className="wz-go" onClick={show}>{label}</button>;
}

// Exactly what to do to place this system: open its kind's list, find it there, then drag it onto the map. The ring moves to
// whatever the player has to use next, and a system of the same kind they picked themselves stands over the recommendation.
function PlaceSteps({ def }) {
  const game = useGame(), pack = useAccount()?.activeUnit;
  const held = STRUCTURES[game.getTool()], use = held && held.kind === def.kind ? held : def;
  const stage = game.getTool() === use.id ? 3 : game.catalogue() === def.kind ? 2 : 1;
  const target = stage === 1 ? `[data-catalogue="${def.kind}"]` : stage === 2 ? `[data-pick="${use.id}"]` : null;
  const list = useRef(null);
  useEffect(() => { // both what to use next and the step that says so must be on screen, in their own scrolling panels
    if (target) document.querySelector(target)?.scrollIntoView?.({ block: 'nearest' });
    list.current?.querySelector('.now')?.scrollIntoView?.({ block: 'nearest' });
  }, [target]);
  const mark = (n) => (n < stage ? 'done' : n === stage ? 'now' : undefined);
  return (
    <>
      {target && <Spotlight selector={target} />}
      <ol className="wz-steps" id="wz-place" aria-label="What to do" ref={list}>
        <li className={mark(1)}>Click <b>{kindName(def.kind)}</b> in the toolbar on the left. Its list of real systems opens beside it.</li>
        <li className={mark(2)}>Find <b>{use.product}</b> in that list, {money(use.cost)}. The lime ring shows where it is.</li>
        <li className={mark(3)}>Drag it onto the map and let go where you want it{view.spot ? ', on the lime marker' : ''}. Or click it, then click the map.</li>
      </ol>
      {pack?.assets.systems.some((l) => l.id === use.id) && <p className="wz-small">It is in your deployment pack too: you can drag it from the pack tray at the top of the toolbar instead.</p>}
    </>
  );
}

function Refusal() {
  const why = useGame().lastRefusal();
  return why ? <p className="wz-warn wz-small">Last try: {why}.</p> : null;
}

const SpotReason = () => (view.spot && view.spot.why ? <p id="wz-spot-why" className="wz-small">{view.spot.why}</p> : null);

function ZoneStep({ next }) {
  const game = useGame();
  const zone = view.zone, closed = !!(zone && zone.closed), count = zone && !closed ? zone.points.length : 0;
  const set = (z) => game.setViewOption('zone', z);
  useEffect(() => {
    if (!(view.zone && view.zone.closed) && game.getTool() !== 'zone') game.setTool('zone');
    return () => { if (game.getTool() === 'zone') game.setTool('zone'); };
  }, [game]);
  return (
    <>
      <p>Draw the area you want to defend, anywhere on the map. It becomes the site: the attack comes for it, and you can build anywhere. With no area drawn, drones go for the red ring, and you build from {BUILD.minDist} m out to the blue ring at {km(BUILD.maxDist)}.</p>
      {closed ? <p>Your zone is drawn on the map. The attack now comes for it, and I will use it to score your sensor coverage.</p> : <p>Click the map to outline the area you care about, then double-click to close it. I will use it to score your sensor coverage.</p>}
      <p className="wz-small wz-muted">{ATTACK_NOTE}</p>
      <div className="wz-actions">
        {closed
          ? <><button className="wz-go" onClick={next}>Next</button><button onClick={() => { set(null); if (game.getTool() !== 'zone') game.setTool('zone'); }}>Redraw</button></>
          : <><button className="wz-go" disabled={count < 3} onClick={() => { set(closeZone(zone)); if (game.getTool() === 'zone') game.setTool('zone'); }}>Close the zone</button><button onClick={() => { set(ringZone(1000)); if (game.getTool() === 'zone') game.setTool('zone'); }}>Use a 1 km ring</button></>}
      </div>
      {!closed && (
        <div className="wz-actions wz-quiet">
          {count > 0 && <button onClick={() => set(undoZonePoint(zone))}>Undo point</button>}
          <button onClick={next}>Skip this step</button>
        </div>
      )}
    </>
  );
}

function ThreatPicker() {
  const game = useGame();
  return (
    <label className="wz-threat">Plan against
      <select id="wz-threat" value={view.threat ?? ''} onChange={(e) => game.setViewOption('threat', e.target.value || null)}>
        <option value="">Every type of drone</option>
        <ThreatOptions />
      </select>
    </label>
  );
}

function SensorsStep({ next }) {
  const { sim } = useGame();
  const rows = sensorChecklist(sim, planned()), now = rows.find((r) => !r.done);
  return (
    <>
      <p>Undetected drones cannot be targeted, and no one sensor sees them all.</p>
      {sim.state.kit && <p className="wz-small">{rows.length ? 'Planning with your deployment pack: only the sensors it holds.' : 'Your deployment pack holds no sensors. Add some with Edit this pack in the pack tray.'}</p>}
      <ThreatPicker />
      <div className="wz-list">
        {rows.map((r) => (
          <div key={r.kind}>
            <span className={`wz-tag${r === now ? ' now' : ''}`}>{r.done ? 'DONE' : r === now ? 'NOW' : 'THEN'}</span>
            <b>{r.name}</b><br />{SENSOR_TEXT[r.kind]}
            {r === now && (
              <p id="wz-advice" className="wz-small">
                For {view.threat ? DRONES[view.threat].name : 'every type of drone'}: <b>{r.def.product}</b>, {money(r.def.cost)}. Warning it gives: {r.threats.map((d) => `${d.label} ${warningText(r.def, d)}`).join(', ')}.
              </p>
            )}
          </div>
        ))}
      </div>
      {now && <PlaceSteps def={now.def} />}
      <SpotReason />
      <Refusal />
      <div className="wz-actions">
        {now ? <GoodSpot def={now.def} /> : <button className="wz-go" onClick={next}>Next</button>}
        {now && <button className="wz-narrow" onClick={next}>Next</button>}
      </div>
    </>
  );
}

function EffectorsStep({ next }) {
  const { sim } = useGame();
  const columns = effectorColumns(), have = new Set(sim.structures.map((s) => s.def.kind));
  const kit = kitLeft(sim), gap = unanswered(sim)[0], fix = gap && effectorFor(gap, kit ? Infinity : sim.state.budget, kit);
  const spotter = Object.values(DRONES).find((d) => d.loiterDist);
  return (
    <>
      <p>Match weapons to drones. No single system handles them all.</p>
      <table className="wz-matrix">
        <thead><tr><th scope="col">Drone</th>{columns.map((c) => <th scope="col" key={c.id} className={have.has(c.kind) ? 'have' : ''}>{kindName(c.kind)}</th>)}</tr></thead>
        <tbody>
          {[...new Set([...DRONE_CLASSES, ...planned()])].map((d) => (
            <tr key={d.id} className={gap && gap.id === d.id ? 'gap' : ''}>
              <th scope="row">{d.name}</th>
              {columns.map((c) => <td key={c.id} className={have.has(c.kind) ? 'have' : ''}>{answer(d, c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="wz-small wz-muted">Last: kept for close calls, at {money(STRUCTURES.missile.shotCost)} a shot against a {money(DRONES.fpv.cost)} drone. Far: spotters orbit {km(spotter.loiterDist)} out and a laser reaches {km(STRUCTURES.laser.range)}.</p>
      {gap && fix && <p className="wz-warn">Nothing answers {gap.name} yet. For that threat{kit ? ', from your pack' : ''}: {kindName(fix.kind)}, {fix.product}, {money(fix.cost)}.</p>}
      {gap && !fix && <p className="wz-warn">Nothing answers {gap.name} yet, and nothing left in your deployment pack would. Add a system to the pack that does, or plan around it.</p>}
      {fix && <PlaceSteps def={fix} />}
      <p>{money(sim.state.budget)} left. Every shot comes out of this too, and nothing is earned back.</p>
      <SpotReason />
      <Refusal />
      <div className="wz-actions">
        {fix ? <GoodSpot def={fix} /> : <button className="wz-go" onClick={next}>Next</button>}
        {fix && <button className="wz-narrow" onClick={next}>Next</button>}
      </div>
    </>
  );
}

function NetworkStep({ next }) {
  const { sim, commands } = useGame();
  const total = sim.structures.length, loose = sim.unwired().length, fusion = sim.net.fusion.uplinks.size > 0;
  const ready = total > 0 && !loose && fusion;
  return (
    <>
      {!ready && <Spotlight selector="#net-auto" />}
      <p>Every system is a SAPIENT node. Without a link it cannot report or be tasked.</p>
      {ready
        ? <p>All {total} systems are connected, and the fusion node has its terminals.</p>
        : <p className="wz-warn">{loose} of {total} systems are offline{fusion ? '' : ', and the fusion node has no terminal'}.</p>}
      <p>Auto-wire uses cellular where a tower reaches well, otherwise Starlink, and gives the fusion node both. You can change any link by hand.</p>
      <div className="wz-actions">
        {ready ? <button className="wz-go" onClick={next}>Next</button> : <button className="wz-go" onClick={() => commands.autoWire()}>Auto-wire for me</button>}
        {!ready && <button className="wz-narrow" onClick={next}>Next</button>}
      </div>
    </>
  );
}

function CoverageStep({ next, goTo }) {
  const game = useGame();
  const scores = zoneScores(game.sim, view.zone), weakest = scores[0];
  const weak = weakest.share < WEAK;
  useEffect(() => {
    game.setViewOption('coverageOn', true);
    game.setViewOption('coverageThreat', weakest.id);
  }, [game, weakest.id]);
  return (
    <>
      <p>How much of {view.zone && view.zone.closed ? 'your zone' : 'the build area'} is seen, for each drone type. They fly at different heights, and some make no radio noise.</p>
      <CoverageBars scores={scores} gap={weak ? weakest : null} />
      {weak && <p className="wz-warn">{weakest.name} is your weak spot{DRONES[weakest.id].rfEmitter ? '.' : ': it makes no radio noise, so only radar and cameras count.'}</p>}
      <div className="wz-actions">
        <button className={weak ? 'wz-go' : ''} onClick={() => goTo('sensors')}>Go back and add a sensor</button>
        <button className={weak ? 'wz-narrow' : 'wz-go wz-narrow'} onClick={next}>Next</button>
      </div>
    </>
  );
}

function RehearseStep({ next, passed }) {
  const { sim, commands } = useGame();
  const { state, drones } = sim;
  const weakest = view.threat ? DRONES[view.threat] : zoneScores(sim, view.zone)[0];
  return (
    <>
      {!state.sandbox && <Spotlight selector="#btn-sandbox" />}
      <p>Nothing in the sandbox can hurt the site, and shots are free. You can still move systems. Try the drone you are {view.threat ? 'planning against' : 'weakest against'}.</p>
      {state.sandbox && <p className="wz-warn">In the air {drones.length} · waiting {state.sbQueue.length} · reached the site {state.leaks}</p>}
      <p className="wz-small wz-muted">Leaving the sandbox resets the run and keeps your systems.</p>
      <div className="wz-actions">
        {state.sandbox
          ? <>
              <button className="wz-go" onClick={() => { passed.rehearsed = true; commands.launchSandboxAttack({ type: weakest.id, bearingDeg: 'rand', count: 10, gap: 4 }); }}>Launch 10 {weakest.name}</button>
              <button onClick={() => { commands.exitSandbox(); next(); }}>Exit and go on</button>
            </>
          : <>
              <button className="wz-go" onClick={() => commands.enterSandbox()}>Enter the sandbox</button>
              <button className="wz-narrow" onClick={next}>Next</button>
            </>}
      </div>
    </>
  );
}

const ASSUMPTION = '[data-pane="systems"] .fb.assumption';

function RefineStep({ next }) {
  return (
    <>
      <Spotlight selector={ASSUMPTION} />
      <p>Most figures are vendor claims. If you have a better number, use it. It applies at once, to every unit of that type.</p>
      <ol className="wz-steps">
        <li>Start with anything marked ASSUMPTION: it has no verified source.</li>
        <li>Type your figure. The arrow puts the original back.</li>
        <li>Save it as a named set, so you can repeat the run.</li>
      </ol>
      <p className="wz-warn">Runs on different figures are not comparable.</p>
      <div className="wz-actions">
        <button className="wz-go" onClick={() => document.querySelector(ASSUMPTION)?.scrollIntoView?.({ block: 'center' })}>Show the first assumption</button>
        <button className="wz-narrow" onClick={next}>Skip</button>
      </div>
    </>
  );
}

function Check({ ok, children }) {
  return <div className={ok ? '' : 'wz-warn'}><span className="wz-check">{ok ? 'OK' : 'CHECK'}</span>{children}</div>;
}

function PreflightStep({ goTo, openDock, passed, status }) {
  const { sim, commands } = useGame();
  const { state } = sim;
  const count = (role) => sim.structures.filter((s) => s.def.role === role).length;
  const weakest = zoneScores(sim, view.zone)[0], weak = weakest.share < WEAK;
  return (
    <>
      <Spotlight selector="#btn-wave" />
      <div className="wz-checks">
        <Check ok={status.sensors}>Sensors: {count('sensor')} placed</Check>
        <Check ok={status.effectors}>Effectors: {count('effector')} placed</Check>
        <Check ok={status.network}>Network: {sim.unwired().length ? `${sim.unwired().length} offline` : 'all connected'}</Check>
        <Check ok={!!passed.rehearsed}>{passed.rehearsed ? 'Rehearsed in the sandbox' : 'Not rehearsed yet'}</Check>
        <Check ok={!weak}>{weak ? `Coverage is weak against ${weakest.name}` : 'Coverage looks reasonable'}</Check>
      </div>
      <fieldset className="wz-radio">
        <legend>Who decides to fire?</legend>
        {[['auto', 'Automatic'], ['costly', 'Ask me for costly shots'], ['all', 'Ask me for every engagement']].map(([value, label]) => (
          <label key={value}><input type="radio" name="wizard-authority" checked={FUSION.authority === value} onChange={() => commands.setAuthority(value)} /> {label}</label>
        ))}
      </fieldset>
      <div className="wz-actions wz-quiet"><button onClick={() => openDock('saved')}>Save this laydown first</button></div>
      <p className="wz-warn">Starting locks your systems and wiring for the whole run. Jam bands stay live, and Reset run starts again.</p>
      <div className="wz-actions">
        <button className="wz-go" disabled={state.sandbox} onClick={() => commands.startWave()}>{state.sandbox ? 'Exit the sandbox first' : 'Start wave 1'}</button>
        {weak && <button className="wz-narrow" onClick={() => goTo('coverage')}>Fix</button>}
      </div>
    </>
  );
}

// title, what the step does, and the questions a new player tends to ask at that point
export const STEPS = {
  zone: { title: 'Mark what you are defending', Body: ZoneStep, why: [
    ['Why draw a zone?', 'It is what the enemy attacks, and it tells me what to score. Coverage only means something against the ground you care about.'],
    ['Does it change the attack?', 'Yes. Strike drones aim for spots inside it instead of the station, and spotters circle it. The same seed, laydown and zone still give the same run.'],
  ] },
  sensors: { title: 'See them first', Body: SensorsStep, why: [
    ['Why a radar first?', 'It gives range as well as direction, so tracks are sharp. The other sensors make up for what it misses.'],
    ["Why can't an RF detector see every drone?", `It only hears radio. ${RF_DEAF} make none.`],
    ['Why this one, and not a bigger one?', 'The faster a threat flies, the further out you must see it. I pick the cheapest system that gives about a minute of warning of the most threats. Pick a different one from the toolbar if you prefer.'],
    ['Where should it go?', 'High, open ground sees further. Trees block low flyers, and strike drones go for loud emitters.'],
  ] },
  effectors: { title: 'Stop what you can see', Body: EffectorsStep, why: [
    ['Why not buy the most expensive one?', `The budget is ${money(ECONOMY.budget)} for the whole run, shots included, and the attack is far cheaper than your answer to it.`],
    ['What if I cannot afford them all?', 'Selling gives a full refund until the first wave, so you can change your mind.'],
  ] },
  network: { title: 'Connect it', Body: NetworkStep, why: [
    ['What happens without it?', 'An unwired system is offline: it cannot report what it sees or be told what to engage.'],
    ['Can my own jammers hurt this?', 'Yes. The Spectrum tab shows where your jamming overlaps your own links.'],
  ] },
  coverage: { title: 'Check what it can see', Body: CoverageStep, why: [
    ['Why is one drone so much lower?', 'Each type flies at its own height. Low flyers are hidden by hills and trees for longer.'],
    ['What do the colours mean?', 'Red is unseen, green is one sensor, blue is two, and white is three or more.'],
  ] },
  people: { title: 'Who is on site?', optional: true, Body: PeopleStep, why: [
    ['Do I need to do this?', 'No. People change nothing about the attack. They only show what a blast near them would do.'],
    ['Where do the casualty numbers come from?', 'Assumed round figures, marked ASSUMPTION in the Sources tab. They are not weapons-effects data.'],
  ] },
  rehearse: { title: 'Rehearse before it counts', Body: RehearseStep, why: [
    ['Why rehearse?', 'The laydown locks at the first wave. Here you can still fix what you find.'],
  ] },
  refine: { title: 'Make the figures yours', optional: true, Body: RefineStep, why: [
    ['Do I need to do this?', 'No. The figures work as they are, and you can come back to them at any time.'],
    ['Can I trust these numbers?', 'They are mostly vendor claims and labelled assumptions. This is a teaching tool, not a basis for real decisions.'],
  ] },
  preflight: { title: 'Ready to commit?', Body: PreflightStep, why: [
    ['What does engagement authority change?', 'Whether the fusion node fires by itself or asks you first. SAPIENT has no weapon-release message, so this is a C2 policy.'],
  ] },
};
