// Tunable game data. Distances are in metres, speeds in m/s, times in seconds.
//
// Each purchasable system is modelled on a real class of C-UAS equipment (see `ref`). Its game range is
// `published` (a figure taken from public sources, listed per system) multiplied by WORLD.rangeScale.
// Figures marked "assumption" had no verified public number. Vendor figures are marketing claims, not
// independent test results. Edit freely, or use the in-game Tuning panel.

// Stored with saved laydowns and runs. Raise it when a change means old saves no longer replay the same.
export const GAME_VERSION = '0.19.0';

export const WORLD = {
  metresPerUnit: 20,     // 3D scene scale: 1 scene unit = this many metres
  radius: 27000,         // the ground reaches this far from the middle: a square 54 km across
  spawnDist: 26000,      // the furthest a drone starts from the site, 1 km inside the edge; a spotter that gets this far out has left
  // How far out a drone starts. A quadcopter has the range of its radio or fibre, about 12 to 15 km (short), and a fixed-wing
  // drone starts anywhere out to spawnDist (long); a drone's `launch` can name another band. A wave's launch areas each roll a
  // share of the band. Long-range one-way attack drones, the Shahed class, have launch: 'edge' and fly in from off the map.
  launchBand: { short: [12000, 15000], long: [12000, 26000] },
  timeScale: 5,          // game seconds per real second at 1x (distances are real-scale, so time is compressed)
  droneVisualScale: 4,   // zoomed right out, drones are drawn at most this much larger than the models' units (render/drone-models.js)
  // Closer in, a drone or system keeps at least this share of the screen's height (a Shahed's span, a system's height),
  // until the camera is close enough to show it at true size.
  droneOnScreen: 0.06, systemOnScreen: 0.05,
  rangeScale: 1,         // game range = published range x this. 1 = published figures.
};
export const WORLD_KM = (2 * WORLD.radius) / 1000; // the world's width, for wording

// Simulated geodetic origin used to turn scene positions into the lat/lon that SAPIENT messages carry.
// Deliberately fictional (0,0). North is -z in the scene, east is +x.
export const GEO = { originLat: 0, originLon: 0 };

export const SITE = {
  radius: 150,           // a drone that gets this close hits the site (the power station is about 300 m across)
  targetAlt: 20,         // drones aim at this height above the ground (m)
  diveAngle: 45,         // degrees: a fixed-wing strike drone holds its height until it can reach its target at this angle, then dives: an assumption
  maxHealth: 100,
};

export const BUILD = { minDist: 250, maxDist: 2500, spacing: 60, sellRefund: 1, lockAfterStart: true };

// Procedural terrain. The terrain seed is separate from the scenario seed, so you can change the attack
// without changing the ground (or the other way round). Heights are metres above the station base.
export const TERRAIN = {
  cell: 20,              // resolution of the height/obstacle grid (m)
  relief: 380,           // mountain height far from the station (m); lower it for gentler country
  flatRadius: 450,       // the station platform is flat inside this radius (m)
  blendRadius: 1300,     // terrain reaches full relief at this distance (m)
  warp: 700,             // how far the ground is twisted by domain warping (m): bigger = more winding ridges
  waterLevel: -12,       // height of rivers and lakes relative to the station (m)
  riverWidth: 0.08,      // river valley width in noise units (bigger = wider rivers)
  snowLine: 0.72,        // snow above this fraction of the relief
  treeLine: 0.55,        // no trees above this fraction of the relief
  meshStride: 3,         // drawn terrain vertex at least every this many grid cells (smaller = finer, slower); a bigger world draws coarser
  forestThreshold: 0.56, // higher = less forest
  canopyMin: 12, canopyMax: 20, // tree height range (m)
  clearRadius: 450,      // no trees within this of the station (m)
  hamlets: 48,           // small clusters of buildings
  treeStep: 40,          // one drawn tree per this many metres of forest
  rfCanopyLength: 300,   // a network link's signal falls by 1/e for each three of these through canopy. Detection and jamming use propagation.js.
  opticalCanopyTol: 40,  // radar/EO/guns are blocked by more than this many metres of canopy on the path
  endClear: 50,          // trees within this distance of a sensor or weapon are assumed cleared
  pylonSpacing: 260, pylonHeight: 42, // power lines run out from the switchyard
  visualScale: 2,        // trees, pylons and houses are drawn this much larger than true size so you can see them
};

// One fixed budget for the whole run. Buying systems and every shot fired both draw on it; there are no rewards
// for kills or surviving waves. Laydown can only change before the first wave starts, so runs are comparable.
export const ECONOMY = { budget: 15000000 };

