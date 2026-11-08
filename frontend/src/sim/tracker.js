// Multi-sensor track fusion for the fusion node. No rendering and no game state here.
//
// Each track is a constant-velocity Kalman filter over position and velocity in metres (east, north, up).
// Measurements come in three shapes:
//   - range measurements (radar): a full 3D point with a long-thin or round error ellipsoid
//   - bearing + elevation (camera): constrains two directions; range along the line of sight is unknown
//   - azimuth only (RF direction finding): constrains one direction
// A bearing-only measurement can update a track that already exists (it pulls the track onto the line of sight) but cannot
// create one on its own. Two bearing-only measurements from different sensors whose lines nearly cross are triangulated
// into a new track. That is how real fusion works, and also why two targets can make a "ghost" at a wrong crossing.
//
// Association is nearest-neighbour inside a statistical gate (Mahalanobis distance). It can go wrong: close targets can
// swap or share tracks. Track lifecycle: tentative -> confirmed after enough hits -> coasting when updates stop -> dropped.

// ---------- 3-vectors and 3x3 matrices (row-major arrays) ----------
const v = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  unit: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
const m3 = {
  I: (k = 1) => [k, 0, 0, 0, k, 0, 0, 0, k],
  add: (A, B) => A.map((x, i) => x + B[i]),
  sub: (A, B) => A.map((x, i) => x - B[i]),
  scale: (A, k) => A.map((x) => x * k),
  T: (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]],
  mul: (A, B) => {
    const C = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    return C;
  },
  mulv: (A, x) => [A[0] * x[0] + A[1] * x[1] + A[2] * x[2], A[3] * x[0] + A[4] * x[1] + A[5] * x[2], A[6] * x[0] + A[7] * x[1] + A[8] * x[2]],
  outer: (a, b) => [a[0] * b[0], a[0] * b[1], a[0] * b[2], a[1] * b[0], a[1] * b[1], a[1] * b[2], a[2] * b[0], a[2] * b[1], a[2] * b[2]],
  inv: (A) => {
    const [a, b, c, d, e, f, g, h, i] = A;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    const k = 1 / (det || 1e-12);
    return [(e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k, (f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k, (d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k];
  },
};

// error ellipsoid for a measurement: variance sigU along the line of sight, sigH sideways (horizontal), sigV sideways (vertical)
function measCov(u, sigU, sigH, sigV) {
  let h = v.cross([0, 0, 1], u);
  if (v.len(h) < 1e-6) h = [1, 0, 0]; // looking straight up or down
  h = v.unit(h);
  const w = v.unit(v.cross(u, h));
  return m3.add(m3.add(m3.scale(m3.outer(u, u), sigU * sigU), m3.scale(m3.outer(h, h), sigH * sigH)), m3.scale(m3.outer(w, w), sigV * sigV));
}

export const TRACKER = {
  gate: 14.2,          // chi-square, 3 degrees of freedom, ~99.7%
  accel: 6,            // process noise: assumed manoeuvre acceleration, m/s^2
  velSigma: 45,        // initial velocity uncertainty, m/s
  confirmHits: 3,      // updates needed to confirm a track
  confirmSensors: 3,   // a track with no range measurement also needs this many different sensors: two bearings always cross somewhere
  tentativeTimeout: 2.5, // a tentative track with no update for this long is dropped (s)
  confirmedTimeout: 5,   // a confirmed track with no update for this long is dropped (s)
  coastAfter: 1.6,     // a confirmed track not updated for this long is "coasting" (s)
  candidateLife: 3,    // how long an unmatched bearing is kept for triangulation (s)
  bigSigma: 4000,      // "unknown" along a line of sight, m
  flatHeight: 60,      // a height guess above the sensor for a track nobody has measured the height of, m
  flatSigma: 150,      // and how far off that guess may be, m
};

// The timeouts above are set for sensors that report about once a second. A slower sensor stretches them by its own update interval,
// so a track is only dropped or coasting when every sensor that fed it has missed as many of its own updates.
const slackOf = (m) => Math.max(1, m.every ?? 1);
const quietFor = (tr, t, limit) => { for (const h of tr.heard.values()) if (t - h.t <= limit * h.slack) return false; return true; };
export const slowestSensor = (tr) => Math.max(1, ...[...tr.heard.values()].map((h) => h.slack));

export function createTracker(newId) {
  const tracks = new Map();
  let cands = []; // unmatched bearing-only measurements waiting for a second sensor
  let candSeq = 0;

  // ---------- Kalman filter ----------
  function predict(tr, t) {
    const dt = t - tr.t;
    if (dt <= 0) return;
    const q = TRACKER.accel * TRACKER.accel;
    const { P11, P12, P22 } = tr;
    const P21 = m3.T(P12);
    const n11 = m3.add(m3.add(P11, m3.scale(m3.add(P12, P21), dt)), m3.scale(P22, dt * dt));
    const n12 = m3.add(P12, m3.scale(P22, dt));
    tr.P11 = m3.add(n11, m3.I((q * dt * dt * dt) / 3));
    tr.P12 = m3.add(n12, m3.I((q * dt * dt) / 2));
    tr.P22 = m3.add(P22, m3.I(q * dt));
    tr.pos = v.add(tr.pos, v.mul(tr.vel, dt));
    tr.t = t;
  }

  function innovation(tr, z, R) {
    const y = v.sub(z, tr.pos);
    const S = m3.add(tr.P11, R);
    const Si = m3.inv(S);
    return { y, S, Si, d2: v.dot(y, m3.mulv(Si, y)) };
  }

  function update(tr, z, R, inn) {
    const { y, Si } = inn ?? innovation(tr, z, R);
    const K1 = m3.mul(tr.P11, Si);
    const K2 = m3.mul(m3.T(tr.P12), Si);
    tr.pos = v.add(tr.pos, m3.mulv(K1, y));
    tr.vel = v.add(tr.vel, m3.mulv(K2, y));
    const I_K1 = m3.sub(m3.I(), K1);
    tr.P22 = m3.sub(tr.P22, m3.mul(K2, tr.P12));
    tr.P12 = m3.mul(I_K1, tr.P12);
    tr.P11 = m3.mul(I_K1, tr.P11);
  }

  // Position error, horizontal only for a track with no measured height: what uses it then compares horizontal distance too.
  const posError = (tr) => Math.sqrt(tr.flat ? (tr.P11[0] + tr.P11[4]) / 2 : (tr.P11[0] + tr.P11[4] + tr.P11[8]) / 3);

  function makeTrack(pos, Ppos, t) {
    const tr = {
      id: newId(), pos, vel: [0, 0, 0], t, firstT: t, lastT: t, hits: 1,
      P11: Ppos, P12: m3.I(0), P22: m3.I(TRACKER.velSigma * TRACKER.velSigma),
      status: 'tentative', short: null, sources: new Map(), nodes: new Set(), ranged: false, heard: new Map(), flat: true,
    };
    tracks.set(tr.id, tr);
    return tr;
  }

  // ---------- measurements ----------
  // m: { node, from:[e,n,u], az (rad, clockwise from north), el (rad) or null, range (m) or null,
  //      sigAz, sigEl, sigRange (rad, rad, m), t, scan, every (the sensor's update interval, s) }
  function rayOf(m) {
    const el = m.el ?? 0;
    return v.unit([Math.cos(el) * Math.sin(m.az), Math.cos(el) * Math.cos(m.az), Math.sin(el)]);
  }
  const hasRange = (m) => m.range != null;

  // the pseudo-measurement point and covariance for a measurement, given where a track predicts the target to be
  function asMeasurement(m, predicted) {
    const u = rayOf(m);
    if (hasRange(m) && m.el == null) { // a 2D radar: range and bearing, but the height is a guess or the track's own
      const up = predicted ? predicted[2] : m.from[2] + TRACKER.flatHeight;
      const hr = Math.sqrt(Math.max(m.range * m.range - (up - m.from[2]) ** 2, 0));
      return { z: [m.from[0] + u[0] * hr, m.from[1] + u[1] * hr, up], R: measCov(u, m.sigRange, hr * m.sigAz, predicted ? TRACKER.bigSigma : TRACKER.flatSigma) };
    }
    if (hasRange(m)) {
      const range = m.range;
      const z = v.add(m.from, v.mul(u, range));
      return { z, R: measCov(u, m.sigRange, range * m.sigAz, range * (m.sigEl ?? m.sigAz)) };
    }
    // bearing-only: put the point on the line of sight nearest the prediction; range along it is unknown
    const rel = v.sub(predicted, m.from);
    const along = Math.max(v.dot(rel, u), 10);
    const dist = Math.max(v.len(rel), 10);
    const sigH = dist * m.sigAz;
    const sigV = m.el == null ? TRACKER.bigSigma : dist * (m.sigEl ?? m.sigAz);
    return { z: v.add(m.from, v.mul(u, along)), R: measCov(u, TRACKER.bigSigma, sigH, sigV) };
  }

  // ---------- association ----------
  function associate(m, t) {
    let best = null, bd = TRACKER.gate;
    for (const tr of tracks.values()) {
      if (tr.heard.has(m.node) && tr.heard.get(m.node).scan === m.scan) continue; // one measurement per sensor scan
      predict(tr, t);
      const { z, R } = asMeasurement(m, tr.pos);
      // d2 is at least |y|^2 / trace(S), so a track that bound already puts past the best cannot win: skip inverting S
      const y = v.sub(z, tr.pos), traceS = tr.P11[0] + R[0] + tr.P11[4] + R[4] + tr.P11[8] + R[8];
      if (v.dot(y, y) > bd * traceS * (1 + 1e-9)) continue;
      const inn = innovation(tr, z, R);
      if (inn.d2 < bd) { bd = inn.d2; best = { tr, z, R, inn }; }
    }
    return best;
  }

  // closest approach of two rays (3D, or in the horizontal plane if either has no elevation)
  function triangulate(a, b) {
    const flat = a.el == null || b.el == null;
    const ua = rayOf(a), ub = rayOf(b);
    const A = flat ? [a.from[0], a.from[1], 0] : a.from, B = flat ? [b.from[0], b.from[1], 0] : b.from;
    const da = flat ? v.unit([ua[0], ua[1], 0]) : ua, db = flat ? v.unit([ub[0], ub[1], 0]) : ub;
    const w0 = v.sub(A, B);
    const bb = v.dot(da, db), d = v.dot(da, w0), e = v.dot(db, w0);
    const den = 1 - bb * bb;
    if (den < 1e-3) return null; // nearly parallel lines give no fix
    const s = (bb * e - d) / den, t = (e - bb * d) / den;
    if (s <= 0 || t <= 0) return null;
    const pa = v.add(A, v.mul(da, s)), pb = v.add(B, v.mul(db, t));
    return { mid: v.mul(v.add(pa, pb), 0.5), miss: v.len(v.sub(pa, pb)), s, t, flat };
  }

  const beyond = (m, dist) => m.reach != null && dist > 1.5 * m.reach; // with room for the bearing error of a target near its limit
  function tryTriangulate(m) {
    for (const c of cands) {
      if (c.node === m.node || m.t - c.t > TRACKER.candidateLife * slackOf(c)) continue;
      const x = triangulate(c, m);
      if (!x || beyond(c, x.s) || beyond(m, x.t)) continue; // nearly parallel bearings cross far past where either sensor hears
      const tol = 2.5 * (x.s * c.sigAz + x.t * m.sigAz) + 40;
      if (x.miss > tol) continue;
      const sig = Math.max(60, 0.04 * Math.max(x.s, x.t), x.miss);
      let mid = x.mid;
      let P = m3.I(sig * sig);
      if (x.flat) { // no elevation from either sensor: altitude is a guess
        mid = [mid[0], mid[1], (c.from[2] + m.from[2]) / 2 + 60];
        P = [sig * sig, 0, 0, 0, sig * sig, 0, 0, 0, 150 * 150];
      }
      return { mid, P, other: c.node, flat: x.flat };
    }
    return null;
  }

  // Take in one measurement. Returns the track it updated or created, or null if it became a bearing candidate.
  function ingest(m, t) {
    for (const tr of tracks.values()) predict(tr, t);
    const hit = associate(m, t);
    let tr = null;
    if (hit) {
      update(hit.tr, hit.z, hit.R, hit.inn);
      tr = hit.tr;
      tr.hits++;
      if (m.el != null) tr.flat = false;
    } else if (hasRange(m)) {
      const { z, R } = asMeasurement(m, null);
      tr = makeTrack(z, R, t);
      tr.flat = m.el == null;
    } else {
      const fix = tryTriangulate(m);
      if (fix) { tr = makeTrack(fix.mid, fix.P, t); tr.nodes.add(fix.other); tr.flat = fix.flat; }
      else cands.push({ ...m, id: ++candSeq });
    }
    if (tr) {
      tr.lastT = Math.max(tr.lastT, t); // a report that queued longer can arrive after a newer one
      tr.heard.set(m.node, { scan: m.scan, t, slack: slackOf(m) });
      tr.nodes.add(m.node);
      tr.ranged ||= hasRange(m);
      if (tr.status === 'tentative' && tr.hits >= TRACKER.confirmHits && (tr.ranged || tr.nodes.size >= TRACKER.confirmSensors)) { tr.status = 'confirmed'; tr.justConfirmed = true; }
    }
    return tr;
  }

  // Housekeeping each step: update coasting flags, drop stale tracks and candidates. Returns the dropped tracks.
  function prune(t) {
    const dropped = [];
    for (const tr of tracks.values()) {
      const limit = tr.status === 'tentative' ? TRACKER.tentativeTimeout : TRACKER.confirmedTimeout;
      if (quietFor(tr, t, limit)) { tracks.delete(tr.id); dropped.push(tr); continue; }
      if (tr.status !== 'tentative') tr.status = quietFor(tr, t, TRACKER.coastAfter) ? 'coasting' : 'confirmed';
    }
    cands = cands.filter((c) => t - c.t <= TRACKER.candidateLife * slackOf(c));
    return dropped;
  }

  // where a track is believed to be right now (extrapolated, without changing the filter)
  function estimate(tr, t) {
    const dt = Math.max(t - tr.t, 0);
    const p = v.add(tr.pos, v.mul(tr.vel, dt));
    const err = Math.sqrt(posError(tr) ** 2 + ((TRACKER.accel * dt * dt) / 2) ** 2);
    return { east: p[0], north: p[1], up: p[2], err, vel: tr.vel };
  }

  return { tracks, get candidates() { return cands; }, ingest, prune, estimate, posError, clear() { tracks.clear(); cands = []; } };
}
