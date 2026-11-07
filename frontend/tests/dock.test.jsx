// @vitest-environment jsdom
// The SAPIENT panel, and its messages, nodes, plan and network tabs, against a real simulation.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game.js';
import { resetAllFigures } from '../src/sim/config/index.js';
import { view } from '../src/render/view.js';
import { GameContext } from '../src/ui/hooks.js';
import { Dock } from '../src/ui/dock/Dock.jsx';
import { summary } from '../src/ui/dock/MessagesTab.jsx';
import { createPlanCanvas } from '../src/ui/dock/plan-canvas.js';
import { createNetworkCanvas, pointAlong, linkColour, nodeList } from '../src/ui/dock/network-canvas.js';
import { terrainState } from '../src/sim/terrain.js';
import { bus, emit } from '../src/sim/sapient.js';
import { MIXED, setUp } from './support/scenarios.js';
import { createFakeApi, createFakeStorage } from './support/fake-api.js';

// a 2D context that accepts every drawing call
const fakeContext = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
const sized = (el) => { Object.defineProperty(el, 'clientWidth', { value: 600, configurable: true }); Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true }); el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 400 }); return el; };
const newCanvas = () => sized(document.createElement('canvas'));

const drawNow = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

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

describe('dock', () => {
  it('switches tabs, keeps one visible, and grows', () => {
    openDock();
    expect($('[data-pane="nodes"]').className).not.toContain('hidden');
    tab('messages');
    expect($('[data-pane="nodes"]').className).toContain('hidden');
    expect($('[data-pane="messages"]').className).not.toContain('hidden');
    fireEvent.click($('#dock-max'));
    expect($('#dock').className).toContain('max');
  });

  it('puts every tab in exactly one named group', () => {
    openDock();
    const groups = [...document.querySelectorAll('.tabs [role="group"]')];
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Live', 'Comms', 'Plan and cost', 'Records', 'Reference']);
    const tabs = groups.flatMap((g) => [...g.querySelectorAll('[data-tab]')]);
    expect(tabs).toHaveLength(document.querySelectorAll('[data-pane]').length);
    expect(new Set(tabs.map((t) => t.dataset.tab)).size).toBe(tabs.length);
    for (const t of tabs) expect(t.title).not.toBe('');
  });
});

describe('messages tab', () => {
  it('says when older messages are no longer kept, and does not claim to export them', () => {
    openDock('messages');
    expect($('#log-kept')).toBeNull();
    expect($('#log-export').title).not.toMatch(/every message/);
    const msg = { timestamp: 't', node_id: 'n', registration_ack: { acceptance: true } };
    for (let i = 0; i <= bus.max; i++) emit(msg, 'a', 'b');
    refresh();
    expect(bus.entries.length).toBeLessThan(bus.seq);
    expect($('#log-kept').textContent).toContain(`${bus.entries.length.toLocaleString('en-US')} of ${bus.seq.toLocaleString('en-US')}`);
  }, 30000);
  it('lists messages, filters them, and shows one in detail', () => {
    running();
    openDock('messages');
    const rows = () => document.querySelectorAll('#msg-list .row');
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().length).toBeLessThanOrEqual(150);
    fireEvent.click($('.chip[data-type="status_report"]'));
    expect($('.chip[data-type="status_report"]').className).toContain('off');
    expect([...rows()].some((r) => r.className.includes('t-status_report'))).toBe(false);
    fireEvent.click($('.chip[data-type="status_report"]'));
    fireEvent.click(rows()[rows().length - 1]);
    expect($('#msg-detail').textContent).toContain('timestamp');
    fireEvent.click($('#log-explain'));
    expect($('#msg-detail').textContent).not.toBe('Select a message to see its JSON.');
    const node = game.sim.structures[0];
    fireEvent.change($('#node-filter'), { target: { value: node.nodeId } });
    expect(rows().length).toBeGreaterThan(0);
    expect([...rows()].every((r) => r.textContent.includes(node.name) || r.textContent.includes('Fusion'))).toBe(true);
  }, 30000);

  it('freezes, clears, exports and injects a fault', () => {
    running();
    openDock('messages');
    fireEvent.click($('#log-freeze'));
    expect($('#log-freeze').textContent).toBe('Resume');
    const n = document.querySelectorAll('#msg-list .row').length;
    game.sim.run(100);
    refresh();
    expect(document.querySelectorAll('#msg-list .row').length).toBe(n);
    fireEvent.click($('#log-freeze'));
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click($('#log-export'));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    fireEvent.click($('#log-clear'));
    expect(document.querySelectorAll('#msg-list .row').length).toBe(0);
    fireEvent.click($('#log-fault'));
    expect(screen.getAllByText('error').length).toBeGreaterThan(0);
  }, 30000);

  it('summarises every message type', () => {
    running(MIXED, 6000);
    const seen = new Set();
    for (const e of game.sim.bus.entries) { expect(typeof summary(e)).toBe('string'); seen.add(e.type); }
    expect(seen.size).toBeGreaterThan(4);
    const wrap = (type, body) => ({ type, msg: { [type]: body } });
    expect(summary(wrap('registration_ack', { acceptance: false }))).toBe('rejected');
    expect(summary(wrap('registration', { name: 'n', node_definition: [{ node_type: 'NODE_TYPE_RADAR' }] }))).toBe('n (RADAR)');
    expect(summary(wrap('error', { error_message: ['x', 'y'] }))).toBe('x; y');
    expect(summary(wrap('detection_report', { object_id: 'abcdefgh', detection_confidence: 1, location: {} }))).toContain('location');
    expect(summary({ type: 'other', msg: { other: {} } })).toBe('');
  }, 30000);

  it('shows only what had been sent while rewinding', () => {
    running();
    view.replayT = 10;
    openDock('messages');
    for (const r of document.querySelectorAll('#msg-list .tm')) expect(parseFloat(r.textContent)).toBeLessThanOrEqual(10);
  }, 30000);
});

