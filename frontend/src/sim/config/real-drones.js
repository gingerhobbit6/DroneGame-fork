// Real drones, from public sources, for the sandbox and for planning against. The waves still send the four generic types.
// Each one starts from its type (variantOf) and overrides only what is public, or what would be plainly wrong left as it is,
// such as a 10 m airframe with a small drone's radar cross-section. Figures not listed in `published` are assumptions, and the
// Sources tab says so. Speeds are cruise where public, otherwise the top speed, in m/s. See docs/SECURITY_NOTES.md: this is
// published flight performance and reported warhead mass only, and nothing about building or arming a drone belongs here.

// Damage to the site is a game rule. Blast grows with the cube root of the charge, scaled so the generic types keep their values:
// 2 kg gives the first-person-view drone's 12, and 30 kg gives the fixed-wing strike drone's 30.
export const blast = (warheadKg) => Math.round(9.5 * Math.cbrt(warheadKg));

// Agility (evade, 1 = no manoeuvre) is set by rule, as nothing publishes it: 0.6 for a radio strike quad an operator flies, 0.7 for a
// fibre-optic one, 0.75 for an operator-guided small fixed-wing drone, 0.85 for a camera quad, 0.9 for a drone on a set route or a
// reconnaissance aircraft, and 0.95 for a heavy farm drone. Height is reported where `published` says so, and otherwise in `assumed`.
const NO_PRICE = 'No price found on any page opened, so the game uses the price of its type. Attack cost sums involving it are rough.';

