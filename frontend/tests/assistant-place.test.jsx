// @vitest-environment jsdom
// The wizard tells the player exactly how to place what it recommends: open the list, find the system, drag it onto the map.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { FUSION, STRUCTURES, resetAllFigures } from '../src/sim/config/index.js';
import { view } from '../src/render/view.js';
import { App } from '../src/ui/App.jsx';
import { AccountContext } from '../src/ui/account/pack.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

let game;
const $ = (sel) => document.querySelector(sel);
const steps = () => [...document.querySelectorAll('#wz-place li')];
const now = () => steps().findIndex((li) => li.className === 'now') + 1;
const toSensors = () => fireEvent.click($('[aria-label^="Step 2:"]'));

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  game.attach = vi.fn();
  Object.assign(view, { zone: null, spot: null, wizard: 'closed', coverageOn: false, coverageThreat: null });
  FUSION.authority = 'auto';
});
afterEach(() => { cleanup(); resetAllFigures(); });

function opened(pack = null) {
  render(<AccountContext.Provider value={pack && { activeUnit: pack }}><App game={game} /></AccountContext.Provider>);
  fireEvent.click($('#btn-deploy'));
  fireEvent.click($('#btn-wizard'));
  toSensors();
}

describe('placing what the wizard recommends', { timeout: 30000 }, () => {
  it('walks through opening the list, finding the system and dragging it on, ringing each control in turn', () => {
    opened();
    const recommended = $('#wz-advice b').textContent;
    expect(steps().length).toBe(3);
    expect(steps()[0].textContent).toBe('Click Radar in the toolbar on the left. Its list of real systems opens beside it.');
    expect(steps()[1].textContent).toContain(recommended);
    expect(steps()[2].textContent).toMatch(/Drag it onto the map/);
    expect(now()).toBe(1);
    const ring = () => $('#wizard-spot');
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 30, width: 100, height: 20, right: 120, bottom: 50 });
    act(() => game.bump());
    expect(ring()).not.toBeNull();

    fireEvent.click($('[data-catalogue="radar"]'));
    expect(now()).toBe(2);
    expect($('#tool-picker')).not.toBeNull(); // the list shows beside the wizard
    expect(steps()[0].className).toBe('done');

    const id = Object.values(STRUCTURES).find((d) => d.product === recommended).id;
    fireEvent.click($(`[data-pick="${id}"]`));
    expect(now()).toBe(3);
    expect(ring()).toBeNull(); // nothing left to point at but the map
  });

  it('scrolls the step to do now into view as it moves on', () => {
    const seen = [];
    Element.prototype.scrollIntoView = function () { seen.push(this); }; // jsdom has none
    try {
      opened();
      fireEvent.click($('[data-catalogue="radar"]'));
      const id = Object.values(STRUCTURES).find((d) => d.product === $('#wz-advice b').textContent).id;
      expect(seen).toContain(steps()[1]); // the step, in the wizard
      expect(seen).toContain($(`[data-pick="${id}"]`)); // and the system, in the list
    } finally { delete Element.prototype.scrollIntoView; }
  });

  it('follows a system of the same kind the player picked instead', () => {
    opened();
    fireEvent.click($('[data-catalogue="radar"]'));
    fireEvent.click($('[data-pick="radar_s"]'));
    expect(now()).toBe(3);
    expect(steps()[1].textContent).toContain(STRUCTURES.radar_s.product);
  });

  it('says when the system is in the deployed pack too', () => {
    const radars = Object.values(STRUCTURES).filter((d) => d.kind === 'radar').map((d) => ({ id: d.id, count: 1 }));
    opened({ id: 1, name: 'Troop', assets: { systems: radars, vehicles: [], people: [] } });
    expect($('#wizard').textContent).toMatch(/It is in your deployment pack too/);
  });

  it('says nothing of a pack that does not hold it', () => {
    opened({ id: 1, name: 'Troop', assets: { systems: [{ id: 'laser', count: 1 }], vehicles: [], people: [] } });
    expect($('#wizard').textContent).not.toMatch(/deployment pack/);
  });
});
