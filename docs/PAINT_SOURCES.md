# Paint sources

The colours the 3D models wear (`frontend/src/render/paint.js`), checked against photos of the real products in November 2026: makers' pages, press photos, Wikimedia Commons and wreckage photos. Each hex is an estimate of how the product looks in daylight, not a paint code; no maker publishes those. Confidence: high is a maker photo or a clear photo of the real thing, medium is secondary photos, low is inferred.

A system's map colour (`def.color`) is kept for its label, its rings and a thin ring at its foot. Vehicles, cases and boxes are NATO green (`#4d5a3c`), or tan where the real system rides desert vehicles (Coyote, LOCUST, Iron Beam). The Hilux is military olive, as in British service.

## Systems

| id | Product | Colour | Confidence | Source | Note |
|---|---|---|---|---|---|
| radar | Robin Radar IRIS | white `#edeeec` | high | https://www.robinradar.com/products/iris-radar | black base; an olive version exists |
| radar_s | Echodyne EchoGuard | desert tan `#b7a98a` | high | https://www.defenseadvancement.com/company/echodyne/echoguard-radar/ | grey or white versions exist |
| radar_a800 | Blighter A800 | sand `#c8b48e` | high | https://www.blighter.com/products/a800-3d-multi-mode-radar | |
| radar_a400 | Blighter A400 | sand `#c9b58f` | high | https://www.blighter.com/?p=358 | light grey civil finish exists |
| radar_l | Hensoldt Spexer 2000 3D MkIII | bronze green `#56603f` | high | https://www.hensoldt.net/products/spexer-2000-3d-mkiii-land-ground-based-air-defence | |
| radar_giraffe | Saab Giraffe 1X | sage green `#66704f` | high | https://www.saab.com/newsroom/press-kits/eurosatory-2024 | Sea Giraffe 1X is grey |
| rf | Dedrone RF-360 | white `#f1f2f2` | high | https://www.dedrone.com/sensors/rf-360 | blue band not drawn |
| rf_s | MyDefence Wingman | black `#262729` | high | https://www.everythingrf.com/products/cuas-counter-unmanned-aerial-system/mydefence/1075-2458-wingman-105 | tan and olive versions exist |
| rf_elysion | Hensoldt Elysion direction finder | grey `#a9aeb1` | low | https://www.hensoldt.net/insights/Drone-alert-over-Europe | antenna by Rohde & Schwarz, model not public |
| rf_l | Aaronia AARTOS | white `#eeeeee` | high | https://everythingrf.com/products/cuas-counter-unmanned-aerial-system/aaronia-ag/1075-281-aartos-x9 | black base |
| rf_airfence | Sensofusion Airfence 7 | black `#1f2124` | high | https://sensofusion.com/ | |
| camera | generic EO/IR turret | light grey `#bfc4c6` | medium | https://www.cantronics.com/dense | military ones olive or sand |
| camera_s | Teledyne FLIR Boson 640 | black `#1d1d1f` | high | https://oem.flir.com/products/boson/ | |
| camera_l | long-zoom MWIR turret | off-white `#d8dad6` | medium | https://www.x20.org/m9-x-long-range-thermal-ir-imaging-ptz-flir-zoom-camera/ | military ones olive or sand |
| acoustic_s | ZVOOK NW0 | light grey `#c4c7c9` | high | https://www.unmannedairspace.info/counter-uas-systems-and-policies/ukrainian-start-up-zvook-launches-new-low-cost-c-uas-acoustic-sensor/ | |
| acoustic | Squarehead Discovair G2+ | charcoal `#2e3032` | high | https://cuashub.com/product/discovair-g2/ | tan version exists |
| acoustic_l | ZVOOK listening station | white `#e6e7e5` | medium | https://militarnyi.com/en/news/nato-shows-interest-in-ukrainian-acoustic-detection-networks-for-air-defense/ | |
| jammer | generic tripod jammer | dark grey `#2c2e30` | low | https://www.unmannedsystemstechnology.com/expo/drone-jammers/ | |
| jammer_s | generic small tripod jammer | dark grey `#2f3133` | low | https://www.unmannedsystemstechnology.com/expo/drone-jammers/ | |
| jammer_l | generic fixed-site jammer | light grey `#a6aaad` | low | https://www.antidrone-device.com/sale-53802210-360-omnidirectional-drone-jammer-system-24-7-unmanned-defense-operations.html | |
| jammer_auds | Blighter AUDS RF inhibitor | desert tan `#c2aa7e` | high | https://blighter.com/worlds-first-fully-integrated-anti-uav-defence-system-auds-now-features-quad-band-rf-inhibitor-and-optical-disruptor/ | |
| jammer_neo | Kirintec K-CEMA NEO | olive drab `#5c6047` | medium | https://www.scopex.fr/en/products/k-cema-neo-jamming-system | |
| jammer_jupiter | Kirintec K-CEMA Jupiter | olive drab `#5c6047` | medium | https://www.scopex.fr/en/products/k-cema-kube-jupiter | host vehicle not public |
| jammer_sf | Sensofusion Portable Asymmetric Jammer | black `#1e1f21` | high | https://sensofusion.com/military/ | |
| jammer_mk4 | DroneShield DroneGun Mk4 | charcoal `#2d2f31` | high | https://www.droneshield.com/c-uas-products/dronegun-mk4 | |
| jammer_dgmk3 | DroneShield DroneGun MkIII | black `#2b2d2f` | high | https://www.suasnews.com/2019/07/droneshield-releases-dronegun-mkiii/ | |
| jammer_dgtac | DroneShield DroneGun Tactical | black `#232425` | high | https://www.droneshield.com/products-dismounted | |
| jammer_skywiper | NT Service EDM4S SkyWiper | dark grey `#34373a` | high | https://commons.wikimedia.org/wiki/File:EDM4S_SkyWiper.jpg | |
| jammer_kvertus | Kvertus AD G-6+ | black `#2a2b2d` | high | https://www.armyrecognition.com/archives/archives-land-defense/land-defense-2024/wds-2024-ukraine-displays-kvertus-ad-g-6-and-ad-counter-fpv-counter-drone-systems | |
| interceptor | Wild Hornets Sting | khaki `#a79d6e` | medium | https://censor.net/en/resonance/3607203/the-story-of-sting-how-the-wild-hornets-made-the-drone-interceptor-everyone-wants | some batches dark grey |
| interceptor_p1 | SkyFall P1-SUN | black `#1e1e1f` | high | https://www.pravda.com.ua/eng/news/2026/07/21/8045166/ | |
| interceptor_s | Fortem DroneHunter F700 | white shell `#e9e9e7` | high | https://www.fortemtech.com/ | black frame and arms |
| interceptor_l | Project Eagle Merops | light grey `#bdc1c3` | medium | https://en.wikipedia.org/wiki/Merops_(weapon) | |
| missile | Raytheon Coyote Block 2 | desert tan `#c1a87c` | high | https://www.twz.com/news-features/army-coyote-drone-hunting-drones-have-scored-170-combat-kills | tan vehicle |
| missile_s | Frankenburg Mark I | dark olive grey `#4c504a` | medium | https://euro-sd.com/2026/01/articles/exclusive/48478/assessing-air-defence-requirements-for-ground-formations-on-the-modern-battlefield/ | trial hardware |
| missile_l | NASAMS canister launcher | olive green `#5a6a45` | high | https://www.kongsberg.com/news/news-archive/2022/kongsberg-achieves-factory-acceptance-test-of-the-first-canister-launchers-for-armys-nasams-capability/ | sand for some users |
| missile_rr | Thales Rapid Ranger | olive drab `#5e6146` | high | https://www.thalesgroup.com/en/solutions-catalogue/defence/rapidranger | |
| missile_hvm | Stormer HVM | NATO green `#4b5640` | high | https://en.wikipedia.org/wiki/Alvis_Stormer | black disruptive pattern not drawn |
| missile_skysabre | Sky Sabre / Land Ceptor | British Army green `#4e5a3d` | high | https://defence.nridigital.com/global_defence_technology_yearbook_2018/sky_sabre_inside_the_uks_missile_defence_system | |
| missile_paladin | MSI-DS Terrahawk Paladin | British green `#4f5e3b` | high | https://www.msi-dsl.com/products/msi-ds-terrahawk-vshorad/ | |
| laser | UK DragonFire | white `#e7e8e4` | high | https://www.navylookout.com/dragonfire-pathway-to-a-laser-directed-energy-weapon-for-royal-navy/ | |
| laser_s | AeroVironment LOCUST | desert tan `#c2a97d` | high | https://www.armyrecognition.com/news/army-news/2026/u-s-army-tests-aerovironments-locust-laser-drone-defense-system-for-homeland-airspace-security | tan vehicle |
| laser_l | Rafael Iron Beam | sand `#bca886` | medium | https://www.rafael.co.il/system/iron-beam/ | sand vehicle |
| laser_rfdew | Thales RapidDestroyer | light grey `#e2e3e0` | high | https://www.thalesgroup.com/en/news-centre/news-brief/united-kingdom/thales-energy-weapon-neutralises-80-drones-successful-trial | demonstrator |
| gun_l | Rheinmetall Skynex | olive grey `#6b6f5d` | medium | https://www.armyrecognition.com/news/army-news/2026/romania-to-order-7-rheinmetall-skynex-air-defense-systems-under-european-safe-program | |
| gun_skyranger | Rheinmetall Skyranger 30 | bronze green `#4e5a3e` | high | https://esut.de/en/2024/02/meldungen/47709/bundeswehr-beschafft-19-flugabwehrsysteme-skyranger-30-auf-boxer/ | Boxer camouflage not drawn |
| gun_gepard | Flakpanzer Gepard | dark green `#4e5c3e` | medium | https://www.cnn.com/2023/05/27/europe/ukraine-air-defense-gepard-intl | many still in 3-colour camouflage |
| gun_hmg | 12.7 mm remote weapon station | olive `#5a6146` | low | https://www.joint-forces.com/defence-equipment-news/36838-kongsberg-delivers-20000th-remote-weapon-station | US ones mostly tan |
| gun_s, gun_50 | L7A2 GPMG, L111A1 HMG | dark steel `#2a2b2a` | medium | https://en.wikipedia.org/wiki/FN_MAG | not checked against photos |
| (vehicles) | Patria 6x6, trucks, trailers, THeMIS | NATO green `#4d5a3c` | high | https://milremrobotics.com/milrem-robotics-showcases-themis-combat-cargo-ugv-at-defense-security-2025/ | Patria's 3-colour camouflage not drawn |
| (vehicles) | Toyota Hilux, military | olive `#4d5a3c` | medium | https://www.opex360.com/2026/06/27/exit-le-land-rover-les-forces-speciales-de-la-british-army-vont-recevoir-270-vehicules-de-type-pick-up-toyota-hilux/ | also tan and UN white |
| gun_shotgun | 12-gauge shotgun | black `#1f2021` | medium | https://armadainternational.com/?p=23813 | |
| gun_droneround | 5.56 mm rifle | coyote and black `#4b4a3f` | low | https://dronerounddefense.com/ | the rifle, not the round |
| rf_rfpatrol | DroneShield RfPatrol Mk2 | black case `#2b2c2e` | medium | https://www.droneshield.com/rfpatrol-mk2 | |
| rf_chuyka | BlueBird Chuyka 3.0 | black case `#26282a` | medium | https://www.blue-bird.tech/en/products/chuyka-3-0/ | |
| camera_podview | Overview PodView2600 | grey `#8f9496` | low | https://overview.co.uk/product/podview-family/ | marine-grade finish; colour not stated |
| radar_xenta | Weibel XENTA-M5 | army green `#56603f` | low | https://www.weibelradars.com/wp-content/uploads/2026/01/XENTA-M-Brochure.pdf | inferred from military fits |
| jammer_vepr | Kvertus AD VEPR M100 | olive `#4f5640` | low | https://flasharmy.com.ua/en/kvertus-ad-vepr-m100 | |

