// History for pause and rewind. The recorder keeps a snapshot of the run every half second of game time (what every drone,
// track, missile and system was doing), plus a list of events (launches, kills, leaks).

import { WORLD } from './config/index.js';

export const SNAPSHOT_EVERY = 10; // simulation steps per snapshot (10 x 0.05 s = 0.5 s)
const MAX_FRAMES = 7200;          // one hour of game time

export function createRecorder(now) {
  const frames = [], events = [];
  return {
    frames, events,
    push(f) { frames.push(f); if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES); },
    event(type, text, uid) { events.push({ t: now(), type, text, uid }); },
    clear() { frames.length = 0; events.length = 0; },
  };
}

// A system doing what it was doing at the last snapshot shares that entry, so a long run keeps one object per change, not per frame.
// Frames are only read, never changed.
export function takeSnapshot({ state, drones, missiles, structures, net, people, rec }) {
  const m = WORLD.metresPerUnit, last = rec?.frames.at(-1)?.structs;
  return {
    ...(people.length ? { casualties: people.map((g) => g.hits.length) } : {}),
    t: state.time, wave: state.wave, budget: state.budget, kills: state.kills, leaks: state.leaks, health: state.health,
    drones: drones.map((d) => ({ u: d.uid, type: d.type, x: d.pos.x, y: d.pos.y, z: d.pos.z, ry: d.heading, tracked: !!d.track })),
    tracks: [...net.tracks.values()].filter((tr) => tr.est).map((tr) => ({
      id: tr.id, short: tr.short, status: tr.status, airframe: tr.airframe, x: tr.est.east / m, y: tr.est.up / m, z: -tr.est.north / m, kill: !!tr.killWatch,
    })),
    missiles: missiles.map((mi) => ({ x: mi.pos.x, y: mi.pos.y, z: mi.pos.z })),
    structs: structures.map((s, i) => {
      const tr = s.task && net.tracks.get(s.task.trackId), was = last?.[i];
      const now = { id: s.nodeId, mode: s.mode, target: s.task ? s.task.drone.uid : null, trackShort: tr ? tr.short : null, health: s.health, rounds: s.rounds, storage: s.storage, reload: s.reload, fired: s.fired };
      return was && Object.keys(now).every((k) => was[k] === now[k]) ? was : now;
    }),
  };
}
