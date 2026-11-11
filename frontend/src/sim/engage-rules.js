// Rules of engagement the player sets: which of their weapons may fire at which drone type in the attack, so a costly missile is
// kept for the drones worth it. A rule names an effector class and the drone types it must leave alone ('unknown' is a track not
// yet named). The fusion node can only apply a rule to a drone it has named: a camera or an RF library that names the model settles
// it; an airframe alone (multirotor or fixed wing) holds fire only if every drone type in the attack with that airframe is barred;
// an unnamed track is held only where 'unknown' is barred. A crew working its weapon by eye knows what it is looking at.

import { DRONES } from './config/index.js';

export const UNKNOWN = 'unknown';
const byModel = new Map(Object.entries(DRONES).map(([id, d]) => [d.label ?? d.name, id]));

// rules: { [effectorId]: droneId[] barred }. Does it bar this effector from this fusion track, given the drone types in the attack?
export function barsTrack(rules, effectorId, tr, attack = []) {
  const barred = rules?.[effectorId];
  if (!barred?.length) return false;
  const id = tr.model && byModel.get(tr.model);
  if (id) return barred.includes(id);
  if (tr.airframe && tr.airframe !== 'Unknown') {
    const types = attack.filter((t) => DRONES[t]?.airframe === tr.airframe);
    return types.length > 0 && types.every((t) => barred.includes(t));
  }
  return barred.includes(UNKNOWN);
}

// A crew sees the drone itself.
export const barsDrone = (rules, effectorId, droneId) => !!rules?.[effectorId]?.includes(droneId);

// Set one rule: allowed or not. Returns the new rules object (the old one is left as it was).
export function setRule(rules, effectorId, droneId, allowed) {
  const now = new Set(rules?.[effectorId] ?? []);
  if (allowed) now.delete(droneId); else now.add(droneId);
  const next = { ...rules, [effectorId]: [...now] };
  if (!now.size) delete next[effectorId];
  return next;
}

// The value rule: bar every pairing where one shot costs more than the drone it is fired at.
export function valueRules(effectors, attack, shotCostOf) {
  const rules = {};
  for (const e of effectors) {
    const barred = attack.filter((t) => shotCostOf(e) > (DRONES[t]?.cost ?? Infinity));
    if (barred.length) rules[e] = barred;
  }
  return rules;
}
