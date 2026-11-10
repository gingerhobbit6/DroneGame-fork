// What the world looks like, and finding your way around it. A rail of buttons by the minimap is always in reach, and the map
// switcher opens beside it. None of this reaches the simulation, except placing a system, which is the normal command.
// An option that can't be used stays visible and says why.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { terrainState } from '../sim/terrain.js';
import { STRUCTURES, WORLD } from '../sim/config/index.js';
import { gridRef, isEstonian, mgrsAt, onGrid, parsePosition } from '../sim/grids.js';
import { parseWorldId } from '../sim/world-pack.js';
import { contourStep, heightRange } from '../render/topo.js';
import { view } from '../render/view.js';
import { useArmed, useGame, useTick } from './hooks.js';
import { accuracyText, locateMe } from './locate.js';
import { ZonePanel } from './ZonePanel.jsx';
import { Compass } from './Compass.jsx';
import './map-panel.css';
import { Movable } from './Movable.jsx';

const REAL_MAPS = [
  ['os', 'OS map', 'Roads, woods and towns'],
  ['light', 'Light', 'The OS map in pale greys'],
  ['dark', 'Dark', 'The OS map at night'],
  ['satellite', 'Satellite', 'Pictures from space'],
  ['hybrid', 'Hybrid', 'Satellite with roads and names'],
  ['topo', 'Topographic', 'Heights, contours and hill shading'],
  ['relief', 'Shaded relief', 'The bare shape of the ground'],
  ['live', 'Live map', 'OpenStreetMap, over the internet'],
];
const ESTONIAN_MAPS = REAL_MAPS.map(([id, name, text]) => [id, name.replace('OS map', 'Basic map'), text.replace('OS map', 'basic map')]);
const GENERATED_MAPS = [['generated', 'Generated', 'The invented ground']];
const OVERLAYS = [
  ['mapRoads', 'Roads and names', 'Also what makes satellite a hybrid view'],
  ['mapContours', 'Contours (C)', 'Height lines from this world\'s own ground'],
  ['scenery', 'Trees and buildings', 'The 3D trees and buildings. Hide them to place against the map picture: they still block sight lines'],
];
// The grids a real map can show. MGRS covers the world, so every map has it as well as its own national grid.
const gridChoices = (estonian) => [
  ['national', `${estonian ? 'L-EST97' : 'OS'} grid`, `Labelled 1 km squares of the ${estonian ? 'Estonian' : 'British'} national grid`],
  ['mgrs', 'MGRS grid', 'Labelled 1 km squares of the Military Grid Reference System, which covers the world'],
];
// The G key steps through them, then turns the grid off.
export const nextGrid = (grid) => (grid === 'national' ? 'mgrs' : grid === 'mgrs' ? false : 'national');
const CLOSE_ZOOM = 200; // how far the camera sits, at most, after centring on the player: about 4 km of ground in view

const usable = (id, source) => {
  if ((id === 'satellite' || id === 'hybrid') && !source?.pictures.some((p) => p.layer === 'satellite')) return 'Not in this map pack';
  if (id === 'live' && globalThis.navigator?.onLine === false) return 'Needs internet';
  return null;
};
export const mapName = (id, world) => (isEstonian(parseWorldId(world)?.n0) ? ESTONIAN_MAPS : REAL_MAPS).find(([map]) => map === id)?.[1] || id;
// The next map the M key can show, skipping any that can't be used.
export function nextBaseMap(current, source) {
  const ids = REAL_MAPS.map(([id]) => id).filter((id) => !usable(id, source));
  return ids[(ids.indexOf(current) + 1) % ids.length];
}

function Credits({ geo, source, here }) {
  const credits = source?.credits || {};
  const parts = [
    view.baseMap === 'live' ? 'Map © OpenStreetMap contributors' : null,
    view.baseMap === 'satellite' || view.baseMap === 'hybrid' ? credits.satellite : null,
    view.baseMap !== 'satellite' ? credits.osmap : null,
    geo.tier === 'lidar' ? credits.lidar : null,
    credits.heights, // heights from another source, which its licence asks to credit whatever is shown
    credits.names, // names from another source past a border, likewise
  ];
  // The data licences ask for these credits with the map, so they fold behind a © rather than going: the grid reference stays in view.
  return createPortal( // always on screen, outside any panel
    <div id="map-credit" className="muted map-note">
      {here && <b id="map-here">{here}</b>}
      <details id="map-sources"><summary title="Data sources and licences" aria-label="Data sources and licences">©</summary>{parts.filter(Boolean).join('. ')}. Masts are notional.</details>
    </div>,
    document.body,
  );
}

function TopoLegend({ data }) {
  const range = useMemo(() => heightRange(data), [data]);
  const step = contourStep(range);
  return (
    <div id="topo-legend" className="map-note">
      <div className="topo-legend" />
      <div className="topo-range"><span>{Math.round(range.low)} m</span><span>{Math.round(range.high)} m</span></div>
      <div className="muted">Contours every {step} m, with a thick line every {step * 5} m. Heights are above sea level.</div>
    </div>
  );
}

