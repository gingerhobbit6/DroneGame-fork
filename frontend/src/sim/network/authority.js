// Alerts to the C2 GUI, and the operator's authority over engagements.
//
// SAPIENT has no message for "may I fire". The emulation uses an Alert from the fusion node to the C2 GUI asking for a
// decision, and the operator's answer comes back as an AlertAck (ACCEPTED / REJECTED, or CANCELLED if it lapses).

import * as S from '../sapient.js';
import { FUSION } from '../config/index.js';
import { pounds } from '../economy.js';

const ALERT = { information: 'ALERT_TYPE_INFORMATION', warning: 'ALERT_TYPE_WARNING', critical: 'ALERT_TYPE_CRITICAL' };

export function createAlerts(core) {
  const { mpu, fusion, gui, send } = core;
  // Returns the alert id. With autoAck false the C2 GUI does not answer it (a human has to, as for engagement requests).
  function raiseAlert(kind, description, pos, priority = 'DISCRETE_PRIORITY_MEDIUM', tr = null, autoAck = true) {
    const id = S.ulid();
    const body = { alert_id: id, alert_type: ALERT[kind], status: 'ALERT_STATUS_ACTIVE', description, priority, ranking: kind === 'critical' ? 0.9 : kind === 'warning' ? 0.6 : 0.3, confidence: 0.9 };
    const m = mpu();
    if (tr && tr.est) body.location = S.location(tr.est.east, tr.est.north, tr.est.up, 30);
    else if (pos) body.location = S.location(pos.x * m, -pos.z * m, pos.y * m, 30);
    send(S.envelope(fusion.nodeId, 'alert', body, gui.nodeId), fusion.nodeId, gui.nodeId);
    if (autoAck) ackAlert(id, 'ALERT_ACK_STATUS_ACCEPTED');
    return id;
  }
  const ackAlert = (alertId, status) => send(S.envelope(gui.nodeId, 'alert_ack', { alert_id: alertId, alert_ack_status: status }, fusion.nodeId), gui.nodeId, fusion.nodeId);
  return { raiseAlert, ackAlert };
}

export function createAuthority(core, { raiseAlert, ackAlert }, approveEngagement) {
  const { ctx, T, nodes, tracker } = core;
  const pending = []; // { id, alertId, s, tr, t0, text }

  function needsApproval(s) {
    if (FUSION.authority === 'all') return true;
    return FUSION.authority === 'costly' && (s.def.shotCost || 0) >= FUSION.authorityThreshold;
  }
  const isPending = (s, tr) => pending.some((p) => p.s === s && p.tr.id === tr.id);
  function requestApproval(s, tr) {
    const cost = s.def.shotCost ? `, ${pounds(s.def.shotCost)} per shot` : '';
    const text = `Authorise ${s.name} to engage ${tr.short} (${tr.model ?? (tr.airframe === 'Unknown' ? 'unclassified' : tr.airframe)})${cost}?`;
    const alertId = raiseAlert('warning', `Engagement request: ${text}`, null, 'DISCRETE_PRIORITY_HIGH', tr, false);
    const req = { id: alertId, alertId, s, tr, t0: T(), text };
    pending.push(req);
    if (ctx.onApprovalRequest) ctx.onApprovalRequest(req);
  }
  function decide(id, approve) {
    const i = pending.findIndex((p) => p.id === id);
    if (i < 0) return;
    const req = pending.splice(i, 1)[0];
    ackAlert(req.alertId, approve ? 'ALERT_ACK_STATUS_ACCEPTED' : 'ALERT_ACK_STATUS_REJECTED');
    if (approve && tracker.tracks.has(req.tr.id) && req.s.def.role === 'effector' && nodes.has(req.s.nodeId)) approveEngagement(req.s, req.tr);
    else if (!approve) req.s.denied.add(req.tr.id);
    if (ctx.onApprovalDecided) ctx.onApprovalDecided(req, approve);
  }
  function expireRequests() {
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      const gone = !tracker.tracks.has(p.tr.id) || !nodes.has(p.s.nodeId);
      if (!gone && T() - p.t0 < FUSION.authorityTimeout) continue;
      pending.splice(i, 1);
      ackAlert(p.alertId, 'ALERT_ACK_STATUS_CANCELLED');
      p.s.rejected.set(p.tr.id, T() + 10); // may ask again after a pause
      if (ctx.onApprovalDecided) ctx.onApprovalDecided(p, null);
    }
  }
  return { pending, needsApproval, isPending, requestApproval, decide, expireRequests };
}
