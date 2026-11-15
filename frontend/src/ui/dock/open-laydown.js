// Open a laydown that did not come from the player's own account (a file from disk, or one the lab wrote) as the current run, without
// saving it. Checks it first, so a bad file leaves the run alone. Resolves to a note for the player; throws an Error with its reason.

import { COMMS, PEOPLE_LIMITS, STRUCTURES, WORLD } from '../../sim/config/index.js';
import { zoneFromSpec } from '../../zone.js';

// A file skips the server, so the limits the server holds a saved laydown to (LaydownSpec in backend/app/schemas.py) are applied here.
// What the game cleans for itself when it restores one (settings, the attack, the area, a patrol's column) is left to it.
const MAX_SYSTEMS = 200, MAX_POINTS = 32, LINKS = ['starlink', 'cellular'], EDGE = WORLD.radius / WORLD.metresPerUnit;
const onMap = (v) => Number.isFinite(v) && Math.abs(v) <= EDGE;
const band = (b) => b == null || Object.hasOwn(COMMS.cellular.bands, b);
const list = (a, most, ok) => Array.isArray(a) && a.length <= most && a.every(ok);
const okSystem = (l) => l && Object.hasOwn(STRUCTURES, l.id) && onMap(l.x) && onMap(l.z) && (l.uplink == null || LINKS.includes(l.uplink)) && band(l.cellBand)
  && (l.jam == null || Array.isArray(l.jam)) && (l.settings == null || typeof l.settings === 'object');
const okPoint = (p) => Array.isArray(p) && onMap(p[0]) && onMap(p[1]);
export const readable = (spec) => list(spec?.structures, MAX_SYSTEMS, okSystem) && list(spec.fusionUplinks, 2, (k) => LINKS.includes(k)) && band(spec.fusionCell)
  && (spec.people == null || list(spec.people, PEOPLE_LIMITS.groups, (g) => g && onMap(g.x) && onMap(g.z)))
  && [spec.zone, spec.patrol].every((points) => points == null || list(points, MAX_POINTS, okPoint));

// here: lay it out round the site on the ground in play now, instead of switching to the ground it was made for.
export async function openLaydown(game, saved, fallbackName, here = false) {
  const spec = saved?.spec || saved, world = typeof saved?.world === 'string' ? saved.world : game.sim.state.terrainSeed;
  if (!readable(spec)) throw new Error('That file is not a laydown this game can read.');
  const problem = here ? game.commands.loadLaydownHere(spec) : (await game.ensureWorld(world)) || game.commands.loadLaydown(spec, world);
  if (problem) throw new Error(problem);
  game.setViewOption('zone', zoneFromSpec(spec));
  return `Opened ${spec.structures.length} systems from "${saved.name || fallbackName}"${here ? ' round this site' : ''}. It is not saved: use Save to keep it.`;
}