const Icon = ({ path }) => <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
const ICONS = {
  me: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10z',
  site: 'M4 20V10l8-6l8 6v10M9 20v-6h6v6',
  zone: 'M5 8l7-4l7 5l-2 10l-10 1z',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M9 12h6M12 9v6',
};

function Thumb({ id, pictures }) {
  return pictures[id] ? <img className="map-thumb" src={pictures[id]} alt="" /> : <span className={`map-thumb thumb-${id}`} />;
}

export function MapControls() {
  useTick();
  const game = useGame();
  const data = terrainState.data, geo = data?.geo;
  const seed = game.sim.state.terrainSeed;
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [offer, setOffer] = useState(null); // a real place outside this world, which could have a map of its own
  const [locating, setLocating] = useState(false);
  const [pictures, setPictures] = useState({});
  const [zoneOpen, setZoneOpen] = useState(false);
  const change = useArmed();

  const maps = !geo ? GENERATED_MAPS : isEstonian(geo.n0) ? ESTONIAN_MAPS : REAL_MAPS;
  const source = game.mapSource?.(seed);
  const gameView = game.getView();
  useEffect(() => {
    let live = true;
    setPictures({});
    gameView?.mapPreviews?.(maps.map(([id]) => id)).then((found) => { if (live) setPictures(found); }).catch(() => {}); // no pictures: the switcher still works by name
    return () => { live = false; };
  }, [gameView, seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = WORLD.metresPerUnit;
  const current = geo ? view.baseMap : 'generated';
  const toScene = (e, n) => ({ x: (e - geo.e0) / m, z: (geo.n0 - n) / m });
  const inWorld = ({ x, z }) => Math.abs(x) * m <= data.R && Math.abs(z) * m <= data.R;
  const cursor = geo ? game.cursor() : null;
  const refAt = view.mapGrid === 'mgrs' ? mgrsAt : gridRef; // the cursor reads out on the grid that is showing
  const here = cursor && inWorld(cursor) ? `${refAt(geo.e0 + cursor.x * m, geo.n0 - cursor.z * m)}, ${Math.round(geo.H0 + data.groundAt(cursor.x * m, cursor.z * m))} m` : '';
  const say = (text, elsewhere = null) => { setNote(text); setOffer(elsewhere); };

  const centreOnMe = async () => {
    setLocating(true);
    say('Finding your location...');
    if (geo && view.baseMap === 'live') game.setViewOption('baseMap', 'os'); // remove live tiles before centring on a private position
    try {
      const mark = (reading, at) => { // the camera only moves once: a better reading moves the pin, and leaves the player's view alone
        view.me = { ...at, accuracy: reading.accuracy / m };
        say(`You are at ${gridRef(reading.e, reading.n)}, ${accuracyText(reading.accuracy)}.`);
      };
      const fix = await locateMe(undefined, (better) => { const at = geo && toScene(better.e, better.n); if (at && inWorld(at)) mark(better, at); });
      const where = gridRef(fix.e, fix.n), quality = accuracyText(fix.accuracy);
      const at = geo && toScene(fix.e, fix.n);
      if (at && inWorld(at)) {
        mark(fix, at);
        gameView?.centreOn(at.x, at.z, CLOSE_ZOOM);
      } else {
        view.me = null;
        const text = geo ? `outside this world` : 'and this is generated ground';
        if (onGrid(fix.e, fix.n)) say(`You are at ${where}, ${text}.`, { e: fix.e, n: fix.n, note: `Your location, ${quality}.`, privateLocation: true });
        else say('You appear to be outside Great Britain and Estonia, which these maps cover.');
      }
    } catch (problem) { say(problem.message); }
    setLocating(false);
  };
  const placeHere = (e) => {
    e.preventDefault();
    const point = parsePosition(typed);
    if (!point) { say(`That is not a grid reference, such as ${geo ? gridRef(geo.e0, geo.n0) : 'SU 220 660'}.`); return; }
    const at = toScene(point.e, point.n), tool = game.getTool();
    if (!inWorld(at)) { say('That grid reference is outside this world.', point); return; }
    if (STRUCTURES[tool]) {
      const problem = game.placeSystem(at.x, at.z); // with its chosen settings and vehicle, as a click would
      say(problem || `Placed at ${gridRef(point.e, point.n)}.`);
    } else {
      gameView?.centreOn(at.x, at.z);
      say(`Moved to ${gridRef(point.e, point.n)}. Pick a system first to place one there.`);
    }
  };
  const stopDrawing = () => { if (game.getTool() === 'zone') game.setTool('zone'); };
  const toggleZone = () => {
    if (zoneOpen) stopDrawing();
    else {
      game.setViewOption('mapPanel', false);
      if (!view.zone?.closed && !game.sim.designLocked() && game.getTool() !== 'zone') game.setTool('zone');
    }
    setZoneOpen(!zoneOpen);
  };
  const choose = (id) => { if (geo) game.setViewOption('baseMap', id); };
  const forced = (key) => (key === 'mapRoads' && view.baseMap === 'hybrid') || (key === 'mapContours' && view.baseMap === 'topo');
  const showContours = geo && (view.mapContours || view.baseMap === 'topo');

  const message = note && (
    <div id="map-message" className="map-note">
      {note}
      {offer && <button id="map-open-here" className="primary" onClick={() => game.leaveWorld(offer)}>Open a map here</button>}
    </div>
  );

  return (
    <>
      <div id="map-rail">
        <button id="map-switch" className={`${view.mapPanel ? 'on ' : ''}${view.mapLoading ? 'loading' : ''}`} aria-expanded={view.mapPanel} title="Change the map" onClick={() => game.setViewOption('mapPanel', !view.mapPanel)}>
          <Thumb id={current} pictures={pictures} />
        </button>
        <button id="map-me" className={`${locating ? 'loading ' : ''}${view.me ? 'on' : ''}`} aria-label="Centre on my location" title="Centre on my location. Live map tiles switch off first; choosing Live map again shares the viewed area with OpenStreetMap." disabled={locating} onClick={centreOnMe}><Icon path={ICONS.me} /></button>
        <button id="map-site" aria-label="Centre on the site" title="Centre on the site" onClick={() => gameView?.centreOn(0, 0)}><Icon path={ICONS.site} /></button>
        <button id="map-fit" aria-label="Show the whole laydown (H)" title="Show the whole laydown (H)" onClick={() => gameView?.fitLaydown?.()}><Icon path={ICONS.fit} /></button>
        <Compass />
        <button id="map-zone" className={zoneOpen ? 'on' : ''} aria-expanded={zoneOpen} aria-label="Draw the area to defend" title="Draw the area to defend" onClick={toggleZone}><Icon path={ICONS.zone} /></button>
        <button id="map-plan" className={view.planView ? 'on' : ''} aria-pressed={view.planView} title="Look straight down (P)" onClick={() => game.setViewOption('planView', !view.planView)}>{view.planView ? '3D' : '2D'}</button>
      </div>

      {view.mapPanel && (
        <Movable id="map-panel" title="Map" role="dialog" aria-label="Map">
          <div className="map-panel-head"><b>Map</b>{geo && <span className="muted">M changes it</span>}<button id="map-close" aria-label="Close the map panel" onClick={() => game.setViewOption('mapPanel', false)}>×</button></div>
          <div id="map-types" role="radiogroup" aria-label="Map type">
            {maps.map(([id, label, about]) => {
              const why = geo && usable(id, source);
              const chosen = current === id;
              return (
                <button key={id} id={`map-type-${id}`} role="radio" aria-checked={chosen} disabled={!!why} className={`map-card${chosen ? ' on' : ''}${chosen && view.mapLoading ? ' loading' : ''}`} title={why || about} onClick={() => choose(id)}>
                  <Thumb id={id} pictures={pictures} />
                  <span className="map-card-name">{label}</span>
                  {why && <span className="map-card-why">{why}</span>}
                </button>
              );
            })}
          </div>
          {geo && (
            <div id="map-overlays">
              {OVERLAYS.map(([key, label, about]) => (
                <button key={key} id={`map-overlay-${key}`} className={`map-chip${view[key] || forced(key) ? ' on' : ''}`} aria-pressed={view[key] || forced(key)} disabled={forced(key)} title={forced(key) ? 'Part of this map' : about} onClick={() => game.setViewOption(key, !view[key])}>{label}</button>
              ))}
              {gridChoices(isEstonian(geo.n0)).map(([id, label, about]) => (
                <button key={id} id={`map-grid-${id}`} className={`map-chip${view.mapGrid === id ? ' on' : ''}`} aria-pressed={view.mapGrid === id} title={`${about}. Click it again to hide the grid; G steps through the grids`} onClick={() => game.setViewOption('mapGrid', view.mapGrid === id ? false : id)}>{label}</button>
              ))}
            </div>
          )}
          {showContours && <TopoLegend data={data} />}
          {geo && (
            <form id="map-goto" onSubmit={placeHere}>
              <input id="map-ref" type="text" spellCheck="false" maxLength={20} placeholder={`Grid ref, e.g. ${gridRef(geo.e0, geo.n0)}`} title="Move there, or place the selected system there" value={typed} onChange={(e) => setTyped(e.target.value)} />
              <button type="submit">Go</button>
            </form>
          )}
          {message}
          {view.baseMap === 'live' && geo && <div className="muted map-note">Live tiles tell OpenStreetMap which area you are viewing.</div>}
          {geo && geo.lidarHalf < WORLD.radius && <div className="muted map-note">No lidar on part of this map, so tree and building heights there are assumed.</div>}
          <button id="map-change-world" title="Go back to the start screen to pick generated ground or another real map. This clears your laydown." onClick={change.confirm('world', () => game.leaveWorld())}>{change.armed ? 'Sure? This clears your laydown' : 'Change world'}</button>
        </Movable>
      )}
      {zoneOpen && !view.mapPanel && <ZonePanel onClose={toggleZone} />}
      {!view.mapPanel && !zoneOpen && message && <Movable id="map-bubble" title="Map note"><button id="map-bubble-close" aria-label="Dismiss" onClick={() => say('')}>×</button>{message}</Movable>}
      {geo && <Credits geo={geo} source={source} here={here} />}
    </>
  );
}