describe('nodes tab', () => {
  it('lists every node, and what it is doing', () => {
    running();
    openDock('nodes');
    expect(document.querySelectorAll('#node-table tbody tr').length).toBe(game.sim.net.nodes.size);
    expect($('#node-table').textContent).toContain('RDR-01');
  }, 30000);
});

describe('plan tab', () => {
  it('offers coverage for each threat', () => {
    openDock('plan');
    expect($('#cov-legend').textContent).toBe('');
    fireEvent.click($('#cov-on'));
    expect($('#cov-legend').textContent).toMatch(/Not seen.*Seen by 1 sensor.*By 2 or more.*% of the build area seen/);
    fireEvent.change($('#cov-threat'), { target: { value: 'fw' } });
    expect($('#cov-threat').value).toBe('fw');
  });
  it('works the coverage out again when the laydown, ground or figures change, and only then', () => {
    const spec = (x) => ({ structures: [{ id: 'radar', x, z: 0, uplink: null, cellBand: 'B8', jam: null }], fusionUplinks: [], fusionCell: 'B8' });
    const { net, commands } = game.sim;
    const plan = createPlanCanvas(newCanvas(), game.sim);
    const worked = vi.spyOn(net, 'coverageAt');
    const redone = () => { worked.mockClear(); plan.draw('fpv'); return worked.mock.calls.length > 0; };

    commands.loadLaydown(spec(30), '1');
    const ids = [...net.nodes.keys()];
    expect(redone()).toBe(true);
    expect(redone()).toBe(false);

    commands.loadLaydown(spec(120), '1');
    expect([...net.nodes.keys()]).toEqual(ids); // a reload repeats the node ids, so they cannot tell two laydowns apart
    expect(redone()).toBe(true);

    commands.loadLaydown(spec(120), 'other-ground');
    expect(redone()).toBe(true);

    commands.setFigure('drones', 'fpv', 'rcs', 0.5);
    expect(redone()).toBe(true);
  }, 30000);
  it('draws a running game, with and without coverage', () => {
    running();
    terrainState.hillshade = document.createElement('canvas');
    const cv = newCanvas(), plan = createPlanCanvas(cv, game.sim);
    plan.draw(null);
    plan.draw('fpv');
    plan.draw('fpv'); // cached
    view.truth = false;
    plan.draw(null);
    expect(cv.width).toBe(600);
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
    expect(() => createPlanCanvas(document.createElement('canvas'), game.sim).draw(null)).not.toThrow();
    plan.dispose();
    terrainState.hillshade = null;
  }, 30000);
});

