// Open a laydown that did not come from the player's own account (a file from disk, or one the lab wrote) as the current run, without
// saving it. Checks it first, so a bad file leaves the run alone. Resolves to a note for the player; throws an Error with its reason.

import { STRUCTURES } from '../../sim/config/index.js';
import { zoneFromSpec } from '../../zone.js';

export async function openLaydown(game, saved, fallbackName) {
  const spec = saved?.spec || saved, world = typeof saved?.world === 'string' ? saved.world : game.sim.state.terrainSeed;
  const okSystem = (l) => l && Object.hasOwn(STRUCTURES, l.id) && Number.isFinite(l.x) && Number.isFinite(l.z);
  if (!Array.isArray(spec?.structures) || !spec.structures.every(okSystem) || !Array.isArray(spec.fusionUplinks)) throw new Error('That file is not a laydown this game can read.');
  const problem = (await game.ensureWorld(world)) || game.commands.loadLaydown(spec, world);
  if (problem) throw new Error(problem);
  game.setViewOption('zone', zoneFromSpec(spec));
  return `Opened ${spec.structures.length} systems from "${saved.name || fallbackName}". It is not saved: use Save to keep it.`;
}
