# Sensors

This is the inventory of every sensor the defender can buy: radars, RF detectors, EO/IR cameras and acoustic sensors, with the figures the simulation uses and where each one comes from. It is written for a defence reader who wants to know what the numbers mean and how far to trust them, and for a developer who wants to change them. How a range becomes a detection on a real map (terrain, trees, propagation, clutter and weather) is in [PHYSICS_AND_PROPAGATION.md](PHYSICS_AND_PROPAGATION.md).

## Contents

- [How to read the tables](#how-to-read-the-tables)
- [The four kinds at a glance](#the-four-kinds-at-a-glance)
- [How range changes with the target](#how-range-changes-with-the-target)
- [Radars](#radars)
- [RF detectors](#rf-detectors)
- [EO/IR cameras](#eoir-cameras)
- [Acoustic sensors](#acoustic-sensors)
- [The perimeter sensor](#the-perimeter-sensor)
- [Limits and simplifications](#limits-and-simplifications)
- [Where this lives in the code](#where-this-lives-in-the-code)

The tables below were generated from the config modules by a script, so the numbers are copied exactly. If you change a figure in config, these tables go out of date.

## How to read the tables

- **Where the numbers live.** Each sensor is an entry in `SENSORS` ([`sensors.js:7`](../frontend/src/sim/config/sensors.js#L7)), `UK_SYSTEMS` ([`uk-systems.js:4`](../frontend/src/sim/config/uk-systems.js#L4)) or `EU_SYSTEMS` ([`eu-systems.js:4`](../frontend/src/sim/config/eu-systems.js#L4)), all merged into `STRUCTURES` ([`systems.js:9`](../frontend/src/sim/config/systems.js#L9)). Each kind has a small (S), medium (M) and large (L) entry with no `variantOf`. Each of those is itself modelled on a named product. Further real products of a kind carry `variantOf`, naming the size they stand beside. The purchase bar lists each kind's systems in the order of `TOOLBAR` ([`systems.js:13`](../frontend/src/sim/config/systems.js#L13)) and starts on the medium entry ([`systems.js:24`](../frontend/src/sim/config/systems.js#L24)). The **System** column is the config id, linked to its entry.
- **Money.** Config holds US dollars, as the sources quote them. The game shows pounds at 0.75 to the dollar ([`economy.js:26`](../frontend/src/sim/economy.js#L26)), and so do these tables. Buying a sensor comes out of the same single budget as everything else: see [EFFECTORS.md](EFFECTORS.md#money-and-the-budget).
- **Range.** The `published` figure from the sources, times `WORLD.rangeScale`, which is 1 ([`systems.js:27`](../frontend/src/sim/config/systems.js#L27), [`world.js:24`](../frontend/src/sim/config/world.js#L24)). It holds in an open field, on the standard mast, against the reference drone: a small quadcopter with a radar cross-section of 0.01 m², 0.35 m across (`SENSING`, [`world.js:74`](../frontend/src/sim/config/world.js#L74)). Where you place the sensor, terrain, trees, weather and your own jamming cut it down.
- **Detection chance.** At its range, one scan detects the reference drone about 86% of the time: the chance is 1 / (1 + (distance / (reach x 1.35))^6), and nothing is detected beyond 2.2 times the open-field reach ([`sensors.js:82`](../frontend/src/sim/network/sensors.js#L82)).
- **False alarms per scan.** The chance that one scan also reports something that is not there ([`sensors.js:206`](../frontend/src/sim/network/sensors.js#L206)).
- **Error.** The 1-sigma bearing (az), elevation (el) and range error on a strong signal, from `sapient.noise` ([`sensors.js:139`](../frontend/src/sim/network/sensors.js#L139)). It grows as the signal weakens, to about 2.2 times the figure at the edge of reach ([`site-range.js:68`](../frontend/src/sim/site-range.js#L68)). Where a figure is missing, the sensor does not measure that quantity.
- **Scan.** Seconds between scans (`sapient.interval`), which is also how often the sensor sends a SAPIENT DetectionReport (see [SAPIENT.md](SAPIENT.md)).
- **Mast.** `mount`: how high the sensor stands, in metres. Most are assumptions. The config notes that the generated world's tree tops are 12 to 20 m, so a low sensor loses most low flyers behind trees ([`sensors.js:4`](../frontend/src/sim/config/sensors.js#L4)).
- **Signature.** How loud the system is to an enemy drone that seeks emitters, against the other systems ([`targeting.js:55`](../frontend/src/sim/targeting.js#L55)). Anti-radar drones hear only radars and jammers that are on ([`targeting.js:72`](../frontend/src/sim/targeting.js#L72)). A network terminal adds its own signature: see [VEHICLES.md](VEHICLES.md).
- **Health.** Every sensor has 30. A strike takes the drone's damage, divided by any armour, off it ([`targeting.js:97`](../frontend/src/sim/targeting.js#L97)). The drones' damage is in [DRONES.md](DRONES.md).
- **Confidence.** Copied from each entry's `ref`. "ASSUMPTION" means no public figure was found and the value is a placeholder to tune.
- **Settings.** Mast height, transmit power, band, detection threshold and more can be changed on each placed unit, at a price. They are listed in [VEHICLES.md](VEHICLES.md#unit-settings).

## The four kinds at a glance

| Kind | Key | Reports | Good at | Bad at |
|---|---|---|---|---|
| Radar | 1 | Range, bearing, elevation (3D radars) and velocity | Sees drones that send no radio signal. Gives a position from one sensor. Works in any light | It transmits, so emitter-seeking and anti-radar drones find it. Slow low flyers hide in ground clutter. Fixed panels see only their arc. Costly. Higher bands lose range in rain |
| RF detector | 2 | Bearing and the band heard, with no range | Passive and cheap. Hears a drone's radio link far beyond what it can see. A classifier library can name the airframe | Deaf to fibre-optic and autonomous drones. Deafened by your own jammers on the bands they fill. One detector cannot place a drone |
| EO/IR camera | 3 | Bearing and elevation, with the airframe named once the drone covers enough pixels | Strong classification, accurate angles, passive | A narrow view that must be pointed, so it needs a cue. No range unless a rangefinder is fitted. Needs a clear line of sight. The visible channel fades at dusk and night |
| Acoustic sensor | 8 | Bearing (the medium array also elevation) | Very cheap. Hears drones with no radio. Needs no line of sight | Short range. Hills, built-up areas and rain halve it. Sound arrives late, so the bearing lags the drone |

The keys are those in `TOOLBAR`. A sensor never shoots: the fusion node fuses what sensors report into tracks and tasks the effectors (see [FUSION_AND_TARGETING.md](FUSION_AND_TARGETING.md)).

## How range changes with the target

A sensor's range is quoted against the reference drone. Against another drone it scales by one property of that drone ([`site-range.js:35`](../frontend/src/sim/site-range.js#L35)):

- radar: by the fourth root of radar cross-section over 0.01 m² (the radar equation);
- camera: in proportion to the drone's size over 0.35 m (pixels on target);
- RF detector: by the square root of the drone's link power, as a multiple of a small first-person-view (FPV) drone's, and by the band the link is on, against the FPV's 2.4 GHz control link (see [RF detectors](#rf-detectors));
- acoustic sensor: in proportion to the drone's loudness, as a multiple of a small FPV drone's.

The four drone types the waves send (from `DRONES`, see [DRONES.md](DRONES.md)):

| Drone type | Radar cross-section (m²) | Size (m) | Link power (x FPV) | Loudness (x FPV) | Radio links |
|---|---|---|---|---|---|
| Fixed-wing spotter drone | 0.15 | 3 | 2.5 | 3 | control900, video58, gnss |
| Fibre-optic strike drone | 0.01 | 0.35 | 1 | 1 | none |
| First-person-view strike drone | 0.01 | 0.35 | 1 | 1 | control24, video58 |
| Fixed-wing strike drone | 0.2 | 2.5 | 1 | 5 | gnss |

That gives each sensor's open-field reach against each type, as the Unit panel shows it. These are the figures before the map has its say; the real reach at a spot is usually less.

| System | Fixed-wing spotter drone (m) | Fibre-optic strike drone (m) | First-person-view strike drone (m) | Fixed-wing strike drone (m) |
|---|---|---|---|---|
| [`radar_s`](../frontend/src/sim/config/sensors.js#L38) | 1,968 | 1,000 | 1,000 | 2,115 |
| [`radar_a400`](../frontend/src/sim/config/uk-systems.js#L5) | 5,373 | 2,730 | 2,730 | 5,773 |
| [`radar_a800`](../frontend/src/sim/config/sensors.js#L62) | 5,904 | 3,000 | 3,000 | 6,344 |
| [`radar`](../frontend/src/sim/config/sensors.js#L8) | 6,101 | 3,100 | 3,100 | 6,556 |
| [`radar_giraffe`](../frontend/src/sim/config/uk-systems.js#L29) | 7,872 | 4,000 | 4,000 | 8,459 |
| [`radar_l`](../frontend/src/sim/config/sensors.js#L85) | 8,462 | 4,300 | 4,300 | 9,093 |
| [`rf_s`](../frontend/src/sim/config/sensors.js#L137) | 2,373 | cannot hear | 2,000 | cannot hear |
| [`rf`](../frontend/src/sim/config/sensors.js#L110) | 15,098 | cannot hear | 3,500 | cannot hear |
| [`rf_elysion`](../frontend/src/sim/config/sensors.js#L161) | 4,152 | cannot hear | 3,500 | cannot hear |
| [`rf_airfence`](../frontend/src/sim/config/eu-systems.js#L5) | 43,137 | cannot hear | 10,000 | cannot hear |
| [`rf_l`](../frontend/src/sim/config/sensors.js#L180) | 60,392 | cannot hear | 14,000 | cannot hear |
| [`camera_s`](../frontend/src/sim/config/sensors.js#L230) | 2,229 | 260 | 260 | 1,857 |
| [`camera`](../frontend/src/sim/config/sensors.js#L203) | 5,571 | 650 | 650 | 4,643 |
| [`camera_l`](../frontend/src/sim/config/sensors.js#L250) | 3,857 | 450 | 450 | 3,214 |
| [`acoustic_s`](../frontend/src/sim/config/sensors.js#L270) | 900 | 300 | 300 | 1,500 |
| [`acoustic`](../frontend/src/sim/config/sensors.js#L289) | 1,500 | 500 | 500 | 2,500 |
| [`acoustic_l`](../frontend/src/sim/config/sensors.js#L307) | 3,000 | 1,000 | 1,000 | 5,000 |

## Radars

A radar reports range, bearing and radial velocity, and elevation unless it is set to 2D. It is the only sensor that places a drone on its own and the only one that sees a silent drone far out, so most laydowns build round one.

- **Coverage.** A rotating radar (the IRIS and the Giraffe 1X) sees all round. A fixed-panel radar sees its arc per panel, the panels side by side and centred on its facing ([`sensor-model.js:32`](../frontend/src/sim/sensor-model.js#L32)). Left unset, the facing points away from what you defend ([`laydown.js:26`](../frontend/src/sim/laydown.js#L26)). The beam runs from 10° below the horizon ([`sensor-model.js:5`](../frontend/src/sim/sensor-model.js#L5)) up to the elevation it covers, less those 10°, so a drone close overhead can be above it.
- **Ground clutter.** A drone below `lowAlt` and further than `lowRange` from the radar, moving slower than 5 m/s, has its detection chance multiplied by 0.3 ([`site-range.js:77`](../frontend/src/sim/site-range.js#L77), [`sensors.js:76`](../frontend/src/sim/network/sensors.js#L76)). `lowRange` is scaled by the ground under the drone: 1.5 over open ground or water, 0.7 over forest, 0.5 over buildings or a power-line corridor ([`site-range.js:12`](../frontend/src/sim/site-range.js#L12)). The 5 m/s threshold stands for a Doppler filter and is an assumption. The four generic drone types fly at 18 to 45 m/s, so this rule mainly catches a drone that slows or hovers; terrain and trees hide low flyers through line of sight instead (see [PHYSICS_AND_PROPAGATION.md](PHYSICS_AND_PROPAGATION.md)).
- **Micro-Doppler.** A radar with a micro-Doppler classifier names a track multirotor or fixed wing inside half its reach ([`sensor-model.js:29`](../frontend/src/sim/sensor-model.js#L29)). The IRIS and the A400 have one as standard; the others can be fitted with one.
- **Rain.** In rain and haze a radar keeps 100% of its range in S band, 95% in X band, 85% in Ku band and 75% in K band ([`conditions.js:17`](../frontend/src/sim/conditions.js#L17)).
- **Rated power.** The transmit power the Transmit power setting starts from (`TX_POWER`, [`tx-power.js:9`](../frontend/src/sim/config/tx-power.js#L9)). Turning it down cuts range by the fourth root and the signature in proportion.

| System | Product | Size | Price | Range (m) | Mast (m) | Coverage | Elevation | Band | Rated power | Scan (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| [`radar_s`](../frontend/src/sim/config/sensors.js#L38) | Echodyne EchoGuard | S | £33,750 | 1,000 | 15 | 120° per panel, up to 3 panels | 80° (-10° to +70°) | K-band radar 24.45–24.65 GHz | 2 W (assumption) | 1 |
| [`radar_a400`](../frontend/src/sim/config/uk-systems.js#L5) | Blighter A400 series | M | £300,000 | 2,730 | 25 | 90° per panel, up to 4 panels | 20° (-10° to +10°) | Ku-band radar (assumed 15.5–17.3 GHz) | 4 W (published) | 1 |
| [`radar_a800`](../frontend/src/sim/config/sensors.js#L62) | Blighter A800 | M | £450,000 | 3,000 | 25 | 90° per panel, up to 4 panels | 40° (-10° to +30°) | Ku-band radar 15.7–17.2 GHz | 4 W (published) | 1 |
| [`radar`](../frontend/src/sim/config/sensors.js#L8) | Robin Radar IRIS | M | £675,000 | 3,100 | 25 | All round (rotates) | 60° (-10° to +50°) | X-band radar (assumed 9.2–9.5 GHz) | 12 W (published) | 1 |
| [`radar_giraffe`](../frontend/src/sim/config/uk-systems.js#L29) | Saab Giraffe 1X | L | £3,750,000 | 4,000 | 3 | All round (rotates) | 70° (-10° to +60°) | X-band radar (assumed 9.2–10 GHz) | 150 W (assumption) | 1 |
| [`radar_l`](../frontend/src/sim/config/sensors.js#L85) | Hensoldt Spexer 2000 3D MkIII | L | £1,875,000 | 4,300 | 30 | 120° per panel, up to 3 panels | 60° (-10° to +50°) | X-band radar 9.2–10 GHz | 100 W (assumption) | 1 |

| System | False alarms per scan | Clutter zone (detection chance x 0.3) | Error (az / el / range) | Micro-Doppler | Signature | Health | Stands on |
|---|---|---|---|---|---|---|---|
| [`radar_s`](../frontend/src/sim/config/sensors.js#L38) | 0.15 | Below 30 m and beyond 300 m, if slower than 5 m/s | 1° / 2° / 10 m | no | 0.8 | 30 | fixed |
| [`radar_a400`](../frontend/src/sim/config/uk-systems.js#L5) | 0.1 | Below 40 m and beyond 500 m, if slower than 5 m/s | 0.6° / 1.2° / 8 m | yes | 0.8 | 30 | fixed |
| [`radar_a800`](../frontend/src/sim/config/sensors.js#L62) | 0.1 | Below 40 m and beyond 500 m, if slower than 5 m/s | 0.6° / 1.2° / 8 m | no | 1 | 30 | fixed |
| [`radar`](../frontend/src/sim/config/sensors.js#L8) | 0.1 | Below 40 m and beyond 500 m, if slower than 5 m/s | 0.6° / 1.2° / 8 m | yes | 1 | 30 | fixed |
| [`radar_giraffe`](../frontend/src/sim/config/uk-systems.js#L29) | 0.1 | Below 30 m and beyond 800 m, if slower than 5 m/s | 0.3° / 0.6° / 5 m | no | 1.5 | 30 | vehicle |
| [`radar_l`](../frontend/src/sim/config/sensors.js#L85) | 0.1 | Below 30 m and beyond 800 m, if slower than 5 m/s | 0.3° / 0.6° / 5 m | no | 1.5 | 30 | fixed |

Where each range comes from:

| System | Range used | Confidence | Price confidence | Sources |
|---|---|---|---|---|
| [`radar_s`](../frontend/src/sim/config/sensors.js#L38) | 1 km against a DJI Phantom 4 (vendor-listed) | Vendor-listed figures | Secondary sources; not an official quote | [EverythingRF: EchoGuard](https://everythingrf.com/products/radar-systems/echodyne-corp/1069-2160-echoguard); [Aviations UK: comparison with price bands](https://aviationsouk.com/compare-products/droneshield-dronegun-tactical-vs-echodyne-echoshield/) |
| [`radar_a400`](../frontend/src/sim/config/uk-systems.js#L5) | 2.73 km against a 0.01 m² target in free space (datasheet) | Manufacturer datasheet | ASSUMPTION: tune this yourself | [Blighter: A400 datasheet](https://blighter.com/wp-content/uploads/2025/10/blighter-a400-series-radars-datasheet-bss-1311.pdf); [Blighter: A400 enhanced for small drones](https://blighter.com/blighters-battle-proven-a400-series-counter-uav-radar-enhanced-to-better-detect-low-slow-and-small-drones/); [Blighter: counter-UAS radar demonstration](https://blighter.com/counter-uas-radar-capability-demonstration-to-students/) |
| [`radar_a800`](../frontend/src/sim/config/sensors.js#L62) | 3 km against a nano-quadcopter, ideal mounting (vendor) | Vendor figures | ASSUMPTION: tune this yourself | [Blighter: A800](https://www.blighter.com/products/a800-3d-multi-mode-radar); [Blighter: A800 Mk 2 datasheet](https://blighter.com/wp-content/uploads/2025/10/blighter-a800-mk-2-4d-multi-mode-radar-datasheet-bss-4003-MR.pdf) |
| [`radar`](../frontend/src/sim/config/sensors.js#L8) | 3.1 km against a 0.9 kg drone (maker’s test) | Manufacturer’s test figures, not independently checked | CEO statement, an upper bound | [Robin Radar: IRIS product sheet, April 2026](https://www.robinradar.com/hubfs/IRIS%20product%20sheet%20042026.pdf); [Robin Radar: IRIS datasheet V15.6](https://www.robinradar.com/hubfs/Iris%20Datasheet%20V15.6_online.pdf); [EDR Magazine: IRIS long-range module](https://www.edrmagazine.eu/?p=46182); [Robin Radar: how the IRIS uses deep neural networks](https://www.robinradar.com/blog/elevating-drone-detection-how-we-use-deep-neural-networks-dnn-in-the-iris-radar); [Defense News: Robin Radar](https://www.defensenews.com/global/europe/2025/09/24/dutch-radar-firm-robin-turns-bird-spotting-skills-into-drone-defense/) |
| [`radar_giraffe`](../frontend/src/sim/config/uk-systems.js#L29) | About 4 km against the smallest drones (Saab) | Manufacturer and press figures | ASSUMPTION: tune this yourself | [Saab: Giraffe 1X](https://www.saab.com/products/giraffe-1x); [Janes: Giraffe 1X at Eurosatory 2026](https://www.janes.com/defence-intelligence-insights/defence-news/c4isr/eurosatory-2026-saabs-giraffe-1x-radar-range-up-to-250-km-receives-danish-order); [Wikipedia: Rapid Sentry](https://en.wikipedia.org/wiki/Rapid_Sentry) |
| [`radar_l`](../frontend/src/sim/config/sensors.js#L85) | Assessed: the older Spexer 2000’s 9 km at 0.2 m², scaled to 0.01 m² | Assessed from an older model; no manufacturer figure for small drones | ASSUMPTION: tune this yourself | [Quwa: Spexer 2000 detection table](https://quwa.org/system-profile/profile-hensoldt-spexer-2000-border-surveillance-radar/); [Raksha Anirveda: Spexer 2000 3D MkIII](https://raksha-anirveda.com/hensoldt-spexer-2000-3d-mkiii-radar/); [Hensoldt: Spexer 2000 3D MkIII](https://www.hensoldt.net/products/spexer-2000-3d-mkiii-land-ground-based-air-defence); [Armed Conflicts: Spexer detection range](https://origin.armedconflicts.com/-t289922) |

## RF detectors

An RF detector is a passive receiver that hears a drone's control and video links and reports a bearing to it, and the band it heard. It gives no range and no elevation, so the fusion node needs two bearings that cross, or another sensor, to place the drone.

- **What it hears.** A drone radiates on the bands of its control and video links ([`rf-model.js:33`](../frontend/src/sim/rf-model.js#L33)). A detector hears it on a band its `listens` range covers, and picks the one that carries furthest ([`rf-model.js:44`](../frontend/src/sim/rf-model.js#L44)). In free space reach goes with wavelength, so against the 2.4 GHz control link its range is quoted for, a 900 MHz control link is heard 2.7 times as far. A 5.8 GHz link is heard 0.42 times as far, or 0.75 times for a video sender, which is taken to be 5 dB louder than a control link ([`rf-model.js:55`](../frontend/src/sim/rf-model.js#L55)). A wide detector therefore hears the spotter's 900 MHz link at about 15 km, where one that covers only 2.4 and 5.8 GHz hears its video at about 2.4 km. It cannot hear the fibre-optic strike drone or the autonomous fixed-wing strike drone, which send nothing.
- **Your own jammers.** A detector inside the range of one of your jammers that is on cannot hear the bands that jammer fills ([`jamming.js:45`](../frontend/src/sim/jamming.js#L45)). A standard jammer fills both 2.4 and 5.8 GHz, so a Wingman inside its range cannot hear an FPV drone at all while it jams.
- **Classifier library.** A library names the airframe of a link family it knows ([`rf-model.js:14`](../frontend/src/sim/rf-model.js#L14)). Every catalogue detector comes with the commercial library (DJI, Autel), which knows neither the FPV drone's hobby link nor the spotter's tactical link; a better library is a unit setting.
- **Bearing.** Angle of arrival gives a bearing good to a few degrees, good enough to cross with another detector's. A sector bearing (30°) only says roughly which way.
- **Range.** The range is for a clear radio path, against a small FPV heard on its 2.4 GHz control link. Terrain and trees are applied on top from the map, on the band it hears ([`sensors.js:5`](../frontend/src/sim/config/sensors.js#L5)).

| System | Product | Size | Price | Range (m) | Mast (m) | Listens (GHz) | Drone link bands heard | Scan (s) |
|---|---|---|---|---|---|---|---|---|
| [`rf_s`](../frontend/src/sim/config/sensors.js#L137) | MyDefence Wingman 103/105 | S | £7,500 | 2,000 | 1.5 | 2.4–2.4835, 5.15–5.925 | Control 2.4 GHz, Video 5.8 GHz | 1 |
| [`rf`](../frontend/src/sim/config/sensors.js#L110) | Dedrone RF-360 / RF-160 | M | £30,000 | 3,500 | 9 | 0.07–6 | Control 868/915 MHz, Control 2.4 GHz, Video 5.8 GHz | 1 |
| [`rf_elysion`](../frontend/src/sim/config/sensors.js#L161) | Hensoldt Elysion RF DF | M | £22,500 | 3,500 | 9 | 2.4–2.4835, 5.15–5.925 | Control 2.4 GHz, Video 5.8 GHz | 1 |
| [`rf_airfence`](../frontend/src/sim/config/eu-systems.js#L5) | Sensofusion Airfence 7 | L | £138,000 | 10,000 | 9 | 0.07–6 | Control 868/915 MHz, Control 2.4 GHz, Video 5.8 GHz | 1 |
| [`rf_l`](../frontend/src/sim/config/sensors.js#L180) | Aaronia AARTOS | L | £300,000 | 14,000 | 9 | 0.02–8 | Control 868/915 MHz, Control 2.4 GHz, Video 5.8 GHz | 1 |

| System | Sensitivity (dBm) | Direction finding | Bearing error | Classifier library | False alarms per scan | Signature | Stands on |
|---|---|---|---|---|---|---|---|
| [`rf_s`](../frontend/src/sim/config/sensors.js#L137) | -85 | Sector | 30° | commercial | 0.08 | 0.05 | manpack |
| [`rf`](../frontend/src/sim/config/sensors.js#L110) | -90 | Angle of arrival | 3° | commercial | 0.05 | 0.05 | fixed |
| [`rf_elysion`](../frontend/src/sim/config/sensors.js#L161) | -90 | Sector | 30° | commercial | 0.05 | 0.05 | fixed |
| [`rf_airfence`](../frontend/src/sim/config/eu-systems.js#L5) | -95 | Angle of arrival | 3° | commercial | 0.04 | 0.05 | fixed |
| [`rf_l`](../frontend/src/sim/config/sensors.js#L180) | -100 | Angle of arrival | 2° | commercial | 0.03 | 0.05 | fixed |

Where each range comes from:

| System | Range used | Confidence | Price confidence | Sources |
|---|---|---|---|---|
| [`rf_s`](../frontend/src/sim/config/sensors.js#L137) | Assessed from a link budget; maker claims 3 to 5 km, an evaluation more than 1 km | Assessed; a national evaluation found less and the maker claims more | ASSUMPTION: tune this yourself | [Danish Parliament: MyDefence specification](https://ft.dk/samling/20222/almdel/FOU/bilag/136/2737420/index.htm); [Janes: Lithuania and Wingman](https://www.janes.com/defence-news/news-detail/lithuania-acquires-wingman-and-watchdog-c-uas-systems); [Aviations UK: Wingman vs Dedrone RF](https://aviationsouk.com/compare-products/dedrone-dedronesensors-rf-rf-160-rf-360-vs-mydefence-wingman-103-105-drone-detector/); [EverythingRF: Wingman 103](https://www.everythingrf.com/products/cuas-counter-unmanned-aerial-system/mydefence/1075-2458-wingman-103) |
| [`rf`](../frontend/src/sim/config/sensors.js#L110) | Assessed: between the datasheet’s 2 km (normal) and 5 km (ideal) | Assessed from a manufacturer datasheet and a link budget | ASSUMPTION: tune this yourself | [Dedrone: RF-360 datasheet](https://l.dedrone.com/hubfs/Downloads%20-%20PDFs/DS_RF360-360T_en_web.pdf); [Aviations UK: Dedrone RF vs Hensoldt](https://aviationsouk.com/compare-products/dedrone-dedronesensors-rf-rf-160-rf-360-vs-hensoldt-elysion-c-uas-current-c-uas-family-formerly-xpeller/); [RF Essentials: counter-drone systems](https://rfessentials.com/resources/rf-glossary/counter-drone-system/) |
| [`rf_elysion`](../frontend/src/sim/config/sensors.js#L161) | Assessed: set level with the Dedrone entry; no Hensoldt datasheet | One catalogue listing, unverified; range is an assumption | ASSUMPTION: tune this yourself | [Aviations UK: Hensoldt Elysion](https://aviationsouk.com/products/hensoldt-elysion-c-uas-current-c-uas-family-formerly-xpeller/) |
| [`rf_airfence`](../frontend/src/sim/config/eu-systems.js#L5) | 10 km for one sensor on a clear line of sight (maker) | Maker’s listing | Maker’s list price | [Sensofusion: Airfence 7](https://sensofusion.com/airfence/); [Sensofusion: Military Edition](https://sensofusion.com/military/); [Wikipedia: Sensofusion](https://en.wikipedia.org/wiki/Sensofusion) |
| [`rf_l`](../frontend/src/sim/config/sensors.js#L180) | 14 km against commercial drones (AARTOS X9 listing) | Vendor listing, checked with a link budget | ASSUMPTION: tune this yourself | [EverythingRF: AARTOS X9](https://everythingrf.com/products/cuas-counter-unmanned-aerial-system/aaronia-ag/1075-281-aartos-x9); [EDR Magazine: Aaronia AARTOS](https://www.edrmagazine.eu/landeuro-2025-aaronia-aartos-a-uav-detection-and-neutralisation-system-from-germany); [Aviations UK: AARTOS DDS](https://aviationsouk.com/products/aaronia-aartos-dds-drone-detection-system/) |

## EO/IR cameras

An electro-optical and infrared camera reports bearing and elevation, very accurately, and names the airframe once the drone is big enough in its view. It has a narrow field of view that must be pointed at the drone.

- **Search and cue.** With nothing to look at, a camera sweeps at its sweep rate, 3° above the horizon ([`sensors.js:239`](../frontend/src/sim/network/sensors.js#L239)). The fusion node cues it to a track, unclassified tracks first, with a SAPIENT `look_at` task ([`cameras.js:3`](../frontend/src/sim/network/cameras.js#L3)). It turns at its slew rate, looks through its track view and dwells there; if half its dwell on the cue passes with nothing found, it widens to its search view again ([`sensors.js:30`](../frontend/src/sim/network/sensors.js#L30)). Zoomed in, it reaches further by search view over track view.
- **Pixels.** A drone is detected at 4 pixels across, recognised (its airframe named) at 8 and identified at 13 ([`camera-model.js:8`](../frontend/src/sim/camera-model.js#L8)). Every catalogue camera range is where a 0.35 m drone covers 4 pixels.
- **Light and weather.** The visible channel keeps 50% of its range at dusk, 10% at night and 50% in rain and haze; the thermal channel keeps all of it except 60% in rain and haze ([`conditions.js:11`](../frontend/src/sim/conditions.js#L11)). A camera with both uses the better one ([`conditions.js:28`](../frontend/src/sim/conditions.js#L28)).
- **Line of sight.** A camera needs a clear line to the drone: terrain or trees in the way stop it ([`site-range.js:63`](../frontend/src/sim/site-range.js#L63)).

| System | Product | Size | Price | Search range (m) | Range on a cue (m) | Mast (m) | Search view | Track view | Slew (°/s) | Sweep (°/s) | Dwell (s) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [`camera_s`](../frontend/src/sim/config/sensors.js#L230) | Teledyne FLIR Boson 640, 36 mm | S | £18,750 | 260 | no zoom | 15 | 12° | none | 90 | 12 | 3 |
| [`camera`](../frontend/src/sim/config/sensors.js#L203) | Generic EO/IR turret | M | £75,000 | 650 | 2,600 | 15 | 10° | 2.5° | 90 | 12 | 3 |
| [`camera_l`](../frontend/src/sim/config/sensors.js#L250) | MWIR turret, Ophir 80–1200 mm | L | £375,000 | 450 | 6,390 | 25 | 7.1° | 0.5° | 90 | 12 | 3 |

| System | Channels | Sensor | Lens | Thermal band, pitch | Error (az / el) | False alarms per scan | Report interval (s) | Stands on |
|---|---|---|---|---|---|---|---|---|
| [`camera_s`](../frontend/src/sim/config/sensors.js#L230) | Thermal | 640 pixels across | f/1 | LWIR, 12 µm | 0.1° / 0.1° | 0.03 | 0.5 | fixed |
| [`camera`](../frontend/src/sim/config/sensors.js#L203) | Visible and thermal | 1280 pixels across | f/2 | LWIR, 12 µm | 0.05° / 0.05° | 0.03 | 0.5 | fixed |
| [`camera_l`](../frontend/src/sim/config/sensors.js#L250) | Thermal | 640 pixels across | f/5.5 | MWIR, 15 µm | 0.02° / 0.02° | 0.02 | 0.5 | fixed |

Where each range comes from:

| System | Range used | Confidence | Price confidence | Sources |
|---|---|---|---|---|
| [`camera_s`](../frontend/src/sim/config/sensors.js#L230) | Calculated: a 0.35 m drone covers 4 pixels on the 36 mm lens | Lens and sensor from the vendor; range is calculated | ASSUMPTION: tune this yourself | [Teledyne FLIR: Boson](https://www.oem.flir.com/products/boson/) |
| [`camera`](../frontend/src/sim/config/sensors.js#L203) | Calculated: a 0.35 m drone covers 4 of 1,280 pixels across 10° | Calculated, with an assumed sensor; fits one industry statement | One industry statement | [Military Systems Tech: thermal sensor design (figures as surfaced by search; confirm)](https://www.militarysystems-tech.com/articles/thermal-infrared-sensor-design) |
| [`camera_l`](../frontend/src/sim/config/sensors.js#L250) | Calculated: 4 pixels at the lens’s wide 7.1° end | Lens from the vendor; range is calculated | ASSUMPTION: tune this yourself | [Ophir: MWIR f/5.5 zoom lenses](https://www.ophiropt.com/g/long-range-mwir-vga-imaging-lenses) |

## Acoustic sensors

An acoustic sensor is a microphone node or array that hears a drone's engine or rotors and reports a bearing. It is the cheapest sensor and the one most likely to hear a fibre-optic drone, which no RF detector can.

- **No line of sight needed.** Sound carries over hills and through trees, but behind a hill it keeps half its reach, and a sensor in a built-up area keeps half for the noise ([`site-range.js:14`](../frontend/src/sim/site-range.js#L14)). Rain halves it too ([`conditions.js:11`](../frontend/src/sim/conditions.js#L11)).
- **Loudness.** Range scales with how loud the drone is: the spotter is set three times and the fixed-wing strike drone five times as loud as a small FPV drone.
- **Delay.** Sound travels at 343 m/s, so the bearing points to where the drone was when the sound left it ([`sensors.js:21`](../frontend/src/sim/network/sensors.js#L21)).
- "Large" for the ZVOOK listening station means its reach. It is the cheapest system in the game.

| System | Product | Size | Price | Range (m) | Mast (m) | Error (az / el) | False alarms per scan | Scan (s) | Signature |
|---|---|---|---|---|---|---|---|---|---|
| [`acoustic_s`](../frontend/src/sim/config/sensors.js#L270) | ZVOOK NW0 | S | £750 | 300 | 3 | 10° | 0.1 | 1 | 0.02 |
| [`acoustic`](../frontend/src/sim/config/sensors.js#L289) | Squarehead Discovair G2+ | M | £37,500 | 500 | 3 | 4° / 6° | 0.05 | 1 | 0.02 |
| [`acoustic_l`](../frontend/src/sim/config/sensors.js#L307) | ZVOOK listening station | L | £375 | 1,000 | 6 | 10° | 0.15 | 1 | 0.02 |

Where each range comes from:

| System | Range used | Confidence | Price confidence | Sources |
|---|---|---|---|---|
| [`acoustic_s`](../frontend/src/sim/config/sensors.js#L270) | Middle of the declared 150 to 450 m against FPV drones | Maker’s declared figures, reported by the trade press | ASSUMPTION from a comparable system | [Militarnyi: ZVOOK NW0](https://militarnyi.com/en/news/ukraine-develops-acoustic-detector-for-fpv-drones/); [United24: Sky Fortress](https://united24media.com/war-in-ukraine/sky-fortress-ukraines-acoustic-detection-system-that-tracks-drones-cheap-and-fast-9451) |
| [`acoustic`](../frontend/src/sim/config/sensors.js#L289) | A US Air Force minimum of 500 m against Group 1 drones | A buyer’s requirement and a competitor’s overview, not a measured figure | ASSUMPTION: tune this yourself | [US Air Force notice: Discovair G2+](https://app.govly.com/public/opportunities/16844233); [Robin Radar: acoustic sensors](https://www.robinradar.com/blog/acoustic-sensors-drone-detection) |
| [`acoustic_l`](../frontend/src/sim/config/sensors.js#L307) | Assumed against a small FPV drone; the press figure names no drone | A press report of the maker’s claims | Press report of a manufacturing cost | [The Telegraph, reprinted: acoustic sensors](https://www.lucorg.com/?p=17063) |

## The perimeter sensor

The site has its own close-in sensor, which is not bought and cannot be moved: a SAPIENT proximity node at the station with a 150 m range on a 3 m mast ([`world.js:110`](../frontend/src/sim/config/world.js#L110), [`index.js:89`](../frontend/src/sim/network/index.js#L89)). It detects a drone within 150 m horizontally on 98% of its scans, whatever the terrain ([`sensors.js:67`](../frontend/src/sim/network/sensors.js#L67)). Its figures are an assumption, labelled so in config. It stays at the station even when you draw an area to defend elsewhere.

## Limits and simplifications

- **Most ranges are vendor claims or assessments.** Few counter-drone sensors have independently tested ranges in the public domain. The `ref` of each entry says which figures are the maker's, which are worked out and which are placeholders; the Confidence columns above copy it.
- **One reference drone.** Each range is a single number against a 0.01 m², 0.35 m quadcopter, scaled to other drones by one property. Real detection also depends on aspect, speed, altitude, rotor type, background and the operator's settings.
- **Prices are rough.** About half the prices are placeholders marked ASSUMPTION. None includes support, training or integration.
- **Assumed internals.** Masts, scan rates, false alarm rates, elevation coverage, accuracies, transmit powers and camera optics are labelled assumptions where no maker figure was found. The clutter speed threshold and the 0.3 clutter penalty are game rules.
- **Simplified sensing.** False alarms are a flat chance per scan rather than a clutter map. RF detection treats a link as one band with no hopping or duty cycle for detection, and does not locate the pilot (Airfence does in reality). Acoustic sensing has no wind or temperature effect. A camera has no tracker of its own: it dwells, then hands back.
- **No crews or power supplies.** Sensors are not staffed in the simulation and need no generator; their electrical draw is not modelled. Only transmit power, which sets range and signature, is.

## Where this lives in the code

- [`config/sensors.js`](../frontend/src/sim/config/sensors.js): the S, M and L entries of each sensor kind and the Dedrone, Elysion and A800 variants.
- [`config/uk-systems.js`](../frontend/src/sim/config/uk-systems.js) and [`config/eu-systems.js`](../frontend/src/sim/config/eu-systems.js): the Blighter A400, Giraffe 1X and Airfence.
- [`config/systems.js`](../frontend/src/sim/config/systems.js): `STRUCTURES`, the purchase bar (`TOOLBAR`) and the range scale.
- [`config/tx-power.js`](../frontend/src/sim/config/tx-power.js): rated transmit power of radars and jammers.
- [`site-range.js`](../frontend/src/sim/site-range.js): reach against each drone and along a real path, clutter and error growth.
- [`sensor-model.js`](../frontend/src/sim/sensor-model.js): radar arcs, elevation, bands, clutter filter and micro-Doppler.
- [`rf-model.js`](../frontend/src/sim/rf-model.js): what an RF detector hears and its libraries.
- [`camera-model.js`](../frontend/src/sim/camera-model.js) and [`conditions.js`](../frontend/src/sim/conditions.js): pixels on target, channels, light and weather.
- [`network/sensors.js`](../frontend/src/sim/network/sensors.js): each scan, detection chance, measurement error, false alarms and camera aiming.
- [`unit-config.js`](../frontend/src/sim/unit-config.js): the per-unit settings and their prices.
