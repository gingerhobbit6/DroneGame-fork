// The sensors you can buy. Radar, RF detector, camera and acoustic sensor each come in three sizes, with the medium one first, and `variantOf`
// marks a further real system of a size. `product` is the name the toolbar lists it by.
// Costs are in US dollars, and each system's `ref` says where its numbers come from. Prices marked ASSUMPTION had no verified public figure.
// `mount` is how high a sensor sits on its mast (m), an assumption: below the 12-20 m tree tops, trees hide most low flyers. RF systems default to 9 m.
// RF ranges are for a clear path. Terrain and trees are applied on top, from the map, so these figures must not also allow for them.
// RF link budget used to check them, an assumption: a small FPV sends 25 dBm at 5.8 GHz, where path loss is 107.7 + 20 log10(km) dB.
export const SENSORS = {
  radar: {
    product: 'Robin Radar IRIS', size: 'M', name: 'Medium radar', short: 'RDR', cost: 900000, shotCost: 0, color: 0x2962ff, role: 'sensor', kind: 'radar', published: 3100, mount: 25, falseAlarm: 0.1, // chance of a false alarm per scan
    health: 30, signature: 1.0, emits: [{ label: 'X-band radar (assumed 9.2\u20139.5 GHz)', f: [[9.2, 9.5]] }], // radar band: assumption
    lowAlt: 40, lowRange: 500, // targets below lowAlt (m) are only seen inside lowRange (m): ground clutter (game rule)
    elevation: 60, // degrees of elevation it covers (sensor-model.js). A rotating radar has no arc: it sees all round
    microDoppler: 'yes', // tells a multirotor from a fixed wing close in (sensor-model.js)
    desc: 'Medium-range surveillance radar. Range, bearing and velocity. Low flyers hide in ground clutter until close.',
    sapient: {
      nodeType: 'NODE_TYPE_RADAR', subType: ['Surveillance', 'C-UAS'], scan: 'SCAN_TYPE_SCANNING', interval: 1,
      noise: { az: 0.6, el: 1.2, range: 8 }, velocity: true,
      status: { type: 'STATUS_TYPE_CLUTTER', value: 'Targets below 40 m masked beyond 500 m' },
    },
    ref: {
      class: 'Counter-UAS surveillance radar, medium range',
      analogues: ['Robin Radar IRIS'],
      published: 'IRIS datasheet, from real-life testing in typical conditions: 1.1 km against a 0.25 kg drone, 3.1 km against 0.9 kg, 3.7 to 4 km against 2.9 kg (the sheets differ) and 7.6 km against 52 kg. Its instrumented range is 5 km, or 12 km in Long-Range Mode.',
      basis: 'Game range is the 3.1 km figure, because 0.9 kg is closest to the game\u2019s small FPV. The 5 and 12 km are how far it can display, not how far it sees a small drone. It rotates, so it sees all round; the 60\u00B0 of elevation it covers is an ASSUMPTION. Robin Radar says it classifies drones by micro-Doppler with a neural network; that it names multirotor or fixed wing inside half its reach is an ASSUMPTION.',
      confidence: 'Manufacturer\u2019s test figures, not independently checked',
      sources: [
        { label: 'Robin Radar: IRIS product sheet, April 2026', url: 'https://www.robinradar.com/hubfs/IRIS%20product%20sheet%20042026.pdf' },
        { label: 'Robin Radar: IRIS datasheet V15.6', url: 'https://www.robinradar.com/hubfs/Iris%20Datasheet%20V15.6_online.pdf' },
        { label: 'EDR Magazine: IRIS long-range module', url: 'https://www.edrmagazine.eu/?p=46182' },
        { label: 'Robin Radar: how the IRIS uses deep neural networks', url: 'https://www.robinradar.com/blog/elevating-drone-detection-how-we-use-deep-neural-networks-dnn-in-the-iris-radar' },
      ],
      cost: {
        capex: 'Robin Radar’s CEO put IRIS at under $1 million per unit (traditional air-defence radars: $20–50 million). Game price $900,000.',
        confidence: 'CEO statement, an upper bound',
        sources: [{ label: 'Defense News: Robin Radar', url: 'https://www.defensenews.com/global/europe/2025/09/24/dutch-radar-firm-robin-turns-bird-spotting-skills-into-drone-defense/' }],
      },
    },
  },
  radar_s: {
    product: 'Echodyne EchoGuard', size: 'S', name: 'Small radar', short: 'RDS', cost: 45000, shotCost: 0, color: 0x82b1ff, role: 'sensor', kind: 'radar', published: 1000, mount: 15, falseAlarm: 0.15,
    health: 30, signature: 0.8, emits: [{ label: 'K-band radar 24.45\u201324.65 GHz', f: [[24.45, 24.65]] }], // published for EchoGuard (US)
    lowAlt: 30, lowRange: 300,
    arc: 120, elevation: 80, // one fixed panel's arc and elevation, in degrees. More panels widen the arc
    desc: 'Small solid-state radar. Cheap and short range, so you can afford several, but each panel only looks through 120\u00B0.',
    sapient: {
      nodeType: 'NODE_TYPE_RADAR', subType: ['Compact', 'C-UAS'], scan: 'SCAN_TYPE_FIXED', interval: 1,
      noise: { az: 1.0, el: 2.0, range: 10 }, velocity: true,
      status: { type: 'STATUS_TYPE_CLUTTER', value: 'Targets below 30 m masked beyond 300 m' },
    },
    ref: {
      class: 'Compact 3D drone-detection radar',
      analogues: ['Echodyne EchoGuard'],
      published: 'About 1 km against a DJI Phantom 4 and 1.4 km against a Matrice 600 (vendor-listed). Each panel covers 120\u00B0 by 80\u00B0.',
      basis: 'Game range is the 1 km Phantom 4 figure. One panel covers 120\u00B0, and three cover all round.',
      confidence: 'Vendor-listed figures',
      sources: [{ label: 'EverythingRF: EchoGuard', url: 'https://everythingrf.com/products/radar-systems/echodyne-corp/1069-2160-echoguard' }],
      cost: {
        capex: 'A 2025 government purchasing schedule reportedly lists EchoGuard at about $45,000; a 2019 article said “upwards of $50,000”. Game price $45,000.',
        confidence: 'Secondary sources; not an official quote',
        sources: [{ label: 'Aviations UK: comparison with price bands', url: 'https://aviationsouk.com/compare-products/droneshield-dronegun-tactical-vs-echodyne-echoshield/' }],
      },
    },
  },
  radar_a800: {
    product: 'Blighter A800', variantOf: 'radar', size: 'M', name: 'Blighter A800', short: 'A80', model: 'radar_s', cost: 600000, shotCost: 0, color: 0x448aff, role: 'sensor', kind: 'radar', published: 3000, mount: 25, falseAlarm: 0.1,
    health: 30, signature: 1.0, emits: [{ label: 'Ku-band radar 15.7\u201317.2 GHz', f: [[15.7, 17.2]] }],
    lowAlt: 40, lowRange: 500,
    arc: 90, elevation: 40,
    desc: '3D multi-mode AESA drone radar. It reaches about as far as the IRIS for less, but each head only looks through a 90\u00B0 cone.',
    sapient: {
      nodeType: 'NODE_TYPE_RADAR', subType: ['Multi-mode', 'C-UAS'], scan: 'SCAN_TYPE_SCANNING', interval: 1,
      noise: { az: 0.6, el: 1.2, range: 8 }, velocity: true,
      status: { type: 'STATUS_TYPE_CLUTTER', value: 'Targets below 40 m masked beyond 500 m' },
    },
    ref: {
      class: 'Counter-UAS surveillance radar, medium range',
      analogues: ['Blighter A800'],
      published: 'Ku band, 15.7\u201317.2 GHz. FMCW Doppler AESA scanning a 90\u00B0 x 40\u00B0 cone, with a 1 s full scan. Up to 3 km against a nano-quadcopter and 7 km against a Class 2 winged drone, assuming ideal mounting over flat terrain. Instrumented range 3.5, 10 or 20 km.',
      basis: 'Game range is the 3 km quadcopter figure, a best case by the maker\u2019s own footnote. Accuracy and clutter are assumptions, copied from the IRIS entry. The 90\u00B0 by 40\u00B0 cone is the published one, and four heads cover all round.',
      confidence: 'Vendor figures',
      sources: [
        { label: 'Blighter: A800', url: 'https://www.blighter.com/products/a800-3d-multi-mode-radar' },
        { label: 'Blighter: A800 Mk 2 datasheet', url: 'https://blighter.com/wp-content/uploads/2025/10/blighter-a800-mk-2-4d-multi-mode-radar-datasheet-bss-4003-MR.pdf' },
      ],
      cost: { capex: 'No public price found. Game price $600,000 is a placeholder.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  radar_l: {
    product: 'Hensoldt Spexer 2000 3D MkIII', size: 'L', name: 'Large radar', short: 'RDL', model: 'radar_s', modelScale: 1.4, cost: 2500000, shotCost: 0, color: 0x0d47a1, role: 'sensor', kind: 'radar', published: 4300, mount: 30, falseAlarm: 0.1,
    health: 30, signature: 1.5, emits: [{ label: 'X-band radar 9.2\u201310 GHz', f: [[9.2, 10]] }],
    lowAlt: 30, lowRange: 800,
    arc: 120, elevation: 60,
    desc: 'Long-range multi-beam radar. It sees furthest and is the most accurate, but it is the most expensive and the easiest for the enemy to find.',
    sapient: {
      nodeType: 'NODE_TYPE_RADAR', subType: ['Air defence', 'C-UAS'], scan: 'SCAN_TYPE_SCANNING', interval: 1,
      noise: { az: 0.3, el: 0.6, range: 5 }, velocity: true,
      status: { type: 'STATUS_TYPE_CLUTTER', value: 'Targets below 30 m masked beyond 800 m' },
    },
    ref: {
      class: 'Long-range air-defence and C-UAS radar',
      analogues: ['Hensoldt Spexer 2000 3D MkIII'],
      published: 'X-band pulse Doppler, 9.2\u201310 GHz. The 40 km instrumented range is for a single beam, and falls to 2.5 km with all 16 beams. The older Spexer 2000 is listed at up to 9 km against a 0.2 m\u00B2 UAV and 36 km against a 5 m\u00B2 low-flying aircraft. No figure for small drones was found for the MkIII.',
      basis: 'Game range 4.3 km is an ASSESSMENT: that 9 km scaled to the 0.01 m\u00B2 reference drone by the radar range equation, which brings a 0.2 m\u00B2 Fixed-wing strike drone back to 9 km. It fits the Giraffe 1X, a comparable radar quoted at about 4 km against the smallest drones. The MkIII is newer, so this may be low. Accuracy and clutter are assumptions. Each panel covers 120\u00B0; its 60\u00B0 of elevation is an ASSUMPTION.',
      confidence: 'Assessed from an older model; no manufacturer figure for small drones',
      sources: [
        { label: 'Quwa: Spexer 2000 detection table', url: 'https://quwa.org/system-profile/profile-hensoldt-spexer-2000-border-surveillance-radar/' },
        { label: 'Raksha Anirveda: Spexer 2000 3D MkIII', url: 'https://raksha-anirveda.com/hensoldt-spexer-2000-3d-mkiii-radar/' },
        { label: 'Hensoldt: Spexer 2000 3D MkIII', url: 'https://www.hensoldt.net/products/spexer-2000-3d-mkiii-land-ground-based-air-defence' },
        { label: 'Armed Conflicts: Spexer detection range', url: 'https://origin.armedconflicts.com/-t289922' },
      ],
      cost: { capex: 'No public unit price found. Game price $2,500,000 is a placeholder.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  rf: {
    product: 'Dedrone RF-360 / RF-160', size: 'M', name: 'Medium RF detector', short: 'RF', cost: 40000, shotCost: 0, color: 0x00e676, role: 'sensor', kind: 'rf', published: 3500, mount: 9, senses: 'rf', falseAlarm: 0.05,
    health: 30, signature: 0.05, emits: [], listens: [[0.07, 6]], // passive
    library: 'commercial', sensitivity: -90, df: 'aoa', // as in its range basis; the library is an assumption (rf-model.js)
    desc: 'Passive RF sensor. Direction finding only (no range). Cannot hear a drone with no radio link.',
    sapient: {
      nodeType: 'NODE_TYPE_PASSIVE_RF', subType: ['Direction finding', 'C-UAS'], scan: 'SCAN_TYPE_FIXED', interval: 1,
      noise: { az: 3 }, signal: true,
    },
    ref: {
      class: 'Passive RF detection / direction-finding sensor',
      analogues: ['Dedrone RF-360 / RF-160', 'Hensoldt Elysion RF DF'],
      published: 'RF-360 datasheet: 2 km line of sight for most drones under normal conditions, and up to 5 km for specific drones under ideal conditions. The RF-160 sheet gives 1.6 km and 5 km.',
      basis: 'Game range 3.5 km is an ASSESSMENT, the middle of 2 and 5 km: "normal conditions" already includes real-world losses, which the game applies itself from terrain and trees. A link budget of 6 dBi gain and -90 dBm sensitivity, both assumed, gives 4.6 km. Drones with no radio emission (fibre-optic FPV, autonomous fixed-wing here) give it nothing to detect.',
      confidence: 'Assessed from a manufacturer datasheet and a link budget',
      sources: [
        { label: 'Dedrone: RF-360 datasheet', url: 'https://l.dedrone.com/hubfs/Downloads%20-%20PDFs/DS_RF360-360T_en_web.pdf' },
        { label: 'Aviations UK: Dedrone RF vs Hensoldt', url: 'https://aviationsouk.com/compare-products/dedrone-dedronesensors-rf-rf-160-rf-360-vs-hensoldt-elysion-c-uas-current-c-uas-family-formerly-xpeller/' },
        { label: 'RF Essentials: counter-drone systems', url: 'https://rfessentials.com/resources/rf-glossary/counter-drone-system/' },
      ],
      cost: {
        capex: 'No reliable public price found for Dedrone RF sensors. Game price $40,000 is a placeholder.',
        confidence: 'ASSUMPTION: tune this yourself',
        sources: [],
      },
    },
  },
  rf_s: {
    product: 'MyDefence Wingman 103/105', size: 'S', name: 'Small RF detector', short: 'RFS', model: 'rf', modelScale: 0.7, cost: 10000, shotCost: 0, color: 0x69f0ae, role: 'sensor', kind: 'rf', published: 2000, mount: 1.5, mobile: 'manpack', senses: 'rf', falseAlarm: 0.08,
    health: 30, signature: 0.05, emits: [], listens: [[2.4, 2.4835], [5.15, 5.925]], // without its optional wideband antenna
    library: 'commercial', sensitivity: -85, df: 'sector',
    desc: 'Wearable passive RF detector. Cheap and short range, and its bearing is only a rough sector, so it warns of a drone more than it locates one.',
    sapient: {
      nodeType: 'NODE_TYPE_PASSIVE_RF', subType: ['Direction finding', 'C-UAS'], scan: 'SCAN_TYPE_FIXED', interval: 1,
      noise: { az: 30 }, signal: true,
    },
    ref: {
      class: 'Wearable passive RF drone detector',
      analogues: ['MyDefence Wingman 103/105'],
      published: 'The maker\u2019s sheet gives up to 6 km and 3 to 5 km effective, depending on line of sight and the RF environment. A Lithuanian evaluation of the 105 reported more than 1 km, depending on conditions. Listings give \u00B130\u00B0 direction finding, and 2.4, 5.2 and 5.8 GHz without an antenna, or 200 MHz\u20136 GHz with one.',
      basis: 'Game range 2 km is an ASSESSMENT from a link budget: 2 dBi gain and -85 dBm sensitivity, both assumed, give 1.6 km at 5.8 GHz and 2.2 km against 20 dBm at 2.4 GHz. It sits above the evaluation\u2019s "more than 1 km" and below the maker\u2019s 3 to 5 km. The bearing error is the listed figure. It is worn, so it stands 1.5 m up.',
      confidence: 'Assessed; a national evaluation found less and the maker claims more',
      sources: [
        { label: 'Danish Parliament: MyDefence specification', url: 'https://ft.dk/samling/20222/almdel/FOU/bilag/136/2737420/index.htm' },
        { label: 'Janes: Lithuania and Wingman', url: 'https://www.janes.com/defence-news/news-detail/lithuania-acquires-wingman-and-watchdog-c-uas-systems' },
        { label: 'Aviations UK: Wingman vs Dedrone RF', url: 'https://aviationsouk.com/compare-products/dedrone-dedronesensors-rf-rf-160-rf-360-vs-mydefence-wingman-103-105-drone-detector/' },
        { label: 'EverythingRF: Wingman 103', url: 'https://www.everythingrf.com/products/cuas-counter-unmanned-aerial-system/mydefence/1075-2458-wingman-103' },
      ],
      cost: { capex: 'No public price found. Game price $10,000 is a placeholder.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  rf_elysion: {
    product: 'Hensoldt Elysion RF DF', variantOf: 'rf', size: 'M', name: 'Elysion RF detector', short: 'ELY', model: 'rf', cost: 30000, shotCost: 0, color: 0x1de9b6, role: 'sensor', kind: 'rf', published: 3500, mount: 9, senses: 'rf', falseAlarm: 0.05,
    health: 30, signature: 0.05, emits: [], listens: [[2.4, 2.4835], [5.15, 5.925]],
    library: 'commercial', sensitivity: -90, df: 'sector',
    desc: 'Passive RF sensor with a rough bearing. It warns of a drone more than it locates one. Cannot hear a drone with no radio link.',
    sapient: {
      nodeType: 'NODE_TYPE_PASSIVE_RF', subType: ['Direction finding', 'C-UAS'], scan: 'SCAN_TYPE_FIXED', interval: 1,
      noise: { az: 30 }, signal: true,
    },
    ref: {
      class: 'Passive RF detection / direction-finding sensor',
      analogues: ['Hensoldt Elysion RF DF'],
      published: 'One catalogue lists \u00B130\u00B0 direction finding and 2.4, 5.2 and 5.8 GHz, and up to 5 km for the older Xpeller. No Hensoldt datasheet was found.',
      basis: 'Game range 3.5 km is an ASSESSMENT, set level with the Dedrone entry because the 5 km listing is the same kind of best case. The bearing and bands are the unverified catalogue figures.',
      confidence: 'One catalogue listing, unverified; range is an assumption',
      sources: [{ label: 'Aviations UK: Hensoldt Elysion', url: 'https://aviationsouk.com/products/hensoldt-elysion-c-uas-current-c-uas-family-formerly-xpeller/' }],
      cost: { capex: 'No public price found. Game price $30,000 is a placeholder.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  rf_l: {
    product: 'Aaronia AARTOS', size: 'L', name: 'Large RF detector', short: 'RFL', model: 'rf', modelScale: 1.4, cost: 400000, shotCost: 0, color: 0x00a152, role: 'sensor', kind: 'rf', published: 14000, mount: 9, senses: 'rf', falseAlarm: 0.03,
    health: 30, signature: 0.05, emits: [], listens: [[0.02, 8]],
    library: 'commercial', sensitivity: -100, df: 'aoa',
    desc: 'Fixed wideband RF detection system. It hears furthest and gives the best bearing, at a much higher price. It still cannot hear a drone with no radio link.',
    sapient: {
      nodeType: 'NODE_TYPE_PASSIVE_RF', subType: ['Direction finding', 'C-UAS'], scan: 'SCAN_TYPE_FIXED', interval: 1,
      noise: { az: 2 }, signal: true,
    },
    ref: {
      class: 'Fixed wideband RF detection and direction-finding system',
      analogues: ['Aaronia AARTOS'],
      published: 'The X9 is listed at 14 km against commercial drones, 40 km with a long-range option and 80 km against military UAVs. The X2 is quoted at about 5 km. Typical tracking accuracy is 1\u00B0 to 3\u00B0. Coverage is quoted as 20 MHz\u20138 GHz, or selectively 400 MHz\u20136 GHz.',
      basis: 'Game range is the 14 km standard listing. A link budget supports it: 12 dBi gain and -100 dBm sensitivity, both assumed for a large directional array, give 23 km at 5.8 GHz. Only a clear path gets that far: on a 9 m mast, tree tops and hills will usually stop it sooner. Bearing is the middle of the 1\u00B0 to 3\u00B0 listed.',
      confidence: 'Vendor listing, checked with a link budget',
      sources: [
        { label: 'EverythingRF: AARTOS X9', url: 'https://everythingrf.com/products/cuas-counter-unmanned-aerial-system/aaronia-ag/1075-281-aartos-x9' },
        { label: 'EDR Magazine: Aaronia AARTOS', url: 'https://www.edrmagazine.eu/landeuro-2025-aaronia-aartos-a-uav-detection-and-neutralisation-system-from-germany' },
        { label: 'Aviations UK: AARTOS DDS', url: 'https://aviationsouk.com/products/aaronia-aartos-dds-drone-detection-system/' },
      ],
      cost: { capex: 'No reliable public price found. Game price $400,000 is a placeholder.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  camera: {
    product: 'Generic EO/IR turret', size: 'M', name: 'Medium EO/IR camera', short: 'EO', cost: 100000, shotCost: 0, color: 0xb0bec5, role: 'sensor', kind: 'camera', published: 650, mount: 15, falseAlarm: 0.03,
    health: 30, signature: 0.05, emits: [], // passive
    // A narrow field of view (degrees, total) that has to be pointed. Idle, it sweeps; the fusion node cues it to
    // radar tracks with a look_at task and it dwells there before moving on. Slew and sweep rates are in deg/s.
    fov: 10, trackFov: 2.5, slewRate: 90, searchRate: 12, dwell: 3,
    channels: 'both', pixels: 'hd', fnumber: 2, // visible and thermal, 1280 pixels across, an f/2 lens: assumptions (camera-model.js)
    ir: 'lwir', pitch: 12, // a long-wave thermal core with 12 µm pixels, as HD cores are: an assumption
    desc: 'Electro-optical / infrared camera. Narrow view that must be cued by another sensor. Bearing and elevation with strong classification, no range.',
    sapient: {
      nodeType: 'NODE_TYPE_CAMERA', subType: ['EO/IR', 'C-UAS'], scan: 'SCAN_TYPE_STEERABLE', interval: 0.5,
      noise: { az: 0.05, el: 0.05 }, modes: ['Search', 'Track'],
    },
    ref: {
      class: 'EO/IR drone-detection camera',
      analogues: ['Multi-sensor C-UAS EO/IR turrets (e.g. as fitted to Hensoldt Elysion)'],
      published: 'An industry source says lower-cost imaging-only EO and long-wave IR systems reach under 1,000 m for drones, and only cooled, zoomed cameras go further. Another gives 200 m to 2 km or more, by sensor and drone size. No manufacturer range found.',
      basis: 'Game range 650 m is calculated by the rule used for the other cameras: a 0.35 m drone covers 4 pixels. This assumes a 1280 pixel sensor across the 10\u00B0 view. It fits "under 1,000 m". It zooms to a 2.5\u00B0 track view on a cue, where it reaches four times as far; that view and the f/2 lens are ASSUMPTIONS.',
      confidence: 'Calculated, with an assumed sensor; fits one industry statement',
      sources: [{ label: 'Military Systems Tech: thermal sensor design (figures as surfaced by search; confirm)', url: 'https://www.militarysystems-tech.com/articles/thermal-infrared-sensor-design' }],
      cost: {
        capex: 'The same source puts these imaging-only detection systems at $50,000–$150,000. Game price $100,000, the midpoint.',
        confidence: 'One industry statement',
        sources: [{ label: 'Military Systems Tech: thermal sensor design (figures as surfaced by search; confirm)', url: 'https://www.militarysystems-tech.com/articles/thermal-infrared-sensor-design' }],
      },
    },
  },
  camera_s: {
    product: 'Teledyne FLIR Boson 640, 36 mm', size: 'S', name: 'Small EO/IR camera', short: 'EOS', model: 'camera', modelScale: 0.7, cost: 25000, shotCost: 0, color: 0xcfd8dc, role: 'sensor', kind: 'camera', published: 260, mount: 15, falseAlarm: 0.03,
    health: 30, signature: 0.05, emits: [],
    fov: 12, slewRate: 90, searchRate: 12, dwell: 3,
    channels: 'thermal', pixels: 'sd', fnumber: 1, ir: 'lwir', pitch: 12, // a fixed lens: no zoom. Long-wave, 12 µm pixels, as published
    desc: 'Small thermal camera. Cheap and passive, with a short reach. Must be cued by another sensor. Bearing and elevation with strong classification, no range.',
    sapient: {
      nodeType: 'NODE_TYPE_CAMERA', subType: ['LWIR', 'C-UAS'], scan: 'SCAN_TYPE_STEERABLE', interval: 0.5,
      noise: { az: 0.1, el: 0.1 }, modes: ['Search', 'Track'],
    },
    ref: {
      class: 'Thermal camera core',
      analogues: ['Teledyne FLIR Boson 640, 36 mm lens'],
      published: 'LWIR, 640 x 512 at 12 \u00B5m pitch. The 36 mm lens gives a 12\u00B0 horizontal view. No drone detection range is published.',
      basis: 'Game range 260 m is where a 0.35 m drone covers 4 pixels on this lens. The 4 pixel threshold and the accuracy are assumptions. It has no zoom, and f/1, typical of uncooled thermal lenses, is an ASSUMPTION.',
      confidence: 'Lens and sensor from the vendor; range is calculated',
      sources: [{ label: 'Teledyne FLIR: Boson', url: 'https://www.oem.flir.com/products/boson/' }],
      cost: { capex: 'A core alone costs far less than a mounted, weatherproof sensor. Game price $25,000 is a placeholder.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  camera_l: {
    product: 'MWIR turret, Ophir 80\u20131200 mm', size: 'L', name: 'Large EO/IR camera', short: 'EOL', model: 'camera', modelScale: 1.4, cost: 500000, shotCost: 0, color: 0x78909c, role: 'sensor', kind: 'camera', published: 450, mount: 25, falseAlarm: 0.02,
    health: 30, signature: 0.05, emits: [],
    fov: 7.1, trackFov: 0.5, slewRate: 90, searchRate: 12, dwell: 3,
    channels: 'thermal', pixels: 'sd', fnumber: 5.5, ir: 'mwir', pitch: 15, // the lens's own wide and narrow ends, its published f/5.5, and 15 µm mid-wave pixels
    desc: 'Cooled long-zoom thermal turret. It reaches further and identifies at a distance, but its view is very narrow, so it needs a good cue.',
    sapient: {
      nodeType: 'NODE_TYPE_CAMERA', subType: ['MWIR', 'C-UAS'], scan: 'SCAN_TYPE_STEERABLE', interval: 0.5,
      noise: { az: 0.02, el: 0.02 }, modes: ['Search', 'Track'],
    },
    ref: {
      class: 'Cooled MWIR long-range camera',
      analogues: ['MWIR camera with Ophir SupIR 80\u20131200 mm f/5.5'],
      published: 'For 15 \u00B5m 640 x 512 cameras, with a 7.1\u00B0 to 0.5\u00B0 horizontal view. Ophir quotes more than 26 km, but that is for vehicles, not drones.',
      basis: 'Game range 450 m is its search view at the wide 7.1\u00B0 end, where a 0.35 m drone covers 4 pixels. On a cue it zooms to the narrow 0.5\u00B0 end, where that is about 6.4 km. The 4 pixel threshold and the accuracy are assumptions.',
      confidence: 'Lens from the vendor; range is calculated',
      sources: [{ label: 'Ophir: MWIR f/5.5 zoom lenses', url: 'https://www.ophiropt.com/g/long-range-mwir-vga-imaging-lenses' }],
      cost: { capex: 'No public price found. Game price $500,000 is a placeholder.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  acoustic_s: {
    product: 'ZVOOK NW0', size: 'S', name: 'Small acoustic sensor', short: 'ACS', model: 'acoustic', modelScale: 0.7, cost: 1000, shotCost: 0, color: 0xffcc80, role: 'sensor', kind: 'acoustic', senses: 'acoustic', published: 300, mount: 3, falseAlarm: 0.1,
    health: 30, signature: 0.02, emits: [], // completely passive
    desc: 'Tactical microphone node. Very cheap and short range. Hears drones that make no radio signal and does not need a line of sight, but noise and hills cut its reach.',
    sapient: { nodeType: 'NODE_TYPE_ACOUSTIC', subType: ['Microphone', 'C-UAS'], scan: 'SCAN_TYPE_FIXED', interval: 1, noise: { az: 10 } },
    ref: {
      class: 'Tactical acoustic drone detector',
      analogues: ['ZVOOK NW0'],
      published: 'Declared range 150–450 m against first-person-view drones, with 360° coverage. The maker recommends a sensor every 400–600 m.',
      basis: 'Game range 300 m is the middle of the declared band, and fits the recommended spacing. Bearing accuracy and false alarms are ASSUMPTIONS: the source gives neither.',
      confidence: 'Maker’s declared figures, reported by the trade press',
      sources: [{ label: 'Militarnyi: ZVOOK NW0', url: 'https://militarnyi.com/en/news/ukraine-develops-acoustic-detector-for-fpv-drones/' }],
      cost: {
        capex: 'No price published for the NW0. Sensors in Ukraine’s Sky Fortress network are reported at $400–$1,000. Game price $1,000 is the top of that band.',
        confidence: 'ASSUMPTION from a comparable system',
        sources: [{ label: 'United24: Sky Fortress', url: 'https://united24media.com/war-in-ukraine/sky-fortress-ukraines-acoustic-detection-system-that-tracks-drones-cheap-and-fast-9451' }],
      },
    },
  },
  acoustic: {
    product: 'Squarehead Discovair G2+', size: 'M', name: 'Medium acoustic sensor', short: 'ACM', model: 'acoustic', cost: 50000, shotCost: 0, color: 0xffa726, role: 'sensor', kind: 'acoustic', senses: 'acoustic', published: 500, mount: 3, falseAlarm: 0.05,
    health: 30, signature: 0.02, emits: [],
    desc: 'Microphone array that filters out background noise. Gives bearing and elevation, with no range. Hears drones that make no radio signal and does not need a line of sight, but noise and hills cut its reach.',
    sapient: { nodeType: 'NODE_TYPE_ACOUSTIC', subType: ['Microphone array', 'C-UAS'], scan: 'SCAN_TYPE_FIXED', interval: 1, noise: { az: 4, el: 6 } },
    ref: {
      class: 'Passive acoustic microphone array',
      analogues: ['Squarehead Discovair G2+'],
      published: 'No datasheet range found. A US Air Force notice asks for this array or an equal, with at least 500 m against Group 1 drones. Robin Radar gives 300–500 m for acoustic sensors in general, and says wind, temperature and noise reduce it.',
      basis: 'Game range is the 500 m procurement minimum. Bearing accuracy and false alarms are ASSUMPTIONS.',
      confidence: 'A buyer’s requirement and a competitor’s overview, not a measured figure',
      sources: [
        { label: 'US Air Force notice: Discovair G2+', url: 'https://app.govly.com/public/opportunities/16844233' },
        { label: 'Robin Radar: acoustic sensors', url: 'https://www.robinradar.com/blog/acoustic-sensors-drone-detection' },
      ],
      cost: { capex: 'No public price found. Game price $50,000 is a placeholder.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  acoustic_l: {
    product: 'ZVOOK listening station', size: 'L', name: 'Large acoustic sensor', short: 'ACL', model: 'acoustic', modelScale: 1.4, cost: 500, shotCost: 0, color: 0xef6c00, role: 'sensor', kind: 'acoustic', senses: 'acoustic', published: 1000, mount: 6, falseAlarm: 0.15,
    health: 30, signature: 0.02, emits: [],
    desc: 'Long-range listening station for loud targets. Very cheap and reaches furthest, but its bearing is coarse and it raises more false alarms. Noise and hills cut its reach.',
    sapient: { nodeType: 'NODE_TYPE_ACOUSTIC', subType: ['Listening station', 'C-UAS'], scan: 'SCAN_TYPE_FIXED', interval: 1, noise: { az: 10 } },
    ref: {
      class: 'Networked long-range acoustic station',
      analogues: ['ZVOOK listening station', 'Sky Fortress'],
      published: 'The Telegraph reports that its sensors detect drones three miles away and cruise missiles at four. The figure is not given for any particular drone.',
      basis: 'Game range 1 km is against a small first-person-view drone, an ASSUMPTION. A fixed-wing strike drone is set five times louder, so it is heard at about the reported three miles. False alarms and bearing accuracy are assumptions.',
      confidence: 'A press report of the maker’s claims',
      sources: [{ label: 'The Telegraph, reprinted: acoustic sensors', url: 'https://www.lucorg.com/?p=17063' }],
      cost: { capex: 'Reported at about £400 to manufacture, so about $500. "Large" here means its reach, not its price or bulk.', confidence: 'Press report of a manufacturing cost', sources: [{ label: 'The Telegraph, reprinted: acoustic sensors', url: 'https://www.lucorg.com/?p=17063' }] },
    },
  },
};
