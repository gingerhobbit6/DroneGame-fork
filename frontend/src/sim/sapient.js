// SAPIENT (BSI Flex 335 v2.0) message layer: envelope, ID generators, validation and the message bus.
//
// Messages are plain objects shaped like the proto3 JSON form of the official .proto files
// (github.com/dstl/SAPIENT-Proto-Files, bsi_flex_335_v2_0): snake_case field names, enums as their string names,
// timestamps as RFC 3339 strings. Field names used here were checked against those files. Where this
// emulation fills a free-form field (classification type names, Task `request` strings) the values are
// illustrative, not taken from the standard.

import { GEO } from './config/index.js';
import { terrainState } from './terrain.js';
import { latLonOf } from './world-pack.js';
import { idRand, EPOCH_MS } from './rng.js';

export const ICD_VERSION = 'BSI Flex 335 v2.0';

const CONTENT_KEYS = [
  'registration', 'registration_ack', 'status_report', 'detection_report',
  'task', 'task_ack', 'alert', 'alert_ack', 'error',
];

// ---------- simulated clock ----------
// Message timestamps follow simulated time, so paused/fast-forwarded play stays consistent.
export const clock = { epochMs: EPOCH_MS, t: 0 };
const simMs = () => clock.epochMs + clock.t * 1000;
export const timestamp = () => new Date(simMs()).toISOString();

