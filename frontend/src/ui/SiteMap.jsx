// The start map and its controls: buttons for the map style above it, and ticks for the loaded data below it, which also explain its colours.
// The drawing stays in site-map.js, as the minimap's stays in minimap.js.

import { useEffect, useRef, useState } from 'react';
import { WORLD_KM } from '../sim/config/index.js';
import { MAP_STYLES, NO_LIVE_MAP, createSiteMap } from './site-map.js';

const LOADED = [['packs', 'Maps ready to play'], ['lidar', 'Lidar heights'], ['downloads', 'Data downloaded'], ['osmap', 'Map pictures'], ['satellite', 'Satellite pictures']];
const MARKS = [['world', `Your ${WORLD_KM} km world`], ['plan', 'Map a build would make']];
const STYLE_HELP = { Satellite: 'From EOX, which then sees the area you view', Hybrid: 'From EOX, which then sees the area you view', [NO_LIVE_MAP]: 'Asks no outside server, and shows only the pictures in your map packs' };

export function SiteMap({ packs, decoded, downloads, point, planned, elsewhere, moving, privateLocationRequest = 0, onPick }) {
  const box = useRef(null);
  const leaflet = useRef(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [shown, setShown] = useState(null); // the style and layers showing
  useEffect(() => {
    leaflet.current = createSiteMap(box.current, { onPick: (spot) => pick.current(spot), onChange: setShown });
    setShown(leaflet.current.state());
    return () => { leaflet.current.remove(); leaflet.current = null; };
  }, []);
  useEffect(() => { packs.forEach((pack) => leaflet.current.addPack(pack)); }, [packs]);
  useEffect(() => { leaflet.current.setPictures(decoded); }, [decoded]);
  useEffect(() => { leaflet.current.showDownloads(downloads); }, [downloads]);
  useEffect(() => { if (privateLocationRequest) leaflet.current.setStyle(NO_LIVE_MAP); }, [privateLocationRequest]);
  useEffect(() => { leaflet.current.show(point, { planned, move: moving.current }); }, [point, planned]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { leaflet.current.markElsewhere(elsewhere); }, [elsewhere]);
  return (
    <>
      <div className="site-map-bar">
        <div className="site-map-styles" role="group" aria-label="Map style">
          {MAP_STYLES.map((name) => <button key={name} aria-pressed={shown?.style === name} className={shown?.style === name ? 'on' : ''} title={STYLE_HELP[name] || 'From OpenStreetMap, which then sees the area you view'} onClick={() => leaflet.current.setStyle(name)}>{name}</button>)}
        </div>
        <div className="site-map-jumps">
          <button id="site-map-world" onClick={() => leaflet.current.showWorld()}>World</button>
          <button id="site-map-mine" disabled={!packs.length} onClick={() => leaflet.current.showLoaded()}>My maps{packs.length ? ` (${packs.length})` : ''}</button>
        </div>
      </div>
      <div id="site-map" ref={box} />
      <div className="site-legend">
        {LOADED.map(([name, text]) => <label key={name}><input type="checkbox" checked={!!shown?.layers[name]} onChange={(e) => leaflet.current.setLayer(name, e.target.checked)} /><i className={`key key-${name}`} />{text}</label>)}
        {MARKS.map(([kind, text]) => <span key={kind}><i className={`key key-${kind}`} />{text}</span>)}
      </div>
    </>
  );
}
