// What the enemy goes for. FPV and FO strikes look for the loudest radio emitter near them and go for that instead of the
// site: a radar, a jammer that is switched on, a system with a Starlink or cellular terminal. Everything else heads for its own
// target in the area the player drew (one of the systems, people or buildings there), or for the station if there is none.

import { WORLD, COMMS, STRUCTURES } from './config/index.js';
import { u, hdist, hereU } from './units.js';
import { tally } from './economy.js';
import { removeStructure } from './laydown.js';
import { removeDrone, spotterBonus } from './drones.js';
import { blastOnGround } from './people.js';
import { patrolAim } from './hunt.js';
import { aimInZone, inZone } from './attack-area.js';
import { terrainState } from './terrain.js';

// How an attacker with a spotter's picture of the area shares its strikes between what is there: an ASSUMPTION.
export const AIM_SHARE = { system: 0.45, people: 0.3, building: 0.25 };

// The building cells inside an area, in scene units, worked out once for each area on each world.
const buildingCache = new WeakMap();
function buildingsIn(points) {
  const world = terrainState.data;
  const hit = buildingCache.get(points);
  if (hit && hit.world === world) return hit.spots;
  const m = WORLD.metresPerUnit, xs = points.map(([x]) => x * m), zs = points.map(([, z]) => z * m);
  const { N, cell, R, bldg } = world, spots = [];
  const lo = (v) => Math.max(0, Math.floor((v + R) / cell)), hi = (v) => Math.min(N - 1, Math.ceil((v + R) / cell));
  for (let j = lo(Math.min(...zs)); j <= hi(Math.max(...zs)); j++) {
    for (let i = lo(Math.min(...xs)); i <= hi(Math.max(...xs)); i++) {
      const x = (-R + i * cell) / m, z = (-R + j * cell) / m;
      if (bldg[j * N + i] && inZone(points, x, z)) spots.push({ x, z, structure: null });
    }
  }
  buildingCache.set(points, { world, spots });
  return spots;
}

// One drone's target in the drawn area: first a kind, by AIM_SHARE among the kinds the area holds, then one of that kind at random.
// A spot at random only if the area holds no system, people or building. The patrol's own escort and group are not in the area.
export function chooseAim(w, rng) {
  const points = w.state.zone, inside = (x, z) => inZone(points, x, z);
  const kinds = {
    system: w.structures.filter((s) => !s.escort && inside(s.pos.x, s.pos.z)).map((s) => ({ x: s.pos.x, z: s.pos.z, structure: s })),
    people: w.people.filter((g) => !g.patrol && inside(g.x, g.z)).map((g) => ({ x: g.x, z: g.z, structure: null })),
    building: buildingsIn(points),
  };
  const held = Object.keys(AIM_SHARE).filter((k) => kinds[k].length);
  if (!held.length) return aimInZone(points, rng);
  let r = rng() * held.reduce((n, k) => n + AIM_SHARE[k], 0), kind = held.at(-1);
  for (const k of held) { r -= AIM_SHARE[k]; if (r < 0) { kind = k; break; } }
  const list = kinds[kind];
  return { ...list[Math.min(list.length - 1, Math.floor(rng() * list.length))], kind };
}

function emitterScore(s) {
  const def = s.def;
  let sig = def.signature || 0;
  if (def.kind === 'jammer' && s.mode !== 'Jam') sig *= 0.1; // a jammer is quiet until it is jamming
  if (s.uplink) sig += COMMS[s.uplink].signature;
  return sig;
}

const SITE_AIM = { x: 0, z: 0, structure: null };
function plainAim(w, d) {
  if (w.patrol) return patrolAim(w, d); // a patrol takes the place of the station and any drawn area
  if (d.aim?.structure && !w.structures.includes(d.aim.structure)) d.aim = { ...d.aim, structure: null }; // gone: it strikes where it stood
  return d.aim || SITE_AIM;
}

// An anti-radar drone only hears what radiates: a radar, or a jammer that is on. It goes for the strongest, wherever it is within reach.
// A jammer is louder for each band it jams, against the bands it jams as standard.
export const radiates = (s) => (s.def.kind === 'radar' ? s.def.signature || 0 : s.def.kind === 'jammer' && s.mode === 'Jam' ? ((s.def.signature || 0) * s.jamBands.size) / STRUCTURES[s.def.id].bands.length : 0);

export function pickTarget(w, d) {
  if (!d.def.seeksEmitters) return plainAim(w, d);
  if (d.targetStructure && w.structures.includes(d.targetStructure)) return { x: d.targetStructure.pos.x, z: d.targetStructure.pos.z, structure: d.targetStructure };
  d.targetStructure = null;
  let best = null, bs = 0.3;
  const reach = u(d.def.seekRange ?? 3000);
  for (const s of w.structures) {
    const dist = hdist(s.pos, d.pos);
    if (dist > reach) continue;
    const score = d.def.antiRadar ? radiates(s) : emitterScore(s) / (1 + dist / u(1500));
    if (score > bs) { bs = score; best = s; }
  }
  if (!best) return plainAim(w, d);
  d.targetStructure = best;
  d.h0 = hdist(d.pos, best.pos); d.agl0 = Math.max((d.pos.y - hereU(d.pos.x, d.pos.z)) * WORLD.metresPerUnit, 5); // restart the descent profile
  return { x: best.pos.x, z: best.pos.z, structure: best };
}

export function hitStructure(w, d, s) {
  const { state, ledger, net } = w;
  w.emit('explosion', { pos: d.pos, r: u(60), color: 0xff5252 });
  blastOnGround(w, d, s.pos.x, s.pos.z);
  if (!state.sandbox) s.health -= d.def.damage * (1 + spotterBonus(w)); // the sandbox protects the laydown too
  state.hits++;
  removeDrone(w, d);
  net.raiseAlert('critical', `${d.def.name} struck ${s.name}: ${Math.max(Math.round(s.health), 0)}% health left`, s.pos, 'DISCRETE_PRIORITY_HIGH');
  if (s.health <= 0) {
    tally(ledger.lost, s.def.id); ledger.lostValue += s.def.cost;
    w.rec.event('lost', `${s.name} destroyed`);
    net.raiseAlert('critical', `${s.name} destroyed`, s.pos, 'DISCRETE_PRIORITY_HIGH');
    w.emit('toast', `${s.name} destroyed`);
    removeStructure(w, s);
  }
}