describe('network tab', () => {
  it('keeps every system on a short canvas, where it can be clicked', () => {
    setUp(game.sim, { seed: '1', laydown: MIXED });
    const cv = newCanvas();
    Object.defineProperty(cv, 'clientWidth', { value: 300 });
    Object.defineProperty(cv, 'clientHeight', { value: 360 });
    const d = createNetworkCanvas(cv, game.sim.net, { getSel: () => null, isVisible: () => true, getPace: () => 1 });
    d.draw();
    const seen = new Set();
    for (let x = 0; x < 300; x += 10) for (let y = 0; y < 360; y += 5) seen.add(d.hitTest({ x, y }).box?.id);
    for (const n of nodeList(game.sim.net)) expect(seen).toContain(n.nodeId);
    d.dispose();
  });

  it('wires everything, shows the cost, and clears it', () => {
    setUp(game.sim, { seed: '1', laydown: [['rf', 900, 0], ['jammer', 500, 300]] });
    game.commands.clearAll();
    openDock('network');
    expect($('#net-cost').textContent).toContain('2 systems unwired');
    fireEvent.click($('#net-auto'));
    expect($('#net-cost').textContent).not.toContain('unwired');
    fireEvent.click($('#net-clear'));
    expect($('#net-cost').textContent).toContain('unwired');
    expect($('#net-static').textContent).toContain('Network design');
  });

  it('selects by clicking the diagram, and wires from the canvas and the side panel', async () => {
    setUp(game.sim, { seed: '1', laydown: [['rf', 900, 0], ['jammer', 500, 300]] });
    openDock('network');
    const cv = sized($('#net-canvas'));
    const click = (x, y) => fireEvent.click(cv, { clientX: x, clientY: y });
    // Starlink box, with nothing selected: only a hint
    const toasts = [];
    game.onToast((t) => toasts.push(t));
    await drawNow();
    click(120, 35);
    expect(toasts[0]).toMatch(/Select a system first/);
    fireEvent.mouseMove(cv, { clientX: 120, clientY: 35 });
    expect(cv.style.cursor).toBe('pointer');
    fireEvent.mouseMove(cv, { clientX: 590, clientY: 390 });
    expect(cv.style.cursor).toBe('default');
    click(300, 130); // fusion box
    expect($('#net-static').textContent).toContain('Fusion node');
    expect($('#net-live').textContent).toContain('Fusion links');
    fireEvent.click($('[data-fus="starlink"]'));
    expect(game.sim.net.fusion.uplinks.has('starlink')).toBe(false);
    click(120, 35); // wires the fusion node back to Starlink
    expect(game.sim.net.fusion.uplinks.has('starlink')).toBe(true);
    fireEvent.change($('[data-fusband]'), { target: { value: 'n78' } });
    expect(game.sim.net.fusion.cellBand).toBe('n78');
    click(50, 225); // the first sensor
    const rf = game.sim.structures.find((s) => s.def.id === 'rf');
    expect($('#net-static').textContent).toContain(rf.name);
    fireEvent.click($('input[name="uplink"][value=""]'));
    expect(rf.uplink).toBeNull();
    expect($('#net-live').textContent).toContain('No terminal wired');
    fireEvent.click($('input[name="uplink"][value="starlink"]'));
    expect(rf.uplink).toBe('starlink');
    fireEvent.change($('[data-band]'), { target: { value: 'B3' } });
    expect(rf.cellBand).toBe('B3');
    click(120, 35); // clicking its network again unplugs it
    expect(rf.uplink).toBeNull();
    click(590, 390); // empty space clears the selection
    expect($('#net-static').textContent).toContain('Network design');
    click(320, 225); // the jammer
    fireEvent.click($('[data-jam="gnss"]'));
    expect(game.sim.structures.find((s) => s.jamBands).jamBands.has('gnss')).toBe(true);
  });

  it('steps to the next packet, on the selected wire if there is one', () => {
    setUp(game.sim, { seed: '1', laydown: [['rf', 900, 0]] });
    openDock('network');
    const packets = game.sim.net.comms.packets, before = packets.length;
    fireEvent.click($('#net-step'));
    expect(game.clock.speed).toBe(0);
    expect(packets.length).toBeGreaterThan(before);
    fireEvent.change($('#net-pace'), { target: { value: '2' } });
    expect($('#net-pace').value).toBe('2');
  });

  it('taps a wire: link stats, packets, freeze and detail', async () => {
    running([['rf', 900, 0], ['rf', -900, 0], ['radar', 600, 0]], 400);
    openDock('network');
    const cv = sized($('#net-canvas'));
    await drawNow();
    fireEvent.click(cv, { clientX: 50, clientY: 225 });
    expect($('.lstats').textContent).toMatch(/Status|Sent/);
    const pk = () => document.querySelectorAll('#net-live .pk');
    expect(pk().length).toBeGreaterThan(0);
    fireEvent.click(pk()[0]);
    expect($('.pk.sel')).not.toBeNull();
    expect($('.pk-json').textContent).not.toContain('Click a packet');
    fireEvent.click($('#net-freeze'));
    expect($('#net-freeze').textContent).toBe('Resume');
    const first = pk()[0].textContent;
    game.sim.run(100);
    refresh();
    expect(pk()[0].textContent).toBe(first);
  }, 30000);

  it('shows pulses and helpers correctly', () => {
    expect(pointAlong([{ x: 0, y: 0 }], 0.5)).toBeNull();
    expect(pointAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0.5)).toEqual({ x: 5, y: 0 });
    expect(pointAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2)).toEqual({ x: 10, y: 0 });
    expect(linkColour(null)).toBe('#5c6b86');
    expect(linkColour({ up: false })).toBe('#ef5350');
    expect(linkColour({ up: true, quality: 0.3 })).toBe('#ffb300');
    expect(linkColour({ up: true, quality: 0.9 })).toBe('#66bb6a');

    running([['rf', 900, 0], ['radar', 600, 0], ['jammer', 500, 300]], 200);
    const rf = game.sim.structures.find((s) => s.def.id === 'rf');
    game.sim.commands.wireFusion('starlink', true);
    const cv = newCanvas();
    const d = createNetworkCanvas(cv, game.sim.net, { getSel: () => ({ kind: 'wire', id: rf.nodeId }), isVisible: () => true, getPace: () => 1 });
    d.draw();
    game.sim.run(200); // packets become pulses
    d.draw();
    d.setHover('starlink');
    d.draw();
    expect(d.hitTest({ x: 590, y: 395 })).toEqual({});
    rf.offline = true;
    d.draw();
    const pts = nodeList(game.sim.net);
    expect(pts.length).toBe(3);
    d.dispose();
  }, 30000);
});

// wait for the diagram's animation loop to draw
