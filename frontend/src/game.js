// Wires the simulation to the 3D view and runs the frame loop. React reads from here through useTick and never owns game state.

import * as THREE from 'three';
import { DRONES, WORLD } from './sim/config/index.js';
import { cleanSettings, fieldsFor, setSetting, unitDef } from './sim/unit-config.js';
import { predictRange, usesPath } from './sim/site-range.js';
import { terrainState } from './sim/terrain.js';
import { createSimulation, SIM_STEP } from './sim/simulation.js';
import { onVehicle } from './sim/laydown.js';
import { createGameView } from './render/game-view.js';
import { hereU } from './sim/units.js';
import { PLACING_PICK_PX, createPlacement, pickDrone, pickStructure, selectionFrom, slideToShow } from './render/placement.js';
import { createReplay } from './render/replay-view.js';
import { view } from './render/view.js';
import { createApi } from './api/client.js';
import { createRunSaver } from './api/run-saver.js';
import { addZonePoint } from './zone.js';
import { patrolClicker } from './patrol-draw.js';
import { createTools } from './tools.js';
import { createPackStore } from './api/pack-store.js';
import { parseWorldId } from './sim/world-pack.js';

const PANEL_INTERVAL = 100; // ms between panel refreshes: panels never update per frame

// Seeds are saved, so they obey the limits the backend enforces.
// eslint-disable-next-line no-control-regex
export const cleanSeed = (text) => (text || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 64) || '1';

const ZONE_LOCKED = 'The area to defend is locked once the first wave starts';
const PATROL_FIRST = 'Clear the patrol first: with a patrol, the patrol is what the enemy attacks';

