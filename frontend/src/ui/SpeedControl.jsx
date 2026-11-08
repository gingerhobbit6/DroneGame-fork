// Game speed: play or pause, and how fast simulated time runs, from 1x to 10x. Space pauses and resumes. Steps are fixed in size,
// so the same laydown and seed give the same run at any speed.

import { WORLD } from '../sim/config/index.js';
import { useGame, useTick } from './hooks.js';
import './speed-control.css';

const SPEEDS = [1, 2, 3, 4, 5, 10];
const ICON = { pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z', play: 'M8 5.5v13l10.5-6.5z' };

export function SpeedControl() {
  useTick();
  const game = useGame();
  const { speed, lastSpeed } = game.clock;
  const running = speed > 0, resume = SPEEDS.includes(lastSpeed) ? lastSpeed : 1;
  const at = SPEEDS.indexOf(running ? speed : resume); // while paused, the marker waits on the speed play resumes at
  return (
    <div id="speed-control" className={running ? 'running' : 'paused'} role="group" aria-label="Game speed">
      <button id="speed-play" aria-label={running ? 'Pause' : `Play at ${resume}x`} title={running ? 'Pause (Space)' : `Play at ${resume}x (Space)`} onClick={() => game.setSpeed(running ? 0 : resume)}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d={running ? ICON.pause : ICON.play} fill="currentColor" /></svg>
      </button>
      <div className="speed-track" style={{ '--count': SPEEDS.length, '--at': Math.max(at, 0) }}>
        <span className="speed-thumb" aria-hidden="true" />
        {SPEEDS.map((s) => (
          <button key={s} className={`speed${speed === s ? ' active' : ''}`} data-speed={s} aria-pressed={speed === s} title={`${s}x: ${s * WORLD.timeScale} s of simulated time each second`} onClick={() => game.setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