export const REAL_DRONES = {
  // ---------- Russia ----------
  geran2: {
    variantOf: 'fw', origin: 'Russia', name: 'Geran-2 (fixed-wing strike)', label: 'Geran-2',
    evade: 0.9, speed: 50, alt: [50, 4000], altModes: [[50, 300], [2000, 4000]], size: 2.5, warhead: 50, cost: 48800,
    usedBy: 'Russia. Widely documented against Ukraine.',
    published: 'Cruise about 180 km/h, top about 185 km/h. Reported flying either low, at about 50 to 300 m and at times 10 to 20 m, or high, at 2 to 4 km out of reach of mobile fire teams, before diving at the target (Ukrainian Air Force and officials, 2025 to 2026). Ceiling about 4,000 m. Range 1,000 to 2,500 km. Wingspan 2.5 m, up to 240 kg. Warhead 40 to 90 kg (game uses 50). Piston engine. Satellite and inertial navigation; later versions add cellular and radio modems. Press figures, several uncited.',
    assumed: 'Agility 0.9, as a drone flying a set route; it learns to manoeuvre wave by wave, as newer Gerans and Gerberas are reported to.',
    costRef: {
      note: 'RUSI: $30,000 to $80,000. CSIS works with $35,000 for Shahed-type drones. Leaked documents projected about $48,800 with near-full local production. Game uses $48,800.',
      confidence: 'Analyst estimates; wide spread',
      sources: [
        { label: 'Kyiv Independent: launched above 2 km, then diving', url: 'https://kyivindependent.com/russia-has-changed-drone-attack-tactics-against-ukraine-to-bypass-air-defense-ukraines-air-force-says' },
        { label: 'Ukrinform: from 3 to 4 km down to 250 m', url: 'https://www.ukrinform.net/rubric-ato/4077268-enemy-reduces-launch-altitude-of-shahed-drones-over-zaporizhzhia-to-250-meters-fedorov.html' },
        { label: 'RBC-Ukraine: as low as 10 to 20 m', url: 'https://newsukraine.rbc.ua/news/russian-shahed-drones-fly-as-low-as-10-meters-1780394143.html' },
        { label: 'CSIS: Shahed to Geran', url: 'https://www.csis.org/analysis/shahed-geran-how-russia-continues-reinvent-one-way-attack-drone' },
        { label: 'Wikipedia: HESA Shahed 136', url: 'https://en.wikipedia.org/wiki/HESA_Shahed_136' },
        { label: 'LB.ua: jet Shaheds', url: 'https://en.lb.ua/news/2025/08/01/36522_reactive_shaheds_when.html' },
        { label: 'Forces News: Shahed heights', url: 'https://www.forcesnews.com/russia/ukraine-urged-change-tactics-russias-shahed-drones-become-more-deadly' },
      ],
    },
  },
  lancet3: {
    variantOf: 'fw', origin: 'Russia', name: 'Lancet-3 (loitering munition)', label: 'Lancet-3',
    evade: 0.75, speed: 26, alt: [500, 800], size: 1, rcs: 0.05, sound: 1, warhead: 4, cost: 35000, seeksEmitters: true,
    links: { control: 'control900', gnss: true }, rfEmitter: true, protocol: 'tactical',
    usedBy: 'Russia.',
    published: 'Cruise 80 to 110 km/h (game uses 95). Ceiling about 5,000 m. Range about 40 km, about 40 minutes. 12 kg. Warhead 3 to 5 kg (game uses 4). Electric. 868 to 928 MHz reported for ZALA drones generally. Typical height and wingspan are not public, so size is assumed. Press figures.',
    assumed: 'Height 500 to 800 m before its dive, from an unverified summary of GlobalSecurity. Agility 0.75, as an operator-guided small fixed-wing drone.',
    costRef: {
      note: 'About 3 million roubles, Samuel Bendett (CNAS) via Reuters, given as $35,000 to $37,000. Game uses $35,000.',
      confidence: 'Analyst estimate',
      sources: [
        { label: 'Army Recognition: Lancet-3', url: 'https://armyrecognition.com/military-products/army/unmanned-systems/unmanned-aerial-vehicles/lancet-3-loitering-munition-kamikaze-drone-russia-data-fact-sheet' },
        { label: 'Wikipedia: ZALA Lancet', url: 'https://en.wikipedia.org/wiki/ZALA_Lancet' },
      ],
    },
  },
  orlan10: {
    variantOf: 'spotter', origin: 'Russia', name: 'Orlan-10 (reconnaissance)', label: 'Orlan-10',
    evade: 0.9, speed: 33, alt: [1000, 3000], size: 3.1, cost: 100000, links: { control: 'control900', gnss: true },
    usedBy: 'Russia.',
    published: 'Cruise 90 to 150 km/h (game uses 120). Ceiling 5,000 m. Wingspan 3.1 m, 15 to 18 kg. Control on 850 to 930 MHz, with satellite navigation. Piston engine. Typical height is not public; one was shot down at 3,620 m. Ukrainian military intelligence and press figures.',
    assumed: 'Height 1 to 3 km, below that shoot-down and its 5 km ceiling. Agility 0.9, as a reconnaissance aircraft.',
    costRef: {
      note: 'Reported at $87,000 to $120,000 by Army Recognition, with no named origin. Game uses $100,000.',
      confidence: 'Press report',
      sources: [
        { label: 'UNN: an Orlan-10 shot down at 3,620 m', url: 'https://unn.ua/en/news/ukrainian-military-shoots-down-an-orlan-10-for-the-first-time-at-an-altitude-of-over-3600-meters' },
        { label: 'War & Sanctions (HUR): Orlan-10', url: 'https://war-sanctions.gur.gov.ua/en/uav/207' },
        { label: 'Army Recognition: Orlan-10', url: 'https://www.armyrecognition.com/archives/archives-land-defense/land-defense-2018/more-orlan-10-drones-for-russian-army-in-may' },
        { label: 'Wikipedia: Orlan-10', url: 'https://en.wikipedia.org/wiki/Orlan-10' },
      ],
    },
  },
  molniya2: {
    variantOf: 'fpv', origin: 'Russia', name: 'Molniya-2 (first-person-view fixed wing)', label: 'Molniya-2',
    evade: 0.75, model: 'fw', airframe: 'Fixed wing', speed: 29, alt: [30, 150], size: 1.5, rcs: 0.05, warhead: 4.5, cost: 1600, hops: true,
    usedBy: 'Russia. Its use is solid; the maker rests on Wikipedia alone.',
    published: 'Cruise 90 to 120 km/h (game uses 105). One source gives about 400 m up, but a Ukrainian electronic warfare adviser says it flies too low for radar (2026), which the game follows. Range 30 to 60 km. Wingspan about 1.5 m, about 10 kg. Warhead 3 to 6 kg (game uses 4.5). Electric. Flown over a first-person video radio link; which bands is not public, so they are its type’s. The same adviser says it hops frequency too fast for standard jamming, so a reactive jammer cannot follow it and only a barrage touches it. One analyst and press figures.',
    assumed: 'Height 30 to 150 m, for low. Agility 0.75, as an operator-guided small fixed-wing drone; it is reported to manoeuvre erratically near the end.',
    costRef: {
      note: '$1,600 from Russian media and industry, via United24; other reports say about $300. Game uses $1,600.',
      confidence: 'Press reports; wide spread',
      sources: [
        { label: 'Euromaidan Press: Molniya flies too low for radar', url: 'https://euromaidanpress.com/2026/04/25/ukraines-prominent-drone-expert-flash-russias-cheap-molniya-drones-fly-too-low-for-radar-and-hop-frequencies-too-fast-for-standard-jamming/' },
        { label: 'Mezha: Molniya drones', url: 'https://oboronka.mezha.ua/en/udarni-droni-molniya-harateristiki-chim-nebezpechni-307515/' },
        { label: 'United24: Molniya family', url: 'https://united24media.com/war-in-ukraine/russia-expands-molniya-drone-family-with-new-lightning-13-variant-20008' },
        { label: 'Wikipedia: Molniya', url: 'https://en.wikipedia.org/wiki/Molniya_(drone)' },
      ],
    },
  },
  kvn: {
    variantOf: 'fo', origin: 'Russia', name: 'KVN (fibre-optic, Knyaz Vandal Novgorodsky)', label: 'KVN',
    evade: 0.7, speed: 18, warhead: 4.5, cost: 17000,
    usedBy: 'Russia.',
    published: 'Normal speed 50 to 80 km/h (game uses 65) and top 100 to 140 km/h, as Ukrainian military intelligence declares them. Range 15 to 42 km, the longer figures being Russian developer claims. Warhead 3 to 6 kg (game uses 4.5). Fibre-optic control and video. Height and size are not public, so they are its type’s. Thin apart from range.',
    assumed: 'Agility 0.7: an operator-flown quad, a little slower to turn than a radio one for its fibre spool.',
    costRef: {
      note: '$17,000 is what Russian military bloggers say the ministry pays, via Kyiv Post.',
      confidence: 'Press report of blogger claims',
      sources: [
        { label: 'War&Sanctions: KVN', url: 'https://war-sanctions.gur.gov.ua/en/uav/486' },
        { label: 'TASS: KVN', url: 'https://tass.com/defense/2110647' },
        { label: 'www1.ru: KVN range versions', url: 'https://www1.ru/en/news/2026/08/15/428247-optovolokonnyi-dron-kniaz-vandal-polucil-versii-s-dalnostiu-do-42-km-lineika-modifikacii-rassiriaetsia.html' },
        { label: 'Kyiv Post: KVN price', url: 'https://www.kyivpost.com/post/38831' },
      ],
    },
  },
  gerbera: {
    variantOf: 'fw', origin: 'Russia', name: 'Gerbera (decoy, some armed)', label: 'Gerbera',
    evade: 0.9, speed: 44, alt: [20, 3000], altModes: [[20, 300], [2000, 3000]], size: 2.5, warhead: 6, cost: 10000, rfEmitter: true,
    usedBy: 'Russia.',
    published: 'Top speed about 160 km/h. Ceiling about 3,000 m. Range 300 to 600 km. Wingspan 2.5 m. Mostly a decoy; warheads of 2 to 10 kg reported (game uses 6). Small piston engine. Later versions relay through radio mesh modems. Cruise speed, height and mass are not public. Press figures.',
    assumed: 'Height is low or high: a reported 20 to 30 m, or up to its declared 3,000 m. Agility 0.9, as a drone flying a set route; it learns to manoeuvre wave by wave, as newer Gerans and Gerberas are reported to.',
    costRef: {
      note: 'About $10,000 from Ukrainian officials via Reuters: an adversary’s estimate.',
      confidence: 'Official, adversary estimate',
      sources: [
        { label: 'Wikipedia: Gerbera', url: 'https://en.wikipedia.org/wiki/Gerbera_(drone)' },
        { label: 'ISIS: Russian decoy drones', url: 'https://isis-online.org/isis-reports/russian-decoy-drones-that-depend-on-western-parts-pose-a-great-challenge/' },
      ],
    },
  },

  // ---------- Iran ----------
  shahed136: {
    variantOf: 'fw', origin: 'Iran', name: 'Shahed-136 (fixed-wing strike)', label: 'Shahed-136',
    evade: 0.9, speed: 50, alt: [50, 4000], altModes: [[50, 300], [2000, 4000]], size: 2.5, warhead: 35, cost: 35000,
    usedBy: 'Iran, and Russia as the Geran-2. Houthi use is reported by one Newsweek story.',
    published: 'Cruise about 180 km/h, top about 185 km/h. Reported flying either low, at about 50 to 300 m and at times 10 to 20 m, or high, at 2 to 4 km out of reach of mobile fire teams, before diving at the target (Ukrainian Air Force and officials, 2025 to 2026). Range 1,000 to 2,500 km. Wingspan 2.5 to 3 m, 200 kg. Warhead 20 to 50 kg (game uses 35). Piston engine. Satellite and inertial navigation. CSIS and press figures. The only radar cross-section found, 0.01 m², traces to a post on X, so it is not used.',
    assumed: 'Agility 0.9, as a drone flying a set route; it learns to manoeuvre wave by wave, as newer Gerans and Gerberas are reported to.',
    costRef: {
      note: 'CSIS works with about $35,000, citing estimates from $20,000 to $80,000. An export quote of $193,000 came from leaked documents. Game uses $35,000.',
      confidence: 'Analyst estimates; wide spread',
      sources: [
        { label: 'Kyiv Independent: launched above 2 km, then diving', url: 'https://kyivindependent.com/russia-has-changed-drone-attack-tactics-against-ukraine-to-bypass-air-defense-ukraines-air-force-says' },
        { label: 'Ukrinform: from 3 to 4 km down to 250 m', url: 'https://www.ukrinform.net/rubric-ato/4077268-enemy-reduces-launch-altitude-of-shahed-drones-over-zaporizhzhia-to-250-meters-fedorov.html' },
        { label: 'RBC-Ukraine: as low as 10 to 20 m', url: 'https://newsukraine.rbc.ua/news/russian-shahed-drones-fly-as-low-as-10-meters-1780394143.html' },
        { label: 'CSIS Missile Threat: Shahed 131 and 136', url: 'https://missilethreat.csis.org/missile/shahed-131-and-136/' },
        { label: 'CSIS: cost of Russia’s drone strikes', url: 'https://www.csis.org/analysis/calculating-cost-effectiveness-russias-drone-strikes' },
        { label: 'Army Recognition: Shahed-136', url: 'https://armyrecognition.com/military-products/army/unmanned-systems/unmanned-aerial-vehicles/shahed-136-loitering-munition-kamikaze-suicide-drone-technical-data' },
      ],
    },
  },
  shahed131: {
    variantOf: 'fw', origin: 'Iran', name: 'Shahed-131 (fixed-wing strike)', label: 'Shahed-131',
    evade: 0.9, speed: 50, alt: [50, 4000], altModes: [[50, 300], [2000, 4000]], size: 2.2, warhead: 15, cost: 20000,
    usedBy: 'Iran, and Russia as the Geran-1.',
    published: 'Cruise about 180 km/h. Range 700 to 1,000 km. Wingspan 2.2 m, 135 kg. Warhead 10 to 20 kg (game uses 15). Rotary engine. Satellite and inertial navigation. Top speed and height are not public. Ukrainian military intelligence and CSIS figures.',
    assumed: 'Height copies the Shahed-136: low or high. Agility 0.9, as a drone flying a set route; it learns to manoeuvre wave by wave, as newer Gerans and Gerberas are reported to.',
    costRef: {
      note: '$20,000 is a figure for the Shahed series, not the 131 alone: Knights and Almeida, Washington Institute, via Wikipedia.',
      confidence: 'Analyst estimate for the series',
      sources: [
        { label: 'War & Sanctions (HUR): Shahed-131', url: 'https://war-sanctions.gur.gov.ua/en/uav/338' },
        { label: 'CSIS Missile Threat: Shahed 131 and 136', url: 'https://missilethreat.csis.org/missile/shahed-131-and-136/' },
        { label: 'Wikipedia: Shahed 131', url: 'https://en.wikipedia.org/wiki/Shahed_131' },
      ],
    },
  },
  mohajer6: {
    variantOf: 'spotter', origin: 'Iran', name: 'Mohajer-6 (reconnaissance and strike)', label: 'Mohajer-6',
    evade: 0.9, speed: 36, alt: [4876, 5486], size: 10, rcs: 1,
    usedBy: 'Iran and Russia, both solid. Venezuela limited and partly unconfirmed.',
    published: 'Cruise about 130 km/h, top about 200 km/h. Operates at 4,900 to 5,500 m, ceiling 5,400 to 7,600 m. 12 hours’ endurance. Wingspan 10 m, 600 to 670 kg. Payload 100 to 150 kg. Piston engine. It can carry weapons, but the game only models it spotting. Press figures.',
    assumed: 'Agility 0.9, as a reconnaissance aircraft.',
    costRef: {
      note: NO_PRICE,
      confidence: 'Not public',
      sources: [
        { label: 'TWZ: Mohajer-6', url: 'https://www.twz.com/news-features/iranian-mohajer-6-drones-now-operating-in-venezuela' },
        { label: 'Army Recognition: Mohajer-6', url: 'https://www.armyrecognition.com/focus-analysis-conflicts/army/conflicts-in-the-world/russia-ukraine-war-2022/first-armed-iranian-made-mohajer-6-uav-used-by-russia-in-ukraine-crashes-near-kursk' },
        { label: 'Wikipedia: Qods Mohajer-6', url: 'https://en.wikipedia.org/wiki/Qods_Mohajer-6' },
      ],
    },
  },
  ababil2: {
    variantOf: 'spotter', origin: 'Iran', name: 'Ababil-2 (reconnaissance)', label: 'Ababil-2',
    evade: 0.9, speed: 77, alt: [1000, 3000], size: 3.25,
    usedBy: 'Iran. Hezbollah and the Libyan National Army rest on Wikipedia.',
    published: 'Cruise 250 to 305 km/h (game uses 278), top about 370 km/h. Ceiling 3,000 m. Range about 120 km. Wingspan 3.25 m, 83 kg. Piston engine. Mostly uncited Wikipedia figures, chosen over the Ababil-3, which has even less. Typical height is not public.',
    assumed: 'Height 1 to 3 km, up to its ceiling. Agility 0.9, as a reconnaissance aircraft.',
    costRef: {
      note: NO_PRICE,
      confidence: 'Not public',
      sources: [
        { label: 'Wikipedia: HESA Ababil', url: 'https://en.wikipedia.org/wiki/HESA_Ababil' },
        { label: 'FAS: Hezbollah’s use of drones', url: 'https://fas.org/publication/hezbollah-use-drones-weapon-terrorism/' },
      ],
    },
  },

  // ---------- China ----------
  ch901: {
    variantOf: 'fw', origin: 'China', name: 'CH-901 (loitering munition)', label: 'CH-901',
    evade: 0.75, speed: 39, alt: [100, 150], size: 1, rcs: 0.05, sound: 1, warhead: 3,
    usedBy: 'China. Fielding with the PLA is not confirmed.',
    published: 'Cruise 100 to 180 km/h (game uses 140). Defense Update gives a loiter at 100 to 150 m; other sources say up to 450 m. Range 10 to 15 km, 40 to 120 minutes. 9 kg. Warhead about 3 kg. Wingspan is not public, so size is assumed. Press and analyst figures, which often disagree.',
    assumed: 'Agility 0.75, as an operator-guided loitering munition.',
    costRef: {
      note: NO_PRICE,
      confidence: 'Not public',
      sources: [
        { label: 'Bard CSD: Loitering Munitions', url: 'https://dronecenter.bard.edu/files/2017/02/CSD-Loitering-Munitions.pdf' },
        { label: 'Army Recognition: CH-901', url: 'https://www.armyrecognition.com/archives/archives-land-defense/land-defense-2018/china-defense-industry-presents-ch-901-suicide-drone-at-sofex-2018' },
        { label: 'Wikipedia: CASC CH-901', url: 'https://en.wikipedia.org/wiki/CASC_CH-901' },
      ],
    },
  },
  feilong300d: {
    variantOf: 'fw', origin: 'China', name: 'Feilong-300D (fixed-wing strike)', label: 'Feilong-300D',
    evade: 0.9, alt: [50, 300], warhead: 45, cost: 10000,
    usedBy: 'China, as a showcased export product. PLA use rests on one post on X. No export customer announced.',
    published: 'Range about 1,000 km. Warhead 40 to 50 kg (game uses 45). Piston engine. Inertial and satellite guidance. Speed, height and size are not public, so they are its type’s.',
    assumed: 'Height 50 to 300 m, as it is described flying low. Agility 0.9, as a drone flying a set route; it learns to manoeuvre wave by wave, as newer Gerans and Gerberas are reported to.',
    costRef: {
      note: '"As low as $10,000", from a Chinese industry journal: a marketing figure, not a sale price.',
      confidence: 'Marketing figure',
      sources: [
        { label: 'Army Recognition: FL-300D', url: 'https://armyrecognition.com/news/army-news/2026/chinas-10k-truck-launched-fl-300d-drone-to-overwhelm-air-defenses-with-mass-saturation-strikes' },
        { label: 'The Defense Post: Feilong-300D', url: 'https://thedefensepost.com/2025/11/07/china-feilong-300d-drone' },
        { label: 'Interesting Engineering: Feilong', url: 'https://interestingengineering.com/military/china-feilong-drone-long-range-strike' },
      ],
    },
  },
  sunflower200: {
    variantOf: 'fw', origin: 'China', name: 'Sunflower-200 (fixed-wing strike)', label: 'Sunflower-200',
    evade: 0.9, speed: 53, size: 2.5, warhead: 40,
    usedBy: 'A showcased Chinese product. Not confirmed in PLA service, and no confirmed sale.',
    published: 'Cruise 160 to 220 km/h (game uses 190). Range 1,500 to 2,000 km. Wingspan 2.5 m, 175 kg. Warhead 40 kg. All the seller’s claims. Height is not public, so it is its type’s.',
    assumed: 'Agility 0.9, as a drone flying a set route; it learns to manoeuvre wave by wave, as newer Gerans and Gerberas are reported to.',
    costRef: {
      note: NO_PRICE,
      confidence: 'Not public',
      sources: [
        { label: 'Defense Express: Sunflower-200', url: 'https://en.defence-ua.com/news/china_shows_a_shahed_136_copy_called_sunflower_200_and_its_serious_threat-7648.html' },
        { label: 'Army Recognition: Sunflower-200', url: 'https://www.armyrecognition.com/archives/archives-land-defense/land-defense-2023/china-could-provide-large-scale-sunflower-200-kamikaze-drones-to-russia' },
        { label: 'Asia Times: Sunflower', url: 'https://asiatimes.com/2023/09/killer-sunflower-chinas-kamikaze-drone-has-arrived/' },
      ],
    },
  },
  asn209: {
    variantOf: 'spotter', origin: 'China', name: 'ASN-209 (reconnaissance)', label: 'ASN-209',
    evade: 0.9, speed: 39, alt: [1000, 4000], size: 7.5, rcs: 0.5,
    usedBy: 'China, Algeria, and Egypt under licence. Mostly from Wikipedia.',
    published: 'Cruise about 140 km/h, top about 180 km/h. Ceiling 5,000 m. Range 200 km, 10 hours. Wingspan 7.5 m, 320 kg. Payload 50 kg. Mostly Wikipedia citing a maker brochure. Typical height is not public.',
    assumed: 'Height 1 to 4 km, below its 5 km ceiling. Agility 0.9, as a reconnaissance aircraft.',
    costRef: {
      note: NO_PRICE,
      confidence: 'Not public',
      sources: [
        { label: 'Wikipedia: Aisheng ASN-209', url: 'https://en.wikipedia.org/wiki/Aisheng_ASN-209' },
        { label: 'StrategyPage: ASN-209', url: 'https://www.strategypage.com/htmw/htairfo/20120524.aspx' },
      ],
    },
  },
  skywalker: {
    variantOf: 'fo', origin: 'China', name: 'Skywalker (fibre-optic fixed wing, commercial)', label: 'Skywalker',
    model: 'fw', airframe: 'Fixed wing', speed: 53,
    usedBy: 'A commercial product from Wuhan with no military user reported. The PLA has been shown training with fibre-optic drones, but no named model has published figures, so this is the nearest documented Chinese example.',
    published: 'Top speed about 190 km/h. Range about 30 km on the fibre. The maker’s claims. Cruise speed, height, size and warhead are not public, so they are its type’s.',
    costRef: {
      note: NO_PRICE,
      confidence: 'Not public',
      sources: [
        { label: 'Militarnyi: Chinese fibre-optic drone', url: 'https://militarnyi.com/en/news/chinese-drone-maker-introduces-uav-controlled-by-fiber-optics/' },
        { label: 'Militarnyi: PLA fibre-optic training', url: 'https://militarnyi.com/en/news/china-s-military-is-training-with-fiber-optic-drones-and-homing-systems/' },
        { label: 'The Star: PLA low-cost drones', url: 'https://thestar.com.my/tech/tech-news/2025/04/29/chinas-military-rapidly-expands-use-of-low-cost-ai-powered-drones-in-phased-leap' },
      ],
    },
  },

};
