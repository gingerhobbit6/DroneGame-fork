import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as S from '../src/sim/sapient.js';
import { seedAll } from '../src/sim/rng.js';

const ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const NODE = '11111111-2222-4333-8444-555555555555';
const msg = (key, body) => S.envelope(NODE, key, body);

beforeEach(() => { seedAll('test'); S.clearBus(); });

describe('identifiers', () => {
  it('are well formed and repeatable from the seed', () => {
    const a = [S.ulid(), S.uuid()];
    expect(a[0]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    seedAll('test');
    expect([S.ulid(), S.uuid()]).toEqual(a);
  });
});

describe('timestamps', () => {
  it('are built once for each time, and change when the clock or its epoch moves', () => {
    const was = { ...S.clock }, text = () => new Date(S.clock.epochMs + S.clock.t * 1000).toISOString();
    const built = vi.spyOn(Date.prototype, 'toISOString');
    try {
      S.clock.t = 12.5;
      const first = S.timestamp();
      expect(S.timestamp()).toBe(first);
      expect(built).toHaveBeenCalledTimes(1); // the second message in the step reuses the first one's text
      expect(first).toBe(text());
      S.clock.t = 12.55;
      expect(S.timestamp()).not.toBe(first);
      expect(S.timestamp()).toBe(text());
      const moved = S.timestamp();
      S.clock.epochMs += 60000;
      expect(S.timestamp()).not.toBe(moved);
      expect(S.timestamp()).toBe(text());
    } finally { built.mockRestore(); Object.assign(S.clock, was); }
  });
});

describe('location', () => {
  it('converts metres to degrees, with errors only when given', () => {
    const l = S.location(111320, 111320, 50);
    expect(l).toMatchObject({ x: 1, y: 1, z: 50 });
    expect(l.x_error).toBeUndefined();
    expect(S.location(0, 0, 0, 111320).y_error).toBe(1);
  });
});

describe('validation', () => {
  const valid = {
    registration: {
      node_definition: [{}], icd_version: 'v', capabilities: [{}], status_definition: { status_interval: {} }, config_data: [{ manufacturer: 'm', model: 'm' }],
      mode_definition: [{ mode_name: 'Detect', mode_type: 'MODE_TYPE_DEFAULT', settle_time: {}, task: { region_definition: {} } }],
    },
    registration_ack: { acceptance: true },
    status_report: { report_id: ULID, system: 'SYSTEM_OK', info: 'INFO_NEW', mode: 'Detect' },
    detection_report: { report_id: ULID, object_id: ULID, location: {} },
    task: { task_id: ULID, control: 'CONTROL_START' },
    task_ack: { task_id: ULID, task_status: 'TASK_STATUS_ACCEPTED' },
    alert: { alert_id: ULID },
    alert_ack: { alert_id: ULID, alert_ack_status: 'ALERT_ACK_STATUS_ACCEPTED' },
    error: { packet: 'x', error_message: [] },
  };

  it.each(Object.entries(valid))('accepts a valid %s', (key, body) => {
    expect(S.validate(msg(key, body))).toEqual([]);
    expect(S.typeOf(msg(key, body))).toBe(key);
  });

  it.each(Object.keys(valid).filter((k) => k !== 'error'))('rejects an empty %s', (key) => {
    expect(S.validate(msg(key, {})).length).toBeGreaterThan(0);
  });

  it('rejects a broken envelope', () => {
    expect(S.validate({ node_id: 'nope', destination_id: 'nope', alert: { alert_id: ULID } })).toEqual(expect.arrayContaining(['timestamp is mandatory', 'node_id must be a UUID', 'destination_id must be a UUID']));
    const t = '2026-01-01T00:00:00.000Z';
    expect(S.validate({ timestamp: t, node_id: NODE })[0]).toMatch(/exactly one content field/);
    expect(S.validate({ timestamp: t, node_id: NODE, alert: {}, task: {} })[0]).toMatch(/found 2/);
    expect(S.validate({ timestamp: 'banana', node_id: NODE, alert: { alert_id: ULID } })).toEqual(['timestamp must be an RFC 3339 time']);
  });

  it('reports a missing body instead of throwing on it', () => {
    expect(S.validate(msg('detection_report', null))).toEqual(['detection_report: must be a message, not null']);
    expect(S.send(msg('task', 5), 'a', 'b', 'mw').ok).toBe(false);
  });

  it('sets a destination only when given', () => {
    expect(S.envelope(NODE, 'alert', {}).destination_id).toBeUndefined();
    expect(S.envelope(NODE, 'alert', {}, NODE).destination_id).toBe(NODE);
  });
});

describe('the bus', () => {
  it('records messages and counts them per node', () => {
    const seen = [];
    const listener = (e) => seen.push(e.type);
    S.bus.listeners.add(listener);
    const e = S.send(msg('alert', { alert_id: ULID }), 'a', 'b', 'mw');
    S.bus.listeners.delete(listener);
    expect(e.ok).toBe(true);
    expect(seen).toEqual(['alert']);
    expect(S.bus.tx.get('a')).toBe(1);
    expect(S.bus.rx.get('b')).toBe(1);
    expect(S.bus.counts.alert).toBe(1);
  });

  it('answers an invalid message with an error from the middleware', () => {
    const e = S.send(msg('alert', {}), 'a', 'b', NODE);
    expect(e.ok).toBe(false);
    expect(S.bus.entries.at(-1).type).toBe('error');
    expect(S.bus.entries.at(-1).msg.error.error_message[0]).toMatch(/alert_id/);
  });

  it('caps its history', () => {
    for (let i = 0; i < S.bus.max + 1; i++) S.emit(msg('alert', { alert_id: ULID }), 'a', 'b');
    expect(S.bus.entries.length).toBeLessThanOrEqual(S.bus.max);
    expect(S.bus.seq).toBe(S.bus.max + 1);
  });
});
