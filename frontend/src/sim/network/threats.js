// The fusion node's threat library: what it may believe about a track, from what its sensors have named and the catalogue of known drones.
// It never looks at the real drone. A named model brings its own figures; a named airframe, what drones of that kind could be; an unnamed
// track, what any drone could be. So it can only count on jamming a drone it knows has a radio link to break. What a drone could be is
// what the enemy is known to send (the attack mix), as intelligence would say, so adding a drone to the catalogue changes nothing.

import { DRONES } from '../config/index.js';

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
const radioLinked = (d) => !!d.links?.control && d.jamResist < 1; // jamming can break it: its control link, as its video is received far off
const bandsOf = (d) => [d.links?.control, d.links?.video, d.links?.gnss && 'gnss'].filter(Boolean);

// Built from the drone figures as they are now, so an edit in the Sources tab reaches it. The tasking builds it once a pass, so a named
// model is only judged when a track is first named as one.
// expected: the ids of the drones the enemy sends, or every drone if none are given.
export function threatLibrary(expected) {
  const known = (expected ?? []).filter((id) => Object.hasOwn(DRONES, id));
  const all = known.length ? known.map((id) => DRONES[id]) : Object.values(DRONES);
  const strikeHarm = mean(all.filter((d) => d.role !== 'spotter').map((d) => d.damage));
  // a spotter strikes nothing, but each one on station makes every strike hit harder
  const harm = (d) => (d.role === 'spotter' ? (d.spotBonus ?? 0) * strikeHarm : d.damage);
  const judge = (ds) => ({
    harm: mean(ds.map(harm)), // what it would do on arrival, on average over what it could be
    jammable: ds.some((d) => bandsOf(d).length > 0), // a jammer could do something to it: break a link or throw its navigation off
    breakable: ds.length > 0 && ds.every(radioLinked), // jamming is sure to have a link to break
    bands: new Set(ds.flatMap(bandsOf)),
  });
  const models = new Map(); // by the name a camera or RF library gives it: any drone
  const modelOf = (name) => {
    if (!models.has(name)) { const d = Object.values(DRONES).find((x) => (x.label ?? x.name) === name); models.set(name, d && { ...judge([d]), model: d }); }
    return models.get(name);
  };
  const kinds = new Map([...new Set(all.map((d) => d.airframe))].map((a) => [a, judge(all.filter((d) => d.airframe === a))]));
  const any = judge(all);
  // What the fusion node believes about this track: { harm, jammable, breakable, bands, model? }.
  return (tr) => (tr.model && modelOf(tr.model)) || kinds.get(tr.airframe) || any;
}
