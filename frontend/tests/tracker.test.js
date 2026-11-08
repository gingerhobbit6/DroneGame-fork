import { describe, expect, it } from 'vitest';
import { createTracker, slowestSensor, TRACKER } from '../src/sim/tracker.js';

const rad = (d) => (d * Math.PI) / 180;
let seq = 0;
const newTracker = () => createTracker(() => `T${++seq}`);

// a radar at the origin seeing a target at (east, north, up)
function radarAt(east, north, up, t, scan, node = 'radar') {
  const hr = Math.hypot(east, north);
  return { node, from: [0, 0, 0], az: Math.atan2(east, north), el: Math.atan2(up, hr), range: Math.hypot(hr, up), sigAz: rad(0.5), sigEl: rad(1), sigRange: 8, t, scan };
}
// a bearing-only sensor at `from` looking at (east, north)
function bearingAt(from, east, north, t, scan, node) {
  return { node, from, az: Math.atan2(east - from[0], north - from[1]), el: null, range: null, sigAz: rad(1), sigEl: null, sigRange: 0, t, scan };
}

describe('track lifecycle', () => {
  it('confirms after enough hits, coasts when updates stop, then drops', () => {
    const tk = newTracker();
    let tr;
    for (let i = 0; i < TRACKER.confirmHits; i++) {
      tr = tk.ingest(radarAt(1000, 2000, 100, i, i), i);
      expect(tr).not.toBeNull();
      if (i < TRACKER.confirmHits - 1) expect(tr.status).toBe('tentative');
    }
    expect(tr.status).toBe('confirmed');
    expect(tr.justConfirmed).toBe(true);
    expect(tk.tracks.size).toBe(1);
    tk.prune(2 + TRACKER.coastAfter + 0.1);
    expect(tr.status).toBe('coasting');
    expect(tk.prune(2 + TRACKER.confirmedTimeout + 0.1)).toEqual([tr]);
    expect(tk.tracks.size).toBe(0);
  });

  it('drops a tentative track quickly', () => {
    const tk = newTracker();
    tk.ingest(radarAt(1000, 2000, 100, 0, 0), 0);
    expect(tk.prune(TRACKER.tentativeTimeout + 0.1).length).toBe(1);
  });
});

describe('sensors slower than once a second', () => {
  const every = (m, s) => ({ ...m, every: s });

  it('a radar scanning every 5 s confirms a track, holds it between scans, and drops it after as many missed scans', () => {
    const tk = newTracker();
    let tr;
    for (let i = 0; i < TRACKER.confirmHits; i++) {
      tr = tk.ingest(every(radarAt(1000, 2000, 100, i * 5, i), 5), i * 5);
      tk.prune(i * 5 + 4.9); // just before the next scan
    }
    expect(tk.tracks.size).toBe(1);
    expect(tr.status).toBe('confirmed');
    const last = (TRACKER.confirmHits - 1) * 5;
    tk.prune(last + TRACKER.coastAfter * 5 + 0.1);
    expect(tr.status).toBe('coasting');
    expect(tk.prune(last + TRACKER.confirmedTimeout * 5 - 0.1)).toEqual([]);
    expect(tk.prune(last + TRACKER.confirmedTimeout * 5 + 0.1)).toEqual([tr]);
  });

  it('holds a track while its slow sensor may still look again, after a fast one has lost it', () => {
    const tk = newTracker();
    let tr;
    for (let i = 0; i < 3; i++) tr = tk.ingest(radarAt(1000, 2000, 100, i, i, 'fast'), i);
    expect(tk.ingest(every(radarAt(1000, 2000, 100, 2, 0, 'slow'), 5), 2)).toBe(tr);
    expect(slowestSensor(tr)).toBe(5);
    tk.prune(2 + TRACKER.coastAfter + 0.1);
    expect(tr.status).toBe('confirmed');
    expect(tk.prune(2 + TRACKER.confirmedTimeout + 1)).toEqual([]);
    expect(tk.prune(2 + TRACKER.confirmedTimeout * 5 + 0.1)).toEqual([tr]);
  });

  it('keeps the usual clocks for a sensor that reports faster than once a second', () => {
    const tk = newTracker();
    const tr = tk.ingest(every(radarAt(1000, 2000, 100, 0, 0), 0.5), 0);
    expect(slowestSensor(tr)).toBe(1);
    expect(tk.prune(TRACKER.tentativeTimeout + 0.1)).toEqual([tr]);
  });

  it("keeps a slow sensor's bearing waiting for a cross for as many of its own updates", () => {
    const tk = newTracker();
    tk.ingest(every(bearingAt([0, 0, 0], 1000, 2000, 0, 0, 'rf1'), 4), 0);
    const later = TRACKER.candidateLife + 1;
    tk.prune(later);
    expect(tk.candidates.length).toBe(1);
    expect(tk.ingest(bearingAt([3000, 0, 0], 1000, 2000, later, 0, 'rf2'), later)).not.toBeNull();
  });
});

