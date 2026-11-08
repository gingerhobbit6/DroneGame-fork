// Commercial and hobby drones reported in Russia-Ukraine, kept apart from real-drones.js to stay within the file size limit. The
// rules are the same as there: each starts from its type (variantOf), `published` holds only what public sources say, and `assumed`
// says what was set by rule because nothing is public. Published flight performance and reported payload mass only (docs/SECURITY_NOTES.md).


// A maker's own link. Its flight controller flies it, and on losing its controller it returns home after a few seconds (the Mavic 3
// manual gives six), or drifts if its satellite navigation is lost too (drones.js).
const COMMERCIAL = { links: { control: 'control24', video: 'video58', gnss: true }, protocol: 'commercial', lostLink: 'home' };
const HOBBY_LONG = { links: { control: 'control900', video: 'video58' }, protocol: 'hobby' }; // long-range control on 900 MHz, video on 5.8 GHz
const QUAD_HEIGHT = 'Height 60 to 200 m, around the one reported case of a Mavic 3T at about 150 m (Kyiv Post, 2024).';
const HRW = { label: 'Human Rights Watch: drones in Kherson', url: 'https://www.hrw.org/report/2025/06/03/hunted-from-above/russias-use-of-drones-to-attack-civilians-in-kherson-ukraine' };
const MANUAL = { label: 'UNITED24: Russian drone manual, about 300 g', url: 'https://united24media.com/latest-news/russian-drone-operators-use-homemade-chemical-munitions-in-combat-leaked-manual-reveals-7266' };
const CNA = { label: 'CNA: Russian uncrewed systems', url: 'https://www.cna.org/reports/2023/03/Russian-Uncrewed-Systems-Ukraine.pdf' };
const NO_PRICE_MODULE = 'The 7-inch quad’s price: no price was found for the homing module, so attack cost sums involving it are rough.';
const KYIV_POST = { label: 'Kyiv Post: Mavic 3T at about 150 m', url: 'https://www.kyivpost.com/post/28820' };

