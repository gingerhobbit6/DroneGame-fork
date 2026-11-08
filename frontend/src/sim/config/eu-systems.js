// European systems outside the UK. Each is a further real system of a kind, marked `variantOf`, so the S, M and L choices stay as they
// are, except Skynex, which stands as the large gun.
// Costs are in US dollars, converted at $1.15 to the euro, an assumption. Each system's `ref` says where its numbers come from.
export const EU_SYSTEMS = {
  rf_airfence: {
    product: 'Sensofusion Airfence 7', variantOf: 'rf_l', size: 'L', name: 'Airfence', short: 'AFN', model: 'rf', modelScale: 1.2, cost: 184000, shotCost: 0, color: 0x00897b, role: 'sensor', kind: 'rf', published: 10000, mount: 9, senses: 'rf', falseAlarm: 0.04,
    health: 30, signature: 0.05, emits: [], listens: [[0.07, 6]],
    library: 'commercial', sensitivity: -95, df: 'aoa',
    desc: 'Finnish passive RF detection system, in use since 2016. One sensor hears a drone up to 10 km away on a clear path and finds its bearing. The real one also finds the pilot, which the game does not model. It cannot hear a drone with no radio link.',
    sapient: {
      nodeType: 'NODE_TYPE_PASSIVE_RF', subType: ['Direction finding', 'C-UAS'], scan: 'SCAN_TYPE_FIXED', interval: 1,
      noise: { az: 3 }, signal: true,
    },
    ref: {
      class: 'Passive RF detection and direction-finding system',
      analogues: ['Sensofusion Airfence 7'],
      published: 'Passive RF detection up to 10 km for one sensor unit, extended by adding units, at 70 MHz to 6 GHz, with a direction-finding antenna. It locates the drone, its pilot and its home point, from a library of the major commercial drones updated over the air. It mounts on a building or a vehicle. Its Military Edition adds countermeasures, including high-power jamming.',
      basis: 'Game range is the 10 km listed, which needs a clear line of sight: on a 9 m mast, tree tops and hills will usually stop it sooner. No sensitivity, bearing accuracy or false alarm rate is published, so -95 dBm, 3° and its false alarms are ASSUMPTIONS, between the Dedrone and AARTOS entries. Finding the pilot is not modelled.',
      confidence: 'Maker’s listing',
      sources: [
        { label: 'Sensofusion: Airfence 7', url: 'https://sensofusion.com/airfence/' },
        { label: 'Sensofusion: Military Edition', url: 'https://sensofusion.com/military/' },
        { label: 'Wikipedia: Sensofusion', url: 'https://en.wikipedia.org/wiki/Sensofusion' },
      ],
      cost: { capex: 'Listed at €160,000 before tax, for one sensor, its direction-finding antenna and software. Game price $184,000 converts that at $1.15 to the euro, an assumption.', confidence: 'Maker’s list price', sources: [{ label: 'Sensofusion: Airfence 7', url: 'https://sensofusion.com/airfence/' }] },
    },
  },
  jammer_sf: {
    product: 'Sensofusion Portable Asymmetric Jammer', variantOf: 'jammer_l', size: 'L', name: 'Sensofusion jammer', short: 'SFJ', model: 'jammer', modelScale: 1.1, cost: 46000, shotCost: 0, color: 0x311b92, role: 'effector', kind: 'jammer', published: 4500, mount: 3, mobile: 'vehicle', fire: 'jam',
    health: 30, signature: 3, emits: [], bands: ['control900', 'control24', 'video58', 'gnss'], slow: 0.5, killTime: 5,
    desc: 'Finnish 800 W portable jammer on eight channels at once, listed with Airfence Military Edition. It reaches further than any other jammer here, for little money, but it is the loudest. Autonomous/fibre drones ignore it. No cost per use.',
    sapient: { nodeType: 'NODE_TYPE_JAMMER', subType: ['RF', 'GNSS'], scan: 'SCAN_TYPE_FIXED', modes: ['Standby', 'Jam'] },
    ref: {
      class: 'Portable high-power RF and GNSS jammer',
      analogues: ['Sensofusion Portable Asymmetric Jammer'],
      published: '800 W on eight simultaneous channels, adjustable over 300 to 6,000 MHz, covering the major drone ISM bands and GNSS L1, L2 and L5. Deliveries from early 2026. No range is published.',
      basis: 'Game range 4.5 km is an ASSESSMENT from its power. Aaronia lists its 40 W handheld jammer at 2 km; half that, inside the 30\u201360% of claims the fixed site jammer assumes, is 1 km at 40 W, level with the DroneGun Tactical. Jamming reach goes with the square root of power, as the game\u2019s power setting does, so 800 W reaches about 4.5 km. An omni antenna and its loudness are ASSUMPTIONS. Its 300\u20136,000 MHz and GNSS take in the game\u2019s four bands. At 800 W it needs a vehicle or generator, so it is taken as vehicle-mounted, 3 m up.',
      confidence: 'Maker’s power figure; range is an assessment',
      sources: [
        { label: 'Sensofusion: Military Edition', url: 'https://sensofusion.com/military/' },
        { label: 'EverythingRF: Aaronia jammers, 40 W handheld at 2 km', url: 'https://www.everythingrf.com/news/details/14983-aaronia-offers-portable-stationary-and-fully-integrated-counter-drone-jammers-with-10-km-range' },
      ],
      cost: { capex: 'Listed at €40,000. Game price $46,000 converts that at $1.15 to the euro, an assumption.', confidence: 'Maker’s list price', sources: [{ label: 'Sensofusion: Military Edition', url: 'https://sensofusion.com/military/' }] },
    },
  },
  // Guns. Skynex stands as the large gun of its kind; the others are further real ones.
  gun_l: {
    product: 'Rheinmetall Skynex (35 mm Revolver Gun Mk3)', size: 'L', name: 'Skynex', short: 'SKX', model: 'gun', cost: 9000000, shotCost: 5000, color: 0xff7043, role: 'effector', kind: 'gun', published: 4000, muzzleY: 2.4, fire: 'guided',
    health: 40, signature: 0.3, emits: [],
    pk: 0.9, damage: 60, splash: 20, fuze: 20, cooldown: 1, missileSpeed: 1050, magazine: 15, storage: 45, reloadTime: 300,
    desc: 'German 35 mm revolver gun firing AHEAD airburst rounds, networked with its battery. In Ukraine one downed 11 drones and a cruise missile in a single engagement.',
    sapient: { nodeType: 'NODE_TYPE_KINETIC', subType: ['Gun', 'Airburst'], scan: 'SCAN_TYPE_STEERABLE' },
    ref: {
      class: 'Networked 35 mm air defence gun', analogues: ['Rheinmetall Skynex', 'Oerlikon Revolver Gun Mk3'],
      published: 'Up to 1,000 rounds a minute of AHEAD airburst, 252 ready rounds a gun, a nominal 4 km effective range, networked in a battery of up to four guns with an X-TAR3D radar. Ukraine reports short bursts on Shaheds, and one engagement downing 11 drones and a cruise missile.',
      basis: 'Game range is the 4 km nominal figure. A shot is a 16-round burst, 15 to a magazine. Hit chance 0.9 a burst, like the other airburst guns, and the rest are ASSUMPTIONS.',
      confidence: 'Maker’s figures and press reports; performance is an assumption',
      sources: [
        { label: 'Militarnyi: Skynex used against Shaheds', url: 'https://militarnyi.com/en/news/skynex-anti-aircraft-systems-were-used-to-shoot-down-shaheds/' },
        { label: 'Army Technology: Oerlikon Skynex', url: 'https://www.army-technology.com/projects/oerlikon-skynex-air-defence-system-germany/' },
      ],
      cost: { capex: 'No unit price found. Game prices of $9,000,000 for one gun and $5,000 a burst are placeholders.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  gun_skyranger: {
    product: 'Rheinmetall Skyranger 30 on Boxer', variantOf: 'gun_l', size: 'L', name: 'Skyranger 30', short: 'SKR', model: 'gun', cost: 12000000, shotCost: 4000, color: 0xff8a65, role: 'effector', kind: 'gun', published: 3000, muzzleY: 2.4, fire: 'guided', mobile: 'vehicle',
    health: 40, armour: 2, signature: 0.3, emits: [],
    pk: 0.85, damage: 60, splash: 15, fuze: 15, cooldown: 1, missileSpeed: 1100, magazine: 16, storage: 16, reloadTime: 900,
    desc: 'German 30 mm turret on an armoured Boxer, firing airburst rounds, with its own radar, networked with other air defence.',
    sapient: { nodeType: 'NODE_TYPE_KINETIC', subType: ['Gun', 'Airburst'], scan: 'SCAN_TYPE_STEERABLE' },
    ref: {
      class: 'Mobile networked 30 mm air defence gun', analogues: ['Rheinmetall Skyranger 30'],
      published: 'A 30 mm gun at up to 1,200 rounds a minute, with AHEAD airburst, 252 (or 300) ready rounds, about 3 km against air targets, a 20 km AESA radar and EO sights, on a Boxer 8x8.',
      basis: 'Game range 3 km. A shot is a 16-round burst. Hit chance 0.85 a burst and the rest are ASSUMPTIONS. It is drawn on a Patria-like 8x8. Its armoured hull halves what a strike does to it (armour 2): an ASSUMPTION.',
      confidence: 'Maker’s brochure; performance is an assumption',
      sources: [
        { label: 'ARTEC: Boxer Skyranger 30 brochure', url: 'https://www.artec-boxer.com/fileadmin/user_upload/product-brochures/Update/Artec-BOXER-Skyranger-30-brochure.pdf' },
        { label: 'Wikipedia: Skyranger 30', url: 'https://en.wikipedia.org/wiki/Skyranger_30' },
      ],
      cost: { capex: 'No unit price found. Game prices of $12,000,000 and $4,000 a burst are placeholders.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
  gun_gepard: {
    product: 'Flakpanzer Gepard (twin 35 mm)', variantOf: 'gun_l', size: 'L', name: 'Gepard', short: 'GEP', model: 'gun', cost: 5000000, shotCost: 1500, color: 0xf4511e, role: 'effector', kind: 'gun', published: 3500, muzzleY: 2.4, fire: 'guided', mobile: 'vehicle',
    health: 40, armour: 2, signature: 0.5, emits: [],
    pk: 0.73, rangeLoss: 0.75, damage: 60, splash: 0, fuze: 5, cooldown: 1, missileSpeed: 1175, magazine: 40, storage: 40, reloadTime: 1200,
    desc: 'German twin 35 mm gun tank, given to Ukraine, where its crews down many Shaheds. It has its own search and tracking radars; here it is networked like the other radar guns.',
    sapient: { nodeType: 'NODE_TYPE_KINETIC', subType: ['Gun'], scan: 'SCAN_TYPE_STEERABLE' },
    ref: {
      class: 'Stand-alone self-propelled 35 mm air defence gun', analogues: ['Flakpanzer Gepard'],
      published: 'Twin 35 mm guns at 1,100 rounds a minute combined, 320 air-defence rounds a gun, with its own search and tracking radars. Crews report bursts of 7 to 11 rounds and 20 to 30 a target including misses, at about 3 km; one crew reportedly downed more than 10 Shaheds and two cruise missiles.',
      basis: 'Game range 3.5 km and its radar seeing 15 km are ASSUMPTIONS. A shot is a 16-round burst. Hit chance 0.73 a burst close in falls with range, to a quarter at its limit, as a gun’s spread grows and its rounds have no airburst (an ASSUMPTION); at about 3 km that leaves what 0.4 gave before, about the reported 20 to 30 rounds a kill. Gepards fight stand-alone in Ukraine; here, with its own radar, it is networked like the other radar guns. Its armoured hull halves what a strike does to it (armour 2): an ASSUMPTION.',
      confidence: 'Crew reports in the press; performance is an assumption',
      sources: [
        { label: 'Espreso: how many shots Gepard takes to down a Shahed', url: 'https://global.espreso.tv/russia-ukraine-war-how-many-shots-does-it-take-for-gepard-to-down-shahed-and-what-is-best-weapon-against-drones' },
        { label: 'United24: a Gepard crew downs 17', url: 'https://united24media.com/war-in-ukraine/russian-drones-came-one-after-another-ukraines-gepard-crew-shot-down-17-19881' },
      ],
      cost: { capex: 'No price used. Game prices of $5,000,000 and $1,500 a burst are placeholders.', confidence: 'ASSUMPTION: tune this yourself', sources: [] },
    },
  },
};
