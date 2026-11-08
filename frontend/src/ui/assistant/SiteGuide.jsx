// The guide's first part, before there is a game to guide: where to defend. It only points at the controls on the start card,
// which work the same without it, and what it says is worked out from what has been chosen so far.

import { useEffect } from 'react';
import { WORLD_KM } from '../../sim/config/index.js';
import { gridRef } from '../../sim/grids.js';
import { Spotlight } from './Spotlight.jsx';

function advice(site, wanted, packName) {
  if (site) return { spot: '#btn-guide', title: `Ready at ${gridRef(site.e, site.n)}`, text: `${packName || 'This map'} is on this computer, so nothing needs downloading. The red square is the ${WORLD_KM} km world you will defend. To go somewhere else, use any of the three ways below. Otherwise, press Defend here and carry on.` };
  if (wanted) return { spot: '#pack-build-go', title: `No map at ${gridRef(wanted.e, wanted.n)} yet`, text: 'The list below shows what building one would download. Press Build this map, or choose somewhere inside a blue square to play straight away.' };
  return { spot: '#site-ways', title: 'Where do you want to defend?', text: 'Near you? Press Use my location. Know roughly where? Drag and zoom the map, then click the spot. Have exact coordinates? Type them in.' };
}

export function SiteGuide({ site, wanted, packName, onClose }) {
  const { spot, title, text } = advice(site, wanted, packName);
  useEffect(() => { document.querySelector(spot)?.scrollIntoView?.({ block: 'nearest' }); }, [spot]); // the card can scroll, and what it points at must be seen
  return (
    <section id="site-guide" aria-label="Guide: choosing where to defend">
      <Spotlight selector={spot} />
      <div className="wz-head"><span>GUIDE: BEFORE YOU DEPLOY</span><button aria-label="Close the guide" title="Close" onClick={onClose}>×</button></div>
      <h3 aria-live="polite">{title}</h3>
      <p>{text}</p>
    </section>
  );
}