// ---------- identifiers ----------
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, as used by ULID
export function ulid() {
  let ms = Math.floor(simMs());
  let time = '';
  for (let i = 0; i < 10; i++) { time = B32[ms % 32] + time; ms = Math.floor(ms / 32); }
  let rand = '';
  for (let i = 0; i < 16; i++) rand += B32[Math.floor(idRand() * 32)];
  return time + rand;
}
export function uuid() { // RFC 4122 version 4 layout, from the seeded id stream
  const b = Array.from({ length: 16 }, () => Math.floor(idRand() * 256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------- geometry ----------
const M_PER_DEG = 111320;
export const round = (x, n = 3) => Number(x.toFixed(n));

// Location (SAPIENT: x = longitude, y = latitude, z = altitude in metres) from metres east/north of the origin.
export function location(eastM, northM, altM, errM = 0) {
  const geo = terrainState.data?.geo; // a real world knows where it is, to full accuracy
  const flatLat = GEO.originLat + northM / M_PER_DEG;
  const { lat, lon } = geo ? latLonOf(geo, eastM, northM) : { lat: flatLat, lon: GEO.originLon + eastM / (M_PER_DEG * Math.cos((GEO.originLat * Math.PI) / 180)) };
  const cosLat = Math.cos(((geo ? lat : GEO.originLat) * Math.PI) / 180);
  const loc = {
    x: round(lon, 7), y: round(lat, 7), z: round(geo ? altM + geo.H0 + geo.geoidSeparation : altM, 1),
    coordinate_system: 'LOCATION_COORDINATE_SYSTEM_LAT_LNG_DEG_M',
    datum: 'LOCATION_DATUM_WGS84_E',
  };
  if (errM) {
    loc.x_error = round(errM / (M_PER_DEG * cosLat), 7);
    loc.y_error = round(errM / M_PER_DEG, 7);
    loc.z_error = round(errM, 1);
  }
  return loc;
}

// ---------- envelope ----------
// SapientMessage: timestamp, node_id, optional destination_id, and exactly one content field.
export function envelope(nodeId, key, body, destinationId) {
  const msg = { timestamp: timestamp(), node_id: nodeId };
  if (destinationId) msg.destination_id = destinationId;
  msg[key] = body;
  return msg;
}
export const typeOf = (msg) => CONTENT_KEYS.find((k) => msg[k] !== undefined);

// ---------- validation (what a middleware would check) ----------
export function validate(msg) {
  const problems = [];
  if (!msg.timestamp) problems.push('timestamp is mandatory');
  else if (Number.isNaN(Date.parse(msg.timestamp))) problems.push('timestamp must be an RFC 3339 time');
  if (!UUID_RE.test(msg.node_id || '')) problems.push('node_id must be a UUID');
  if (msg.destination_id !== undefined && !UUID_RE.test(msg.destination_id)) problems.push('destination_id must be a UUID');
  const present = CONTENT_KEYS.filter((k) => msg[k] !== undefined);
  if (present.length !== 1) { problems.push(`exactly one content field required, found ${present.length}`); return problems; }
  const type = present[0];
  const c = msg[type];
  if (!c || typeof c !== 'object') { problems.push(`${type}: must be a message, not ${c === null ? 'null' : typeof c}`); return problems; }
  const need = (cond, text) => { if (!cond) problems.push(`${type}: ${text}`); };
  switch (type) {
    case 'registration':
      need(c.node_definition && c.node_definition.length, 'node_definition is mandatory');
      need(c.icd_version, 'icd_version is mandatory');
      need(c.name, 'name is mandatory');
      need(c.short_name, 'short_name is mandatory');
      need(c.status_definition && c.status_definition.status_interval, 'status_definition.status_interval is mandatory');
      break;
    case 'registration_ack': need(typeof c.acceptance === 'boolean', 'acceptance is mandatory'); break;
    case 'status_report':
      need(ULID_RE.test(c.report_id || ''), 'report_id must be a ULID');
      need(c.system, 'system is mandatory'); need(c.info, 'info is mandatory'); need(c.mode, 'mode is mandatory');
      break;
    case 'detection_report':
      need(ULID_RE.test(c.report_id || ''), 'report_id must be a ULID');
      need(ULID_RE.test(c.object_id || ''), 'object_id must be a ULID');
      need(c.range_bearing || c.location, 'one of range_bearing or location is mandatory');
      break;
    case 'task':
      need(ULID_RE.test(c.task_id || ''), 'task_id must be a ULID'); need(c.control, 'control is mandatory'); break;
    case 'task_ack':
      need(ULID_RE.test(c.task_id || ''), 'task_id must be a ULID'); need(c.task_status, 'task_status is mandatory'); break;
    case 'alert': need(ULID_RE.test(c.alert_id || ''), 'alert_id must be a ULID'); break;
    case 'alert_ack':
      need(ULID_RE.test(c.alert_id || ''), 'alert_id must be a ULID'); need(c.alert_ack_status, 'alert_ack_status is mandatory'); break;
    default: break;
  }
  return problems;
}

// ---------- message bus ----------
// Everything any node sends is recorded here, in order. This is the view a middleware (or a packet capture) has.
export const bus = {
  entries: [], max: 5000, seq: 0,
  counts: {}, tx: new Map(), rx: new Map(),
  listeners: new Set(),
};

export function emit(msg, from, to) {
  const type = typeOf(msg);
  const entry = { seq: ++bus.seq, t: clock.t, type, from, to, msg };
  bus.entries.push(entry);
  if (bus.entries.length > bus.max) bus.entries.splice(0, bus.entries.length - bus.max + 500);
  bus.counts[type] = (bus.counts[type] || 0) + 1;
  bus.tx.set(from, (bus.tx.get(from) || 0) + 1);
  bus.rx.set(to, (bus.rx.get(to) || 0) + 1);
  for (const f of bus.listeners) f(entry);
  return entry;
}

export function clearBus() {
  bus.entries.length = 0; bus.seq = 0; bus.counts = {}; bus.tx.clear(); bus.rx.clear();
}

// Send through the middleware: validate, record, and if invalid also record the Error it would return.
// Returns the bus entry for the message (entry.ok is false if it failed validation).
export function send(msg, from, to, middlewareId) {
  const problems = validate(msg);
  const entry = emit(msg, from, to);
  entry.ok = problems.length === 0;
  if (problems.length) {
    const packet = btoa(unescape(encodeURIComponent(JSON.stringify(msg)))).slice(0, 200);
    emit(envelope(middlewareId, 'error', { packet, error_message: problems }, from), middlewareId, from);
  }
  return entry;
}