describe('a 2D radar', () => {
  const flat = (m) => ({ ...m, el: null, sigEl: null });

  it('starts a track at a guessed height, and keeps it flat until something measures height', () => {
    const tk = newTracker();
    const tr = tk.ingest(flat(radarAt(1000, 2000, 300, 0, 0)), 0);
    expect(tr.flat).toBe(true);
    expect(tr.pos[2]).toBeCloseTo(TRACKER.flatHeight, 0);
    expect(Math.hypot(tr.pos[0], tr.pos[1])).toBeCloseTo(Math.sqrt(1000 ** 2 + 2000 ** 2 + 300 ** 2 - TRACKER.flatHeight ** 2), 0); // its range, laid at that height
    for (let i = 1; i < 4; i++) tk.ingest(flat(radarAt(1000, 2000, 300, i, i)), i);
    expect(tk.tracks.size).toBe(1);
    expect(tr.flat).toBe(true);
    expect(tk.posError(tr)).toBeLessThan(100); // across the ground only
    expect(tk.ingest(radarAt(1000, 2000, 300, 4, 0, 'radar3d'), 4)).toBe(tr);
    expect(tr.flat).toBe(false);
    expect(tr.pos[2]).toBeGreaterThan(200);
  });
});

describe('filter', () => {
  it('converges on a moving target and learns its velocity', () => {
    const tk = newTracker();
    let tr;
    for (let i = 0; i < 20; i++) tr = tk.ingest(radarAt(1000 + 30 * i, 2000, 100, i, i), i);
    const e = tk.estimate(tr, 19);
    expect(Math.abs(e.east - (1000 + 30 * 19))).toBeLessThan(40);
    expect(Math.abs(e.north - 2000)).toBeLessThan(40);
    expect(Math.abs(e.vel[0] - 30)).toBeLessThan(8);
  });

  it('keeps separate targets on separate tracks', () => {
    const tk = newTracker();
    for (let i = 0; i < 5; i++) {
      tk.ingest(radarAt(1000, 2000, 100, i, i * 2), i);
      tk.ingest(radarAt(-3000, -2000, 100, i, i * 2 + 1), i);
    }
    expect(tk.tracks.size).toBe(2);
  });

  it('takes only one measurement per sensor scan on a track', () => {
    const tk = newTracker();
    const a = tk.ingest(radarAt(1000, 2000, 100, 0, 7), 0);
    const b = tk.ingest(radarAt(1001, 2001, 100, 0, 7), 0);
    expect(b).not.toBe(a);
  });

  it('extrapolates the estimate and widens its error as time passes', () => {
    const tk = newTracker();
    let tr;
    for (let i = 0; i < 10; i++) tr = tk.ingest(radarAt(1000 + 30 * i, 2000, 100, i, i), i);
    const now = tk.estimate(tr, 9), later = tk.estimate(tr, 11);
    expect(later.east).toBeGreaterThan(now.east);
    expect(later.err).toBeGreaterThan(now.err);
    expect(tk.estimate(tr, 8).err).toBeCloseTo(now.err, 6); // no negative extrapolation
    const dt = 2, err = tk.posError(tr), want = Math.sqrt(err ** 2 + ((TRACKER.accel * dt * dt) / 2) ** 2);
    expect(later.err).toBeCloseTo(want, 6); // both terms are variances
  });
});

