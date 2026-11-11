// After the site falls: what got through, and a look back at the first leak. The run is over, so showing the truth is fine.

import { DRONES } from '../../sim/config/index.js';
import { liveStats } from '../../sim/stats.js';
import { useGame } from '../hooks.js';

const ADVICE = {
  fo: 'low, radio silent and hard to see. Try more radar or camera cover, then rehearse it in the sandbox.',
  fpv: 'fast and agile, but it uses a radio link. Try jammers and interceptors, then rehearse it in the sandbox.',
  fw: 'fast, high and out of reach of interceptors. Try a missile or a laser, then rehearse it in the sandbox.',
};

export function Debrief({ onReview }) {
  const game = useGame();
  const { ledger, rec } = game.sim;
  const n = (counts, type) => counts[type] || 0;
  // a drone hit you if it reached the site or came down on one of your systems: counting only the site left most of a wave out
  const hit = Object.fromEntries(liveStats(game.sim).types.map((t) => [t.id, t.leaked + t.struck]).filter(([, count]) => count));
  const worst = Object.keys(hit).sort((a, b) => hit[b] - hit[a])[0];
  const replay = game.getReplay();
  const t0 = rec.frames.length ? rec.frames[0].t : 0;
  const leak = rec.events.find((e) => e.type === 'leak' && e.t >= t0);
  const review = () => {
    replay.enter(Math.max(rec.frames.findIndex((f) => f.t >= leak.t) - 4, 0)); // a couple of seconds before it, to see it coming
    onReview();
  };
  return (
    <div id="debrief">
      <div className="wz-debrief-head">WIZARD DEBRIEF</div>
      <h2>What got through</h2>
      <table className="wz-matrix">
        <thead><tr><th scope="col">Drone</th><th scope="col">Launched</th><th scope="col">Killed</th><th scope="col">Hit you</th></tr></thead>
        <tbody>
          {Object.values(DRONES).filter((d) => !d.variantOf || ledger.launched[d.id]).map((d) => (
            <tr key={d.id} className={d.id === worst ? 'gap' : ''}>
              <th scope="row">{d.name}</th><td>{n(ledger.launched, d.id)}</td><td>{n(ledger.killed, d.id)}</td><td>{n(hit, d.id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {worst && <p>{DRONES[worst].name} did the most damage: {ADVICE[DRONES[worst].variantOf ?? worst] || 'see how it got through on the timeline.'}</p>}
      {replay && leak && <div className="wz-actions"><button className="wz-go" id="btn-first-leak" onClick={review}>Replay the first leak</button></div>}
    </div>
  );
}
