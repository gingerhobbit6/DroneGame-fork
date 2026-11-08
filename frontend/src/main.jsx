import { createRoot } from 'react-dom/client';
import { cleanSeed, createGame } from './game.js';
import { parseWorldId } from './sim/world-pack.js';
import { App } from './ui/App.jsx';
import './style.css';
import './mobile.css'; // last, so its narrow-screen rules win over the desktop ones

// The scenario seed fixes every chance event: wave contents, sensor noise, message IDs. The terrain seed is separate, so you
// can change the attack without changing the ground.
const params = new URLSearchParams(location.search);
const terrain = cleanSeed(params.get('terrain'));
const game = createGame({ seed: cleanSeed(params.get('seed')), terrainSeed: parseWorldId(terrain) ? '1' : terrain }); // a real world's pack is not loaded yet, and its site does not belong in a URL
createRoot(document.getElementById('root')).render(<App game={game} />);
addEventListener('pagehide', game.pageClosing); // a run still going when the page closes is kept, and saved next time
game.saver.flush();

// for the console and scripted browser runs
if (import.meta.env.DEV) window.game = game;
