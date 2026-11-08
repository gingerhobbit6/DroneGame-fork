// @vitest-environment jsdom
// The wizard's optional people step: the same size and protection choices as the People tool, from inside the wizard.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { view } from '../src/render/view.js';
import { App } from '../src/ui/App.jsx';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

let game;
const $ = (sel) => document.querySelector(sel);
const button = (text) => [...document.querySelectorAll('#wizard button')].find((b) => b.textContent.includes(text));

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  Object.assign(view, { zone: null, spot: null, wizard: 'closed', people: { count: 10, protection: 'open' } });
  game.attach = vi.fn();
  render(<App game={game} />);
  fireEvent.click($('#btn-deploy'));
  fireEvent.click($('#btn-wizard'));
  fireEvent.click($('[aria-label="Step 6: Who is on site?"]'));
});
afterEach(cleanup);

describe('the people step', () => {
  it('is optional, and turns on the People tool while it is open', () => {
    expect($('#wizard h2').textContent).toBe('Who is on site?');
    expect($('#wizard').textContent).toContain('OPTIONAL');
    expect(game.getTool()).toBe('people');
    expect($('#tool-picker')).toBeNull(); // the wizard shows the controls, not a second panel
    expect(button('Skip this step')).toBeTruthy();
  });

  it('places a group of the chosen size and protection, then moves on', () => {
    const size = $('#wz-people #people-count');
    size.value = 25; fireEvent.change(size);
    fireEvent.click($('#wz-people [data-protection="bunker"]'));
    act(() => { game.sim.commands.placePeople(20, 20, view.people.count, view.people.protection); game.bump(); }); // what a map click does with the People tool
    expect(game.sim.people.map((g) => [g.count, g.protection])).toEqual([[25, 'bunker']]);
    expect($('#wz-people .people-list').textContent).toContain('25 civilians · In a bunker');
    fireEvent.click(button('Next'));
    expect($('#wizard h2').textContent).toBe('Rehearse before it counts');
    expect(game.getTool()).toBeNull();
  });
});
