// @vitest-environment jsdom
// The SAPIENT panel's spectrum, cost and sources tabs, source links and the minimap, against a real simulation.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { COMMS, STRUCTURES, WORLD, WAVES, resetAllFigures, setFigure } from '../src/sim/config/index.js';
import { view } from '../src/render/view.js';
import { GameContext } from '../src/ui/hooks.js';
import { Dock } from '../src/ui/dock/Dock.jsx';
import { safeHref, SourceLinks } from '../src/ui/dock/SourceLinks.jsx';
import { basisOf } from '../src/ui/dock/SourcesTab.jsx';
import { drawSpectrum, jamConflicts } from '../src/ui/dock/spectrum-canvas.js';
import { createPlanCanvas } from '../src/ui/dock/plan-canvas.js';
import { createNetworkCanvas } from '../src/ui/dock/network-canvas.js';
import { createMinimap } from '../src/ui/minimap.js';
import { MIXED, setUp, play } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

// a 2D context that accepts every drawing call
const fakeContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
const sized = (el) => { Object.defineProperty(el, 'clientWidth', { value: 600, configurable: true }); Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true }); el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 400 }); return el; };
const newCanvas = () => sized(document.createElement('canvas'));

let game;
const $ = (sel) => document.querySelector(sel);
const refresh = () => act(() => game.bump());
const tab = (name) => fireEvent.click($(`[data-tab="${name}"]`));
function openDock(name) {
  render(<GameContext.Provider value={game}><Dock open onClose={() => {}} /></GameContext.Provider>);
  if (name) tab(name);
}
const running = (laydown = MIXED, steps = 2400) => {
  setUp(game.sim, { seed: '1', laydown });
  game.sim.state.warnedWire = true;
  game.sim.commands.startWave();
  game.sim.run(steps);
};

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = fakeContext;
  game = createGame({ seed: '1', terrainSeed: '1', api: createFakeApi(), storage: createFakeStorage() });
  Object.assign(view, { truth: true, labels: true, rings: true, trackHi: false, replayT: null });
});
afterEach(() => { cleanup(); resetAllFigures(); });

describe('spectrum tab', () => {
  it('warns when your jamming overlaps your own links', () => {
    setUp(game.sim, { seed: '1', laydown: [['rf', 900, 0], ['jammer', 500, 300]] });
    game.sim.commands.wireNode(game.sim.structures.find((s) => s.def.id === 'rf'), 'cellular');
    openDock('spectrum');
    expect($('#spec-notes').textContent).toContain('No overlap');
    game.sim.structures.find((s) => s.jamBands).jamBands.add('control900');
    refresh();
    expect($('#spec-notes').textContent).toContain('overlaps your');
    expect(jamConflicts(game.sim.net).length).toBeGreaterThan(0);
    const cv = newCanvas();
    drawSpectrum(cv, game.sim.net);
    game.sim.structures.find((s) => s.jamBands).mode = 'Jam';
    drawSpectrum(cv, game.sim.net);
    refresh();
    expect($('#spec-notes b').textContent).toContain('JAM');
    drawSpectrum(document.createElement('canvas'), game.sim.net);
  });
});

describe('on a scaled display', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('gives the plan, network and spectrum canvases the display\'s pixels, and still draws and takes clicks in CSS pixels', () => {
    vi.stubGlobal('devicePixelRatio', 2.5);
    setUp(game.sim, { seed: '1', laydown: MIXED });
    const scaled = () => { const cv = newCanvas(), g = Object.assign(fakeContext(), { setTransform: vi.fn() }); cv.getContext = () => g; return { cv, g }; };
    const map = scaled(), wires = scaled(), bands = scaled();
    const plan = createPlanCanvas(map.cv, game.sim);
    plan.draw(null);
    const diagram = createNetworkCanvas(wires.cv, game.sim.net, { getSel: () => null, isVisible: () => true, getPace: () => 1 });
    diagram.draw();
    drawSpectrum(bands.cv, game.sim.net);
    for (const { cv, g } of [map, wires, bands]) {
      expect([cv.width, cv.height]).toEqual([1500, 1000]); // 600 by 400 on the page
      expect(g.setTransform).toHaveBeenLastCalledWith(2.5, 0, 0, 2.5, 0, 0);
    }
    expect(diagram.hitTest({ x: 300, y: 130 }).box.kind).toBe('fusion'); // found where it is on the page, not in the canvas's own pixels
    plan.dispose(); diagram.dispose();
  });
});

describe('cost tab', () => {
  it('starts empty, then shows the laydown, shots and enemy', () => {
    openDock('cost');
    setUp(game.sim, { seed: '1', laydown: [] });
    game.commands.clearAll();
    refresh();
    expect($('#cost').textContent).toContain('Nothing placed yet');
    setUp(game.sim, { seed: '1', laydown: [['radar', 600, 0], ['interceptor', 490, 99], ['rf', 900, 0]] });
    game.sim.state.warnedWire = true;
    play(game.sim, 6);
    Object.assign(game.sim.ledger, { lost: { radar: 2 }, lostValue: 1800000 });
    refresh();
    const text = $('#cost').textContent;
    expect(text).toContain('Medium radar');
    expect(text).toContain('terminal');
    expect(text).toMatch(/£[\d.]+ of shots/);
    expect(text).toContain('Lost to enemy strikes');
    expect($('#cost a')).not.toBeNull();
  }, 60000);
});