## Drones

| id | Drone | Colour | Confidence | Source | Note |
|---|---|---|---|---|---|
| fw, geran2 | Shahed-type, Geran-2 (Russian-built) | matte black `#1b1c1e` | high | https://united24media.com/latest-news/russias-geran-2-drones-upgraded-with-napalm-like-incendiaries-and-air-burst-fragments-12335 | black since late 2023; white reported in 2026, no photos found |
| shahed136, shahed131 | Shahed-136, Shahed-131 (Iranian) | light grey `#c5c9cc` | high | https://missilethreat.csis.org/missile/shahed-131-and-136/ | some black |
| geran3 | Geran-3 / Shahed-238 | matte black `#1b1c1e` | high | https://dev.ua/en/news/syly-oborony-zakhopyly-neushkodzhenyi-reaktyvnyi-dron-heran-3-z-kameroiu-ta-mesh-zviazkom-1764235139 | |
| gerbera | Gerbera decoy | black `#2a2b2d` | medium | https://united24media.com/latest-news/russian-gerbera-drone-downed-by-ukrainian-fpv-3300 | white nearly as common |
| spotter, orlan10 | Orlan-10 | light grey `#d3d6d8` | high | https://commons.wikimedia.org/wiki/Category:Orlan-10_in_the_2022_Russian_invasion_of_Ukraine | |
| lancet3 | ZALA Lancet-3 | pale grey `#d4d7d9` | high | https://commons.wikimedia.org/wiki/Category:ZALA_Lancet | |
| molniya2 | Molniya-2 | white `#ececea` | high | https://www.forbes.com/sites/vikrammittal/2026/04/27/russian-molniya-2-drone-evades-ukrainian-counter-drone-defenses/ | black booms, plywood |
| kvn | KVN fibre-optic | mustard yellow `#c8b540` | high | https://thedefender.media/wp-content/uploads/2025/07/rq8ujnzmalhdpvhrxye1-1024x614.webp | fibreglass frame |
| mohajer6 | Mohajer-6 | light grey `#c9ccce` | high | https://www.oryxspioenkop.com/2021/08/iranian-mohajer-6-drones-spotted-in.html | |
| ababil2 | Ababil-2 | white `#e2e4e5` | medium | https://en.topwar.ru/213983-mnogocelevoj-bpla-ababil-2-iran.html | many versions |
| ch901 | CH-901 | light grey `#cdd0d2` | medium | https://tvd.im/aviation/5842-casc-ch901.html | pale blue seen too |
| feilong300d | Feilong-300D | light grey `#c3c7ca` | medium | https://defencesecurityasia.com/en/china-feilong-300d-10000-suicide-drone-asia-warfare/ | show units only |
| sunflower200 | Sunflower-200 | light grey `#cfd2d4` | medium | https://www.janes.com/defence-intelligence-insights/defence-news/air/umex-2024-cobtec-sunflower-200-uav-to-enter-into-service-with-uae | show units only |
| asn209 | ASN-209 | white `#eeefee` | high | https://www.armyrecognition.com/archives/archives-land-defense/land-defense-2021/egyptian-armed-forces-showcases-aisheng-asn-209-uav | |
| asn301 | ASN-301 | light grey `#cbced0` | high | https://www.globalsecurity.org/military/world/china/asn-301.htm | |
| skywalker | Skywalker X8 | white foam `#f2f2f0` | high | https://www.aeroflyhobbies.com/fpv-and-uav-kits/108-skywalker-x8-flying-wing-2120mm-fpvuav-airplane-kit.html | |
| wingloong2 | Wing Loong II | light grey `#b9bfc4` | high | https://www.armyrecognition.com/military-products/army/unmanned-systems/unmanned-aerial-vehicles/wing-loong-ii-2-uav-male-armed-drone-data-pictures-video-11906174 | |
| mavic3, mavic3t, mavic3pro | DJI Mavic 3 | dark grey `#4a4d51` | high | https://www.dji.com/mavic-3-pro | |
| mini4pro | DJI Mini 4 Pro | light grey `#b8bbbe` | high | https://www.dji.com/mini-4-pro | |
| matrice30t | DJI Matrice 30T | charcoal `#3d4044` | high | https://enterprise.dji.com/matrice-30 | |
| matrice300 | DJI Matrice 300 RTK | near black `#2b2d30` | high | https://enterprise.dji.com/matrice-300 | |
| agrast30 | DJI Agras T30 | light grey `#d0d3d5` | high | https://www.dji.com/t30 | black arms not drawn |
| evomax4t | Autel EVO Max 4T | mid grey `#85898d` | high | https://auteldrones.com/products/evo-max-4t | |
| evo2t | Autel EVO II Dual 640T | Autel orange `#f0641e` | medium | https://www.autelpilot.com/blogs/news/autel-evo-ii-v3-gray-color-update | a grey version is sold too |
| fpv, fo, fpv7inch, fpv10inch | FPV quadcopters | black carbon `#1c1c1c` | high | https://www.reuters.com/pictures/drones-war-uavs-frontlines-ukraine-2024-01-30/ | olive warhead not drawn |
| fpv13inch, fpvlastmile | larger FPV quadcopters | black carbon `#1c1c1c` | low | inferred from the smaller ones | |
