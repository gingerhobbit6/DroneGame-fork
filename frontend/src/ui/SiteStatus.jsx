// What the chosen spot already has on this computer, and what building a map of it would still download. It is worked out here from
// the list of downloads, so the position itself never leaves the browser until the player presses Build.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { WORLD, WORLD_KM } from '../sim/config/index.js';
import { squaresAround } from '../sim/bng.js';
import { gridRef, isEstonian } from '../sim/grids.js';
import { BUILT_HALF } from '../sim/world-pack.js';
import { useGame } from './hooks.js';

// Sizes as measured: docs/REAL_MAPPING_PLAN.md, and the largest square downloaded so far (TQ). English lidar covers the world in 1 m squares, about
// 7.1 GB for 54 km (scaled by area from 2.2 GB for 30 km), and is not kept.
const TERRAIN_GB = 0.16, SQUARE_GB = 0.55, LIDAR_GB = 2.2 * (WORLD_KM / 30) ** 2;
// Estonia's national files, as measured. They are fetched once and serve every Estonian map.
const ESTONIA_HEIGHTS_GB = 2.2, ESTONIA_FEATURES_GB = 1.3, ESTONIA_SURFACE_GB = 3.8;
const roundGb = (gb) => `${gb.toFixed(gb < 1 ? 2 : 1)} GB`;

function britishRows(point, downloads, lidar) {
  const squares = squaresAround(point.e, point.n, BUILT_HALF);
  const have = squares.filter((s) => downloads.squares.includes(s)), missing = squares.filter((s) => !have.includes(s));
  const rows = [['OS Terrain 50 heights', downloads.terrain50 ? 0 : TERRAIN_GB]];
  if (have.length) rows.push([`OS maps of ${have.join(', ')}`, 0]);
  if (missing.length) rows.push([`OS maps of ${missing.join(', ')}`, missing.length * SQUARE_GB]);
  if (lidar) rows.push(['Lidar heights, not kept', LIDAR_GB]);
  return rows;
}

function estonianRows(downloads, lidar) {
  const have = downloads.estonia || {};
  const rows = [['Estonian ground heights', have.heights ? 0 : ESTONIA_HEIGHTS_GB], ['Estonian buildings, roads, water, woods and place names', have.features ? 0 : ESTONIA_FEATURES_GB]];
  if (lidar) rows.push(['Lidar tree and building heights', have.surface ? 0 : ESTONIA_SURFACE_GB]);
  return rows;
}

function needs(point, downloads, lidar) {
  const rows = isEstonian(point.n) ? estonianRows(downloads, lidar) : britishRows(point, downloads, lidar);
  return { rows, total: rows.reduce((sum, [, gb]) => sum + gb, 0) };
}

// What differs between the countries in the offer to build.
const WORDS = {
  british: {
    fetched: ['Satellite picture'],
    lidar: 'Include lidar heights across the world: about 2.5 hours, England only. Without it, about 8 minutes, with assumed tree and building heights.',
    reveals: 'Building reveals this region to the Environment Agency and AWS.',
  },
  estonian: {
    fetched: ['Basic map tiles', 'Satellite picture'],
    lidar: 'Include lidar heights, across the whole map. Without it, assumed tree and building heights.',
    reveals: 'The national files say nothing about where you are building, but the map tiles and satellite picture reveal this region to the Estonian mapping agency and AWS. Estonian data stops at the national border, so near it Copernicus 30 m heights are fetched from AWS for each whole degree square. They include woods and buildings, so none are drawn past the border.',
  },
};

function Builder({ point, downloads, onBuilt }) {
  const { api } = useGame();
  const [lidar, setLidar] = useState(true);
  const [status, setStatus] = useState(null);
  const [problem, setProblem] = useState('');
  const latestOnBuilt = useRef(onBuilt);
  useLayoutEffect(() => { latestOnBuilt.current = onBuilt; }, [onBuilt]); // parent renders must not restart the progress timer
  const plan = downloads && needs(point, downloads, lidar);
  const words = WORDS[isEstonian(point.n) ? 'estonian' : 'british'];

  // A build can finish before its first response, so starts and progress polls share the same outcome handling.
  const receiveStatus = useCallback((now) => {
    setStatus(now);
    if (!now.running) {
      if (now.ok) latestOnBuilt.current();
      else setProblem(now.message || 'The map could not be built.');
    }
  }, []);

  useEffect(() => {
    if (!status?.running) return undefined;
    let active = true, timer;
    // Wait for each answer before scheduling another poll, and ignore answers from an abandoned attempt.
    const poll = async () => {
      try {
        const now = await api.packs.buildStatus();
        if (!active) return;
        receiveStatus(now);
        if (now.running) timer = setTimeout(poll, 2000);
      } catch (e) { if (active) receiveStatus({ running: false, ok: false, message: e.message }); }
    };
    timer = setTimeout(poll, 2000);
    return () => { active = false; clearTimeout(timer); };
  }, [api, receiveStatus, status?.running]);

  const start = async () => {
    setProblem('');
    try { receiveStatus(await api.packs.build({ east: Math.round(point.e), north: Math.round(point.n), lidar })); } catch (e) { setProblem(e.message); }
  };
  return (
    <div id="pack-build" className="sys note">
      <b>No map here yet.</b> Build one around {gridRef(point.e, point.n)}.
      {plan && (
        <ul id="pack-needs">
          {plan.rows.map(([name, gb]) => <li key={name} className={gb ? 'need-get' : 'need-have'}><span>{name}</span><span>{gb ? `Download, up to about ${roundGb(gb)}` : 'On this computer'}</span></li>)}
          {words.fetched.map((name) => <li key={name} className="need-get"><span>{name}</span><span>Fetched while building</span></li>)}
        </ul>
      )}
      <label className="opt"><input type="checkbox" id="pack-lidar" checked={lidar} onChange={(e) => setLidar(e.target.checked)} /> {words.lidar}</label>
      <div className="muted">{plan ? (plan.total ? `Up to about ${roundGb(plan.total)} to download. ` : '') : 'This can download several GB of open data the first time in an area. '}{words.reveals}</div>
      {status?.running
        ? <div id="pack-progress" className="muted">Building... {status.message}</div>
        : <button id="pack-build-go" className="primary" onClick={start}>Build this map</button>}
      {problem && <div id="pack-build-error" className="saved-error" role="alert">{problem}</div>}
    </div>
  );
}

export function SiteStatus({ site, decoded, wanted, downloads, onBuilt }) {
  if (wanted) return <Builder point={wanted} downloads={downloads} onBuilt={onBuilt} />;
  if (!site || !decoded) return <div id="site-info" className="muted">Nothing chosen yet. Use one of the three ways above.</div>;
  const { header } = decoded.pack;
  const allLidar = header.lidarHalf >= WORLD.radius + Math.max(Math.abs(site.e - header.east), Math.abs(site.n - header.north));
  return (
    <div id="site-info">
      <b className="site-ok">Ready to play, nothing to download</b>
      Start point <b>{gridRef(site.e, site.n, 8)}</b> on {header.name}. The red square is your {WORLD_KM} km world. {allLidar ? 'Lidar heights across this world.' : 'Part or all of this world has no lidar, so its tree and building heights are assumed.'}
    </div>
  );
}
