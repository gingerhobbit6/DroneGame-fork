// Each radar's and jammer's rated RF output, in watts: the standard its Transmit power setting starts from. Range and signature
// go with the share of it used. Radars are average power (Blighter and IRIS transmit continuously, so peak is the same); jammers
// are total output across their bands. Where a maker publishes none, the figure is an ASSUMPTION from comparable systems.

const published = (watts, basis, url) => ({ watts, confidence: 'published', basis, url });
const secondary = (watts, basis, url) => ({ watts, confidence: 'secondary', basis, url });
const assumed = (watts, basis) => ({ watts, confidence: 'assumption', basis });

export const TX_POWER = {
  radar_s: assumed(2, 'Only its 50 W electrical draw is published; about 4% of draw, as for the Blighter and IRIS'),
  radar_a400: published(4, 'Transmitter power (nominal) 4 W', 'https://blighter.com/wp-content/uploads/2025/10/blighter-a400-series-radars-datasheet-bss-1311.pdf'),
  radar: published(12, 'Power output 12 W (one report gives 2 x 12 W from two faces)', 'https://www.robinradar.com/hubfs/IRIS%20product%20sheet%20042026.pdf'),
  radar_a800: published(4, 'Mk 2: transmitter power (nominal) 4 W', 'https://blighter.com/wp-content/uploads/2025/10/blighter-a800-mk-2-4d-multi-mode-radar-datasheet-bss-4003-MR.pdf'),
  radar_xenta: secondary(240, 'solid-state GaN at 240 W, twice the 120 W of the XENTA-M3', 'https://www.weibelradars.com/wp-content/uploads/2026/01/XENTA-M-Brochure.pdf'),
  radar_giraffe: assumed(150, 'Only a 2.3 kW peak draw is published; average RF taken as 5 to 10% of it'),
  radar_l: assumed(100, 'Only draw is published (1,700 W antenna); average RF per 120° antenna, against 8 W for the older 2D Spexer'),
  jammer_neo: published(45, '45 W output power, 20 MHz to 6 GHz', 'https://www.kirintec.com/wp-content/uploads/2022/12/Kirintec-K-CEMA-NEO-A4-0722-WEB.pdf'),
  jammer_jupiter: secondary(600, 'up to 600 W (Alex); a trade report gives 450 W, 20 MHz to 6 GHz', 'https://www.armadainternational.com/2022/10/ew-live-counter-drone-event/'),
  jammer_auds: published(150, 'AUDS Claw inhibitor: 5 bands, 150 W total (Enterprise Control Systems)', 'https://www.targikielce.pl/storage/file/core_files/2023/8/29/798c5bd3e37304bd0fbf22628edc4d23/ECS-RF-Inhibition-Brochure-25102021-1.pdf'),
  jammer_sf: published(800, '800 W across 8 channels, 300 to 6000 MHz and GNSS', 'https://sensofusion.com/military/'),
  jammer_mk4: assumed(40, 'None published; handheld jammers of its weight give about 10 W a band'),
  jammer_skywiper: secondary(40, '4 antennas of 10 W each', 'https://en.wikipedia.org/wiki/EDM4S'),
  jammer_vepr: secondary(400, '4 modules of 100 W each, from a retailer', 'https://flasharmy.com.ua/en/kvertus-ad-vepr-m100'),
  jammer_kvertus: secondary(110, '6 channels, 110 W in all, from a retailer (another report gives 90 W)', 'https://flasharmy.com.ua/en/kvertus-ad-g-6-plus'),
  jammer_dgmk3: assumed(10, 'None published; half the Tactical\'s range suggests about a quarter of its power'),
  jammer_dgtac: assumed(40, 'None published; a rifle-sized jammer, like the SkyWiper\'s 40 W'),
  jammer_s: assumed(10, 'A generic jammer of the DroneGun MkIII class'),
  jammer: assumed(40, 'A generic jammer of the DroneGun Tactical class'),
  jammer_l: assumed(400, 'A generic site jammer, between the AUDS (150 W), Jupiter (450 W) and Sensofusion (800 W)'),
};