describe('bearing-only measurements', () => {
  it('cannot start a track alone, and wait as candidates', () => {
    const tk = newTracker();
    expect(tk.ingest(bearingAt([0, 0, 0], 1000, 2000, 0, 0, 'rf1'), 0)).toBeNull();
    expect(tk.candidates.length).toBe(1);
    expect(tk.prune(TRACKER.candidateLife + 0.1)).toEqual([]);
    expect(tk.candidates.length).toBe(0);
  });

  it('triangulate into a track when two sensors cross', () => {
    const tk = newTracker();
    tk.ingest(bearingAt([0, 0, 0], 1000, 2000, 0, 0, 'rf1'), 0);
    const tr = tk.ingest(bearingAt([3000, 0, 0], 1000, 2000, 0, 0, 'rf2'), 0);
    expect(tr).not.toBeNull();
    expect(Math.hypot(tr.pos[0] - 1000, tr.pos[1] - 2000)).toBeLessThan(120);
  });

  it('give no fix from nearly parallel lines or the same sensor', () => {
    const tk = newTracker();
    tk.ingest(bearingAt([0, 0, 0], 0, 5000, 0, 0, 'rf1'), 0);
    expect(tk.ingest(bearingAt([10, 0, 0], 10, 5000, 0, 0, 'rf2'), 0)).toBeNull();
    const same = newTracker();
    same.ingest(bearingAt([0, 0, 0], 0, 5000, 0, 0, 'rf1'), 0);
    expect(same.ingest(bearingAt([0, 0, 0], 3000, 3000, 0, 1, 'rf1'), 0)).toBeNull();
  });

  it('give no fix where the bearings cross far beyond what either sensor can hear', () => {
    // two detectors 500 m apart whose bearings differ by 2 degrees cross about 14 km out; each hears 3.5 km at most
    const heard = (from, east, north, node) => ({ ...bearingAt(from, east, north, 0, 0, node), reach: 3500 });
    const tk = newTracker();
    tk.ingest(heard([0, 0, 0], 0, 1000, 'rf1'), 0);
    expect(tk.ingest(heard([500, 0, 0], 500 - Math.sin(rad(2)) * 1000, Math.cos(rad(2)) * 1000, 'rf2'), 0)).toBeNull();
    const near = newTracker(); // the same pair still fixes a drone inside their reach
    near.ingest(heard([0, 0, 0], 1000, 2000, 'rf1'), 0);
    expect(near.ingest(heard([500, 0, 0], 1000, 2000, 'rf2'), 0)).not.toBeNull();
  });

  it('triangulate in 3D when both sensors give elevation', () => {
    const tk = newTracker();
    const cam = (from, node) => {
      const dx = 1000 - from[0], dy = 2000 - from[1];
      return { node, from, az: Math.atan2(dx, dy), el: Math.atan2(300 - from[2], Math.hypot(dx, dy)), range: null, sigAz: rad(0.5), sigEl: rad(0.5), sigRange: 0, t: 0, scan: 0 };
    };
    tk.ingest(cam([0, 0, 10], 'eo1'), 0);
    const tr = tk.ingest(cam([3000, 0, 10], 'eo2'), 0);
    expect(tr).not.toBeNull();
    expect(Math.abs(tr.pos[2] - 300)).toBeLessThan(60);
  });

  it('fix on the candidate that crosses closest, and use it up', () => {
    const tk = newTracker();
    const cam = (from, node, up, scan) => {
      const dx = 1000 - from[0], dy = 2000 - from[1];
      return { node, from, az: Math.atan2(dx, dy), el: Math.atan2(up - from[2], Math.hypot(dx, dy)), range: null, sigAz: rad(0.5), sigEl: rad(0.5), sigRange: 0, t: 0, scan };
    };
    const off = cam([0, 0, 10], 'eo1', 380, 0); // an earlier look, 80 m high
    tk.ingest(off, 0);
    tk.ingest(cam([0, 0, 10], 'eo1', 300, 1), 0);
    const tr = tk.ingest(cam([3000, 0, 10], 'eo2', 300, 0), 0);
    expect(Math.abs(tr.pos[2] - 300)).toBeLessThan(5);
    expect(tk.candidates.map((c) => c.el)).toEqual([off.el]); // the one used is gone, so it cannot start a second track
  });

  it('update a track that already exists', () => {
    const tk = newTracker();
    let tr;
    for (let i = 0; i < 4; i++) tr = tk.ingest(radarAt(1000, 2000, 100, i, i), i);
    const hits = tr.hits;
    expect(tk.ingest(bearingAt([0, 0, 0], 1000, 2000, 4, 0, 'rf1'), 4)).toBe(tr);
    expect(tr.hits).toBe(hits + 1);
  });

  it('forget everything on clear', () => {
    const tk = newTracker();
    tk.ingest(radarAt(1000, 2000, 100, 0, 0), 0);
    tk.ingest(bearingAt([0, 0, 0], -3000, 100, 0, 0, 'rf1'), 0);
    tk.clear();
    expect(tk.tracks.size).toBe(0);
    expect(tk.candidates.length).toBe(0);
  });
});
