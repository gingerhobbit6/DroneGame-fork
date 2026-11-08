// Point each camera at the most useful track: radar finds things, the camera is then cued to classify them, unclassified first.
// It comes back to a classified track once it is close enough to name its model, but an unclassified one cuts that look short.
// Uses the SAPIENT Task `look_at` command. With nothing to look at, a camera sweeps (and rarely catches anything).

import * as S from '../sapient.js';
import { DETECT_PX, IDENTIFY_PX, zoomMax } from '../camera-model.js';

export function cueCameras(core, live, { sendTask, sendTaskAck, sendStatus }) {
  const { T, nodes, tracker, deliver, distToTrack, siteDist } = core;
  for (const s of nodes.values()) {
    if (!s.def.fov || s.offline) continue;
    const dwelling = s.cue && T() < s.cue.until && tracker.tracks.has(s.cue.trackId);
    if (dwelling && !s.cue.identify) continue; // still dwelling on a live track
    let best = null, bs = Infinity;
    const reach = s.def.range * zoomMax(s.def), identifyAt = (reach * DETECT_PX) / IDENTIFY_PX; // where a typical drone can be named to its model
    for (const tr of live) {
      const dist = distToTrack(s, tr);
      if (dist > reach * 1.3) continue; // it zooms in on a cue
      const looked = s.lookedAt.get(tr.id);
      if (tr.airframe !== 'Unknown' && looked !== undefined && (tr.model || dist > identifyAt)) continue; // classified, and identified or too far to be
      if (looked !== undefined && T() - looked < 4) continue;
      const score = (tr.airframe === 'Unknown' ? 0 : 1e6) + siteDist(tr);
      if (score < bs) { bs = score; best = tr; }
    }
    if (dwelling && best?.airframe !== 'Unknown') continue; // only an unclassified track cuts short a look to name a model
    if (best) {
      const identify = best.airframe !== 'Unknown';
      const loc = S.location(best.est.east, best.est.north, best.est.up, Math.max(best.estErr, 5));
      const { id, res } = sendTask(s, { control: 'CONTROL_START', command: { look_at: { location_list: { locations: [loc] } } } }, `Look at ${best.short}`, `Slew to track ${best.short} and dwell`);
      s.lookedAt.set(best.id, T());
      deliver(res, () => { // the camera turns once the task arrives
        s.cue = { trackId: best.id, until: T() + s.def.dwell, from: T(), onAt: null, identify };
        s.mode = 'Track';
        sendTaskAck(s, id, 'TASK_STATUS_ACCEPTED');
        sendStatus(s, true);
      });
    } else if (s.mode !== 'Search' && s.modePending !== 'Search') {
      const { id, res } = sendTask(s, { control: 'CONTROL_START', command: { mode_change: 'Search' } }, 'Mode Search', `Return ${s.name} to its search sweep`);
      s.modePending = 'Search';
      deliver(res, () => { s.cue = null; s.mode = 'Search'; s.modePending = null; sendTaskAck(s, id, 'TASK_STATUS_ACCEPTED'); sendStatus(s, true); });
      if (res.dropped) s.modePending = null;
    }
  }
}