export function createGame({ seed, terrainSeed, api = createApi(), storage = globalThis.localStorage }) {
  const sim = createSimulation({ seed, terrainSeed });
  const { state, net } = sim;

  // ---------- what panels subscribe to ----------
  const subscribers = new Set();
  let tick = 0;
  const bump = () => { tick++; for (const fn of subscribers) fn(); };
  const subscribe = (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); };
  const getTick = () => tick;

  // Every command the UI sends refreshes the panels straight away, so controls never lag behind a click.
  const commands = Object.fromEntries(Object.entries(sim.commands).map(([name, fn]) => [name, (...args) => { const r = fn(...args); bump(); return r; }]));

  // ---------- game speed ----------
  const clock = { speed: 1, lastSpeed: 1 };
  const setSpeed = (s) => { if (s > 0) clock.lastSpeed = s; clock.speed = s; bump(); };

  const toastListeners = new Set();
  const toast = (msg) => { for (const fn of toastListeners) fn(msg); };
  sim.on('toast', toast);
  sim.on('gameOver', bump);
  sim.on('moved', (s) => { view.selected = s; }); // a moved system is rebuilt, so the Unit panel follows it

  // ---------- saving finished runs ----------
  const saver = createRunSaver({ api, storage, notify: toast, onChange: bump });
  let closing = false; // no request while closing: if it arrived, the kept copy would be saved a second time
  sim.on('runEnded', (run) => { if (closing) saver.keep(run); else saver.save(run); });
  // shortcut: a page restored from the back/forward cache keeps playing, but that run was already recorded when it closed. Clear runEnded on pageshow if that ever matters.
  const pageClosing = () => { closing = true; sim.endRun(); closing = false; };
  sim.on('sandbox', bump);

  // ---------- real map packs ----------
  const packs = createPackStore({ api, pinned: () => parseWorldId(state.terrainSeed)?.hash });
  const usePack = ({ pack }) => sim.registerPack({ hash: pack.hash, header: pack.header, grids: pack.grids, features: pack.features });
  let latestPackLoad = 0;
  async function loadPack(entry, required = false) {
    const ticket = ++latestPackLoad;
    const decoded = await packs.load(entry);
    if (required || ticket === latestPackLoad) usePack(decoded);
    return decoded;
  }
  // Make sure a saved world's pack is loaded. Returns why not, or null.
  async function ensureWorld(world) {
    const id = parseWorldId(world);
    if (!id) return null;
    if (packs.get(id.hash)) { await loadPack({ hash: id.hash }, true); return null; }
    const { packs: all } = await packs.list();
    const entry = all.find((p) => p.hash.startsWith(id.hash));
    if (!entry) return 'The map pack for this laydown is not available here. Import or build it first.';
    await loadPack(entry, true);
    return null;
  }
  const mapSource = (world) => {
    const id = parseWorldId(world), found = id && packs.get(id.hash);
    return found ? { pictures: found.pictures, features: found.pack.features, credits: found.pack.header.credits } : null;
  };

  // ---------- filled in once the canvas exists ----------
  let gameView = null, placement = null, replay = null;
  const frameListeners = new Set();
  let refusal = null; // why the last placement was refused
  let selectHinted = false; // the first placement says that systems can be clicked

  const tools = createTools(() => { if (placement) placement.refresh(); bump(); });
  const setTool = tools.set;
  // A card let go over the map: a system is placed like a click with it picked, and a group of people where it fell.
  function dropAt(item, x, z) {
    if (item.system) {
      tools.use(item.system, item.vehicle);
      groundClick(x, z);
    } else if (state.started && !state.over) {
      refusal = commands.placePeople(x, z, item.people.count, item.people.protection);
      toast(refusal || `Placed ${item.people.count} people`);
    }
    tools.endDrag();
  }

  // The settings the next system of each type is placed with, chosen in the toolbar's list.
  const loadouts = {};
  const loadoutFor = (id) => (loadouts[id] ??= {});
  function setLoadout(id, field, value) {
    if (fieldsFor(id).includes(field)) setSetting(loadoutFor(id), field, id, value);
    if (placement) placement.refresh(); // the preview judges the new price
    bump();
  }
  // A deployed pack's lines: each system is placed with the settings its line holds, or the catalogue's. With no pack (null), the
  // systems the last one set go back to the catalogue's settings, and its price.
  let fromPack = [];
  function usePackLoadouts(lines) {
    for (const id of fromPack) delete loadouts[id];
    fromPack = (lines ?? []).map((l) => l.id);
    for (const l of lines ?? []) loadouts[l.id] = cleanSettings(l.id, l.settings);
    if (placement) placement.refresh();
    bump();
  }
  // With a pack's kit, a hotkey opens its kind's list of what the pack holds rather than picking a system to place.
  const cycleTool = (group) => (sim.state.kit ? tools.openCatalogue(group.kind, true) : tools.cycle(group));

  // What the system just placed really gets from where it stands, against the open field it is advertised for.
  function placedSummary() {
    const s = sim.structures[sim.structures.length - 1], km = (metres) => `${(metres / 1000).toFixed(1)} km`;
    if (!usesPath(s.def)) return `Placed. ${km(s.def.range)} range, wherever it stands`;
    const m = WORLD.metresPerUnit, p = predictRange(s.def, DRONES.fpv, terrainState.data, s.pos.x * m, s.pos.z * m);
    return `Placed. ${km(p.mean)} predicted here on average, against ${km(p.open)} in an open field`;
  }

  // A closed outline is what the enemy attacks. One still being drawn is only a picture.
  function syncZone() {
    const points = view.zone?.closed ? view.zone.points : null;
    if (JSON.stringify(points) !== JSON.stringify(sim.state.zone)) commands.setZone(points);
  }

  let patrolClick = null; // made on first use, once everything it calls exists

  // The picked system, with the settings and vehicle chosen for it, however the spot was given. Returns why it was refused, or null.
  function placeSystem(x, z) {
    const tool = tools.get(), loadout = Object.keys(loadoutFor(tool)).length ? { ...loadoutFor(tool) } : undefined, vehicle = tools.vehicle();
    refusal = vehicle ? commands.place(tool, x, z, loadout, vehicle) : loadout ? commands.place(tool, x, z, loadout) : commands.place(tool, x, z);
    return refusal;
  }

  function groundClick(x, z) {
    const tool = tools.get();
    if (!tool || state.over || !state.started) return;
    if (tool === 'sell' || tool === 'move') { if (tool === 'sell') commands.sell(x, z); else putDown(x, z); return; }
    if (tool === 'people') {
      refusal = commands.placePeople(x, z, view.people.count, view.people.protection, view.people.role);
      if (refusal) toast(refusal);
      return;
    }
    if (tool === 'patrol') { (patrolClick ??= patrolClicker({ sim, commands, view, toast, setTool, bump }))(x, z); return; }
    if (tool === 'zone') {
      if (sim.designLocked()) toast(ZONE_LOCKED);
      else if (sim.getPatrol()) toast(PATROL_FIRST);
      else {
        view.zone = addZonePoint(view.zone, x, z);
        syncZone();
        if (view.zone && view.zone.closed) setTool('zone'); else bump();
      }
      return;
    }
    if (placeSystem(x, z)) { toast(refusal); return; }
    const esc = tools.dragging() ? '' : ', or press Esc to stop placing'; // a drag puts the last tool back itself
    toast(`${placedSummary()}${selectHinted ? '' : `. Click a system for details${esc}`}`);
    selectHinted = true;
  }

  // The system the Unit panel shows. It is view state, not a command, so it is not logged and cannot change a run.
  function select(s) { view.selected = s; bump(); }
  function startMove(s) { view.moving = s; tools.use('move'); toast(`Click the map where the ${s.def.name} should go, or press Esc`); } // the next map click puts it down; Esc leaves it
  function putDown(x, z) { const s = view.moving; tools.use(null); view.moving = null; refusal = s ? commands.move(s, x, z) : null; toast(refusal || 'Moved, with its settings, wiring and name'); }
  function lookFrom(s) { view.eye = s ?? null; bump(); } // the ground view from this system's mast, or back to the map
  function selectDrone(d) { view.drone = d; if (!d) view.follow = false; bump(); } // view state too
  function getSelected() { // sold or destroyed systems drop out of the list
    if (view.selected && !sim.structures.includes(view.selected)) view.selected = null;
    return view.selected;
  }
  // Returns true if the click was about a system on the screen, so the ground under it should not be used as well.
  function mapClick(x, y) {
    if (!state.started) return false;
    const tagged = gameView.structures.labelAt(x, y), tool = tools.get();
    const pick = () => pickStructure(sim.structures, gameView.camera, x, y);
    if (tool === 'sell') { // the command takes a point on the ground, and the system's own position can only mean that system
      const s = !state.over && (tagged || pick());
      if (s && !s.escort) commands.sell(s.pos.x, s.pos.z); // an escort goes with its patrol, and its spot would sell the system nearest it
      return !!s;
    }
    const drone = !tool && view.truth && view.replayT == null && pickDrone(sim.drones, gameView.camera, x, y); // drones are drawn only with the truth overlay
    if (drone) { selectDrone(drone); return true; }
    const chosen = selectionFrom(tool, tagged, tool ? () => pickStructure(sim.structures, gameView.camera, x, y, innerWidth, innerHeight, PLACING_PICK_PX) : pick);
    if (chosen === undefined) return false;
    selectHinted = true;
    select(chosen);
    if (!chosen) selectDrone(null); // a click on empty ground closes both panels
    return true;
  }
  // If this ground point is hidden behind a panel or off the screen, slide the camera so it appears at (px, py) instead.
  function reveal(x, z, px, py) {
    if (!gameView) return;
    const { camera, controls } = gameView, y = hereU(x, z);
    const at = new THREE.Vector3(x, y, z).project(camera);
    const showing = document.elementFromPoint(((at.x + 1) / 2) * innerWidth, ((1 - at.y) / 2) * innerHeight);
    if (showing && showing.id === 'game') return;
    const slide = slideToShow(camera, x, y, z, px, py);
    if (!slide) return;
    camera.position.x += slide.x; camera.position.z += slide.z;
    controls.target.x += slide.x; controls.target.z += slide.z;
  }

  // Starting wave 1 rebuilds every system, with a new id and perhaps a new callsign. Only its position is sure to be the same.
  const rebuilt = (was) => was && sim.structures.find((s) => s.def.id === was.def.id && s.pos.x === was.pos.x && s.pos.z === was.pos.z) || null;

  // when the fusion node asks the operator to authorise an engagement, stop the clock so there is time to decide
  let pausedForApproval = false, simAcc = 0;
  sim.on('approvalRequest', () => { if (clock.speed > 0) { pausedForApproval = true; setSpeed(0); } });
  sim.on('approvalDecided', () => {
    if (pausedForApproval && !net.pendingRequests.length && !reviewing) { pausedForApproval = false; setSpeed(clock.lastSpeed || 1); }
  });

  // Reviewing stops the clock, and going back to live puts it back as it was. It never runs past a decision still waiting,
  // and a decision made during the review lets it run again.
  let reviewing = false, speedBeforeReview = 1;
  const reviewClock = {
    setPaused() { reviewing = true; speedBeforeReview = clock.speed; setSpeed(0); },
    resume() {
      reviewing = false;
      if (clock.speed > 0 || net.pendingRequests.length) return; // the player chose a speed during the review, or a decision is waiting
      setSpeed(pausedForApproval ? clock.lastSpeed || 1 : speedBeforeReview);
      pausedForApproval = false;
    },
  };
  // One handler, in this order: the selection and ground view move to the rebuilt systems before the views are cleared, and the replay
  // is left (which can set the speed) before the speed is set for the new run.
  sim.on('reset', ({ kept, begin, loading }) => {
    view.selected = rebuilt(view.selected); view.eye = rebuilt(view.eye); // the ground view stays on its system too
    view.drone = null; view.follow = false;
    if (replay) replay.reset();
    if (gameView) gameView.clear();
    simAcc = 0; pausedForApproval = false;
    if (!begin) setSpeed(1);
    if (!kept && !loading) view.zone = view.route = null;
    if (!begin && !loading) toast(kept ? 'Run reset: same laydown and seed' : 'Map cleared: the site is empty and the budget is full again');
    bump();
  });

  const debug = { frozen: false }; // scripted browser runs drive the simulation themselves
  const frameClock = new THREE.Timer(); // three.js 0.186 deprecates Clock
  // Panels refresh on the timer only while what they show can change: the run moving, a replay, or the player's hand on the mouse or
  // keys (the cursor read-outs, a dragged panel). Paused, idle or on the start screen, nothing re-renders.
  let lastBump = 0, stirred = true, covered = false, faulted = false;
  const stir = () => { stirred = true; };
  // A fault in a step or a view pauses the game and says so once: it used to freeze the picture and retry the same step every frame.
  const fault = (e) => { simAcc = 0; if (clock.speed > 0) setSpeed(0); if (!faulted) { faulted = true; console.error(e); toast('The game hit an error and has been paused. Reset run starts again.'); } };
  function frame() { try { runFrame(); faulted = false; } catch (e) { fault(e); } }
  function runFrame() {
    const real = Math.min(frameClock.update().getDelta(), 0.05);
    let n = 0;
    if (!debug.frozen && state.started && !state.over && clock.speed > 0) {
      // fixed-size steps: the same seed and laydown give the same run at any frame rate or speed
      simAcc += real * WORLD.timeScale * clock.speed;
      while (simAcc >= SIM_STEP && n < 400 && !state.over) { sim.step(); simAcc -= SIM_STEP; n++; }
      if (n >= 400) simAcc = 0;
    }
    gameView.labels.beginFrame();
    gameView.update(real);
    for (const fn of frameListeners) fn(real);
    replay.update(real, gameView.camera);
    placement.update();
    if (!covered) gameView.draw(); // the profile screen hides the whole scene
    const now = performance.now();
    if (now - lastBump >= PANEL_INTERVAL && (n || stirred || replay.active())) { lastBump = now; stirred = false; bump(); }
  }

  // Called once, when the canvas and label layer are in the page.
  function attach(canvas, labelLayer) {
    for (const type of ['pointermove', 'pointerdown', 'wheel', 'keydown']) addEventListener(type, stir, { capture: true, passive: true });
    gameView = createGameView(canvas, labelLayer, sim, mapSource, toast);
    placement = createPlacement({
      scene: gameView.scene, camera: gameView.camera, canvas, sim,
      getTool: tools.get, defFor: (id) => unitDef(id, cleanSettings(id, onVehicle(id, loadoutFor(id), tools.vehicle()))), onGroundClick: groundClick, onSelect: mapClick, onDrop: dropAt,
      onDoubleClick: gameView.zoomInOn,
    });
    replay = createReplay({
      scene: gameView.scene, rec: sim.rec, labels: gameView.labels,
      getStructures: () => sim.structures, labelOf: gameView.structures.labelOf, hideLive: gameView.hideLive,
      getLastSpeed: () => clock.lastSpeed, ...reviewClock,
    });
    gameView.start(frame);
    bump();
  }

  return {
    packs, loadPack, ensureWorld, mapSource, cursor: () => placement?.cursor() ?? null,
    sim, commands, clock, setSpeed, reviewClock, subscribe, getTick, bump, attach, debug, api, saver, storage, pageClosing,
    getTool: tools.get, toolVehicle: tools.vehicle, setTool, startMove, toolChoice: tools.choice, cycleTool, loadoutFor, setLoadout, usePackLoadouts, placeSystem, lastRefusal: () => refusal, select, getSelected, selectDrone, lookFrom, reveal,
    catalogue: tools.catalogue, openCatalogue: tools.openCatalogue, pickFromTray: tools.pickFromTray, startDrag: tools.startDrag, endDrag: tools.endDrag, dropAt,
    toast, onToast(fn) { toastListeners.add(fn); return () => toastListeners.delete(fn); },
    onFrame(fn) { frameListeners.add(fn); return () => frameListeners.delete(fn); },
    setCovered(on) { covered = on; },
    getReplay: () => replay,
    getView: () => gameView,
    // settings shared with the 3D view
    setViewOption(key, value) {
      if (key === 'zone' && sim.designLocked()) { toast(ZONE_LOCKED); return; }
      if (key === 'zone' && value && sim.getPatrol()) { toast(PATROL_FIRST); return; }
      view[key] = value;
      if (key === 'truth' && !value) { view.drone = null; view.follow = false; }
      if (key === 'zone') syncZone();
      if (key === 'rings' && gameView) gameView.structures.setRingsVisible(value);
      if (key === 'planView' && gameView) gameView.viewFromAbove(value);
      if (['baseMap', 'mapRoads', 'mapGrid', 'mapContours'].includes(key) && gameView) {
        view.mapLoading = true;
        const world = sim.state.terrainSeed;
        gameView.refreshMap().then((live) => {
          if (live?.stale) { if (sim.state.terrainSeed !== world) { view.mapLoading = false; bump(); } return; } // a newer paint has it, unless the world changed
          view.mapLoading = false;
          bump();
          if (live?.total && live.failed === live.total) { view.baseMap = 'os'; toast('The live map could not load: it needs an internet connection'); gameView.refreshMap().catch(() => {}); bump(); }
          else if (live?.failed) toast(`${live.failed} of ${live.total} map tiles could not load`);
        }).catch(() => { view.mapLoading = false; toast('The map could not be drawn'); bump(); });
      }
      bump();
    },
    // Back to the start screen, to choose another world. A point makes it open on that place.
    leaveWorld(point = null) {
      tools.openCatalogue(null, false);
      Object.assign(view, { startAt: point, zone: null, route: null, me: null, selected: null, drone: null, follow: false, mapPanel: false, planView: false });
      if (gameView) gameView.viewFromAbove(false);
      commands.leave();
    },
    // a figure was edited in the Sources tab: redraw anything built from it
    figuresChanged() {
      if (gameView) gameView.structures.remakeRings();
      if (placement) placement.refresh();
      bump();
    },
  };
}
