// Draws the simulated people at true scale, civilians in everyday clothes and soldiers in MultiCam (figures.js). Instancing keeps
// large groups cheap. From afar each person is one rigid figure, rebuilt only when somebody is placed, removed or hurt. Up close
// they are drawn in parts and posed every frame (poses.js): standing about, walking with the patrol, and getting down while a
// drone is near. People in a building or bunker are drawn too, standing still, and its walls hide them.

import * as THREE from 'three';
import { PEOPLE, PEOPLE_LIMITS, WORLD } from '../sim/config/index.js';
import { bunkerSide } from '../sim/people.js';
import { hashSeed, mulberry32 } from '../sim/rng.js';
import { clamp, hdist, u } from '../sim/units.js';
import { groundU } from './terrain-view.js';
import { hexCss } from './labels.js';
import { view } from './view.js';
import { civilianParts, soldierParts } from './figures.js';
import { REST, STEP, idleTurn, partMatrices, placeParts, pose } from './poses.js';

const CAPACITY = PEOPLE_LIMITS.groups * PEOPLE_LIMITS.perGroup;
const CLOTHES = [0x3f5a78, 0x6b7f58, 0x8a8f96, 0x7a4a3a, 0xb8b2a4, 0x2f3b4a, 0xa8743c, 0x9b2d30, 0xd9d4c7];
const TROUSERS = [0x3b4f6b, 0x2b2b2e, 0x9c8d6b, 0x5f6368, 0x5a4636];
const SKIN = [0xf1c8a8, 0xd9a47e, 0xa9744f, 0x6f4a32];
const HURT = 0x8c2f2f, KILLED = 0x3a2424; // injured, and killed: darker, and both lying down
const MODEL_HEIGHT = 1.75; // metres
const BUNKER_HEIGHT = 2.6; // metres, over the heads of those inside
const FOOTING = 3; // metres of block below the ground, so it does not float on a slope
const LABEL_LIFT = 6; // metres above the group
const NEAR = u(1500); // camera distance: beyond about 1.5 km a person is a pixel or less, so they are only posed closer in
const COVER_RANGE = 400; // metres. ASSUMPTION: a small drone this close is heard and seen, and people in the open get down
const EASE = 0.5, SPREAD = 0.2; // seconds each person takes to get down or up, and the spread of when they start
const WALKING = 0.3, PACE = 2.5; // m/s: slower than this a group is standing; faster (the clock sped up), the legs keep this pace
const MOVED = 5; // metres between frames: the group was put somewhere else, not walked there
const IDLE_EVERY = 4; // frames: people standing about move slowly, so each is posed on one frame in this many, in turn
const ROLES = ['civilian', 'military'];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// only the part of an instance buffer in use goes to the GPU
const flush = (attr, n) => { if (!attr) return; attr.clearUpdateRanges(); attr.addUpdateRange(0, n * attr.itemSize); attr.needsUpdate = true; };

