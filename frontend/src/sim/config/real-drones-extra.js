// Three more real drones, kept apart from real-drones.js to stay within the file size limit: a jet strike drone, an anti-radar
// loitering munition and a large reconnaissance drone. The rules are the same as there: each starts from its type (variantOf),
// `published` holds only what public sources say, and `assumed` says what was set by class because nothing is public.
// Published flight performance and reported warhead mass only (docs/SECURITY_NOTES.md).


export const EXTRA_REAL_DRONES = {
  geran3: {
    variantOf: 'fw', origin: 'Russia', name: 'Geran-3 / Shahed-238 (jet strike)', label: 'Geran-3',
    evade: 0.9, speed: 90, alt: [50, 4000], altModes: [[50, 300], [2000, 4000]], size: 2.5, sound: 8, jamResist: 0.7, warhead: 50, cost: 300000,
    usedBy: 'Russia, as the Geran-3. Iran makes the Shahed-238 it is based on.',
    published: 'A turbojet Shahed. Ukrainian forces record a cruise of about 300 to 350 km/h (game uses 325); other reports claim 550 to 600 km/h. Range 1,500 to 2,500 km by different reports. Warhead usually given as 50 kg. Anti-jam satellite navigation antennas of up to 16 elements are reported on Russian Gerans.',
    assumed: 'Height copies the Geran-2: low or high. Agility 0.9, as a drone flying a set route. Loudness (8 times an FPV, against 5 for the piston Shahed) and jam resistance (0.7, for the larger anti-jam antennas) are assumptions.',
    costRef: {
      note: 'No reliable price. One estimate puts an export Shahed-238 at $1.4 million, and a turbojet costs far more than a piston engine. Game uses $300,000, an ASSUMPTION.',
      confidence: 'ASSUMPTION: no reliable price',
      sources: [
        { label: 'United24: Geran-3 production', url: 'https://united24media.com/latest-news/russia-begins-production-of-jet-powered-geran-3-drone-a-faster-deadlier-shahed-238-clone-6001' },
        { label: 'Espreso: Geran-3 cost and speed', url: 'https://global.espreso.tv/russia-ukraine-war-geran-3-too-costly-for-russia-just-target-for-ukraine-aviation-expert' },
        { label: 'Army Recognition: Shahed-238', url: 'https://armyrecognition.com/focus-analysis-conflicts/army/conflicts-in-the-world/russia-ukraine-war-2022/russias-jet-powered-shahed-238-drones-introduce-new-challenges-to-ukraines-air-defenses' },
      ],
    },
  },
  asn301: {
    variantOf: 'fw', origin: 'China', name: 'ASN-301 (anti-radar loitering munition)', label: 'ASN-301',
    evade: 0.9, speed: 61, size: 2.2, warhead: 30, cost: 50000, seeksEmitters: true, antiRadar: true, seekRange: 8000,
    usedBy: 'China. Shown in 2017, and tested and fitted to new trucks since.',
    published: 'An anti-radar loitering munition in the class of the Israeli Harpy, fired from canisters on a truck. About 220 km/h, 135 kg, 2.2 m span, a combat radius of about 280 to 300 km and over 4 hours aloft. One aggregator gives a 30 kg warhead, unverified.',
    assumed: 'It hunts the strongest radar, or a jammer that is on, within 8 km, and otherwise heads for the site. That seeker range is an assumption. Damage uses the unverified 30 kg. Agility 0.9, as a drone flying a set route; it learns to manoeuvre wave by wave, as newer Gerans and Gerberas are reported to.',
    costRef: {
      note: 'No price found. Game uses $50,000, an ASSUMPTION: a Shahed-class airframe plus a radar seeker.',
      confidence: 'ASSUMPTION: no price found',
      sources: [
        { label: 'Army Recognition: ASN-301 test', url: 'https://armyrecognition.com/news/army-news/2025/china-tests-asn-301-anti-radar-drone-raising-new-threats-for-u-s-and-allied-forces' },
        { label: 'SCMP: ASN-301', url: 'https://www.scmp.com/news/china/military/article/3347494/why-chinas-asn-301-suicide-drone-more-deadly-its-iranian-counterpart' },
      ],
    },
  },
  wingloong2: {
    variantOf: 'spotter', origin: 'China', name: 'Wing Loong II (reconnaissance and strike)', label: 'Wing Loong II',
    evade: 0.9, speed: 56, alt: [4000, 6000], size: 20, rcs: 2, cost: 2000000,
    usedBy: 'China, and exported to several countries in the Middle East and Africa.',
    published: 'Top speed about 370 km/h. Service ceiling 9,000 to 9,900 m by different sources. 11 m long and about 20 m in span, with a satellite link. It can carry weapons, but in the game it spots for the strikes.',
    assumed: 'Agility 0.9, as a reconnaissance aircraft. Cruise of 200 km/h, height of 4 to 6 km and radar cross-section of 2 m² are assumptions for a drone of its size.',
    costRef: {
      note: 'No price published. Its smaller predecessor reportedly sold for about $1 million, and one listing gives $2 million with no source. Game uses $2 million, an ASSUMPTION.',
      confidence: 'ASSUMPTION: no published price',
      sources: [
        { label: 'Armed Forces: Wing Loong II', url: 'https://armedforces.eu/air_forces/drone/CAIG_Wing_Loong_II' },
        { label: 'Defense News: Wing Loong II', url: 'https://development.defensenews.com/?p=38166' },
      ],
    },
  },
};
