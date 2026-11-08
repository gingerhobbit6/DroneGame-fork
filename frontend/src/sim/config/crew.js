// Systems a crew works by hand, off the network: machine guns on a vehicle's pintle and handheld jammers. They cannot be wired
// to the fusion node, so nothing tasks them. The crew fires or jams at the nearest drone it can see in reach (sim/crew.js), with a
// wearable detector to warn it of drones with a radio link nearby. Guns with a radar of their own stay networked.
// Costs are placeholders where no price is published; each `ref` says where the numbers come from.

// How far a crew picks out a drone by eye in daylight: where its span fills eyeAngle degrees, as half of the observers in field trials
// saw a Phantom 4 at 245 m and a Mavic Air at 307 m, both at 0.065°. So a quadcopter at about 300 m and a Shahed at about 2.2 km, up to
// eyeMax, less in poor light though never below nightFloor of that (with night sights). eyeMax is an ASSUMPTION for haze.
// A crew hears a drone earRange metres off for each unit of its loudness (`sound`), as far as the small microphone node hears a small
// first-person-view drone, half that in rain: an ASSUMPTION. A wearable detector warns of a drone with a radio link within alertRange
// metres. Warned either way, the crew is ready, and a jammer can be pointed down the drone's bearing. reaction: seconds from seeing a
// drone to firing or jamming, unless warned in time. ASSUMPTIONS apart from the angle.
export const CREW = { eyeAngle: 0.065, eyeMax: 3000, nightFloor: 0.5, earRange: 300, alertRange: 400, reaction: 3 };

const MG_SOURCES = [
  { label: 'MDPI Applied Sciences: seeing a Mavic Air and a Phantom 4 by eye', url: 'https://www.mdpi.com/2076-3417/10/16/5501' },
  { label: 'British Army: general purpose machine gun', url: 'https://www.army.mod.uk/learn-and-explore/equipment/small-arms-and-support-weapons/general-purpose-machine-gun' },
  { label: 'British Army: heavy machine gun', url: 'https://www.army.mod.uk/learn-and-explore/equipment/small-arms-and-support-weapons/heavy-machine-gun' },
  { label: 'Ukrainian News: Shahed hit rates and mobile fire groups', url: 'https://ukranews.com/en/news/1015783-since-beginning-of-year-russians-launched-over-2-000-shaheds-across-ukraine-what-is-hit-percentage' },
];
const crewGun = { role: 'effector', kind: 'gun', model: 'gun', fire: 'guided', networked: false, mobile: 'vehicle', health: 20, signature: 0, emits: [], muzzleY: 1.2, splash: 0, fuze: 2,
  sapient: { nodeType: 'NODE_TYPE_KINETIC', subType: ['Gun'], scan: 'SCAN_TYPE_STEERABLE' } };
// beam: degrees either side of where the soldier points it, together. Kvertus publishes 30°; for the others 30° is an ASSUMPTION.
const handheld = { role: 'effector', kind: 'jammer', model: 'jammer', fire: 'jam', networked: false, handheld: true, beam: 30, mount: 1.5, mobile: 'manpack', shotCost: 0, health: 15, signature: 0.8, emits: [], slow: 0.5, killTime: 5,
  sapient: { nodeType: 'NODE_TYPE_JAMMER', subType: ['RF', 'GNSS'], scan: 'SCAN_TYPE_STEERABLE', modes: ['Standby', 'Jam'] } };