// Sensor detection model. A sensor's published range is where it detects a small reference drone (radar cross-section
// refRcs, size refSize). Bigger targets are seen further away. The chance of detection per scan is
// 1 / (1 + (range / (reach * pdEdge)) ^ pdSlope): about 86% at the reach, falling off quickly beyond it.
// The cross-section, size and link-power numbers on the drones are rough assumptions, not measurements.
export const SENSING = {
  refRcs: 0.01,          // m^2, a small quadcopter
  refSize: 0.35,         // m, a small quadcopter
  pdEdge: 1.35, pdSlope: 6,
  rangeCap: 2.2,         // detections beyond this many "reaches" are ignored
  clutterPenalty: 0.3,   // detection chance multiplier for a low flyer inside radar ground clutter
  clutterSpeed: 5,       // m/s: a radar's Doppler filter loses a low flyer in ground clutter only below this speed. An ASSUMPTION;
                         // drone radars are Doppler radars, so a drone moving faster stands out from the still ground
};

// SAPIENT fusion / C2 behaviour (seconds of simulated time, metres)
export const FUSION = {
  statusInterval: 5,     // StatusReport period for every node
  taskInterval: 1,       // how often the fusion node re-evaluates tasking
  fusedInterval: 1,      // fused DetectionReport period to the C2 GUI
  warnZone: 2500,        // WARNING alert when a track comes this close to the site
  critZone: 800,         // CRITICAL alert inside this
  rejectBackoff: 3,      // after a rejected task, don't retry that effector for this long
  emptyHold: 10,         // after an effector finds nothing at a track's position, no effector is offered that track for this long: an assumption
  retaskGain: 0.25,      // switch target only if the new one is this much more urgent (sooner to arrive for the harm it would do)
  minClosing: 10,        // m/s: a track slower than this is taken to close at this speed, so a hovering one still counts
  softKillWait: 10,      // s a jammer is given to break a drone's link before rounds are fired at it anyway: an assumption, twice a jammer's kill time
  // Who decides to engage. SAPIENT has no message for a weapon-release decision (see the Alert/AlertAck emulation in
  // network.js), so this is a C2 policy: 'auto' engages by itself, 'costly' asks the operator for engagements whose
  // shot costs at least authorityThreshold dollars, 'all' asks for every engagement.
  authority: 'auto', authorityThreshold: 50000, authorityTimeout: 20, // timeout in seconds, then the request lapses
  killConfirmDelay: 2.5, // after an effector reports a kill, sensors must lose the track for this long to confirm it (s)
  acquireRadius: 300,    // an effector cued to a track's estimate finds a real drone within this distance of it, or nothing (m)
  // A track is called loitering when it keeps moving but mostly sideways to the site for this long.
  loiterAfter: 10, loiterMinSpeed: 8, loiterRadial: 0.3, // s, m/s, fraction of its speed that may be towards or away from the site
};

// How the attack arrives. FPV drones come one at a time, each from its own direction, this many seconds apart.
export const WAVES = { fpvGap: 20 };

// The site's own close-in sensing. It is a SAPIENT node too, so everything flows through the same messages.
export const PERIMETER = {
  id: 'perimeter', name: 'Perimeter sensor', short: 'PRM', role: 'sensor', color: 0xff5252,
  range: 150, senses: 'perimeter', mount: 3,
  sapient: { nodeType: 'NODE_TYPE_PROXIMITY_SENSOR', subType: ['Perimeter'], scan: 'SCAN_TYPE_FIXED', interval: 1, noise: { az: 1, el: 2, range: 5 } },
  ref: { analogues: ['Site perimeter security sensors'], confidence: 'assumption' },
};

export const FUSION_DEF = {
  id: 'fusion', name: 'Site Fusion Node', short: 'FUSION', role: 'fusion', color: 0xffffff,
  mount: 80, // its network terminals are on a mast (assumed) clear of the 70 m cooling towers around it
  sapient: { nodeType: 'NODE_TYPE_FUSION_NODE', subType: ['C-UAS fusion'] },
};

// The enemy learns: each wave after the first, drones spawn better at evading and resisting jamming.
// evade = max(evadeFloor, base * (1 - evadePerWave * adapt * (wave - 1)))
// jamResist = max(base, min(jamResistCap, base + jamResistPerWave * adapt * (wave - 1)))
export const ADAPT = { evadePerWave: 0.07, evadeFloor: 0.25, jamResistPerWave: 0.05, jamResistCap: 0.95 };

// Zoomed right out, systems are drawn this many scene units per model unit, much larger than life; close up they are true size.
export const STRUCT_SCALE = 1.8;
// Metres per system model unit at true size: the models are built so that a truck is about 7.5 m long. A launcher's muzzle is
// muzzleY model units up, so this many metres each.
export const SYSTEM_UNIT_M = 2.2;
