// Simulated people: placing groups, and the casualties a blast causes. Outside a drawn area people never change the attack: nothing
// aims at them, and every roll comes from a stream of its own, so a run with people plays out exactly as it does without them.
// Inside a drawn area a strike may aim at a group (chooseAim in targeting.js).

import { PEOPLE, PEOPLE_LIMITS, PEOPLE_ROLES, SITE, WORLD, casualtyRadii } from './config/index.js';
import { hashSeed, mulberry32 } from './rng.js';
import { terrainState } from './terrain.js';
import { clamp, hereU, u } from './units.js';
import { reachProblem } from './attack-area.js';
import { LAYDOWN_LOCKED, designLocked } from './lock.js';

const SPACING = 1.5; // metres between people standing in a group
const FLOOR_SPACE = 1.5; // square metres a person takes up in a bunker
const WALL_INSET = 1; // metres people stay clear of a wall
const UNMAPPED_ROOM = 16; // metres across, for a marked grid cell with no building outline

// The side of the concrete block a bunker group is drawn inside, in metres.
export const bunkerSide = (count) => Math.sqrt(count * FLOOR_SPACE) + 2 * WALL_INSET;

// People spread over a rectangle in metres, turned to match a building. Spots are kept in scene units.
function inRoom(rng, count, w, d, angle, cx, cz) {
  const c = Math.cos(angle), s = Math.sin(angle), spots = new Float32Array(count * 2);
  const across = Math.max(w - 2 * WALL_INSET, 1), deep = Math.max(d - 2 * WALL_INSET, 1);
  for (let i = 0; i < count; i++) {
    const lx = (rng() - 0.5) * across, lz = (rng() - 0.5) * deep;
    spots[i * 2] = u(cx + lx * c + lz * s); spots[i * 2 + 1] = u(cz - lx * s + lz * c);
  }
  return spots;
}

// A loose crowd: a sunflower spiral keeps people apart at any size, and the jitter stops it looking like a pattern.
function inTheOpen(rng, count, cx, cz) {
  const spots = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const r = SPACING * Math.sqrt(i) + rng() * 0.5, a = i * 2.39996 + rng() * 0.3;
    spots[i * 2] = u(cx + Math.cos(a) * r); spots[i * 2 + 1] = u(cz + Math.sin(a) * r);
  }
  return spots;
}

function layOut(x, z, count, protection) {
  const rng = mulberry32(hashSeed(`people:${x}:${z}`));
  const xm = x * WORLD.metresPerUnit, zm = z * WORLD.metresPerUnit;
  if (protection === 'open') return inTheOpen(rng, count, xm, zm);
  if (protection === 'bunker') return inRoom(rng, count, bunkerSide(count), bunkerSide(count), 0, xm, zm);
  const b = terrainState.data.buildingAt(xm, zm);
  return b ? inRoom(rng, count, b.w, b.d, b.angle || 0, b.x, b.z) : inRoom(rng, count, UNMAPPED_ROOM, UNMAPPED_ROOM, 0, xm, zm);
}

// look: what the drawing seeds each person's clothes from, so a group that moves keeps its look.
// role: 'civilian' or 'military' (PEOPLE_ROLES), which only the drawing uses.
export function addGroup(w, x, z, count, protection, role = 'civilian') {
  const g = { id: ++w.peopleUid, x, z, y: hereU(x, z), look: `${x},${z}`, count, protection, role, spots: layOut(x, z, count, protection), down: new Uint8Array(count), hits: [] };
  w.people.push(g);
  w.peopleRev++;
  return g;
}

// Why a group can't go here, or null if it can.
export function peopleProblem(w, x, z, protection) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 'Choose a spot on the map';
  if (!Object.hasOwn(PEOPLE, protection)) return 'Choose a level of protection';
  if (designLocked(w)) return LAYDOWN_LOCKED;
  if (w.people.length >= PEOPLE_LIMITS.groups) return `No more than ${PEOPLE_LIMITS.groups} groups`;
  const far = reachProblem(w, x, z);
  if (far) return far;
  const xm = x * WORLD.metresPerUnit, zm = z * WORLD.metresPerUnit, data = terrainState.data;
  if (protection === 'building') return data.onBuilding(xm, zm) ? null : 'Click on a building to put a group inside it';
  if (data.onBuilding(xm, zm)) return 'There is a building here. Choose In a building to put them inside it';
  if (data.coverAt(xm, zm) === 4) return 'They cannot stand in water';
  if (data.slope(xm, zm) > 0.4) return 'The ground is too steep';
  return null;
}