export const COTS_DRONES = {
  // ---------- commercial drones reported carrying munitions. Flight figures are the maker's, for the unmodified aircraft. ----------
  mavic3: {
    variantOf: 'fpv', origin: 'Commercial off the shelf', name: 'DJI Mavic 3 with a small munition', label: 'Mavic 3',
    speed: 15, alt: [60, 200], size: 0.38, evade: 0.85, ...COMMERCIAL, warhead: 0.3, cost: 2199,
    usedBy: 'Reported on the Russia-Ukraine battlefield. Which side flies which model is not confirmed.',
    published: 'Cruise about 54 km/h, top about 76 km/h. Up to 46 minutes. 0.38 m across, 0.9 kg. 2.4 and 5.8 GHz links, with satellite navigation. A leaked Russian manual gives about 300 g of munitions for the Mavic 3 and Autel drones.',
    assumed: 'Height 60 to 200 m, around the one reported case of a Mavic 3T at about 150 m. Agility 0.85, as a camera quad.',
    costRef: {
      note: 'Launch price of the standard model. NPR says around $2,000 or less.',
      confidence: 'Press report of a retail price',
      sources: [
        { label: 'UNITED24: Russian drone manual, about 300 g', url: 'https://united24media.com/latest-news/russian-drone-operators-use-homemade-chemical-munitions-in-combat-leaked-manual-reveals-7266' },
        { label: 'DJI: Mavic 3', url: 'https://www.dji.com/ph/support/product/mavic-3' },
        { label: 'DroneDJ: Mavic 3 specs', url: 'https://dronedj.com/2021/11/04/dji-mavic-3-vs-mavic-2-pro-spec-sheet' },
        { label: 'CT Public (NPR): hobby drones in the war', url: 'https://www.ctpublic.org/2023-03-21/a-chinese-drone-for-hobbyists-plays-a-crucial-role-in-the-russia-ukraine-war' },
      ],
    },
  },
  matrice30t: {
    variantOf: 'fpv', origin: 'Commercial off the shelf', name: 'DJI Matrice 30T with a munition', label: 'Matrice 30T',
    speed: 23, alt: [60, 200], size: 0.67, evade: 0.85, ...COMMERCIAL, warhead: 1, cost: 6800,
    usedBy: 'Bought for Ukrainian forces. Munition use is not confirmed on any page opened.',
    published: 'Top speed about 83 km/h. Up to 41 minutes. 0.67 m across, 3.8 kg. 2.4 and 5.8 GHz links, with satellite navigation. No source gives a munition mass: the game assumes 1 kg.',
    assumed: 'Height 60 to 200 m, as for the Mavic 3. Agility 0.85, as a camera quad.',
    costRef: {
      note: '265,000 UAH per drone in a Ukrainian defence contract, March 2024. About $6,800 at about 39 UAH/$; the dollar conversion is mine.',
      confidence: 'Contract reporting; currency converted by approximation',
      sources: [
        { label: 'DJI: Matrice 30 specs', url: 'https://enterprise.dji.com/matrice-30/specs' },
        { label: 'Borg Expert: Matrice 30T contract', url: 'https://borgexpert.com/ru/news/ahentstvo-oboronnykh-zakupok-zakazalo-samye-deshevye-drony-matrice-30t' },
      ],
    },
  },
  matrice300: {
    variantOf: 'fpv', origin: 'Commercial off the shelf', name: 'DJI Matrice 300 RTK with a munition', label: 'Matrice 300',
    speed: 17, alt: [60, 200], size: 0.9, evade: 0.85, rcs: 0.02, ...COMMERCIAL, warhead: 2, cost: 6800,
    usedBy: 'One 2022 report of Ukrainian forces carrying munitions on it, with no mass given.',
    published: 'Cruise about 61 km/h, top about 83 km/h. Up to 55 minutes. 0.9 m across, 6.3 kg. 2.4 and 5.8 GHz links, with satellite navigation. The game assumes a 2 kg munition.',
    assumed: 'Height 60 to 200 m, as for the Mavic 3. Agility 0.85, as a camera quad.',
    costRef: {
      note: 'No price found on any page opened. The game borrows the Matrice 30T’s, so treat it as a rough stand-in.',
      confidence: 'Not public',
      sources: [
        { label: 'Drone Spec: Matrice 300', url: 'https://dronespec.dronedesk.io/dji-matrice-300' },
        { label: 'Clifton Cameras: Matrice 300 RTK specs', url: 'https://www.cliftoncameras.co.uk/uploads/specifications/DJI%20Matrice%20300%20RTK.pdf' },
        { label: 'DroneXL: Matrice 300 in Ukraine', url: 'https://dronexl.co/2022/07/10/dji-matrice-300-ukrainian-forces-mortars' },
      ],
    },
  },
  agrast30: {
    variantOf: 'fpv', origin: 'Commercial off the shelf', name: 'DJI Agras T30 as a heavy bomber', label: 'Agras T30',
    speed: 10, size: 2.1, evade: 0.95, rcs: 0.1, sound: 3, ...COMMERCIAL, warhead: 20, cost: 23000,
    usedBy: 'A farm drone. Ukrainian use with added weapons is reported, naming the T30.',
    published: 'Top speed 36 km/h, working speed about 25 km/h. Up to about 20 minutes. 2.1 m across, 78 kg fully loaded. Crop load 30 kg. 2.4 and 5.8 GHz links. The 20 kg bomb load the game uses is reported for an unnamed farm hexacopter, not confirmed for this model.',
    costRef: {
      note: '$39,000 on a New Zealand retailer’s page, probably New Zealand dollars. About $23,000 at about 0.6; the conversion is mine.',
      confidence: 'Retail listing; currency uncertain',
      sources: [
        { label: 'DJI: Agras T30 specs', url: 'https://www.dji.com/t30/specs' },
        { label: 'Ferntech: Agras T30', url: 'https://www.ferntech.co.nz/dji-agras-t30' },
        { label: 'Army Recognition: armed farm drone', url: 'https://www.armyrecognition.com/focus-analysis-conflicts/army/conflicts-in-the-world/russia-ukraine-war-2022/ukrainian-farm-drone-now-armed-with-pkm-7-62-mm-machine-gun-and-bullspike-at-grenade-launcher' },
        { label: 'Kyiv Post: Baba Yaga', url: 'https://www.kyivpost.com/amp/post/31150' },
      ],
    },
  },
  evomax4t: {
    variantOf: 'fpv', origin: 'Commercial off the shelf', name: 'Autel EVO Max 4T with a small munition', label: 'EVO Max 4T',
    speed: 23, alt: [60, 200], size: 0.46, evade: 0.85, ...COMMERCIAL, warhead: 0.5, cost: 5400,
    usedBy: 'Bought for Ukrainian forces. A Russian link rests on one Bloomberg report, which Autel denies. Munition use is not confirmed on any page opened.',
    published: 'Top speed about 83 km/h, from a reseller. Up to 42 minutes. 0.46 m across, 1.6 kg. 2.4 and 5.8 GHz links among others, with satellite navigation. No source gives a munition mass: the game assumes 0.5 kg.',
    assumed: 'Height 60 to 200 m, as for the Mavic 3. Agility 0.85, as a camera quad.',
    costRef: {
      note: '223,700 UAH per kit in a Ukrainian defence contract, April 2025. About $5,400 at about 41.5 UAH/$; the dollar conversion is mine.',
      confidence: 'Contract reporting; currency converted by approximation',
      sources: [
        { label: 'Autel: EVO Max 4T brochure', url: 'https://cdn.shopify.com/s/files/1/0047/0247/0190/files/EVOMax4TBrochure.pdf' },
        { label: 'Economic Pravda: procurement', url: 'https://epravda.com.ua/rus/oborona/kakie-drony-zakazalo-agentstvo-oboronnyh-zakupok-806296/' },
        { label: 'Euromaidan Press: Autel and Bloomberg', url: 'https://euromaidanpress.com/2025/07/08/china-helped-build-the-drones-now-hitting-ukraine-bloomberg-traces-the-parts/' },
      ],
    },
  },
  fpv7inch: {
    variantOf: 'fpv', origin: 'Commercial off the shelf', name: 'Typical 7-inch first-person-view quadcopter (not one product)', label: '7-inch quad',
    speed: 31, size: 0.33, warhead: 1.75, cost: 700,
    usedBy: 'Both sides in Russia-Ukraine, and the hobby market worldwide. A category, not a product.',
    published: 'Top speed 80 to 140 km/h (game uses 110). Range 7 to 20 km. 6 to 25 minutes. About 0.33 m across, 0.65 to 2.5 kg. Carries 0.5 to 3 kg (game uses 1.75). Common links include 900 MHz and 2.4 GHz for control and 5.8 GHz for video. Hobby sources, so indicative only.',
    costRef: {
      note: 'About $400 in parts for a cheap build, up to about $1,000 for retail. Game uses $700.',
      confidence: 'Hobby and press figures',
      sources: [
        { label: 'Grepow: 7-inch first-person-view drones', url: 'https://www.grepow.com/blog/what-is-a-7-inch-fpv-drone.html' },
        { label: 'RobotShop: iFlight 7-inch', url: 'https://uk.robotshop.com/products/iflight-sh-cinelr-7-o4-6s-hd' },
        { label: 'Militarnyi: first-person-view drones', url: 'https://militarnyi.com/en/articles/fpv-drones-weapons-that-changed-the-modern-war' },
      ],
    },
  },
  fpvlastmile: {
    variantOf: 'fpv', origin: 'Commercial off the shelf', name: 'First-person-view quadcopter with a last-mile homing module (not one product)', label: 'Last-mile FPV',
    speed: 31, size: 0.33, warhead: 1.75, cost: 700, terminal: 500,
    usedBy: 'Ukrainian units, with modules from The Fourth Law and TAF Drones. A category, not a product.',
    published: 'Retrofit modules lock onto a target and fly the last stretch themselves, so jamming and lost video no longer stop the drone: up to 500 m for the TFL-1 and the TAF Last Mile module, by their makers. These are company claims, not independent tests. Flight figures copy the 7-inch quad.',
    assumed: 'Homing over the last 500 m, the makers’ figure. Price is the 7-inch quad’s: no module price was found.',
    costRef: {
      note: NO_PRICE_MODULE,
      confidence: 'Not public',
      sources: [
        { label: 'Kyiv Post: FPV drones with autonomous terminal guidance', url: 'https://www.kyivpost.com/post/60152' },
        { label: 'Defence Connect: The Fourth Law final approach module', url: 'https://www.defenceconnect.com.au/industry/16455-fourth-law-announces-successful-results-with-fpv-drone-final-approach-autonomy-module' },
        { label: 'Euromaidan Press: terminal guidance past jamming', url: 'https://euromaidanpress.com/2025/05/29/new-footage-shows-ukraines-fpv-drone-bypasses-jamming-in-autonomous-strike/' },
      ],
    },
  },
  mini4pro: {
    variantOf: 'spotter', origin: 'Commercial off the shelf', name: 'DJI Mini 4 Pro (reconnaissance)', label: 'Mini 4 Pro',
    model: 'quad', airframe: 'Multirotor', bank: 0, speed: 12, alt: [60, 200], size: 0.37, hp: 20, evade: 0.85,
    ...COMMERCIAL, jamResist: 0, adapt: 1, rcs: 0.01, rfPower: 1, sound: 1, loiterDist: 1000, cost: 759,
    usedBy: 'The Mini family. CNA lists the Mini 2 and 3 Pro among commercial drones used by Russian forces for reconnaissance (2023). No report names the Mini 4 Pro itself.',
    published: 'Up to 16 m/s in Sport mode, 12 m/s in Normal (game uses 12). Up to 34 minutes. Under 249 g, 0.37 m across unfolded. O4 links at 2.4, 5.1 and 5.8 GHz, with satellite navigation; the game has no 5.1 GHz band. No payload is reported: it spots for strikes rather than carrying one.',
    assumed: `${QUAD_HEIGHT} Agility 0.85, as a camera quad. It orbits 1 km out, as it is short-ranged.`,
    costRef: {
      note: 'Launch price $759 with the RC-N2 controller.',
      confidence: 'Press report of a retail price',
      sources: [
        { label: 'DJI: Mini 4 Pro specs', url: 'https://www.dji.com/mini-4-pro/specs' },
        { label: 'The Shortcut: Mini 4 Pro prices', url: 'https://www.theshortcut.com/p/dji-mini-4-pro-news-announcement' },
        CNA,
      ],
    },
  },
  mavic3t: {
    variantOf: 'fpv', origin: 'Commercial off the shelf', name: 'DJI Mavic 3T with a small munition', label: 'Mavic 3T',
    speed: 15, alt: [60, 200], size: 0.38, evade: 0.85, ...COMMERCIAL, warhead: 0.3, cost: 4999,
    usedBy: 'Russia: a regional government gave 15 to Russian forces in April 2025, and Human Rights Watch names it among drones Russian forces used in Kherson (2025). Ukraine also flies it.',
    published: 'Up to 15 m/s in Normal mode and 21 m/s in Sport (game uses 15). Up to 45 minutes. 0.38 m across, 920 g. O3 Enterprise links at 2.4 and 5.8 GHz, with satellite navigation, and a thermal camera. A leaked Russian manual gives about 300 g of munitions for the Mavic 3 and Autel drones.',
    assumed: `${QUAD_HEIGHT} Agility 0.85, as a camera quad.`,
    costRef: {
      note: 'Launch price $4,999 for the standard version. Ukraine bought sets at about $3,300 to $3,400.',
      confidence: 'Press reports of retail and state purchase prices',
      sources: [
        { label: 'DJI: Mavic 3 Enterprise specs', url: 'https://enterprise.dji.com/mavic-3-enterprise/specs' },
        { label: 'Drone Girl: Mavic 3 Enterprise', url: 'https://www.thedronegirl.com/2022/10/03/dji-mavic-3-enterprise/' },
        HRW, MANUAL, KYIV_POST,
      ],
    },
  },
  mavic3pro: {
    variantOf: 'fpv', origin: 'Commercial off the shelf', name: 'DJI Mavic 3 Pro with a small munition', label: 'Mavic 3 Pro',
    speed: 15, alt: [60, 200], size: 0.38, evade: 0.85, ...COMMERCIAL, warhead: 0.3, cost: 2199,
    usedBy: 'Human Rights Watch names it among drones Russian forces used in Kherson (2025). Ukraine also flies it for reconnaissance.',
    published: 'Top speed 21 m/s (game uses 15, as for the Mavic 3). Up to 43 minutes. About 0.38 m across, 958 g. O3+ links at 2.4 and 5.8 GHz, with satellite navigation. A leaked Russian manual gives about 300 g of munitions for the Mavic 3 and Autel drones.',
    assumed: `${QUAD_HEIGHT} Agility 0.85, as a camera quad.`,
    costRef: {
      note: 'Launch price $2,199 with the DJI RC controller.',
      confidence: 'Press report of a retail price',
      sources: [
        { label: 'DJI: Mavic 3 Pro specs', url: 'https://www.dji.com/mavic-3-pro/specs' },
        { label: 'Wccftech: Mavic 3 Pro prices', url: 'https://wccftech.com/dji-mavic-3-pro-and-mavic-3-pro-cine-announced/' },
        HRW, MANUAL,
      ],
    },
  },
  evo2t: {
    variantOf: 'fpv', origin: 'Commercial off the shelf', name: 'Autel EVO II Dual 640T with a small munition', label: 'EVO II 640T',
    speed: 15, alt: [60, 200], size: 0.36, evade: 0.85, ...COMMERCIAL, warhead: 0.3, cost: 5999,
    usedBy: 'Human Rights Watch identified an EVO II series drone with Russian forces (2025), and CNA lists Autel EVO variants for reconnaissance and light combat (2023). No report names the 640T itself. Ukraine was given 640Ts in 2022.',
    published: 'Top speed 20 m/s (game uses 15). Up to 38 minutes. 0.36 m across unfolded, 1,150 g. SkyLink 2.0 at 2.4 and 5.8 GHz, and 900 MHz in FCC countries only, with satellite navigation, and a thermal camera. Ceiling 7,000 m. A leaked Russian manual gives about 300 g of munitions for Autel and Mavic 3 drones.',
    assumed: `${QUAD_HEIGHT} Agility 0.85, as a camera quad. Its 900 MHz link is left out, as it is for FCC countries only.`,
    costRef: {
      note: '$5,999 for the V3 at an authorised dealer.',
      confidence: 'Dealer listing',
      sources: [
        { label: 'Autel: EVO II Dual 640T V3 brochure', url: 'https://cdn.shopify.com/s/files/1/0047/0247/0190/files/EVO_II_Dual_640T_V3_Brochure-EN.pdf' },
        { label: 'Autelpilot: 640T V3 price', url: 'https://www.autelpilot.com/blogs/news/autel-640t-v3-8k-thermal-imaging-long-range-drone' },
        HRW, CNA, MANUAL,
      ],
    },
  },
  fpv10inch: {
    variantOf: 'fpv', origin: 'Commercial off the shelf', name: 'Typical 10-inch first-person-view quadcopter (not one product)', label: '10-inch quad',
    speed: 22, size: 0.43, evade: 0.6, ...HOBBY_LONG, warhead: 3, cost: 450,
    usedBy: 'Both sides in Russia-Ukraine. Russian examples include the Veter-10 and Boomerang-10. A category, not a product.',
    published: 'Cruise about 70 to 100 km/h (game uses 80), top 100 to 150 km/h. About 20 minutes. About 0.43 m motor to motor. Control often on 900 MHz long-range links, video on 5.8 GHz; some move video to 1.2 or 3.3 GHz, or above 6 GHz for the Russian Boomerang-10, which the game has no bands for. Reported payloads: 3.5 kg at most for the Veter-10, up to 3 kg for the Boomerang-10 (game uses 3). Maker, retailer and Ukrainian military intelligence figures.',
    assumed: 'Height is its type’s. Agility 0.6, as an operator-flown strike quad.',
    costRef: {
      note: 'About $360 to $430 for a Ukrainian 10-inch, and about $500 for a captured Russian one. Game uses $450.',
      confidence: 'Maker and press figures',
      sources: [
        { label: 'BlueBird: Zhakh 10', url: 'https://www.blue-bird.tech/en/products/fpv-drone-horror-10-by-bluebird/' },
        { label: 'War&Sanctions: Veter-10', url: 'https://war-sanctions.gur.gov.ua/en/uav/455' },
        { label: 'Militarnyi: Boomerang-10 frequencies', url: 'https://militarnyi.com/en/news/russian-boomerang-fpv-drones-shifted-to-frequencies-unavailable-to-most-detectors/' },
      ],
    },
  },
  fpv13inch: {
    variantOf: 'fpv', origin: 'Commercial off the shelf', name: 'Typical 13-inch first-person-view quadcopter (not one product)', label: '13-inch quad',
    speed: 22, size: 0.52, evade: 0.65, rcs: 0.02, sound: 1.5, ...HOBBY_LONG, warhead: 6, cost: 900,
    usedBy: 'Both sides in Russia-Ukraine. Russian examples include the Piranha-13 and Veter-13; Ukraine fields 13-inch bombers. A category, not a product.',
    published: 'Cruise about 70 to 90 km/h (game uses 80), top 100 to 135 km/h. About 15 minutes. 0.48 to 0.56 m motor to motor. Control on 900 MHz, video on 5.8 GHz. Reported payloads: up to 8 kg for the Russian Piranha-13 and Veter-13, and 3 to 4.5 kg for Ukrainian ones (game uses 6). Maker, retailer, Ukrainian military intelligence and TASS figures.',
    assumed: 'Height is its type’s. Agility 0.65, a little below the smaller quads for its weight. Its radar cross-section and loudness are assumptions for a larger frame.',
    costRef: {
      note: 'About $750 to $900 for a Ukrainian 13-inch. Game uses $900.',
      confidence: 'Maker figures',
      sources: [
        { label: 'BlueBird: Zhakh 13', url: 'https://www.blue-bird.tech/en/products/fpv-drone-horror-13-by-bluebird/' },
        { label: 'War&Sanctions: Veter-13', url: 'https://war-sanctions.gur.gov.ua/en/uav/456' },
        { label: 'www1.ru (TASS): Piranha-13, up to 8 kg', url: 'https://www1.ru/news/2024/04/12/eshhe-bolse-vzryvcatki-dlia-porazeniia-protivnika-fpv-dron-pirania-13-smozet-nesti-do-8-kilogrammov.html' },
      ],
    },
  },
};
