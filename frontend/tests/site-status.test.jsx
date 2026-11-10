// @vitest-environment jsdom
// A map build can finish or fail in its first response, before the progress poll starts.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameContext } from '../src/ui/hooks.js';
import { SiteStatus } from '../src/ui/SiteStatus.jsx';

let packs, onBuilt, game, mounted;
const settle = () => act(async () => {});
const build = () => fireEvent.click(screen.getByRole('button', { name: 'Build this map' }));
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(2000); });
const page = (done) => (
  <GameContext.Provider value={game}>
    <SiteStatus wanted={{ e: 222000, n: 166000 }} onBuilt={done} />
  </GameContext.Provider>
);

beforeEach(() => {
  vi.useFakeTimers();
  packs = { build: vi.fn(), buildStatus: vi.fn() };
  onBuilt = vi.fn();
  game = { api: { packs } };
  mounted = render(page(onBuilt));
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('map build outcomes', () => {
  it('shows an immediate failure and allows a retry without polling', async () => {
    packs.build.mockResolvedValueOnce({ running: false, ok: false, message: 'The map builder could not start. It needs uv installed.' });
    build(); await settle();
    expect(screen.getByText(/The map builder could not start/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Build this map' })).toBeTruthy();
    await poll();
    expect(packs.buildStatus).not.toHaveBeenCalled();
    expect(onBuilt).not.toHaveBeenCalled();

    packs.build.mockResolvedValueOnce({ running: true, ok: null, message: 'Starting' });
    build(); await settle();
    expect(screen.queryByText(/The map builder could not start/)).toBeNull();
    expect(screen.getByText('Building... Starting')).toBeTruthy();
    packs.buildStatus.mockResolvedValueOnce({ running: false, ok: true, message: 'Finished' });
    await poll();
    expect(onBuilt).toHaveBeenCalledTimes(1);
  });

  it('uses a map that finished in the initial response, without waiting for a poll', async () => {
    packs.build.mockResolvedValueOnce({ running: false, ok: true, message: 'Finished' });
    build(); await settle();
    expect(onBuilt).toHaveBeenCalledTimes(1);
    await poll();
    expect(packs.buildStatus).not.toHaveBeenCalled();
  });

  it('reports a failure discovered while polling and stops further polls', async () => {
    packs.build.mockResolvedValueOnce({ running: true, ok: null, message: 'Starting' });
    packs.buildStatus.mockResolvedValueOnce({ running: false, ok: false, message: 'The map download failed.' });
    build(); await settle();
    await poll();
    expect(screen.getByText('The map download failed.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Build this map' })).toBeTruthy();
    await poll();
    expect(packs.buildStatus).toHaveBeenCalledTimes(1);
    expect(onBuilt).not.toHaveBeenCalled();
  });

  it('allows retry after a progress request fails, with only one progress request at a time', async () => {
    packs.build.mockResolvedValue({ running: true, ok: null, message: 'Starting' });
    packs.buildStatus.mockRejectedValueOnce(new Error('The save server is not running.'));
    build(); await settle();
    await poll();
    expect(screen.getByRole('alert').textContent).toBe('The save server is not running.');
    expect(screen.queryByText('Building... Starting')).toBeNull();
    expect(screen.getByRole('button', { name: 'Build this map' })).toBeTruthy();
    await poll();
    expect(packs.buildStatus).toHaveBeenCalledTimes(1);

    let finish;
    packs.buildStatus.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    build(); await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    await poll();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(packs.buildStatus).toHaveBeenCalledTimes(2);
    await act(async () => { finish({ running: false, ok: true, message: 'Finished' }); });
    expect(onBuilt).toHaveBeenCalledTimes(1);
    await poll();
    expect(packs.buildStatus).toHaveBeenCalledTimes(2);
  });

  it('keeps polling through parent renders and reports success to the latest callback', async () => {
    packs.build.mockResolvedValueOnce({ running: true, ok: null, message: 'Starting' });
    packs.buildStatus.mockResolvedValueOnce({ running: true, ok: null, message: 'Downloading' });
    let finish;
    packs.buildStatus.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    build(); await settle();
    const earlier = [onBuilt];
    for (let i = 0; i < 8; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      const changed = vi.fn();
      earlier.push(changed);
      mounted.rerender(page(changed));
      if (i === 3) expect(packs.buildStatus).toHaveBeenCalledTimes(1);
    }
    expect(packs.buildStatus).toHaveBeenCalledTimes(2);
    const latest = vi.fn();
    mounted.rerender(page(latest));
    await act(async () => { finish({ running: false, ok: true, message: 'Finished' }); });
    expect(latest).toHaveBeenCalledTimes(1);
    for (const callback of earlier) expect(callback).not.toHaveBeenCalled();
    await poll();
    expect(packs.buildStatus).toHaveBeenCalledTimes(2);
  });

  it('reports a refused start and an immediate failure without a message', async () => {
    packs.build.mockRejectedValueOnce(new Error('The map build daily limit has been reached.'));
    build(); await settle();
    expect(screen.getByText('The map build daily limit has been reached.')).toBeTruthy();
    packs.build.mockResolvedValueOnce({ running: false, ok: false });
    build(); await settle();
    expect(screen.getByText('The map could not be built.')).toBeTruthy();
    expect(screen.queryByText('The map build daily limit has been reached.')).toBeNull();
  });
});