export const cleanCount = (count) => clamp(Math.round(count), 1, PEOPLE_LIMITS.perGroup);

// Returns the reason it can't be placed, or null if it was.
export function placePeople(w, x, z, count, protection, role = 'civilian') {
  if (!Number.isFinite(count)) return 'Choose how many people are in the group';
  if (!Object.hasOwn(PEOPLE_ROLES, role)) return 'Choose civilians or soldiers';
  const problem = peopleProblem(w, x, z, protection);
  if (problem) return problem;
  addGroup(w, x, z, cleanCount(count), protection, role);
  return null;
}

export function removePeople(w, id) {
  if (designLocked(w)) { w.emit('toast', LAYDOWN_LOCKED); return; }
  const at = w.people.findIndex((g) => g.id === id && !g.patrol); // the patrol's own group goes with the patrol
  if (at < 0) return;
  w.people.splice(at, 1);
  w.peopleRev++;
}

export function clearPeople(w) { w.people.length = 0; w.peopleRev++; }

// Sorted, so the order groups were placed in cannot change the run. Left out with no people, so saved laydowns stay as they were.
// The patrol's group is rebuilt from its route, so it is left out too.
export const capturePeople = (w) => (w.people.some((g) => !g.patrol)
  ? { people: w.people.filter((g) => !g.patrol).map(({ x, z, count, protection, role }) => ({ x, z, count, protection, ...(role === 'military' && { role }) })).sort((a, b) => a.x - b.x || a.z - b.z || a.protection.localeCompare(b.protection)) }
  : {});

export function restorePeople(w, groups = []) {
  for (const g of groups) if (Object.hasOwn(PEOPLE, g.protection) && Number.isFinite(g.count)) addGroup(w, g.x, g.z, cleanCount(g.count), g.protection, g.role === 'military' ? 'military' : 'civilian');
}

// Each person near the blast may be killed or injured, likelier the closer they are and the less protected: one roll against a
// chance of being killed, falling to nothing at the lethal radius, and of being hurt at all, falling to nothing at the injury radius.
// g.down is 1 for injured, 2 for killed; a person hurt once is not hurt again. Scene units.
function blast(w, def, x, y, z, rng) {
  const radii = casualtyRadii(def);
  let killed = 0, injured = 0;
  for (const g of w.people) {
    const level = PEOPLE[g.protection], lethal = u(radii.lethal * level.reachScale), injury = u(radii.injury * level.reachScale);
    if (!(injury > 0)) continue;
    for (let i = 0; i < g.count; i++) {
      if (g.down[i]) continue;
      const d = Math.hypot(g.spots[i * 2] - x, g.y - y, g.spots[i * 2 + 1] - z);
      if (d >= injury) continue;
      const roll = rng(), dies = level.pCasualty * Math.max(0, 1 - d / lethal), hurt = level.pCasualty * (1 - d / injury);
      if (roll < dies) { g.down[i] = 2; killed++; } else if (roll < hurt) { g.down[i] = 1; injured++; } else continue;
      g.hits.push(i);
    }
  }
  if (!killed && !injured) return;
  w.state.killed += killed; w.state.injured += injured; w.state.casualties += killed + injured;
  w.peopleRev++;
  const text = `${def.name}: ${killed} killed, ${injured} injured (simulated)`;
  w.rec.event('casualty', text);
  w.emit('toast', text);
}

// A drone's own stream: however many people there are, it reads nothing from the run's.
const blastRng = (w, d) => mulberry32(hashSeed(`${w.state.seed}:blast:${d.uid}`));
const affects = (w, d) => w.people.length > 0 && d.def.warhead > 0;

// A drone destroyed in flight goes off where it is, so its height above a group shelters them.
export function blastInAir(w, d) {
  if (affects(w, d)) blast(w, d.def, d.pos.x, d.pos.y, d.pos.z, blastRng(w, d));
}

// A drone that reaches a system lands on it.
export function blastOnGround(w, d, x, z) {
  if (affects(w, d)) blast(w, d.def, x, hereU(x, z), z, blastRng(w, d));
}

// A drone counts as hitting the site at its edge, but lands inside it: aimed at the middle, with scatter out to the edge.
export function blastOnSite(w, d) {
  if (!affects(w, d)) return;
  if (d.aim) { blast(w, d.def, d.aim.x, hereU(d.aim.x, d.aim.z), d.aim.z, blastRng(w, d)); return; } // a drawn area: it lands on its aim point
  const rng = blastRng(w, d), a = rng() * Math.PI * 2, r = u(SITE.radius) * rng();
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  blast(w, d.def, x, hereU(x, z), z, rng);
}