export const CREW_SYSTEMS = {
  gun_s: {
    ...crewGun, product: 'L7A2 general purpose machine gun on a vehicle pintle', size: 'S', name: 'Small gun', short: 'GPM', cost: 20000, shotCost: 25, color: 0xffcc80, published: 600,
    pk: 0.08, rangeLoss: 0.75, damage: 40, cooldown: 1.5, missileSpeed: 840, magazine: 8, storage: 32, reloadTime: 20,
    desc: 'A 7.62 mm machine gun on a pickup, fired by its gunner at drones in sight. Not networked: nothing cues it. Cheap and short-ranged.',
    ref: {
      class: 'Crew-served 7.62 mm machine gun', analogues: ['L7A2 GPMG', 'FN MAG'],
      published: 'The British Army gives 800 m in the light role and 1,800 m on a tripod, at 750 rounds a minute, from 100-round belts. No figure is published for air targets. Mobile fire groups in Ukraine down many Shaheds with machine guns, but they are poor above about 2 km up.',
      basis: 'Hit chance 0.08 a burst, a 25-round burst a shot and game range 600 m, below the ground figures, are ASSUMPTIONS. Its chance falls to a quarter of that at its limit (rangeLoss), as a gun’s spread grows with distance and its rounds have no airburst to make up for it: an ASSUMPTION.',
      confidence: 'Army figures for ground fire; air performance is an assumption', sources: MG_SOURCES,
      cost: { capex: 'No price used. Game price $20,000 for the gun and its mount, and $25 a burst, are placeholders.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  gun_50: {
    ...crewGun, product: 'L111A1 heavy machine gun (12.7 mm) on a vehicle pintle', variantOf: 'gun_s', size: 'S', name: 'Crewed .50 cal', short: 'L11', cost: 40000, shotCost: 150, color: 0xffb74d, published: 1000,
    pk: 0.12, rangeLoss: 0.75, damage: 60, cooldown: 1.5, missileSpeed: 890, magazine: 6, storage: 24, reloadTime: 25,
    desc: 'A .50 cal on a pickup or a Land Rover, fired by its gunner. Not networked. It outranges the GPMG, and a hit does more.',
    ref: {
      class: 'Crew-served 12.7 mm machine gun', analogues: ['L111A1 (Browning M2)'],
      published: 'The British Army gives 2,000 m against ground targets, at 485 to 635 rounds a minute, from 50-round belts. Heavy machine guns are reported as the most effective guns of Ukraine’s mobile fire groups, which were credited with up to 80% of Shahed kills at one point and about 20 to 40% in later estimates.',
      basis: 'Hit chance 0.12 a burst, a 20-round burst a shot and game range 1 km are ASSUMPTIONS. Its chance falls to a quarter of that at its limit (rangeLoss), as a gun’s spread grows with distance and its rounds have no airburst to make up for it: an ASSUMPTION.',
      confidence: 'Army figures for ground fire; air performance is an assumption', sources: MG_SOURCES,
      cost: { capex: 'Game price $40,000 for the gun and its mount, and $150 a burst, are placeholders.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  jammer_mk4: {
    ...handheld, product: 'DroneShield DroneGun Mk4', variantOf: 'jammer_s', size: 'S', name: 'DroneGun Mk4', short: 'DG4', cost: 30000, color: 0xce93d8, published: 1000,
    bands: ['control900', 'control24', 'video58', 'gnss'],
    desc: 'A handheld jammer gun carried by a soldier, aimed at a drone in sight. Not networked.',
    ref: {
      class: 'Handheld RF jammer', analogues: ['DroneShield DroneGun Mk4'],
      published: 'DroneShield gives the ISM bands and GNSS, 3.2 kg with its battery and over an hour of use. It does not state a range; a retailer gives 1 km.',
      basis: 'Game range 1 km is the retailer figure, NOT VERIFIED. Its beam is an ASSUMED 30°, aimed at the drone the soldier is jamming.',
      confidence: 'Maker and retailer figures', sources: [{ label: 'Janes: DroneShield launches DroneGun Mk4', url: 'https://www.janes.com/defence-news/news-detail/droneshield-launches-dronegun-mk4' }],
      cost: { capex: 'No price published. Game price $30,000 is a placeholder.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  jammer_skywiper: {
    ...handheld, product: 'NT Service EDM4S SkyWiper', variantOf: 'jammer', size: 'M', name: 'SkyWiper', short: 'SKW', cost: 25000, color: 0xba68c8, published: 3000,
    bands: ['control900', 'control24', 'video58', 'gnss'],
    desc: 'A Lithuanian handheld jammer, widely given to Ukraine, carried by a soldier. Not networked.',
    ref: {
      class: 'Handheld RF jammer', analogues: ['NT Service EDM4S SkyWiper'],
      published: 'Reported at 3 to 5 km, 10 W on each of 2.4 and 5.8 GHz with GNSS and 433 or 900 MHz options (sources differ), 5.5 kg, up to an hour. The US Army sought 100.',
      basis: 'Game range 3 km is the low end of the reported range. Its beam is an ASSUMED 30°, aimed at the drone the soldier is jamming.',
      confidence: 'Encyclopaedia and press figures', sources: [{ label: 'Wikipedia: EDM4S', url: 'https://en.wikipedia.org/wiki/EDM4S' }],
      cost: { capex: 'No price found. Game price $25,000 is a placeholder.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  jammer_kvertus: {
    ...handheld, product: 'Kvertus AD G-6+', variantOf: 'jammer', size: 'M', name: 'Kvertus G-6', short: 'KVG', cost: 15000, color: 0xab47bc, published: 1500,
    bands: ['control900', 'control24', 'video58', 'gnss'],
    desc: 'A Ukrainian handheld jammer covering every common drone band, carried by a soldier. Not networked.',
    ref: {
      class: 'Handheld RF jammer', analogues: ['Kvertus AD G-6+'],
      published: 'Seller figures: 433 and 850 to 940 MHz, 1.2, 1.5 to 1.6, 2.4 and 5.8 GHz, a 30° beam, 6.5 kg, and 1.5 km (another page says 3.5 km).',
      basis: 'Game range 1.5 km is the lower figure. Its 30° beam is aimed at the drone the soldier is jamming.',
      confidence: 'Seller figures that conflict', sources: [{ label: 'Flash Army: Kvertus AD G-6+', url: 'https://flasharmy.com.ua/en/kvertus-ad-g-6-plus' }],
      cost: { capex: 'No price used. Game price $15,000 is a placeholder.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  jammer_dgmk3: {
    ...handheld, product: 'DroneShield DroneGun MkIII', variantOf: 'jammer_s', size: 'S', name: 'DroneGun MkIII', short: 'DG3', cost: 40000, color: 0xd1c4e9, published: 500,
    bands: ['control900', 'control24', 'video58'],
    desc: 'A small handheld jammer pistol carried by a soldier, aimed at a drone in sight. Not networked.',
    ref: {
      class: 'Handheld RF jammer', analogues: ['DroneShield DroneGun MkIII'],
      published: 'Effective range up to 500 m. 433 and 915 MHz, 2.4 and 5.8 GHz, with GNSS as an option. An operator manual lists up to 1,000 m in rural conditions.',
      basis: 'Game range is the 500 m launch figure. Its beam is an ASSUMED 30°, aimed at the drone the soldier is jamming.',
      confidence: 'Vendor figures; the manual conflicts',
      sources: [
        { label: 'DroneShield: 2019 specification', url: 'https://www.asx.com.au/asxpdf/20190715/pdf/446lzqk0qszn9n.pdf' },
        { label: 'DroneShield: DroneGun Mk3', url: 'https://droneshield.com/c-uas-products/dronegun-mk3' },
      ],
      cost: { capex: 'A comparison site lists the MkIII at $30,000 to $50,000. DroneShield publishes no price. Game price $40,000.', confidence: 'Secondary source', sources: [{ label: 'Aviations UK: DroneGun Tactical vs Dedrone RF', url: 'https://aviationsouk.com/compare-products/dedrone-dedronesensors-rf-rf-160-rf-360-vs-droneshield-dronegun-tactical/' }] },
    },
  },
  jammer_dgtac: {
    ...handheld, product: 'DroneShield DroneGun Tactical', variantOf: 'jammer', size: 'M', name: 'DroneGun Tactical', short: 'DGT', cost: 60000, color: 0x9575cd, published: 1000,
    bands: ['control900', 'control24', 'video58'],
    desc: 'A rifle-shaped handheld jammer carried by a soldier, aimed at a drone in sight. Not networked.',
    ref: {
      class: 'Handheld RF jammer', analogues: ['DroneShield DroneGun Tactical'],
      published: 'Up to about 1 km effective (older or promotional figures say 2 km). 433 and 915 MHz, 2.4 and 5.8 GHz, with GNSS as an option; 6.8 to 7.3 kg.',
      basis: 'Game range is the 1 km figure. Its beam is an ASSUMED 30°, aimed at the drone the soldier is jamming.',
      confidence: 'Vendor claims; figures conflict across sources',
      sources: [
        { label: 'DroneDJ: DroneGun Tactical', url: 'https://dronedj.com/2021/06/23/dronegun-tactical-jammer-provides-powerful-but-flexible-anti-uav-neutralization/' },
        { label: 'Athlon Outdoors: DroneGun Tactical', url: 'https://athlonoutdoors.com/article/dronegun-tactical-anti-drone-gun/' },
      ],
      cost: { capex: 'A comparison site lists DroneGun Tactical at $50,000 to $80,000; DroneShield publishes no price. Game price $60,000.', confidence: 'Secondary sources; figures conflict', sources: [{ label: 'Aviations UK: DroneGun Tactical vs Dedrone RF', url: 'https://aviationsouk.com/compare-products/dedrone-dedronesensors-rf-rf-160-rf-360-vs-droneshield-dronegun-tactical/' }] },
    },
  },
};
