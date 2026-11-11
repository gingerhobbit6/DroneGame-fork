// Systems added from the field and from British, Danish and Australian industry: a 12-gauge shotgun, a rifle firing Drone Round
// anti-drone ammunition, DroneShield's wearable RfPatrol detector, a handheld detector that receives a first-person-view drone's video, the Overview PodView camera, the Weibel XENTA-M5 radar and the
// Kvertus VEPR M100 dome jammer. Costs are in US dollars, as everywhere in the config. Each `ref` says where its numbers come from, and
// every figure no source gives is marked ASSUMPTION.

// A soldier with a shotgun fires at the nearest drone in sight, off the network, as a machine gunner does (sim/crew.js). One shot is one
// cartridge, its chance of a hit falling with range as the shot spreads. Shot is light, so a hit wrecks a small drone and barely marks
// a large one (damage against a drone's hp in drones.js).
const shotgun = {
  role: 'effector', kind: 'gun', model: 'gun', fire: 'guided', networked: false, handheld: true, mobile: 'manpack', mount: 1.5,
  health: 15, signature: 0, emits: [], muzzleY: 1.4, splash: 0, fuze: 1, rangeLoss: 0.75, missileSpeed: 400,
  cooldown: 0.5, magazine: 8, storage: 40, reloadTime: 8,
  sapient: { nodeType: 'NODE_TYPE_KINETIC', subType: ['Gun'], scan: 'SCAN_TYPE_STEERABLE' },
};

const SHOTGUN_SOURCES = [
  { label: 'Armada International: shotguns fill the infantry counter-drone role', url: 'https://armadainternational.com/?p=23813' },
  { label: 'Defense News: European gun makers trial small arms as drone stoppers', url: 'https://www.defensenews.com/global/europe/2024/06/24/european-gun-makers-trial-small-arms-as-drone-stoppers/' },
  { label: 'RWS: Rottweil anti-drone extended range, hard lead No. 3', url: 'https://www.rws-technology.com/en/armed-forces-law-enforcement/product/12-70-rottweil-anti-drone-extended-range-hard-lead-no-3' },
  { label: 'Primetake: DB-5 12-gauge counter-drone round', url: 'https://www.primetake.com/wp-content/uploads/sites/5/2019/11/01.07.4525.pdf' },
  { label: 'The Firearm Blog: Drone Round multi-projectile anti-drone ammunition', url: 'https://cdn-fastly.thefirearmblog.com/blog/shot-2026-drone-round-defense-multi-projectile-anti-drone-ammo-44825920' },
];

