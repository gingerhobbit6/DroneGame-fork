import { REAL_DRONES, blast } from './real-drones.js';
import { EXTRA_REAL_DRONES } from './real-drones-extra.js';
import { COTS_DRONES } from './real-drones-cots.js';

export const DRONES = {
  // model: 'quad' | 'fw'. alt: spawn altitude range above ground (m). minAgl: lowest it will fly above ground until
  // it is close to the site (m). Strikes follow the terrain. jamResist: 0 = fully jammable, 1 = immune.
  // evade: 1 = no manoeuvrability, lower = harder to hit. It lowers a shot's hit chance and slows a laser's burn.
  // adapt: how strongly this type gets better at evading/resisting each wave (see ADAPT).
  // sound: how much further it is heard than a small FPV, an assumption. A piston-engined fixed-wing drone is far louder than a quadcopter.
  // lostLink: what it does once a jammer has cut its control link: 'crash' (flown by hand, the default) or 'home' (it flies itself and turns
  // for home, or drifts down with its satellite navigation jammed too). terminal: metres from its target inside which a homing module
  // flies it, out of a jammer's reach. hops: its link hops frequency faster than a reactive jammer can follow (drones.js, jamming.js).
  // rfEmitter: has an active radio link an RF detector can hear, on the bands of its control and video links. airframe is what a camera classifies it as.
  // protocol: the family of its radio link, which an RF detector's classifier library may know (rf-model.js).
  // cost: what one drone costs the attacker in dollars, with the evidence in costRef.
  // warhead: the explosive it carries (kg), which sets how far its blast can kill or injure people (CASUALTY in people.js). Reported
  // for the real drones; for these types, the mass their site damage was scaled from (blast() in real-drones.js).
  // label: the tag drawn over it on the map.
  spotter: {
    name: 'Fixed-wing spotter drone', label: 'Fixed-wing spotter', role: 'spotter', model: 'fw', hp: 50, speed: 30, damage: 0, evade: 0.9,
    links: { control: 'control900', video: 'video58', gnss: true }, // radio dependencies, for jamming
    color: 0xffd600, alt: [400, 500], jamResist: 0.75, adapt: 0.5, rfEmitter: true, protocol: 'tactical', airframe: 'Fixed wing',
    loiterDist: 2500, loiterTime: 60, // orbit radius (m) and seconds on station before it leaves
    lostLink: 'home', // an autopilot flies its route, so a lost link turns it for home and lost video only blinds it: an assumption, as usual for military drones
    spotBonus: 0.5,                   // each spotter on station adds this to strike damage
    bank: 0.35,                       // bank angle (radians) while orbiting
    cost: 100000, rcs: 0.15, size: 3.0, rfPower: 2.5, sound: 3, // rcs (m^2), size (m) and link power relative to a small FPV: assumptions
    costRef: {
      note: 'Orlan-10 class reconnaissance drone: estimates $80,000–$120,000 per aircraft (the full system is about 18 million rubles). Game uses $100,000.',
      confidence: 'Wartime press estimates, not procurement prices',
      sources: [{ label: 'UNIAN: Orlan-10', url: 'https://www.unian.info/war/amp-2138624-russia-loses-another-uav-in-donbas-photos.html' }],
    },
  },
  fo: {
    // fibre-optic FPV: an FPV that is slower and less agile, flies low, emits no radio and cannot be jammed
    name: 'Fibre-optic strike drone', label: 'Fibre-optic', model: 'quad', hp: 20, speed: 18, damage: 12, evade: 0.8,
    links: {}, seeksEmitters: true, // fibre: nothing to jam; operator-guided, so it goes for emitters too
    rfEmitter: false, airframe: 'Multirotor', color: 0xff9100, alt: [10, 25], minAgl: 8, jamResist: 1, adapt: 0, fibre: true,
    cost: 1000, rcs: 0.01, size: 0.35, rfPower: 1, warhead: 2, sound: 1,
    costRef: {
      note: 'Ukrainian contracts in 2025 priced fibre-optic FPVs at about 30,000–60,000 UAH each (roughly $700–$1,500 at about 40–42 UAH/$; the dollar conversion is mine), depending on spool size. Game uses $1,000.',
      confidence: 'Contract reporting; currency converted by approximation',
      sources: [
        { label: 'Mezha: fibre-optic FPV contract prices', url: 'https://mezha.net/eng/news/5bb1a299_dot_allows_contract/' },
        { label: 'Gagadget: fibre-optic drone prices', url: 'https://gagadget.com/en/562965-the-latest-fibre-optic-drones-have-started-to-fall-in-price-due-to-increased-production-volumes/' },
      ],
    },
  },
  fpv: {
    name: 'First-person-view strike drone', label: 'First-person-view', model: 'quad', hp: 20, speed: 30, damage: 12, evade: 0.6,
    links: { control: 'control24', video: 'video58' }, seeksEmitters: true, // goes for the loudest emitter it can find
    rfEmitter: true, protocol: 'hobby', airframe: 'Multirotor', color: 0xff1744, alt: [30, 90], minAgl: 15, jamResist: 0, adapt: 1,
    cost: 400, rcs: 0.01, size: 0.35, rfPower: 1, warhead: 2, sound: 1,
    costRef: {
      note: 'Ukrainian FPV strike drones are reported at about $400 each (some makers claim under $400 before the warhead; forum estimates run $500–$1,500). Game uses $400.',
      confidence: 'Press and manufacturer figures',
      sources: [
        { label: 'Defence Blog: What Ukraine’s drones really cost', url: 'https://defence-blog.com/?p=83162' },
        { label: 'TechRadar: $400 FPV', url: 'https://www.techradar.com/pro/ukraine-claims-usd400-fpv-drone-destroyed-russias-usd19-million-apache-rival-attack-helicopter' },
      ],
    },
  },
  fw: {
    name: 'Fixed-wing strike drone', label: 'Fixed-wing strike', model: 'fw', hp: 60, speed: 45, damage: 30, evade: 0.8,
    launch: 'edge', // the Shahed class flies hundreds of km, so it comes in from off the map (WORLD.launchBand)
    links: { gnss: true }, // autonomous, navigates by GNSS
    rfEmitter: false, airframe: 'Fixed wing', color: 0xd500f9, alt: [150, 300], minAgl: 30, jamResist: 0.5, adapt: 0.7,
    cost: 35000, rcs: 0.2, size: 2.5, rfPower: 1, warhead: 30, sound: 5,
    costRef: {
      note: 'Shahed-136 / Geran-2 class: most estimates $20,000–$50,000 per drone (CSIS about $35,000; Forbes Ukraine uses $50,000); later Geran-2 variants closer to $80,000; export price in leaked documents $193,000. Game uses $35,000.',
      confidence: 'Analyst estimates; wide spread',
      sources: [
        { label: 'Phenomenal World: Shahed costs', url: 'https://phenomenalworld.org/?p=29408' },
        { label: 'ThePricer: Shahed cost', url: 'https://www.thepricer.org/how-much-does-a-shahed-drone-cost/' },
      ],
    },
  },
};
// A real drone starts from its type's rules and adds what is publicly known, so anything not public stays a labelled class value.
// Its damage to the site follows its warhead (blast()).
for (const [id, real] of Object.entries({ ...REAL_DRONES, ...EXTRA_REAL_DRONES, ...COTS_DRONES })) DRONES[id] = { ...DRONES[real.variantOf], ...real, ...(real.warhead != null && { damage: blast(real.warhead) }) };
for (const [id, def] of Object.entries(DRONES)) def.id = id;

// The four types the waves send and the wizard reasons about. Every real drone belongs to one of them (variantOf).
export const DRONE_CLASSES = Object.values(DRONES).filter((d) => !d.variantOf);
// Every drone, grouped for pickers.
export const THREAT_GROUPS = [
  { name: 'Generic types', drones: DRONE_CLASSES },
  ...['Russia', 'Iran', 'China', 'Commercial off the shelf'].map((name) => ({ name, drones: Object.values(DRONES).filter((d) => d.origin === name) })),
];
