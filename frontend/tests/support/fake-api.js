// An in-memory stand-in for the backend, with the same interface as api/client.js. `down` makes it fail like a dead server.

import { ApiError } from '../../src/api/client.js';

export function createFakeApi() {
  const state = { down: false, refuse: false, calls: [] };
  const guard = () => {
    if (state.down) throw new ApiError('The save server is not running.', true);
    if (state.refuse) throw new ApiError('The server refused that as invalid.', false);
  };
  const stamp = () => new Date(Date.UTC(2026, 10, 4, 12, 0, state.calls.length)).toISOString();
  const table = (name, extra = () => ({})) => {
    const rows = new Map();
    let next = 1;
    const summary = (r) => { const { spec, figures, commands, ...rest } = r; return rest; };
    return {
      rows,
      list: async () => { guard(); state.calls.push(`${name}.list`); return [...rows.values()].map(summary).reverse(); },
      get: async (id) => { guard(); if (!rows.has(id)) throw new ApiError('That no longer exists.', false); return structuredClone(rows.get(id)); },
      create: async (body) => {
        guard();
        state.calls.push(`${name}.create`);
        const row = { ...structuredClone(body), id: next++, created_at: stamp(), updated_at: stamp(), finished_at: stamp(), ...extra(body) };
        rows.set(row.id, row);
        return row;
      },
      replace: async (id, body) => { guard(); state.calls.push(`${name}.replace`); rows.set(id, { ...rows.get(id), ...structuredClone(body) }); return rows.get(id); },
      remove: async (id) => { guard(); state.calls.push(`${name}.remove`); if (!rows.delete(id)) throw new ApiError('That no longer exists.', false); return null; },
      page: async (limit, offset) => { guard(); const all = [...rows.values()].map(summary).reverse(); return { items: all.slice(offset, offset + limit), total: all.length }; },
    };
  };
  return { state, laydowns: table('laydowns'), figureSets: table('figureSets'), runs: table('runs'), units: table('units') };
}

export function createFakeStorage() {
  const data = new Map();
  return {
    full: false, data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem(k, v) { if (this.full) throw new Error('quota'); data.set(k, v); },
    removeItem: (k) => data.delete(k),
  };
}