export const FIELD_SYSTEMS = {
  gun_shotgun: {
    ...shotgun, product: '12-gauge pump or semi-automatic shotgun, birdshot', variantOf: 'gun_s', size: 'S', name: 'Shotgun', short: 'SG', cost: 1500, shotCost: 1, color: 0xffe0b2, published: 40,
    pk: 0.25, damage: 25,
    desc: 'A soldier with a 12-gauge shotgun and ordinary birdshot: the last line against a first-person-view drone that gets close. Not networked, and only reaches a few tens of metres.',
    ref: {
      class: 'Shotgun carried by a soldier, ordinary shot',
      analogues: ['Benelli M4', 'any 12-gauge with hunting shot'],
      published: 'A standard shotgun’s effective range against small aerial targets is put at about 30 to 50 m, and hunting rounds have been cited at 30 to 45 m against first-person-view drones in Ukraine.',
      basis: 'Game range 40 m is the middle of those figures. Hit chance 0.25 a cartridge at close range, falling to a quarter of that at 40 m (rangeLoss), and 25 damage a hit (enough for a 20 hp first-person-view drone) are ASSUMPTIONS. Eight in the tube, 40 carried and 8 s to reload are ASSUMPTIONS.',
      confidence: 'Reported ranges; hit chance is an assumption',
      sources: SHOTGUN_SOURCES,
      cost: { capex: 'No price used. Game prices of $1,500 for the gun and $1 a cartridge are placeholders.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  gun_droneround: {
    ...shotgun, product: '5.56 mm rifle firing Drone Round L Variant', variantOf: 'gun_s', size: 'S', name: 'Rifle, Drone Round', short: 'DRR', cost: 1200, shotCost: 3, color: 0xffcc80, published: 100,
    pk: 0.15, damage: 30, missileSpeed: 670, cooldown: 0.3, magazine: 30, storage: 210, reloadTime: 4,
    desc: 'A soldier’s standard rifle firing Drone Round, a 5.56 mm cartridge that splits into five projectiles after it leaves the barrel, so a rifleman fires a small spread of shot at a drone. Off the network, and good to about 100 m.',
    ref: {
      class: 'Rifle carried by a soldier, multi-projectile anti-drone rounds',
      analogues: ['Drone Round L Variant, 5.56x45 mm, from an M4 or M27'],
      published: 'Drone Round: 5.56x45 mm, 2,200 ft/s; the L Variant fires 5 projectiles and is effective to 100 m, the K Variant 8 projectiles to 50 m. 7.62x51 mm versions are in testing. It fires from magazine-fed and belt-fed rifles, full-auto and suppressed. The maker gives no hit chance, spread or price, and sells only to the military, police and authorised security. Press reports: the US Marine Corps has bought 400,000 rounds for its M4 and M27 rifles, and Army units have trained with it against FPV drones.',
      basis: 'Game range 100 m and muzzle speed 670 m/s (2,200 ft/s) are the L Variant figures. Hit chance 0.15 a round, falling to a quarter at 100 m (rangeLoss), and 30 damage a hit, enough for a first-person-view drone, are ASSUMPTIONS: five projectiles from a rifle against a small fast drone. A 30-round magazine, 7 carried and 4 s to change one are a rifleman’s standard load.',
      confidence: 'Maker figures for range and speed; hit chance is an assumption',
      sources: [
        { label: 'Drone Round: product information', url: 'https://dronerounddefense.com/product-information/' },
        { label: 'Drone Round: home', url: 'https://dronerounddefense.com/' },
        { label: 'Military Times: the company supplying Marines with anti-drone ammo', url: 'https://militarytimes.com/news/your-military/2026/08/03/meet-drone-round-the-company-supplying-marines-with-anti-drone-ammo' },
        { label: 'TWZ: anti-drone 5.56 mm rounds sought by the Marines', url: 'https://www.twz.com/land/anti-drone-5-56mm-rifle-rounds-the-break-into-multiple-projectiles-sought-by-marines' },
      ],
      cost: { capex: 'No price is published. Game prices of $1,200 for the rifle and $3 a round are placeholders.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },

  rf_rfpatrol: {
    product: 'DroneShield RfPatrol Mk2', variantOf: 'rf_s', size: 'S', name: 'RfPatrol Mk2', short: 'RFP', model: 'rf', modelScale: 0.6, cost: 15000, shotCost: 0, color: 0x80cbc4, role: 'sensor', kind: 'rf', published: 2000, mount: 1.5, mobile: 'manpack', handheld: true, senses: 'rf', falseAlarm: 0.06,
    health: 15, signature: 0.05, emits: [], listens: [[0.433, 0.435], [0.902, 0.928], [2.4, 2.4835], [5.725, 5.875]], // the common drone bands: ASSUMED, none published
    library: 'commercial', sensitivity: -85, df: 'sector',
    desc: 'A body-worn passive RF detector from DroneShield. It warns its wearer by sound, vibration and light when a drone’s radio is near, and names the drone type, but gives no real bearing. Networked here over the soldier’s radio.',
    sapient: {
      nodeType: 'NODE_TYPE_PASSIVE_RF', subType: ['Detection', 'C-UAS'], scan: 'SCAN_TYPE_FIXED', interval: 1,
      noise: { az: 30 }, signal: true,
    },
    ref: {
      class: 'Wearable passive RF drone detector',
      analogues: ['DroneShield RfPatrol Mk2'],
      published: 'DroneShield: completely passive and non-emitting, worn on the body; visual, haptic and audible alerts; Stealth and Glimpse modes; 800 g without its battery, 1.2 kg with it; 157 x 92 x 51 mm. Up to 1 km in urban areas and 4 km in rural ones, with detection in under 5 s (one report gives these for the earlier MkII). DroneShield does not list its bands.',
      basis: 'Game range 2 km is an ASSESSMENT between the 1 km urban and 4 km rural figures, as the game takes off losses to terrain and trees itself. Its bands (433 and 915 MHz, 2.4 and 5.8 GHz), the commercial library, the ±30° bearing and reporting over the soldier’s radio are ASSUMPTIONS.',
      confidence: 'Maker figures; range figures may be the earlier model’s',
      sources: [
        { label: 'DroneShield: RfPatrol Mk2', url: 'https://www.droneshield.com/rfpatrol-mk2' },
        { label: 'Defence Connect: DroneShield releases its Mk II detection device', url: 'https://www.defenceconnect.com.au/joint-capabilities/5991-droneshield-releases-mk-ii-drone-detection-device' },
        { label: 'Aviations UK: RfPatrol Mk2', url: 'https://aviationsouk.com/products/droneshield-rfpatrol-mk2/' },
      ],
      cost: { capex: 'No public price. Game price $15,000 is a placeholder.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },

  rf_chuyka: {
    product: 'BlueBird Chuyka 3.0', variantOf: 'rf_s', size: 'S', name: 'Chuyka 3.0 FPV video detector', short: 'CHK', model: 'rf', modelScale: 0.6, cost: 584, shotCost: 0, color: 0xa5d6a7, role: 'sensor', kind: 'rf', published: 5300, mount: 1.5, mobile: 'manpack', handheld: true, senses: 'rf', falseAlarm: 0.08,
    health: 15, signature: 0.05, emits: [], listens: [[1.08, 1.8], [3.0, 4.1], [4.9, 6.1]], // its three scanned bands: analogue video only
    library: 'hobby', sensitivity: -85, df: 'sector',
    desc: 'A pocket receiver that finds a first-person-view drone’s analogue video and shows its picture, so a soldier sees what the pilot sees and knows it is coming. It hears video only: not control links, and not digital or fibre-optic drones.',
    sapient: {
      nodeType: 'NODE_TYPE_PASSIVE_RF', subType: ['Detection', 'C-UAS'], scan: 'SCAN_TYPE_FIXED', interval: 2,
      noise: { az: 30 }, signal: true,
    },
    ref: {
      class: 'Handheld first-person-view video receiver',
      analogues: ['BlueBird Chuyka 3.0', 'Stinex ZORKO', 'D-Vision SDR'],
      published: 'BlueBird: analogue video at about 1.2, 3.3 and 5.8 GHz (a retailer gives 1,080 to 1,800, 3,000 to 4,100 and 4,900 to 6,100 MHz), a full scan in 4 to 8 s, and up to 4 km depending on conditions, antenna and the drone’s signal. It shows the drone’s video and sounds an alert that grows louder as the drone nears. Press reports: about 95% of common FPV video signals, and fielded in 2025. It cannot see digital video, to which Russian drones are moving.',
      basis: 'Game range 5.3 km is set so that a first-person-view drone’s 5.8 GHz video, which the game hears at 0.75 of a detector’s quoted range (rf-model.js), is heard at the 4 km published. It hears nothing on control bands. It gives no real bearing, only signal strength, so it takes the game’s coarsest, ±30°. It is taken to report over the soldier’s radio, and to name the drone as FPV from its picture (the hobby library): both ASSUMPTIONS. Its 4 to 8 s scan is read as a report every 2 s.',
      confidence: 'Maker figures',
      sources: [
        { label: 'BlueBird: Chuyka 3.0', url: 'https://www.blue-bird.tech/en/products/chuyka-3-0/' },
        { label: 'Flash Army: Chuyka 3.0 bands', url: 'https://flasharmy.com.ua/en/chujka-3-0-ot-bluebird' },
        { label: 'Ukrainska Pravda: Chuika 3.0 intercepts FPV feeds', url: 'https://www.pravda.com.ua/eng/news/2025/05/28/7514494' },
        { label: 'Militarnyi: Chuyka 3.0 video signal detector', url: 'https://militarnyi.com/en/news/ukraine-develops-chuyka-3-0-drone-video-signal-detector/' },
        { label: 'Defense News: receivers that intercept drone feeds', url: 'https://www.defensenews.com/?p=87434' },
      ],
      cost: {
        capex: 'BlueBird lists it at $584 without VAT ($701 with). Ukrainian reports give UAH 24,700 and later UAH 30,840. Game price $584.',
        confidence: 'Maker price',
        sources: [{ label: 'BlueBird: Chuyka 3.0', url: 'https://www.blue-bird.tech/en/products/bluebirds-chuyka-3-0-electronic-intelligence-device-5-8-ghz-3-3-ghz-1-2-ghz/' }],
      },
    },
  },

  camera_podview: {
    product: 'Overview PodView2600', variantOf: 'camera', size: 'L', name: 'PodView2600', short: 'POD', model: 'camera', cost: 40000, shotCost: 0, color: 0x90a4ae, role: 'sensor', kind: 'camera', published: 1900, mount: 6, mobile: 'vehicle', falseAlarm: 0.02,
    health: 30, signature: 0.05, emits: [],
    fov: 10, trackFov: 1.2, slewRate: 720, searchRate: 30, dwell: 2,
    channels: 'both', pixels: 'fhd', fnumber: 2, ir: 'lwir', pitch: 12, rangefinder: 'yes',
    desc: 'A British stabilised camera pod with a 4K zoom camera, thermal imager and laser rangefinder, and onboard AI that finds and tracks drones by itself. It turns at up to 720°/s and speaks SAPIENT.',
    sapient: {
      nodeType: 'NODE_TYPE_CAMERA', subType: ['EO/IR', 'C-UAS'], scan: 'SCAN_TYPE_STEERABLE', interval: 0.5,
      noise: { az: 0.03, el: 0.03 }, modes: ['Search', 'Track'],
    },
    ref: {
      class: 'Stabilised EO/IR sensor pod with edge AI',
      analogues: ['Overview PodView2600'],
      published: 'Overview: 4K visible camera with 50x zoom, LWIR thermal imager, laser rangefinder, GPS and IMU; pan and tilt 0.05 to 720°/s with continuous 360° rotation; preset accuracy better than 0.01°; NVIDIA Jetson Orin AGX running AI detection, classification and tracking; mechanical and electronic stabilisation; IP68; SAPIENT, ONVIF profile S and TAK. Marketed for C-UAS and force protection. No detection range or price is published.',
      basis: 'Game range 1.9 km is calculated by the rule used for the other cameras, a 0.35 m drone covering 4 pixels, for 3,840 pixels across the 10° search view. The game’s camera settings top out at 1,920 pixels, so choosing a smaller sensor lowers it from there. The 1.2° track view (about what a 50x zoom gives), the 10° search view, the 6 m mast, the lower false alarm rate for its AI and the bearing accuracy are ASSUMPTIONS. Its laser rangefinder is fitted, so a cued PodView measures range and can start a track by itself.',
      confidence: 'Maker figures; range is calculated',
      sources: [
        { label: 'Overview: PodView family', url: 'https://overview.co.uk/product/podview-family/' },
        { label: 'Overview: PodView2600 flyer', url: 'https://overview.co.uk/wp-content/uploads/2026/10/Overview_ODD00648_Flyer_PodView2600_Iss03_102026_lr.pdf' },
      ],
      cost: { capex: 'Price given by the user: £30,000, which is $40,000 at the game’s £0.75 to the dollar.', confidence: 'User figure', sources: [] },
    },
  },

  camera_spyke: {
    product: 'Quell SPYKE', variantOf: 'camera', size: 'L', name: 'SPYKE array camera', short: 'SPK', model: 'camera', cost: 400000, shotCost: 0, color: 0x9fa8da, role: 'sensor', kind: 'camera', published: 1800, mount: 3, mobile: 'vehicle', falseAlarm: 0.03,
    health: 25, signature: 0.05, emits: [], channels: 'visible',
    stare: true, arc: 79, elevation: 57, locators: 6, // a fixed wide view that needs no cue, and six locating cameras inside it
    desc: 'A Scottish staring camera: an array of cameras watches a wide 79° by 57° view all the time, so it needs no cue, and six mirror-steered locating cameras inside it fix up to six drones at once. Daylight only. It gives bearings, not range, and speaks SAPIENT.',
    sapient: {
      nodeType: 'NODE_TYPE_CAMERA', subType: ['EO', 'C-UAS'], scan: 'SCAN_TYPE_FIXED', interval: 0.5,
      noise: { az: 0.05, el: 0.05 }, modes: ['Search'],
    },
    ref: {
      class: 'Staring electro-optical drone detector with steered locating cameras',
      analogues: ['Quell SPYKE'],
      published: 'Quell: detects a DJI Mini 3 Pro (251 x 362 x 70 mm) at 1.3 km, a DJI Matrice 300 RTK (810 x 670 x 430 mm) at 2.6 km and a QinetiQ Banshee (2,840 x 2,490 x 860 mm) at 8 km; coverage 79° x 57°; 270 x 290 x 170 mm; 5.9 kg; static and on the move; set up in 60 s; electro-optical; 50 W, battery operated; Drone ID, SAPIENT and TAK.',
      basis: 'Game range 1.8 km for the 0.35 m reference drone is the Mini 3 Pro figure scaled by size (1.3 km x 0.35 / 0.25). The game scales a camera’s reach in proportion to a drone’s size, so it gives the larger drones more than Quell does (about 4 km for a Matrice 300, against 2.6 km): an ASSUMPTION that favours it against big drones. The six locating cameras are modelled as a limit of six drones located per look, each to 0.05° (ASSUMED). Visible light only, as the maker says electro-optical; the 3 m mount and false alarm rate are ASSUMPTIONS.',
      confidence: 'Maker figures; locating accuracy is an assumption',
      sources: [{ label: 'Quell: SPYKE', url: 'https://quell.scot/spyke/' }],
      cost: { capex: 'Price given by the user: £300,000, which is $400,000 at the game’s £0.75 to the dollar.', confidence: 'User figure', sources: [] },
    },
  },

  radar_xenta: {
    product: 'Weibel XENTA-M5', variantOf: 'radar', size: 'L', name: 'XENTA-M5', short: 'XM5', model: 'radar', cost: 3000000, shotCost: 0, color: 0x2962ff, role: 'sensor', kind: 'radar', published: 10000, mount: 6, mobile: 'vehicle', falseAlarm: 0.08,
    health: 40, signature: 2.0, emits: [{ label: 'X-band radar', f: [[8.5, 10.5]] }],
    lowAlt: 30, lowRange: 800,
    elevation: 60,
    desc: 'Danish X-band Doppler air defence radar, bought by Denmark’s army and for Poland’s SAN counter-drone programme. It sees all round and far, and tells drones from birds and aircraft.',
    sapient: {
      nodeType: 'NODE_TYPE_RADAR', subType: ['Doppler', 'C-UAS'], scan: 'SCAN_TYPE_SCANNING', interval: 1,
      noise: { az: 0.3, el: 0.5, range: 5 }, velocity: true,
    },
    ref: {
      class: 'Short-range air defence and counter-drone radar',
      analogues: ['Weibel XENTA-M5'],
      published: 'Weibel: XENTA-M5 instrumented range 75 km, 240 W from solid-state GaN (the M3 has 120 W and 60 km), 60° elevation cover. Weibel gives no drone range for the M5. Its civil XENTA-C radars classify small drones at up to 5 km (low power) or 10 km (high power), and detect a DJI Phantom 4 beyond 7 km. Denmark ordered four for its 1st Brigade; Poland signed €84 million (DKK 625 million) for SAN, with no quantity given.',
      basis: 'Game range 10 km is an ASSESSMENT: the high-power XENTA-C figure for small drones, for a military radar with twice the M3’s power. All-round cover and the 60° elevation are as published. The X band, accuracy, low-flyer clutter and 6 m vehicle mast are ASSUMPTIONS.',
      confidence: 'Maker figures for the M5; its drone range is taken from its civil sister',
      sources: [
        { label: 'Weibel: XENTA-M brochure', url: 'https://www.weibelradars.com/wp-content/uploads/2026/01/XENTA-M-Brochure.pdf' },
        { label: 'Weibel: XENTA-C counter-UAS brochure', url: 'https://www.weibelradars.com/wp-content/uploads/2026/01/XENTA-C-UAS-Brochure.pdf' },
        { label: 'Janes: four XENTA-M5 for Denmark’s 1st Brigade', url: 'https://www.janes.com/defence-intelligence-insights/defence-news/c4isr/weibel-scientific-to-deliver-four-xenta-m5-radar-systems-to-1st-brigade-of-danish-army' },
        { label: 'Defence Industry Europe: XENTA-M5 for Poland’s SAN', url: 'https://defence-industry.eu/weibel-to-supply-xenta-m5-radars-for-polands-san-integrated-counter-drone-programme/' },
      ],
      cost: { capex: 'No unit price: the Polish contract gives no quantity. Game price $3,000,000 is a placeholder.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },

  jammer_vepr: {
    product: 'Kvertus AD VEPR M100', variantOf: 'jammer_l', size: 'L', name: 'Kvertus VEPR M100', short: 'VPR', model: 'jammer', cost: 30000, shotCost: 0, color: 0x8e24aa, role: 'effector', kind: 'jammer', published: 3000, mount: 9, fire: 'jam',
    health: 30, signature: 2.5, emits: [], bands: ['control900', 'control24', 'video58', 'gnss'], slow: 0.5, killTime: 5,
    desc: 'A Ukrainian dome jammer on a mast or a vehicle, throwing a jamming field all round a position. Networked here, so the fusion node switches it on when tracks come in reach. Autonomous and fibre-optic drones ignore it.',
    sapient: { nodeType: 'NODE_TYPE_JAMMER', subType: ['RF', 'GNSS'], scan: 'SCAN_TYPE_FIXED', modes: ['Standby', 'Jam'] },
    ref: {
      class: 'Dome RF jammer',
      analogues: ['Kvertus AD VEPR M100'],
      published: 'Retailer: an enhanced VEPR M50 for 420 to 5,900 MHz, on a fixed mast or a vehicle; 4 modules of 100 W each and up to 3 km depending on conditions. A counter-FPV version covers 420 to 2,500 MHz, and a GPS version gives 100 W a channel and 24 hours of continuous running.',
      basis: 'Game range is the 3 km published. Its bands are read from 420 to 5,900 MHz, which take in 900 MHz and 2.4 GHz control, GNSS and most of the 5.8 GHz video band. Networking it to the fusion node is an ASSUMPTION: the game switches site jammers on only while tracks are in range, where a dome is often left on.',
      confidence: 'Retailer figures',
      sources: [
        { label: 'Flash Army: Kvertus AD VEPR M100', url: 'https://flasharmy.com.ua/en/kvertus-ad-vepr-m100' },
        { label: 'Flash Army: VEPR M100 Counter FPV', url: 'https://flasharmy.com.ua/en/kvertus-ad-vepr-m100-counter-fpv' },
        { label: 'Flash Army: VEPR M100 GPS', url: 'https://flasharmy.com.ua/en/kvertus-ad-vepr-m100-gps' },
      ],
      cost: { capex: 'No price found. Game price $30,000 is a placeholder, well below Western site jammers, as Ukrainian kit is.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
};
