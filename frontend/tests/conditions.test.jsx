// @vitest-environment jsdom
// Stage A5, the conditions: the light and weather a run is fought in. A clear day changes nothing; the rest change cameras by channel,
// radar by band and lasers, are reported over SAPIENT, and are saved with the laydown so a run replays.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame } from '../src/game.js';
import { STRUCTURES, resetAllFigures } from '../src/sim/config/index.js';
import { CONDITIONS, ENV, cleanConditions, weatherRange } from '../src/sim/conditions.js';
import { unitDef } from '../src/sim/unit-config.js';
import { GameContext } from '../src/ui/hooks.js';
import { ControlPanel } from '../src/ui/ControlPanel.jsx';
import { Overlay } from '../src/ui/Overlay.jsx';
import { setUp } from './support/scenarios.js';
import { replayRun } from './support/replay.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

let game, sim;
const $ = (sel) => document.querySelector(sel);
const lay = (...ids) => setUp(sim, { seed: '1', laydown: ids.map((id, i) => [id, 600 + i * 100, 0]) });
const firstWave = () => { sim.state.warnedWire = true; game.commands.startWave(); };
const at = (name, fn) => { expect(game.commands.setConditions(name)).toBeNull(); return fn(); };

beforeEach(() => {
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  game.getReplay = () => null;
  sim = game.sim;
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('what the conditions change', () => {
  it('leave everything as it was on a clear day', () => {
    expect(sim.state.conditions).toBe('day');
    for (const def of Object.values(STRUCTURES)) expect(weatherRange(unitDef(def.id))).toBe(1);
  });
  it('fade a visible camera at dusk and blind it at night, while thermal works on', () => {
    const visible = unitDef('camera', { channels: 'visible' }), thermal = unitDef('camera_s'), both = unitDef('camera');
    at('dusk', () => expect(visible.range).toBe(325));
    at('night', () => {
      expect(visible.range).toBe(65);
      expect(thermal.range).toBe(260);
      expect(both.range).toBe(650); // its thermal channel
    });
  });
  it('let a faster lens keep more of a visible camera at night', () => {
    at('night', () => expect(unitDef('camera', { channels: 'visible', fnumber: 1.4 }).range).toBe(Math.round(650 * 0.1 * (2 / 1.4) ** 2)));
  });
  it('cut cameras, lasers and the higher radar bands in rain and haze, and leave radio alone', () => {
    at('rain', () => {
      expect(unitDef('camera').range).toBe(390);
      expect(unitDef('radar').range).toBe(Math.round(3100 * 0.95));
      expect(weatherRange(unitDef('radar_s'))).toBe(0.75); // K band
      expect(weatherRange(unitDef('radar', { band: 's' }))).toBe(1);
      expect(weatherRange(unitDef('laser'))).toBe(0.5);
      expect(weatherRange(unitDef('laser_rfdew'))).toBe(1); // an RF weapon
      expect(weatherRange(unitDef('rf'))).toBe(1);
      expect(unitDef('acoustic').range).toBe(250); // rain noise drowns half its reach
    });
    at('night', () => expect(weatherRange(unitDef('acoustic'))).toBe(1));
  });
  it('at night, give a thermal camera nothing for pixels finer than its lens resolves', () => {
    at('night', () => {
      expect(unitDef('camera', { pixels: 'fhd' }).range).toBe(650); // 8 µm pixels under a 20 µm spot at f/2
      expect(unitDef('camera_s', { pixels: 'hd' }).range).toBe(Math.round(260 * 2 * (6 / 10))); // f/1 resolves 10 µm, not 6
    });
  });
  it('turn anything unknown into a clear day', () => {
    expect(cleanConditions('fog')).toBe('day');
    expect(cleanConditions('constructor')).toBe('day');
    expect(cleanConditions('night')).toBe('night');
  });
});

describe('the run', () => {
  it('locks them once the first wave starts', () => {
    lay('radar');
    firstWave();
    expect(game.commands.setConditions('night')).toMatch(/locked/);
    expect(sim.state.conditions).toBe('day');
  });
  it('saves them with the laydown, keeps them on a reset, and clears them with the map', () => {
    lay('radar');
    expect(sim.currentLaydown().conditions).toBeUndefined();
    game.commands.setConditions('rain');
    expect(sim.currentLaydown().conditions).toBe('rain');
    game.commands.reset('keep');
    expect(sim.state.conditions).toBe('rain');
    expect(ENV.now).toBe('rain');
    game.commands.reset('clear');
    expect(sim.state.conditions).toBe('day');
    expect(ENV.now).toBe('day');
  });
  it('reports the light and weather in every sensor status, over SAPIENT', () => {
    lay('radar', 'jammer');
    game.commands.setConditions('night');
    sim.run(200);
    const statuses = sim.bus.entries.filter((e) => e.type === 'status_report').map((e) => e.msg.status_report.status ?? []);
    const types = (value) => statuses.flat().filter((s) => s.status_value === value).map((s) => s.status_type);
    expect(types('Night')).toContain('STATUS_TYPE_ILLUMINATION');
    expect(types('Clear')).toContain('STATUS_TYPE_WEATHER');
  });
  it('replays a run at night to its own digest', () => {
    lay('radar', 'camera', 'interceptor');
    game.commands.setConditions('night');
    let run = null;
    const take = (r) => { run = r; };
    sim.on('runEnded', take);
    firstWave();
    sim.run(600);
    sim.endRun();
    sim.off('runEnded', take);
    const record = JSON.parse(JSON.stringify(run));
    expect(record.spec.conditions).toBe('night');
    game.commands.setConditions('day');
    replayRun(sim, record);
    expect(sim.state.conditions).toBe('night');
    expect(sim.digest()).toBe(record.digest);
  }, 60000);
});

describe('choosing them', () => {
  it('on the start card', () => {
    render(<GameContext.Provider value={game}><Overlay /></GameContext.Provider>);
    expect([...$('#start-conditions').options].map((o) => o.textContent)).toEqual(Object.values(CONDITIONS).map((c) => c.label));
    fireEvent.change($('#start-conditions'), { target: { value: 'dusk' } });
    expect(sim.state.conditions).toBe('dusk');
  });
  it('in the control panel, until the first wave starts', () => {
    lay('radar');
    render(<GameContext.Provider value={game}><ControlPanel onToggleDock={() => {}} onToggleTuning={() => {}} onSandbox={() => {}} /></GameContext.Provider>);
    fireEvent.change($('#conditions'), { target: { value: 'rain' } });
    expect(sim.state.conditions).toBe('rain');
    act(() => firstWave());
    expect($('#conditions').disabled).toBe(true);
  });
});