export function createPeopleViews(scene, sim, labels) {
  const instanced = (geo, mat, n) => {
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.count = 0; mesh.frustumCulled = false; // it spans the whole site
    scene.add(mesh);
    return mesh;
  };
  const clothed = new THREE.MeshLambertMaterial({ vertexColors: true });
  const civ = civilianParts(), sol = soldierParts();
  // from afar: each person's meshes by role, taking the colours of their look in this order
  const meshes = {
    civilian: [instanced(civ.trousers, clothed, CAPACITY), instanced(civ.top, clothed, CAPACITY), instanced(civ.skin, clothed, CAPACITY)],
    military: [instanced(sol.body, clothed, CAPACITY), instanced(sol.skin, clothed, CAPACITY)],
  };
  const bunkers = instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0x8b8d86 }), PEOPLE_LIMITS.groups);
  // up close: each part, the joint it moves with, which colour of the look it takes, and how many each person has
  // shortcut: every mesh holds the most people the game allows (about 26 MB of buffers for the parts); size them to the people placed if memory matters
  const part =(name, geo, joint, colour, per = 1) => { const mesh = instanced(geo, clothed, CAPACITY * per); mesh.name = name; return { mesh, joint, colour, per }; };
  const parts = {
    civilian: [part('civilian legs', civ.leg, 'leg', 0, 2), part('civilian torso', civ.torso, 'torso', 1), part('civilian arms', civ.arm, 'arm', 1, 2),
      part('civilian head', civ.head, 'torso', 2), part('civilian hands', civ.hand, 'arm', 2, 2)],
    military: [part('military legs', sol.leg, 'leg', 0, 2), part('military torso', sol.torso, 'torso', 0), part('military arms', sol.arms, 'arm', 0),
      part('military head', sol.head, 'torso', 1), part('military hands', sol.hands, 'arm', 1)],
  };
  const far = [...meshes.civilian, ...meshes.military], near = [...parts.civilian, ...parts.military].map((p) => p.mesh);
  for (const mesh of [...far, ...near]) mesh.castShadow = true;
  const tags = new Map(); // group -> label

  // Everyone drawn, by role and slot: where they stand (x, ground, z), their scale and turn, whether down, and their colours.
  const placed = { civilian: new Float32Array(CAPACITY * 6), military: new Float32Array(CAPACITY * 6) };
  const looks = { civilian: new Uint32Array(CAPACITY * 3), military: new Uint32Array(CAPACITY * 3) };
  const drawn = { civilian: 0, military: 0 }, starts = new Map(); // group -> its first slot
  const motion = new WeakMap(); // group -> how it is moving and how far into cover, for the drawing only

  const m4 = new THREE.Matrix4(), root = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0), FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const P = new Float32Array(13), mats = partMatrices();

  // counts: how many were down in each group at the moment being reviewed, or null for now.
  function rebuild(counts) {
    const n = { civilian: 0, military: 0 };
    let b = 0;
    starts.clear(); layout = '';
    sim.people.forEach((g, gi) => {
      const hurt = new Set(counts ? g.hits.slice(0, counts[gi]) : g.hits);
      const floor = groundU(g.x, g.z);
      const rng = mulberry32(hashSeed(g.look)); // the same look every time this group is drawn
      const role = g.role === 'military' ? 'military' : 'civilian', at = placed[role], look = looks[role];
      starts.set(g, n[role]); layout += `${g.id}:${g.count}:${hurt.size} `;
      for (let i = 0; i < g.count; i++, n[role]++) {
        const x = g.spots[i * 2], z = g.spots[i * 2 + 1], scale = u(1.62 + rng() * 0.3) / MODEL_HEIGHT, turn = rng() * Math.PI * 2;
        const clothes = CLOTHES[Math.floor(rng() * CLOTHES.length)], skin = SKIN[Math.floor(rng() * SKIN.length)];
        const trousers = TROUSERS[Math.floor(rng() * TROUSERS.length)], kit = 0.88 + rng() * 0.12; // a soldier's kit is a little faded or new
        const down = hurt.has(i), dead = down && g.down[i] === 2, o = n[role] * 6;
        at[o] = x; at[o + 1] = (g.protection === 'open' ? groundU(x, z) : floor) + (down ? u(0.15) : 0); at[o + 2] = z;
        at[o + 3] = scale; at[o + 4] = turn; at[o + 5] = down ? 1 : 0;
        const colours = role === 'military' ? [col.setScalar(kit).getHex(), skin] : [trousers, clothes, skin];
        colours.forEach((c, k) => { look[n[role] * 3 + k] = dead ? KILLED : down ? HURT : c; });
      }
      if (g.protection === 'bunker') {
        const side = u(bunkerSide(g.count));
        m4.compose(p.set(g.x, floor - u(FOOTING), g.z), q.identity(), sc.set(side, u(BUNKER_HEIGHT + FOOTING), side));
        bunkers.setMatrixAt(b++, m4);
      }
    });
    for (const role of ROLES) {
      drawn[role] = n[role];
      for (const mesh of meshes[role]) mesh.count = n[role];
      for (const { mesh, per } of parts[role]) mesh.count = n[role] * per;
    }
    bunkers.count = b;
    bunkers.instanceMatrix.needsUpdate = true;
  }

  // Where a person stands and which way they face, or lying where they fell, into root.
  function rootAt(at, o, yaw) {
    if (at[o + 5]) return root.compose(p.set(at[o], at[o + 1], at[o + 2]), q.setFromAxisAngle(UP, at[o + 4]).multiply(FLAT), sc.setScalar(at[o + 3]));
    return root.makeRotationY(yaw).scale(sc.setScalar(at[o + 3])).setPosition(at[o], at[o + 1], at[o + 2]);
  }

  function writeFar() {
    for (const role of ROLES) {
      const at = placed[role], look = looks[role];
      for (let i = 0; i < drawn[role]; i++) {
        rootAt(at, i * 6, at[i * 6 + 4]);
        meshes[role].forEach((mesh, k) => { mesh.setMatrixAt(i, root); mesh.setColorAt(i, col.setHex(look[i * 3 + k])); });
      }
    }
    for (const mesh of far) { flush(mesh.instanceMatrix, mesh.count); flush(mesh.instanceColor, mesh.count); }
  }

  function place(role, slot, pose) {
    placeParts(mats, role, root, pose);
    for (const { mesh, joint, per } of parts[role]) for (let k = 0; k < per; k++) mesh.setMatrixAt(slot * per + k, joint === 'torso' ? mats.torso : mats[joint][k]);
  }

  // How a group in the open is moving, from where the simulation has put it, and how far into cover it is.
  function moving(g, t, dt) {
    let m = motion.get(g);
    if (!m || t - m.t > 0.25) { m = { x: g.x, z: g.z, t, vx: 0, vz: 0, heading: 0, face: 0, walk: 0, step: 0, cover: 0 }; motion.set(g, m); }
    const span = t - m.t, k = 1 - Math.exp(-span / 0.3), mpu = WORLD.metresPerUnit;
    if (span > 0) {
      const dx = (g.x - m.x) * mpu, dz = (g.z - m.z) * mpu, walked = Math.hypot(dx, dz) < MOVED;
      m.vx += ((walked ? dx / span : 0) - m.vx) * k; m.vz += ((walked ? dz / span : 0) - m.vz) * k;
      m.x = g.x; m.z = g.z; m.t = t;
    }
    const speed = Math.hypot(m.vx, m.vz);
    if (speed > WALKING) {
      const to = Math.atan2(m.vx, m.vz); // figures face +z
      m.heading = m.face ? m.heading + wrap(to - m.heading) * (1 - Math.exp(-dt / 0.3)) : to;
      m.face = Math.min(1, m.face + dt / 0.8); // and keep facing that way when they stop
    }
    m.walk = Math.min(speed / 1.2, 1);
    m.step += (2 * Math.PI * Math.min(speed, PACE) * dt) / STEP;
    // a group on the move keeps walking: the simulation is moving it
    const threat = speed < WALKING && sim.drones.some((d) => !d.dead && hdist(d.pos, g) < u(COVER_RANGE));
    m.cover = clamp(m.cover + (threat ? dt : -dt) / (EASE + SPREAD), 0, 1);
    return m;
  }

  // all: after a rebuild, also those who stay still (sheltered or hurt) and every colour.
  function writeNear(t, dt, all) {
    let wrote = all;
    frame++;
    for (const g of sim.people) {
      const start = starts.get(g), role = g.role === 'military' ? 'military' : 'civilian', at = placed[role], open = g.protection === 'open';
      if (start === undefined || !(open || all)) continue;
      const m = open && moving(g, t, dt), busy = m && (m.walk > 0.01 || (m.cover > 0 && m.cover < 1));
      for (let slot = start; slot < start + g.count; slot++) {
        const o = slot * 6, ph = at[o + 4]; // their turn doubles as their phase, so no two are in step
        if (!all && !busy && (slot + frame) % IDLE_EVERY) continue;
        if (!open || at[o + 5]) { if (all || busy) { rootAt(at, o, ph); place(role, slot, REST); } continue; } // the walking patrol carries its hurt
        const cover = clamp((m.cover * (EASE + SPREAD) - ((ph * 7.3) % 1) * SPREAD) / EASE, 0, 1);
        rootAt(at, o, ph + wrap(m.heading - ph) * m.face + idleTurn(t, ph) * (1 - m.walk) * (1 - cover));
        place(role, slot, pose(P, role, t, ph, m.walk, m.step, cover));
        wrote = true;
      }
    }
    if (all) {
      for (const role of ROLES) for (const { mesh, colour, per } of parts[role]) {
        for (let i = 0; i < drawn[role] * per; i++) mesh.setColorAt(i, col.setHex(looks[role][Math.floor(i / per) * 3 + colour]));
      }
    }
    if (wrote) for (const mesh of near) { flush(mesh.instanceMatrix, mesh.count); if (all) flush(mesh.instanceColor, mesh.count); }
  }

  function label(g, down) {
    let tag = tags.get(g);
    if (!tag) { tag = labels.make('', hexCss(PEOPLE[g.protection].color), 'slabel'); tags.set(g, tag); }
    tag.textContent = `${g.count} ${PEOPLE[g.protection].short}${down ? ` · ${down} hurt` : ''}`;
    labels.place(tag, g.x, g.y + u(LABEL_LIFT), g.z, view.labels);
  }

  // the patrol walking changes the key every step, but not the layout: who is drawn in which slot, and who is down
  let shown = null, layout = '', farShown = null, nearShown = null, last = performance.now() / 1000, frame = 0;
  function sync() {
    const counts = view.replayCasualties;
    const key = `${sim.peopleRev()}|${counts}`;
    if (key !== shown) { shown = key; rebuild(counts); }
    const t = performance.now() / 1000, dt = clamp(t - last, 0, 0.1), close = view.zoom < NEAR;
    last = t;
    for (const mesh of far) mesh.visible = !close;
    for (const mesh of near) mesh.visible = close;
    if (close) { writeNear(t, dt, nearShown !== layout); nearShown = layout; }
    else { nearShown = null; if (farShown !== shown) { farShown = shown; writeFar(); } }
    const live = new Set(sim.people);
    for (const [g, tag] of tags) if (!live.has(g)) { tag.remove(); tags.delete(g); }
    sim.people.forEach((g, gi) => label(g, counts ? counts[gi] : g.hits.length));
  }

  return { sync };
}