describe('sources tab', () => {
  it('edits a figure, shows a reset for it, and resets it', () => {
    const changed = vi.spyOn(game, 'figuresChanged');
    openDock('systems');
    const range = $('#systems input[data-key="published"]');
    const base = STRUCTURES.radar.published;
    fireEvent.change(range, { target: { value: '3000' } });
    expect(STRUCTURES.radar.range).toBe(3000);
    expect(changed).toHaveBeenCalled();
    const fig = range.closest('label');
    expect(fig.querySelector('.fr').className).not.toContain('hidden');
    fireEvent.click(fig.querySelector('.fr'));
    expect(STRUCTURES.radar.published).toBe(base);
    fireEvent.change(range, { target: { value: '-5' } });
    expect(STRUCTURES.radar.published).toBe(base);
    expect(range.value).toBe(String(base));
  });

  it('holds a share at 1 on screen, as the game does', () => {
    openDock('systems');
    const chance = $('#systems input[data-key="pk"]'), loss = $('#systems input[data-key="loss"]');
    fireEvent.change(chance, { target: { value: '1.5' } });
    expect(chance.value).toBe('1'); // it stayed at 1.5 while the game used 1
    expect(loss.max).toBe('1');
    expect($('#systems input[data-key="published"]').max).toBe(''); // a range has no such limit
  });

  it('scales ranges, sets the gap, resets all and exports', () => {
    openDock('systems');
    fireEvent.change($('#src-rangescale'), { target: { value: '2' } });
    expect(WORLD.rangeScale).toBe(2);
    expect(STRUCTURES.radar.range).toBe(STRUCTURES.radar.published * 2);
    fireEvent.change($('#src-rangescale'), { target: { value: '1e308' } });
    expect(WORLD.rangeScale).toBe(2);
    expect($('#src-rangescale').value).toBe('2');
    fireEvent.change($('#src-fpvgap'), { target: { value: '7' } });
    expect(WAVES.fpvGap).toBe(7);
    fireEvent.click($('#src-reset'));
    expect(WORLD.rangeScale).toBe(1);
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click($('#src-export'));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    const fileClick = vi.spyOn($('#src-file'), 'click').mockImplementation(() => {});
    fireEvent.click($('#src-import'));
    expect(fileClick).toHaveBeenCalled();
  });

  it('imports a valid file, and refuses a broken one with a message', async () => {
    const toasts = [];
    game.onToast((t) => toasts.push(t));
    openDock('systems');
    const file = (text) => ({ target: { files: [{ text: async () => text }], value: '' } });
    await act(async () => { fireEvent.change($('#src-file'), file(JSON.stringify({ structures: { radar: { published: 1234 } } }))); await Promise.resolve(); });
    expect(STRUCTURES.radar.published).toBe(1234);
    await act(async () => { fireEvent.change($('#src-file'), file('{not json')); await Promise.resolve(); });
    expect(toasts[0]).toMatch(/not a valid figures export/);
    await act(async () => { fireEvent.change($('#src-file'), { target: { files: [] } }); });
  });

  it('labels where each figure comes from', () => {
    const def = { ref: { confidence: 'ASSUMPTION', cost: { confidence: 'Press' } }, confidence: 'x', costRef: { confidence: 'ASSUMPTION' } };
    expect(basisOf('structures', def, 'published')).toBe('assumption');
    expect(basisOf('structures', def, 'cost')).toBe('price');
    expect(basisOf('structures', def, 'missileSpeed')).toBe('research');
    expect(basisOf('structures', def, 'damage')).toBe('rule');
    expect(basisOf('comms', def, 'cost')).toBe('price');
    expect(basisOf('comms', { confidence: 'ASSUMPTION' }, 'latency')).toBe('assumption');
    expect(basisOf('comms', def, 'latency')).toBe('research');
    expect(basisOf('drones', def, 'cost')).toBe('assumption');
    expect(basisOf('drones', def, 'hp')).toBe('rule');
    setFigure('comms', 'starlink', 'cost', COMMS.starlink.cost);
  });
});

describe('source links', () => {
  it('only ever link to https', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com');
    for (const bad of ['javascript:alert(1)', 'http://example.com', 'data:text/html,x', 'not a url']) expect(safeHref(bad)).toBeNull();
    render(<SourceLinks sources={[{ url: 'javascript:alert(1)', label: 'bad' }, { url: 'https://a.example', label: 'one' }, { url: 'https://b.example', label: 'two' }]} />);
    expect([...document.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['one', 'two']);
    cleanup();
    render(<SourceLinks sources={[]} />);
    expect(document.body.textContent).toContain('none found');
  });
});

describe('minimap', () => {
  it('draws, moves the camera and zooms', () => {
    setUp(game.sim, { seed: '1', laydown: MIXED });
    game.sim.spawnDrone('fpv', 0, {});
    const cv = newCanvas();
    cv.width = cv.height = 226;
    cv.setPointerCapture = () => {};
    const camera = { position: { x: 0, y: 300, z: 380 }, fov: 55, aspect: 1.5 };
    const controls = { target: { x: 0, y: 0, z: 0 } };
    view.hillshade = document.createElement('canvas');
    const map = createMinimap(game.sim, cv, camera, controls);
    map.draw(); map.draw();
    view.rings = false; view.truth = false;
    map.draw(); map.draw();
    const at = (type) => { const e = new MouseEvent(type, { clientX: 100, clientY: 100 }); e.pointerId = 1; cv.dispatchEvent(e); };
    at('pointermove');
    expect(controls.target.x).toBe(0);
    at('pointerdown');
    expect(controls.target.x).not.toBe(0);
    at('pointermove');
    at('pointerup');
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
    view.hillshade = null;
  });
});
