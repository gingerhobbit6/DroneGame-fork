// What can be changed on one placed system. This one table drives the panel, the limits, the prices and what loads from a save.
// Every field changes the simulation, and every gain has a cost: price, older data, a louder signature or more false alarms.
// The limits, prices and threshold factors are assumptions: tune them here. Saved values are untrusted, so only keys in this table are read.

import { STRUCTURES, TOOLBAR, TX_POWER } from './config/index.js';
import { BANDS, CLUTTER, arcsText, bandOf, bandRange, bandSharpness, beamGain, lowestEdge, parseArcs } from './sensor-model.js';
import { CHANNELS, PIXELS } from './camera-model.js';
import { weatherRange } from './conditions.js';
import { JAM_BANDS, LIBRARIES, covers, parseBands } from './rf-model.js';

const each = (ids, limits) => Object.fromEntries(ids.map((id) => [id, limits]));
const ofKind = (kind) => TOOLBAR.find((row) => row.kind === kind).classes; // every system of a kind, as the purchase bar lists them
const RADARS = ofKind('radar'), RFS = ofKind('rf'), CAMERAS = ofKind('camera'), JAMMERS = ofKind('jammer'), ACOUSTICS = ofKind('acoustic');
const PANELLED = { radar_s: [1, 3], radar_l: [1, 3], radar_a800: [1, 4], radar_a400: [1, 4] }; // fixed-panel radars: up to all round
const MEDIUM_UP = RADARS.filter((id) => STRUCTURES[id].size !== 'S'); // 2D is offered on Medium and Large radars
const TOP_EDGE = Object.fromEntries(RADARS.filter((id) => STRUCTURES[id].elevation + lowestEdge > 15).map((id) => [id, [15, STRUCTURES[id].elevation + lowestEdge]])); // a narrow beam keeps its top
const FLAT_PRICE = 0.3, MICRO_DOPPLER_PRICE = 0.15; // share of the system's price saved by 2D, and added by a micro-Doppler classifier: assumptions
const ZOOMS = { camera: [2.5, 10], camera_l: [0.5, 7.1] }; // what each zoom lens can do, wide and narrow, in degrees
const RES_PRICE = 0.3, LENS_PRICE = 0.1, SLEW_PRICE = 0.1; // share of a camera's price per doubling of pixels, per doubling of light, and per extra slew rate
const RANGEFINDER_PRICE = 20000, RANGEFINDER_ERROR = 5; // dollars, and metres: assumptions
const SENSITIVITY_PRICE = 0.5, DF_PRICE = 0.5; // share of a detector's price per doubling of reach, and for angle of arrival over a sector
const DF_ERROR = { sector: 30, aoa: 5 }; // bearing error a detector switched to this gets, in degrees: the listed sector, and an older Dedrone's ±5°
const NARROW_PRICE = 0.25; // share of a detector's price saved by a receiver that takes in one band at a time: an assumption
const BAND_PRICE = 0.15; // share of a jammer's price saved for each band module left out: an assumption
// A sector antenna: 10 dB of gain over 60°, about what a panel antenna gives, so range goes up by the square root of 10. Price share assumed.
const SECTOR = { arc: 60, gain: 10, price: 0.2 };
// A jammer's receiver costs what a Small RF detector does with the same library, and reactive jamming, sending only while a link it
// follows is up, is this much quieter to emitter-seeking drones. Both assumptions.
const RECEIVER_LIKE = 'rf_s', REACTIVE_QUIET = 0.5;
const TECHNIQUE_PRICE = 0.25; // share of a jammer's price added for spoofing or taking drones over: an assumption
const receiverPrice = (v) => (v === 'off' ? 0 : STRUCTURES[RECEIVER_LIKE].cost * (1 + LIBRARIES[v].price));
const choicesOf = (table) => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v.label]));
const MAST_PRICE = 0.015, RELOAD_PRICE = 0.1; // share of the system's price, per metre and per second
const THRESHOLD = { low: { range: 1.1, falseAlarm: 2 }, high: { range: 0.9, falseAlarm: 0.5 } };
// Transmit power in watts, from a tenth of the rated output up to it, in steps of about a twentieth: 1, 2 or 5 of a power of ten.
const watts = (id) => TX_POWER[id].watts;
function wattStep(id) {
  const s = watts(id) / 20, p = 10 ** Math.floor(Math.log10(s)), m = s / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
const POWERED = [...RADARS, ...JAMMERS];
const wattLimits = (id) => [Math.max(wattStep(id), Math.round(watts(id) / 10 / wattStep(id)) * wattStep(id)), watts(id)];

export const UNIT_FIELDS = [
  {
    key: 'mount', label: 'Mast height', unit: 'm', step: 0.5, base: (c) => c.mount, direct: 'mount',
    limits: { radar_s: [5, 25], radar: [5, 35], radar_a800: [5, 35], radar_a400: [5, 35], radar_giraffe: [2, 20], radar_l: [10, 40], rf_s: [1, 10], rf: [2, 15], rf_elysion: [2, 15], rf_l: [2, 20], camera_s: [5, 20], camera: [5, 25], camera_l: [5, 30], ...each(JAMMERS, [1, 20]), acoustic_s: [2, 6], acoustic: [2, 6], acoustic_l: [2, 10] },
    price: (v, c) => (v - c.mount) * MAST_PRICE * c.cost,
    help: 'Higher sees over more trees and terrain, at a price.',
  },
  {
    key: 'watts', label: 'Transmit power', unit: 'W', step: Object.fromEntries(POWERED.map((id) => [id, wattStep(id)])), base: (c) => watts(c.id),
    limits: Object.fromEntries(POWERED.map((id) => [id, wattLimits(id)])),
    range: (v, c) => (c.kind === 'radar' ? Math.pow(v / watts(c.id), 0.25) : Math.sqrt(v / watts(c.id))), signature: (v, c) => v / watts(c.id),
    help: 'Less power means less range, and is quieter to emitter-seeking drones.',
    note: (id) => `Rated ${watts(id)} W: ${TX_POWER[id].confidence === 'assumption' ? 'an assumption, none published' : `${TX_POWER[id].confidence}, ${TX_POWER[id].basis}`}.`,
  },
  {
    // The tracker stretches its timeouts by each sensor's update interval (tracker.js), so a slow scan holds its tracks.
    key: 'scan', label: 'Scan period', unit: 's', step: 0.1, base: (c) => c.sapient.interval, limits: each(RADARS, [0.5, 5]),
    range: (v, c) => Math.pow(v / c.sapient.interval, 0.25), sapient: 'interval',
    help: 'Slower reaches further, but its data is older.',
  },
  {
    key: 'panels', label: 'Panels', unit: '', step: 1, base: () => 1, direct: 'panels', limits: PANELLED,
    price: (v, c) => (v - 1) * c.cost,
    help: 'Each panel adds its arc beside the others, at the price of another radar head.',
  },
  {
    // A panel steers its beam, so a narrower arc spends the same scan on less sky: range goes with the fourth root (search radar
    // equation). A rotating radar's dish turns all round whatever it is told, so only fixed panels have this.
    key: 'arc', label: 'Arc per panel', unit: '°', step: 5, base: (c) => c.arc, direct: 'arc', limits: Object.fromEntries(Object.keys(PANELLED).map((id) => [id, [30, STRUCTURES[id].arc]])),
    range: (v, c) => Math.pow(c.arc / v, 0.25),
    help: 'Narrower searches less, so it reaches further: a quarter of the arc gains about 40%. It sees nothing outside it.',
  },
  {
    // No standard value: left unset, it faces away from what is being defended, wherever that is (laydown.js).
    key: 'facing', label: 'Facing', unit: '°', step: 5, base: () => null, limits: { ...Object.fromEntries(Object.keys(PANELLED).map((id) => [id, [0, 355]])), ...each(JAMMERS, [0, 355]) },
    help: 'The compass bearing the middle of its arc points along. Reset, it faces away from what you defend.',
  },
  {
    key: 'fitted', label: 'Bands fitted', base: () => JAM_BANDS, limits: each(JAMMERS, true), bands: true, options: () => JAM_BANDS, parse: (v) => parseBands(v),
    price: (v, c) => (v.length - JAM_BANDS.length) * BAND_PRICE * c.cost,
    help: 'Each band is a module. Leave one out to save its price: it can then never be jammed.',
  },
  {
    key: 'antenna', label: 'Antenna', base: () => 'omni', direct: 'antenna', limits: each(JAMMERS, true), choices: { omni: 'Omni, all round', sector: `Sector, ${SECTOR.arc}°` },
    range: (v) => (v === 'sector' ? Math.sqrt(SECTOR.gain) : 1), price: (v, c) => (v === 'sector' ? SECTOR.price * c.cost : 0),
    help: 'A sector antenna reaches about three times as far, but only through its arc, which faces away from what you defend unless turned.',
  },
  {
    key: 'receiver', label: 'Receiver', base: (c) => c.receiver ?? 'off', limits: each(JAMMERS, true), // some come with one
    choices: { off: 'None', ...Object.fromEntries(Object.entries(LIBRARIES).map(([k, v]) => [k, `Fitted, ${v.name} library`])) },
    price: (v, c) => receiverPrice(v) - receiverPrice(c.receiver ?? 'off'),
    help: 'Hears drones on the bands it is fitted for, as far as it can jam them, but not through its own barrage. Needed to jam reactively or switch itself on.',
  },
  {
    key: 'technique', label: 'Technique', base: () => 'barrage', direct: 'technique', limits: each(JAMMERS, true),
    choices: { barrage: 'Barrage', reactive: 'Reactive', spoof: 'GNSS spoofing', takeover: 'Take over commercial drones' },
    signature: (v) => (v === 'barrage' ? 1 : REACTIVE_QUIET),
    price: (v, c) => (v === 'spoof' || v === 'takeover' ? TECHNIQUE_PRICE * c.cost : 0),
    help: 'Barrage fills its bands for every drone. Reactive follows only the links its receiver hears and its library knows: it breaks them twice as fast at half the noise, and leaves GNSS and every other drone alone. GNSS spoofing, on its GNSS band, feeds false positions that turn a navigating drone off course, and jams nothing else. Taking over sends a commercial drone its maker’s commands and lands it whole, if its receiver hears it and its library knows the link.',
  },
  {
    key: 'trigger', label: 'Switched on by', base: () => 'track', direct: 'trigger', limits: each(JAMMERS, true),
    choices: { track: 'Fusion node, on a track', receiver: 'Its own receiver', manual: 'You, by hand' },
    help: 'Its own receiver works with the network down, but cannot hear a drone that sends nothing, and a barrage has to stop for 1 s in every 4 to listen. By hand, it jams only while you switch it on.',
  },
  {
    key: 'dims', label: 'Height', base: (c) => c.dims ?? 'full', direct: 'dims', limits: each(MEDIUM_UP, true), choices: { full: '3D, measures height', flat: '2D, no height' },
    price: (v, c) => (v === 'flat' ? -FLAT_PRICE * c.cost : 0),
    help: '2D is cheaper, but gives no height: cameras must search up and down, and height is a guess.',
  },
  {
    key: 'band', label: 'Band', base: (c) => bandOf(c), limits: each(RADARS, true), choices: choicesOf(BANDS),
    price: (v, c) => (BANDS[v].price / BANDS[bandOf(c)].price - 1) * c.cost, range: (v, c) => bandRange(v, c),
    help: 'A higher band measures angles better and sees small drones a little further, at a higher price.',
  },
  {
    key: 'microDoppler', label: 'Micro-Doppler classifier', base: (c) => c.microDoppler ?? 'no', direct: 'microDoppler', limits: each(RADARS, true), choices: { no: 'No', yes: 'Yes' },
    price: (v, c) => ((v === 'yes') - (c.microDoppler === 'yes')) * MICRO_DOPPLER_PRICE * c.cost,
    help: 'Tells a multirotor from a fixed wing by its moving parts, inside half its reach.',
  },
  {
    key: 'elevLow', label: 'Low edge of the beam', unit: '°', step: 1, base: () => lowestEdge, direct: 'elevLow', limits: each(RADARS, [lowestEdge, 5]),
    falseAlarm: (v) => Math.pow(2, (lowestEdge - v) / 10),
    help: 'Raising it halves ground clutter false alarms for every 10°, but low flyers close in pass under it.',
  },
  {
    key: 'elevTop', label: 'Top edge of the beam', unit: '°', step: 1, base: (c) => c.elevation + lowestEdge, direct: 'elevTop', limits: TOP_EDGE,
    help: 'Lowering it searches less sky, so it reaches further, but leaves a gap overhead.',
  },
  {
    key: 'blank', label: 'Blanking arcs', base: () => null, direct: 'blank', limits: each(RADARS, true), arcs: true, parse: parseArcs, show: arcsText,
    invalid: 'Write up to 3 blanking arcs as compass bearings from-to, such as 40-80, 200-220',
    help: 'Up to 3, as compass bearings clockwise, such as 40-80, 200-220. It has no false alarms there, and sees nothing there.',
  },
  {
    key: 'clutter', label: 'Clutter filter', base: () => 'medium', limits: each(RADARS, true), choices: choicesOf(CLUTTER),
    lowRange: (v) => CLUTTER[v].lowRange, falseAlarm: (v) => CLUTTER[v].falseAlarm,
    help: 'Low sees low flyers further, with more false alarms. High is the reverse, and misses slow and crossing drones.',
  },
  {
    key: 'library', label: 'Classifier library', base: (c) => c.library, direct: 'library', limits: each(RFS, true), choices: choicesOf(LIBRARIES),
    price: (v, c) => (LIBRARIES[v].price - LIBRARIES[c.library].price) * c.cost, falseAlarm: (v) => (LIBRARIES[v].knows ? 1 : 2),
    help: 'It names the airframe of a radio link it knows, and takes any other for a drone. With none it hears energy only, and has twice the false alarms.',
  },
  {
    // Free-space reach doubles for every 6 dB.
    key: 'sensitivity', label: 'Receiver sensitivity', unit: 'dBm', step: 1, base: (c) => c.sensitivity,
    limits: Object.fromEntries(RFS.map((id) => [id, [STRUCTURES[id].sensitivity - 6, STRUCTURES[id].sensitivity + 6]])),
    range: (v, c) => 2 ** ((c.sensitivity - v) / 6), price: (v, c) => (2 ** ((c.sensitivity - v) / 6) - 1) * SENSITIVITY_PRICE * c.cost,
    help: 'Every 6 dB lower hears twice as far, at a price.',
  },
  {
    key: 'df', label: 'Direction finding', base: (c) => c.df, direct: 'df', limits: each(RFS, true), choices: { sector: 'Sector, ±30°', aoa: 'Angle of arrival' },
    price: (v, c) => ((v === 'aoa') - (c.df === 'aoa')) * DF_PRICE * c.cost,
    help: 'Angle of arrival gives a bearing good enough to cross with another detector\'s. A sector only says roughly which way.',
  },
  {
    // Each band monitored brings its own false alarms, from other emitters there.
    key: 'monitored', label: 'Bands monitored', base: (c) => covers(c), direct: 'monitored', limits: each(RFS, true), bands: true,
    options: (id) => covers(STRUCTURES[id]), parse: (v, id) => parseBands(v, covers(STRUCTURES[id])), falseAlarm: (v, c) => v.length / covers(c).length,
    help: 'It hears only the bands it monitors. Fewer give fewer false alarms, and a narrow receiver comes back to each sooner.',
  },
  {
    // A real receiver steps far faster; here a narrow one takes one report interval per band, so the band count is felt.
    key: 'ibw', label: 'Instantaneous bandwidth', base: () => 'wide', direct: 'ibw', limits: each(RFS, true), choices: { wide: 'Wide, all its bands at once', narrow: 'Narrow, one band at a time' },
    price: (v, c) => (v === 'narrow' ? -NARROW_PRICE * c.cost : 0),
    help: 'Narrow is cheaper, but takes in one band at a time, so it hears each band only once per band it monitors.',
  },
  {
    key: 'threshold', label: 'Detection threshold', base: () => 'normal', limits: { ...each(RADARS, true), ...each(RFS, true), ...each(CAMERAS, true), ...each(ACOUSTICS, true) },
    choices: { low: 'Low', normal: 'Normal', high: 'High' },
    range: (v) => THRESHOLD[v]?.range ?? 1, falseAlarm: (v) => THRESHOLD[v]?.falseAlarm ?? 1,
    help: 'Low detects further with more false alarms. High is the reverse.',
  },
  {
    key: 'view', label: 'Search view', unit: '°', step: 0.5, base: (c) => c.fov, direct: 'fov', limits: ZOOMS,
    range: (v, c) => c.fov / v,
    help: 'The view it sweeps with. Narrower reaches further, but covers less sky on each look.',
  },
  {
    key: 'trackView', label: 'Track view', unit: '°', step: 0.1, base: (c) => c.trackFov, direct: 'trackFov', limits: ZOOMS,
    help: 'How far it zooms in on a cue. Narrower reaches further and names the drone sooner, but a poor cue leaves it looking at empty sky.',
  },
  {
    key: 'channels', label: 'Channels', base: (c) => c.channels, direct: 'channels', limits: each(CAMERAS, true), choices: choicesOf(CHANNELS),
    price: (v, c) => (CHANNELS[v].price / CHANNELS[c.channels].price - 1) * c.cost,
    help: 'Visible fades at dusk and is almost blind at night. Thermal works day and night. Rain and haze cut both.',
  },
  {
    key: 'pixels', label: 'Resolution', base: (c) => c.pixels, limits: each(CAMERAS, true), choices: choicesOf(PIXELS),
    range: (v, c) => PIXELS[v].px / PIXELS[c.pixels].px, price: (v, c) => Math.log2(PIXELS[v].px / PIXELS[c.pixels].px) * RES_PRICE * c.cost,
    help: 'More pixels put more on the drone, so it is seen, recognised and identified further away, at a price. On thermal, not past what the lens can resolve.',
  },
  {
    key: 'fnumber', label: 'Lens F-number', step: 0.1, base: (c) => c.fnumber, direct: 'fnumber', limits: { camera_s: [1, 2], camera: [1.4, 4], camera_l: [4, 5.6] },
    price: (v, c) => ((c.fnumber / v) ** 2 - 1) * LENS_PRICE * c.cost,
    help: 'A faster lens, with a lower number, gathers more light, so it keeps more of its range at dusk, at night and in haze, and on thermal it blurs less, at a price.',
  },
  {
    key: 'rangefinder', label: 'Laser rangefinder', base: (c) => c.rangefinder ?? 'no', direct: 'rangefinder', limits: each(CAMERAS, true), choices: { no: 'No', yes: 'Yes' },
    price: (v, c) => ((v === 'yes') - (c.rangefinder === 'yes')) * RANGEFINDER_PRICE,
    help: 'Measures the range to what it sees, so a cued camera can start a track by itself.',
  },
  {
    key: 'searchArc', label: 'Search arc', unit: '°', step: 10, base: () => 360, direct: 'searchArc', limits: each(CAMERAS, [30, 360]),
    help: 'Idle, it sweeps this arc, facing away from what you defend. Narrower comes round sooner, and sees nothing outside it.',
  },
  {
    key: 'sweep', label: 'Sweep rate', unit: '°/s', step: 1, base: (c) => c.searchRate, direct: 'searchRate', limits: each(CAMERAS, [4, 40]),
    help: 'Faster comes round sooner, but once it turns more than its view between looks it leaves gaps.',
  },
  {
    key: 'slew', label: 'Slew rate', unit: '°/s', step: 10, base: (c) => c.slewRate, direct: 'slewRate', limits: each(CAMERAS, [30, 180]),
    price: (v, c) => (v / c.slewRate - 1) * SLEW_PRICE * c.cost,
    help: 'How fast it turns to a cue. Faster gets to the next track sooner, at a price.',
  },
  {
    key: 'dwell', label: 'Dwell on a cue', unit: 's', step: 0.5, base: (c) => c.dwell, direct: 'dwell', limits: each(CAMERAS, [1, 10]),
    help: 'Longer holds a track for more looks, and leaves other tracks waiting.',
  },
  {
    key: 'reload', label: 'Time between shots', unit: 's', step: 0.5, base: (c) => c.cooldown, direct: 'cooldown', limits: { interceptor_s: [2, 8], interceptor: [1.5, 6], interceptor_p1: [1.5, 6], interceptor_l: [1.5, 6], missile_rr: [2, 8], missile_hvm: [2, 8], missile_paladin: [0.5, 3], gun_hmg: [0.5, 4], gun_s: [0.5, 4], gun_50: [0.5, 4], gun_l: [0.5, 3], gun_skyranger: [0.5, 3], gun_gepard: [0.5, 3], missile_skysabre: [3, 10], missile_s: [1, 4], missile: [2, 8], missile_l: [3, 10] },
    price: (v, c) => (c.cooldown - v) * RELOAD_PRICE * c.cost,
    help: 'Faster launchers cost more.',
  },
  {
    key: 'beam', label: 'Beam damage', unit: 'hp/s', step: 2, base: (c) => c.dps, direct: 'dps', limits: { laser_rfdew: [28, 112], laser_s: [7, 28], laser: [14, 56], laser_l: [28, 112] },
    price: (v, c) => (v / c.dps - 1) * c.cost,
    help: 'A stronger beam burns faster, and its price rises in step.',
  },
];

export const fieldsFor = (id) => UNIT_FIELDS.filter((f) => f.limits[id]);

// A value made safe to use for this field on this system, or undefined if it cannot be used at all.
function cleanValue(field, id, value) {
  if (field.arcs || field.bands) return field.parse(value, id);
  if (field.choices) return Object.hasOwn(field.choices, value) ? value : undefined;
  if (!Number.isFinite(value)) return undefined;
  const [min, max] = field.limits[id], step = stepOf(field, id), base = field.base(STRUCTURES[id]);
  const snapped = Math.min(max, Math.max(min, Number((min + Math.round((value - min) / step) * step).toFixed(2))));
  // The steps count from the minimum, so the standard value can fall between two of them: it stays reachable, at the standard price.
  return Number.isFinite(base) && Math.abs(value - base) <= Math.abs(value - snapped) ? base : snapped;
}

// Only what differs from the catalogue is kept, so a unit with no changes saves and plays exactly as before.
export function setSetting(settings, field, id, value) {
  const clean = value == null ? field.base(STRUCTURES[id]) : cleanValue(field, id, value);
  if (clean === undefined) return false;
  const base = field.base(STRUCTURES[id]), same = clean === base || (Array.isArray(clean) && String(clean) === String(base)); // a list is the same if it holds the same
  if (same || (field.arcs && !clean.length)) delete settings[field.key];
  else settings[field.key] = clean;
  return true;
}

// A field's step: one for every system, or each its own, as transmit power in watts is.
export const stepOf = (field, id) => (typeof field.step === 'object' ? field.step[id] : field.step);

export function cleanSettings(id, saved) {
  const settings = {};
  // saved before transmit power was in watts: a share of the rated output, in per cent
  if (saved && typeof saved === 'object' && Number.isFinite(saved.power) && !Object.hasOwn(saved, 'watts') && TX_POWER[id]) saved = { ...saved, watts: (saved.power / 100) * watts(id) };
  if (saved && typeof saved === 'object') for (const f of fieldsFor(id)) if (Object.hasOwn(saved, f.key)) setSetting(settings, f, id, saved[f.key]);
  return settings;
}

export const settingValue = (def, field) => def.settings[field.key] ?? field.base(STRUCTURES[def.id]) ?? def[field.key] ?? ''; // a placed radar's facing has no standard value

export function unitCost(id, settings = {}) {
  const c = STRUCTURES[id];
  return Math.round(fieldsFor(id).reduce((sum, f) => (f.price && settings[f.key] != null ? sum + f.price(settings[f.key], c) : sum), c.cost));
}

// A unit's own definition sits over the catalogue's. Its values are worked out when read, so figure edits still reach it and one unit can change alone.
export function unitDef(id, settings = {}) {
  const c = STRUCTURES[id], fields = fieldsFor(id);
  const def = Object.create(c);
  def.settings = settings;
  def.sapient = { ...c.sapient };
  if (c.sapient.noise) def.sapient.noise = { ...c.sapient.noise };
  const scaled = (prop) => fields.reduce((v, f) => (f[prop] && settings[f.key] != null ? v * f[prop](settings[f.key], c) : v), c[prop]);
  Object.defineProperty(def, 'cost', { get: () => unitCost(id, settings) });
  Object.defineProperty(def, 'range', { get: () => Math.round(scaled('range') * beamGain(def) * weatherRange(def)) }); // and the light and weather now
  for (const prop of ['signature', 'falseAlarm', 'lowRange']) if (fields.some((f) => f[prop])) Object.defineProperty(def, prop, { get: () => scaled(prop) });
  for (const f of fields) {
    if (f.direct) Object.defineProperty(def, f.direct, { get: () => settings[f.key] ?? c[f.direct] });
    if (f.sapient) Object.defineProperty(def.sapient, f.sapient, { get: () => settings[f.key] ?? c.sapient[f.sapient] });
  }
  if (c.kind === 'radar') { // the band sets angle error and what the Spectrum tab shows, and a 2D radar measures no height
    const n = c.sapient.noise, sharp = () => (settings.band ? bandSharpness(settings.band, c) : 1);
    Object.defineProperty(def.sapient.noise, 'az', { get: () => n.az * sharp(), enumerable: true });
    Object.defineProperty(def.sapient.noise, 'el', { get: () => (settings.dims === 'flat' ? undefined : n.el * sharp()), enumerable: true });
    Object.defineProperty(def, 'emits', { get: () => (settings.band ? [{ label: `${BANDS[settings.band].label} radar`, f: BANDS[settings.band].f }] : c.emits) });
  }
  if (c.kind === 'camera') Object.defineProperty(def.sapient.noise, 'range', { get: () => (def.rangefinder === 'yes' ? RANGEFINDER_ERROR : undefined), enumerable: true });
  if (c.kind === 'rf') { // direction finding sets its bearing error, and a narrow receiver comes back to each band it monitors in turn
    Object.defineProperty(def.sapient.noise, 'az', { get: () => (settings.df ? DF_ERROR[settings.df] : c.sapient.noise.az), enumerable: true });
    Object.defineProperty(def.sapient, 'interval', { get: () => c.sapient.interval * (def.ibw === 'narrow' ? covers(def).length : 1), enumerable: true });
  }
  if (c.kind === 'jammer') { // only fitted bands can be jammed, a sector antenna covers its arc only, and a receiver carries a library
    Object.defineProperty(def, 'fitted', { get: () => settings.fitted ?? JAM_BANDS });
    Object.defineProperty(def, 'library', { get: () => { const v = settings.receiver ?? c.receiver; return v === 'off' ? undefined : v; } }); // off is saved only on one that comes with a receiver
    Object.defineProperty(def, 'bands', { get: () => c.bands.filter((b) => def.fitted.includes(b)) });
    Object.defineProperty(def, 'arc', { get: () => (def.antenna === 'sector' ? SECTOR.arc : undefined) });
  }
  return def;
}

// A name or callsign made safe to keep: printable text, within length. Empty means none.
export const cleanName = (text) => (typeof text === 'string' ? text.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 40) : '');
const CALLSIGN = /^[A-Za-z0-9][A-Za-z0-9 -]{0,11}$/;
export const cleanCallsign = (text) => {
  const t = cleanName(text);
  return CALLSIGN.test(t) ? t : '';
};
