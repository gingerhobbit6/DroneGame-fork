# Physics and propagation

This document explains every physical model in the Bombadil simulation: radar, RF, optical and acoustic detection, terrain and canopy line of sight, radio propagation loss, ground clutter, jamming, weather and light, flight, hit chance, and blast and damage. Each section gives the formula the code uses, the constants and where they come from, a comparison with the real physics it simplifies, and how far to trust it. It is written for a defence professional who wants to know what the numbers mean, and for a developer who wants to change them.

Every number below comes from the code or config (linked with line numbers), or from the worked examples, which were run against the game's own functions (see [Worked examples](#13-worked-examples)). Figures the code labels as assumptions are called assumptions here too.

## Contents

1. [The common shape: from a published range to a roll per scan](#1-the-common-shape-from-a-published-range-to-a-roll-per-scan)
2. [Radar](#2-radar)
3. [Terrain, canopy and the radio path model](#3-terrain-canopy-and-the-radio-path-model)
4. [RF detection](#4-rf-detection)
5. [Optical (EO/IR) cameras and the human eye](#5-optical-eoir-cameras-and-the-human-eye)
6. [Acoustic sensing](#6-acoustic-sensing)
7. [Jamming, spoofing and take-over](#7-jamming-spoofing-and-take-over)
8. [Network links between nodes](#8-network-links-between-nodes)
9. [Weather and light](#9-weather-and-light)
10. [Flight and kinematics](#10-flight-and-kinematics)
11. [Weapons: hit chance, time of flight and beam dwell](#11-weapons-hit-chance-time-of-flight-and-beam-dwell)
12. [Blast and damage](#12-blast-and-damage)
13. [Worked examples](#13-worked-examples)
14. [How far to trust the numbers](#14-how-far-to-trust-the-numbers)
15. [Limits and simplifications](#limits-and-simplifications)
16. [Where this lives in the code](#where-this-lives-in-the-code)

Units throughout are metres, metres per second, seconds and gigahertz. The 3D scene uses 1 unit = 20 m ([`world.js:12`](../frontend/src/sim/config/world.js#L12)), and the simulation advances in fixed steps of 0.05 game seconds ([`simulation.js:29`](../frontend/src/sim/simulation.js#L29)).

## 1. The common shape: from a published range to a roll per scan

Every sensor and effector has one **catalogue range**: its published range multiplied by `WORLD.rangeScale`, which is 1 ([`world.js:24`](../frontend/src/sim/config/world.js#L24), [`systems.js:28`](../frontend/src/sim/config/systems.js#L28)). For a sensor that range means *an open field*: flat, clear ground, on the standard mast, against a small reference drone ([ADR 0003](adr/0003-range-from-a-terrain-path-model.md)). Everything else is a multiplier on it.

```mermaid
flowchart LR
  A[Catalogue range<br/>published x rangeScale] --> B[Unit settings x<br/>weather and light<br/>unit-config.js]
  B --> C[Open-field reach<br/>for this drone type<br/>reachFor]
  C --> D[Reach on the real path<br/>terrain, trees, buildings<br/>reachOnPath]
  D --> E[Cover, clutter,<br/>Doppler and view checks]
  E --> F[Chance per scan Pd<br/>one random roll]
  F --> G[Measurement with<br/>range-dependent error]
```

1. **Unit settings and weather.** A placed system's range is the catalogue range times the product of every changed setting (transmit power, scan period, arc, band, threshold, resolution and so on), times a beam-shape gain, times the weather factor ([`unit-config.js:286`](../frontend/src/sim/unit-config.js#L286)).
2. **Per drone type.** `reachFor` scales that range by what the drone presents to the sensor: radar cross-section, physical size, radio link power or loudness ([`site-range.js:35`](../frontend/src/sim/site-range.js#L35)).
3. **Per path.** `reachOnPath` cuts it down for the real ground between the sensor and the drone ([`site-range.js:55`](../frontend/src/sim/site-range.js#L55)). Radio systems use the propagation model; cameras and lasers need a clear line; acoustic sensors use hill and noise factors.
4. **Per scan.** Each sensor scans once every `sapient.interval` seconds ([`network/index.js:42`](../frontend/src/sim/network/index.js#L42)). On each scan every drone gets one roll against the detection probability below.

### The detection probability

The chance that a sensor detects a drone on one scan is ([`network/sensors.js:82`](../frontend/src/sim/network/sensors.js#L82), constants in [`world.js:74`](../frontend/src/sim/config/world.js#L74)):

$$P_d = \frac{p_{clutter}}{1 + \left(\dfrac{r}{1.35\,R}\right)^{6}}$$

where `r` is the slant range, `R` is the reach on this path (times the camera's zoom, if any), and `p_clutter` is 0.3 for a low flyer lost in radar ground clutter and 1 otherwise. Nothing beyond 2.2 times the open-field reach is ever detected (`rangeCap`, [`network/sensors.js:70`](../frontend/src/sim/network/sensors.js#L70)). Evaluated with the game's constants:

| r / R | 0.5 | 0.75 | 1 | 1.35 | 1.5 | 2 | 2.2 |
|---|---|---|---|---|---|---|---|
| Pd per scan | 0.997 | 0.971 | 0.858 | 0.500 | 0.347 | 0.086 | 0.051, then 0 |

So "range" in this game means the distance at which a single scan succeeds about 86% of the time. Because a sensor rolls every scan, a drone that stays at 1.5 R is still detected on about one scan in three.

Before the roll, `pd` returns 0 if the drone is outside a radar's arc or elevation band, inside a high clutter filter's blind speed, outside a camera's current view, or on no band an RF detector can hear ([`network/sensors.js:63`](../frontend/src/sim/network/sensors.js#L63)). The perimeter sensor is a special case: 0.98 inside 150 m horizontally, otherwise nothing ([`network/sensors.js:67`](../frontend/src/sim/network/sensors.js#L67)).

### Measurement error

Each sensor has a quoted bearing, elevation and range error (`sapient.noise`). That quoted figure is taken as the error on a strong signal, and it grows as the signal weakens ([`site-range.js:68`](../frontend/src/sim/site-range.js#L68)):

$$k = \min\left(8,\ \sqrt{1 + \left(2\,(r/R)^{p}\right)^2}\right),\qquad p = 2 \text{ for radar},\ 1 \text{ otherwise}$$

Each reported value is the truth plus Gaussian noise with standard deviation `k` times the quoted error ([`network/sensors.js:138`](../frontend/src/sim/network/sensors.js#L138)). At the edge of reach k = 2.24. For a medium radar at half its reach k = 1.12. The `EDGE_ERROR` of 2 and the cap of 8 are assumptions ([`site-range.js:19`](../frontend/src/sim/site-range.js#L19)).

**Real physics.** Angle and range error from thermal noise scale as 1/√SNR. A radar's echo falls with r⁴, so its error grows with r²; a passive receiver's signal falls with r², so its error grows with r. The exponents match. The size of the error at the edge (twice the quoted figure) is a game choice.

**False alarms.** Each scan, a sensor raises at most one false alarm, with probability `falseAlarm` per scan, at a random direction inside what it covers and a random range from 15% to 100% of its range ([`network/sensors.js:121`](../frontend/src/sim/network/sensors.js#L121), [`network/sensors.js:206`](../frontend/src/sim/network/sensors.js#L206)). It is not tied to the detection threshold except through the settings in the radar and RF sections. A false alarm that falls in a radar blanking arc is dropped, so blanking removes false alarms in step with the share it blanks.

## 2. Radar

### Range against each drone: the fourth-root law

Each radar's published range is taken as its range against a reference target of 0.01 m² radar cross-section (RCS, the area of a perfect reflector that would return the same echo), described as a small quadcopter ([`world.js:75`](../frontend/src/sim/config/world.js#L75)). Range against any other drone is ([`site-range.js:38`](../frontend/src/sim/site-range.js#L38)):

$$R(\sigma) = R_{pub}\left(\frac{\sigma}{0.01\ \text{m}^2}\right)^{1/4}$$

For the Medium radar (Robin Radar IRIS class, 3.1 km), run through `reachFor`:

| Drone | RCS (m²) | Open-field reach |
|---|---|---|
| First-person-view strike drone (`fpv`) | 0.01 | 3,100 m |
| Fibre-optic strike drone (`fo`) | 0.01 | 3,100 m |
| Fixed-wing spotter drone (`spotter`) | 0.15 | 6,101 m |
| Fixed-wing strike drone (`fw`, Shahed class) | 0.2 | 6,556 m |

The RCS values are rough assumptions ([`drones.js:28`](../frontend/src/sim/config/drones.js#L28), and the comment above `SENSING`). Real RCS of small drones depends strongly on aspect, frequency and materials, and varies widely as a drone turns.

**Real physics.** The radar range equation gives the maximum range as

$$R_{max}^4 = \frac{P_t\, G^2\, \lambda^2\, \sigma}{(4\pi)^3\, k T_0 B F\, (S/N)_{min}\, L}$$

so at fixed everything else, range goes with σ^(1/4) and with transmit power^(1/4). The game uses exactly this scaling, anchored on one published figure per radar. It does not model the radar's actual power budget, so the anchor carries all the vendor's assumptions about target and conditions. The IRIS anchor is its 3.1 km figure against a 0.9 kg drone ([`sensors.js:8`](../frontend/src/sim/config/sensors.js#L8)), which the game equates with 0.01 m².

### Settings that change radar range

All of these follow the search radar equation, in which R⁴ goes with average power times the time spent on each part of the sky, divided by the solid angle searched ([`unit-config.js`](../frontend/src/sim/unit-config.js), [`sensor-model.js`](../frontend/src/sim/sensor-model.js)):

| Setting | Range multiplier | Where |
|---|---|---|
| Transmit power `W` against rated `W₀` | (W / W₀)^(1/4); half power gives 0.841 | [`unit-config.js:54`](../frontend/src/sim/unit-config.js#L54) |
| Scan period `T` against standard `T₀` | (T / T₀)^(1/4); doubling it gives 1.189 | [`unit-config.js:61`](../frontend/src/sim/unit-config.js#L61) |
| Arc per panel (fixed-panel radars) | (arc₀ / arc)^(1/4); a quarter of the arc gives 1.414 | [`unit-config.js:73`](../frontend/src/sim/unit-config.js#L73) |
| Elevation band narrowed | (elevation / band width)^(1/4) | [`sensor-model.js:37`](../frontend/src/sim/sensor-model.js#L37) |
| Radar band `f` against design band `f₀` | (f / f₀)^(1/8); X band to K band gives 1.128 | [`sensor-model.js:18`](../frontend/src/sim/sensor-model.js#L18), [`sensor-model.js:42`](../frontend/src/sim/sensor-model.js#L42) |
| Detection threshold low / high | 1.1 / 0.9, with false alarms x2 / x0.5 | [`unit-config.js:34`](../frontend/src/sim/unit-config.js#L34) |

The band rule assumes a small drone's RCS rises with the square root of frequency, so range rises with its eighth root. That is an assumption, labelled as such. A higher band also scales the quoted angle error by f₀ / f (narrower beam for the same antenna), which is real physics ([`sensor-model.js:43`](../frontend/src/sim/sensor-model.js#L43)). Rated powers come from [`tx-power.js:9`](../frontend/src/sim/config/tx-power.js#L9), each marked published, secondary or assumption.

### Where a radar looks

A rotating radar covers 360°. A fixed-panel radar covers its arc per panel, panels side by side, centred on where it faces (by default away from the site). Every radar covers an elevation band from 10° below the horizon (an assumption, so a mast-mounted radar can look down) up to its catalogue elevation minus 10° ([`sensor-model.js:5`](../frontend/src/sim/sensor-model.js#L5), [`sensor-model.js:33`](../frontend/src/sim/sensor-model.js#L33)). A drone close overhead can therefore be above the beam. Up to three blanking arcs see nothing ([`sensor-model.js:49`](../frontend/src/sim/sensor-model.js#L49)). Raising the low edge of the beam halves false alarms for every 10° raised ([`unit-config.js:125`](../frontend/src/sim/unit-config.js#L125)).

| Radar | Range vs 0.01 m² | Band (GHz) | Rated power (W) | Mast (m) | Arc | Elevation band | Clutter: below / beyond (m) | Scan (s) | Error az / el / range | False alarm per scan |
|---|---|---|---|---|---|---|---|---|---|---|
| Small radar (`radar_s`) | 1000 | 24.55 (K) | 2 | 15 | 120° | -10° to 70° | 30 / 300 | 1 | 1° / 2° / 10 m | 0.15 |
| Blighter A400 (`radar_a400`) | 2730 | 16.40 (Ku) | 4 | 25 | 90° | -10° to 10° | 40 / 500 | 1 | 0.6° / 1.2° / 8 m | 0.1 |
| Blighter A800 (`radar_a800`) | 3000 | 16.45 (Ku) | 4 | 25 | 90° | -10° to 30° | 40 / 500 | 1 | 0.6° / 1.2° / 8 m | 0.1 |
| Medium radar (`radar`) | 3100 | 9.35 (X) | 12 | 25 | 360° | -10° to 50° | 40 / 500 | 1 | 0.6° / 1.2° / 8 m | 0.1 |
| Giraffe 1X (`radar_giraffe`) | 4000 | 9.60 (X) | 150 | 3 | 360° | -10° to 60° | 30 / 800 | 1 | 0.3° / 0.6° / 5 m | 0.1 |
| Large radar (`radar_l`) | 4300 | 9.60 (X) | 100 | 30 | 120° | -10° to 50° | 30 / 800 | 1 | 0.3° / 0.6° / 5 m | 0.1 |

Sources and the basis of each figure are in [SENSORS.md](SENSORS.md).

### Ground clutter and the Doppler filter

Ground clutter is the echo from the ground itself, which can hide a low target. The game has a rule for it ([`site-range.js:77`](../frontend/src/sim/site-range.js#L77)): a drone is "in clutter", and its Pd is multiplied by 0.3 ([`world.js:79`](../frontend/src/sim/config/world.js#L79)), when all of these hold:

- it is lower above the ground than the radar's `lowAlt`;
- it is further away horizontally than `lowRange` times a factor for the ground cover under it: 1.5 for open ground and water, 0.7 for forest, 0.5 for built-up areas and power-line corridors ([`site-range.js:12`](../frontend/src/sim/site-range.js#L12));
- its total speed is below 5 m/s (`clutterSpeed`, [`world.js:80`](../frontend/src/sim/config/world.js#L80)), because a Doppler radar separates a moving target from the still ground.

The clutter filter setting scales `lowRange` (low 1.4, medium 1, high 0.7) and false alarms (x2, x1, x0.5), and the high filter adds a blind speed: a drone whose *radial* speed (towards or away from the radar) is below 4 m/s is filtered out entirely, which includes a fast drone crossing at right angles ([`sensor-model.js:22`](../frontend/src/sim/sensor-model.js#L22), [`network/sensors.js:78`](../frontend/src/sim/network/sensors.js#L78)).

In the current catalogue the slowest drone (`agrast30`, [`real-drones-cots.js:67`](../frontend/src/sim/config/real-drones-cots.js#L67)) flies at 10 m/s, and jamming at most halves a drone's speed, so **no drone in flight is slow enough for the clutter rule to apply**. In practice the clutter penalty only affects a hovering drone, and the high clutter filter's blind speed is the only clutter effect a player sees. Worked example 1 shows this.

A radar with a micro-Doppler classifier (the modulation of the echo by spinning rotors) names a drone as multirotor or fixed wing inside half its reach, an assumption ([`sensor-model.js:29`](../frontend/src/sim/sensor-model.js#L29)).

**Real physics.** Real clutter depends on grazing angle, terrain roughness, wind-blown vegetation and the radar's resolution cell, and a Doppler radar's clutter notch rejects targets by *radial* velocity, not total speed. The game uses total speed for the clutter rule and radial speed only for the high filter's blind speed. The 0.3 penalty and the cover factors are game rules.

### Rain

In rain, a radar keeps 1.0 of its range in S band, 0.95 in X band, 0.85 in Ku band and 0.75 in K band ([`conditions.js:17`](../frontend/src/sim/conditions.js#L17)). Real rain attenuation depends on rain rate and path length (ITU-R P.838 gives it in dB per km); the game applies one fixed factor per band, whatever the distance.

## 3. Terrain, canopy and the radio path model

### The height grids

Every world, generated or real, is a square grid of 20 m cells ([`world.js:44`](../frontend/src/sim/config/world.js#L44); real map packs use the same 20 m, [`world-pack.js:10`](../frontend/src/sim/world-pack.js#L10)). Each cell holds:

- ground height (32-bit float, metres above the station base), read with bilinear interpolation ([`world.js:45`](../frontend/src/sim/world.js#L45));
- canopy height and building height, in whole metres (0 to 255), read from the nearest cell;
- a cover class: open, forest, built-up, power-line corridor or water.

Generated ground has a relief setting of 380 m, a flat platform 450 m round the station, trees 12 to 20 m tall, and hamlet houses 5 to 10 m tall ([`world.js:43`](../frontend/src/sim/config/world.js#L43), [`terrain.js`](../frontend/src/sim/terrain.js)). Real maps take heights from lidar or national height data ([MAPS.md](MAPS.md)).

### Radio paths: radar, RF detection and jamming

`pathLoss` ([`propagation.js:50`](../frontend/src/sim/propagation.js#L50)) works out the loss, in dB beyond free space, on the path from a to b at a frequency. Free-space loss is already inside each system's open-field range, so only the excess counts.

1. **Profile.** The path is sampled at up to 256 points (`MAX_SAMPLES`, [`propagation.js:10`](../frontend/src/sim/propagation.js#L10)): one per 20 m cell on paths up to 5.1 km, and coarser beyond (about 55 m apart on a 14 km path), where a single roof can fall between two points. Each point gets ground height plus building height (the hard profile), and that plus tree height (the soft profile). Trees within 50 m of the transmitting end are taken as cleared (`endClear`, [`world.js:61`](../frontend/src/sim/config/world.js#L61)).
2. **Earth curvature and refraction.** The earth's bulge is added at each point with the standard 4/3 effective earth radius (8,495 km), which allows for normal atmospheric refraction ([`propagation.js:9`](../frontend/src/sim/propagation.js#L9), [`propagation.js:18`](../frontend/src/sim/propagation.js#L18)): h = d₁d₂ / (2kR). On a 3 km path the bulge at the middle is 0.13 m; on 20 km it is 5.9 m.
3. **Diffraction over terrain and buildings.** The Bullington method of [ITU-R P.526](https://www.itu.int/rec/R-REC-P.526/en) (the code follows P.526-15, section 4.5.1, equations 31 and 49 to 57) replaces the whole profile with one equivalent knife edge. If the path is clear, the edge is the point that comes closest to the ray; if not, it is where the steepest lines from each end cross ([`propagation.js:32`](../frontend/src/sim/propagation.js#L32)). Its height above the ray gives the Fresnel-Kirchhoff parameter

   $$\nu = h\sqrt{\frac{2D}{\lambda\, d_1 d_2}}$$

   and the knife-edge loss is ([`propagation.js:22`](../frontend/src/sim/propagation.js#L22))

   $$J(\nu) = 6.9 + 20\log_{10}\!\left(\sqrt{(\nu-0.1)^2+1} + \nu - 0.1\right)\ \text{dB for}\ \nu > -0.78,\ \text{else } 0$$

   which gives 6.03 dB at grazing (ν = 0) and 13.93 dB at ν = 1. The P.526 correction for a whole profile is then added ([`propagation.js:46`](../frontend/src/sim/propagation.js#L46)):

   $$L = J + \left(1 - e^{-J/6}\right)\left(10 + 0.02\,D_{km}\right)$$

   Loss starts as soon as an obstacle enters the first Fresnel zone (radius √(λd₁d₂/D), 4.9 m at the middle of a 3 km X-band path), which is why mast height matters even with a clear line.
4. **Trees.** Where the straight ray passes through canopy, the depth of canopy it crosses gives a Weissberger loss ([`propagation.js:25`](../frontend/src/sim/propagation.js#L25)), with f in GHz and d in metres:

   $$L_{foliage} = \begin{cases} 0.45\, f^{0.284}\, d & d \le 14 \\ 1.33\, f^{0.284}\, d^{0.588} & 14 < d \le 400 \end{cases}$$

   Depth is capped at 400 m, where Weissberger's model stops. The path loss is then the lesser of "diffraction plus foliage loss" and "diffraction over the treetops" (Bullington on the soft profile, [`propagation.js:68`](../frontend/src/sim/propagation.js#L68)). So a deep forest costs about as much as diffracting over it: in worked example 2, 100 m and 400 m of trees cost 22.5 and 23.0 dB. Trees count only where the straight ray passes through them. Treetops that rise into the Fresnel zone without touching the ray add no loss, as in the radar case of worked example 1.
5. **Loss to reach.** Reach on this path is the open-field reach times ([`propagation.js:73`](../frontend/src/sim/propagation.js#L73)):

   $$R_{path} = R_{open} \cdot 10^{-L/20}$$

   This is right for both kinds of system. A one-way link's received power goes with 10^(-L/10)/r², so r goes with 10^(-L/20). A radar takes the loss both ways and its echo goes with 10^(-2L/10)/r⁴, so r again goes with 10^(-L/20). Each 6 dB halves reach; 20 dB leaves a tenth.

The frequency used is the radar's own band, the band an RF detector hears the drone on, or the band a jammer is jamming. A jammer's range prediction with no particular link uses 2.4 GHz ([`site-range.js:15`](../frontend/src/sim/site-range.js#L15)). Antenna height is the system's ground height plus its mast (`mount`).

### Optical line of sight: cameras, lasers, crews and satellite dishes

`los()` ([`world.js:55`](../frontend/src/sim/world.js#L55)) walks a straight line one sample per 20 m cell. The line is blocked outright if any sample is below ground plus building height. Otherwise it counts the metres of the line inside tree canopy, ignoring trees within 50 m of the observer. `clearSight` passes a line with at most 40 m of canopy on it (`opticalCanopyTol`, [`world.js:40`](../frontend/src/sim/world.js#L40), [`world.js:60`](../frontend/src/sim/config/world.js#L60)), so a camera can see through a thin belt of trees but not a wood.

The optical line has **no earth curvature and no refraction**. At game ranges this matters little: with the 4/3 radius the bulge at the middle of a 6.4 km line (the large camera fully zoomed) is 0.6 m.

A camera, laser, gun or beam-riding missile keeps its full reach if the line is clear and has none if it is not ([`site-range.js:63`](../frontend/src/sim/site-range.js#L63)). There is no partial loss through haze or thin canopy.

### Systems that need no path

An interceptor drone, or a missile with its own seeker, is cued over the terrain and needs no line of sight from where it stands ([`site-range.js:28`](../frontend/src/sim/site-range.js#L28), [`effectors.js:25`](../frontend/src/sim/effectors.js#L25)).

Two kinds of effector whose `fire` is `guided` do need the optical line above, from the muzzle their rounds leave ([`site-range.js:29`](../frontend/src/sim/site-range.js#L29), [`site-range.js:32`](../frontend/src/sim/site-range.js#L32)): **every gun**, and a **beam-riding missile** (`beamRider`: the Rapid Ranger and the Stormer HVM, whose launcher holds a laser beam on the target). Their rounds still fly as guided rounds (see [section 11](#11-weapons-hit-chance-time-of-flight-and-beam-dwell)). The line is checked when the weapon is offered a task and each time it fires, and for a beam-rider once more as the missile arrives: if the launcher has lost the target by then, it misses ([`effectors.js:137`](../frontend/src/sim/effectors.js#L137)). Guns worked by a crew off the network also need the crew to see the drone ([`crew.js`](../frontend/src/sim/crew.js)).

### One model for prediction and play

The range ring on the map, the Range panel, the path profile and live detection all call the same `reachOnPath` ([ADR 0003](adr/0003-range-from-a-terrain-path-model.md)). `predictRange` checks 90 bearings, 32 points out along each, against one drone type at its typical height ([`site-range.js:84`](../frontend/src/sim/site-range.js#L84)), so a prediction cannot disagree with what happens in play, apart from the random roll.

**Real physics.** Bullington, the knife-edge function and Weissberger are standard engineering models, and the code implements them as published; the knife edge and Weissberger values are unit-tested against known points ([`propagation.test.js`](../frontend/tests/propagation.test.js)). What the model leaves out matters more than what it includes:

- **No ground reflection.** Over flat ground a direct ray and a ground-reflected ray interfere. Beyond the two-ray breakpoint distance, about 4h₁h₂/λ, received power falls with r⁴ instead of r². For a jammer 1.5 m up and a drone 15 m up at 2.44 GHz that distance is 733 m, so beyond it a real low jammer or detector does worse than this model says. For an RF detector on 9 m and a drone at 60 m it is 17.6 km, so free space holds. The code notes this as a shortcut and [TODO.md](TODO.md) lists it.
- No multipath, ducting, atmospheric gas absorption, or statistical variability (as ITM or P.1546 would give).
- One equivalent edge per path. Bullington tends to underestimate loss on paths with several separate obstacles.
- Clutter loss from buildings is diffraction over their grid heights only, not penetration.
- The model has not been checked against NTIA ITM or measurements ([ADR 0003](adr/0003-range-from-a-terrain-path-model.md)). P.526-15 has since been superseded by P.526-16 (November 2025); the code has not been reviewed against the new edition.

## 4. RF detection

An RF detector is a passive receiver that hears a drone's control and video links.

### What a drone radiates

A drone with `rfEmitter: true` radiates on the bands of its control and video links ([`rf-model.js:33`](../frontend/src/sim/rf-model.js#L33)). A drone with a radio link on no known band is assumed to use 2.4 GHz ([`rf-model.js:9`](../frontend/src/sim/rf-model.js#L9)). The bands are ([`comms.js:5`](../frontend/src/sim/config/comms.js#L5)):

| Band | Frequencies (GHz) | Use |
|---|---|---|
| `control900` | 0.860 to 0.930 | Long-range control links (for example ELRS) |
| `control24` | 2.400 to 2.4835 | Common FPV and hobby control link |
| `video58` | 5.650 to 5.925 | Common FPV video downlink |
| `gnss` | 1.215 to 1.255 and 1.559 to 1.610 | Satellite navigation; drones only receive it |

A fibre-optic drone (`fo`) and an autonomous fixed-wing strike drone (`fw`) have `rfEmitter: false`, so every RF detector's reach against them is zero ([`site-range.js:37`](../frontend/src/sim/site-range.js#L37)).

### Which band it is heard on

A detector covers a link band if its receiver's frequency range overlaps the band and (if set) it monitors that band ([`rf-model.js:41`](../frontend/src/sim/rf-model.js#L41)). Of the bands it covers, it hears a drone on the one that **carries furthest** ([`rf-model.js:44`](../frontend/src/sim/rf-model.js#L44)), which for the link bands in the catalogue is the lowest. Bands your own switched-on jammers fill near the detector are deaf to it ([`jamming.js:45`](../frontend/src/sim/jamming.js#L45)). The path loss is worked out at the middle of the heard band.

### Reach

$$R = R_{pub}\sqrt{P_{rel}}\cdot\frac{f_0}{f}\,V\cdot 2^{(S_0 - S)/6}$$

`P_rel` is the drone's link power relative to a small FPV (`rfPower`, an assumption, for example 2.5 for the spotter, [`site-range.js:40`](../frontend/src/sim/site-range.js#L40)). `S` is the receiver sensitivity setting in dBm against its catalogue `S₀`: every 6 dB more sensitive doubles reach ([`unit-config.js:150`](../frontend/src/sim/unit-config.js#L150)). `f` is the middle of the band the link is heard on and `f₀` that of the 2.4 GHz control band (2.442 GHz), the link a detector's range is quoted for. `V` is 1.78 (5 dB) for a video link and 1 for a control link ([`rf-model.js:55`](../frontend/src/sim/rf-model.js#L55)).

All of it follows the Friis free-space equation, P_r = P_t G_t G_r (λ / 4πd)². Range goes with the square root of transmit power, doubles for each 6 dB of extra receiver sensitivity, and, with the same antenna gain on every band, goes with wavelength:

| Link heard | f₀ / f | V | Reach against the quoted range |
|---|---|---|---|
| 900 MHz control (0.895 GHz) | 2.73 | 1 | 2.73 |
| 2.4 GHz control (2.442 GHz) | 1 | 1 | 1 |
| 5.8 GHz video (5.788 GHz) | 0.42 | 1.78 | 0.75 |

The 5 dB is an assumption taken from the config's own link budgets, which give a video sender 25 dBm and the return on a control link 20 dBm. Jamming has no such term: the jammer and the link it drowns are on the same frequency, so wavelength cancels.

The open-field ranges are assessed, not computed from a link budget. The config records the check used ([`sensors.js:6`](../frontend/src/sim/config/sensors.js#L6), [`sensors.js:110`](../frontend/src/sim/config/sensors.js#L110)): a small FPV sending 25 dBm, a 6 dBi antenna and -90 dBm sensitivity give 4.6 km at 5.8 GHz (free-space loss 107.7 dB at 1 km, which `freeSpaceLoss` reproduces), while the game uses 3.5 km, the middle of the Dedrone datasheet's 2 to 5 km.

### Direction finding and what is reported

RF detectors report a bearing only: no range and no elevation (their `sapient.noise` has only `az`). Angle-of-arrival detectors have 2° to 3° bearing error, sector detectors 30° ([`unit-config.js:22`](../frontend/src/sim/unit-config.js#L22)). A position comes only from crossing bearings in the fusion node ([FUSION_AND_TARGETING.md](FUSION_AND_TARGETING.md)). The signal amplitude in the [SAPIENT](SAPIENT.md) report is a cosmetic formula, -45 dB - 20 log₁₀(r / 100 m) plus 2 dB noise, not the output of a link budget ([`network/sensors.js:171`](../frontend/src/sim/network/sensors.js#L171)).

The classifier library affects only what the detector names, not whether it detects ([`rf-model.js:14`](../frontend/src/sim/rf-model.js#L14)); with no library its false alarms double. A narrow receiver visits one band per report interval, so its interval is multiplied by the number of bands it monitors ([`unit-config.js:168`](../frontend/src/sim/unit-config.js#L168)).

| RF detector | Range (m) | Receiver (GHz) | Link bands heard | Sensitivity (dBm) | DF | Bearing error | Mast (m) | False alarm per scan |
|---|---|---|---|---|---|---|---|---|
| Small RF detector (`rf_s`) | 2000 | 2.4 to 2.4835, 5.15 to 5.925 | control24, video58 | -85 | sector | 30° | 1.5 | 0.08 |
| Medium RF detector (`rf`) | 3500 | 0.07 to 6 | control900, control24, video58 | -90 | angle of arrival | 3° | 9 | 0.05 |
| Elysion RF detector (`rf_elysion`) | 3500 | 2.4 to 2.4835, 5.15 to 5.925 | control24, video58 | -90 | sector | 30° | 9 | 0.05 |
| Airfence (`rf_airfence`) | 10000 | 0.07 to 6 | control900, control24, video58 | -95 | angle of arrival | 3° | 9 | 0.04 |
| Large RF detector (`rf_l`) | 14000 | 0.02 to 8 | control900, control24, video58 | -100 | angle of arrival | 2° | 9 | 0.03 |

**Real physics.** A real detector's reach depends on the drone's actual transmit power and duty cycle (a video link transmits continuously, a control link in bursts), antenna patterns on both ends, the noise floor and interference in the band, and the detector's processing. The game reduces all of that to one assessed range per detector, scaled by `rfPower`, the band and sensitivity, then applies the terrain path. It takes the same antenna gain on every band and a control link that sends all the time, so a real detector may hear a bursting 900 MHz link less far than the 2.73 here.

## 5. Optical (EO/IR) cameras and the human eye

### Pixels on target

A camera's catalogue range is where a 0.35 m drone (`refSize`) covers 4 pixels. Reach for a drone of size `s` is linear in size ([`site-range.js:39`](../frontend/src/sim/site-range.js#L39)):

$$R = R_{pub}\cdot\frac{s}{0.35\ \text{m}},\qquad \text{pixels on target} = \frac{4R}{r}$$

([`camera-model.js:9`](../frontend/src/sim/camera-model.js#L9)). The catalogue ranges themselves follow from the optics: R = s · N_px / (4 · FOV in radians). Worked out with the stated pixel counts and views, that gives 642 m for the medium camera (1280 pixels across 10°, catalogue 650 m), 267 m for the small one (640 across 12°, catalogue 260 m) and 452 m for the large one (640 across 7.1°, catalogue 450 m).

Detect, recognise, identify ([`camera-model.js:8`](../frontend/src/sim/camera-model.js#L8)):

| Level | Pixels across | Range as a share of detection reach | What the camera reports |
|---|---|---|---|
| Detect | 4 | 1 | "UAV" |
| Recognise | 8 | 1/2 | airframe (multirotor or fixed wing) at 0.85 confidence |
| Identify | 13 | 4/13 | the drone model as well, airframe at 0.95 |

These are Johnson-style criteria. Johnson's 1958 criteria, for a 50% chance, are about 1 cycle (2 pixels) across the target's critical dimension to detect, 4 cycles (8 pixels) to recognise and 6.4 cycles (12.8 pixels) to identify. The game's recognise and identify thresholds match; its detection threshold of 4 pixels is twice Johnson's, which is conservative. Unlike Johnson, the game does not use the thresholds as probabilities: detection uses the general Pd curve with R at the 4-pixel range, and recognition and identification are certain once the pixel count is reached.

### Field of view, zoom and slewing

A camera sees only inside its current view, a square of the field of view in azimuth and elevation round where it points ([`network/sensors.js:39`](../frontend/src/sim/network/sensors.js#L39)). Idle, it sweeps its search arc at `searchRate` (12°/s) at 3° elevation. When the fusion node cues it to a track, it slews at `slewRate` (90°/s), and once on target a zoom camera switches to its narrow track view, which multiplies reach by fov / trackFov (4x for the medium camera, 14.2x for the large one). If nothing is seen within half its dwell time it widens again ([`network/sensors.js:30`](../frontend/src/sim/network/sensors.js#L30), [`network/sensors.js:212`](../frontend/src/sim/network/sensors.js#L212)). With a 2D cue (no height) it steps its view up from the horizon, three looks at each step.

| Camera | Range vs 0.35 m | Search / track view | Zoom | Channels | Sensor | f-number | Slew / sweep (°/s) | Dwell (s) | Bearing error |
|---|---|---|---|---|---|---|---|---|---|
| Small EO/IR camera (`camera_s`) | 260 | 12° / 12° | 1x | thermal | 640 px | 1 | 90 / 12 | 3 | 0.1° |
| Medium EO/IR camera (`camera`) | 650 | 10° / 2.5° | 4.0x | visible and thermal | 1280 px | 2 | 90 / 12 | 3 | 0.05° |
| Large EO/IR camera (`camera_l`) | 450 | 7.1° / 0.5° | 14.2x | thermal | 640 px | 5.5 | 90 / 12 | 3 | 0.02° |

### Settings

- **Resolution:** range scales with pixels across ([`unit-config.js:193`](../frontend/src/sim/unit-config.js#L193)).
- **Search view:** range scales with fov₀ / fov ([`unit-config.js:179`](../frontend/src/sim/unit-config.js#L179)).
- **F-number `N`:** light gathered goes with (N₀ / N)², which helps only when light is short (dusk, night, rain), capped at full range ([`conditions.js:24`](../frontend/src/sim/conditions.js#L24)).
- **Thermal sharpness:** a lens blurs a point to a spot of about λN (10 µm for long-wave, 4 µm for mid-wave infrared). Pixels smaller than that spot add nothing, so the thermal channel's range is cut when more, smaller pixels are fitted or a slower lens is used ([`camera-model.js:31`](../frontend/src/sim/camera-model.js#L31)). The comparison uses λN, the common Fλ/d measure; the full Airy disc is 2.44λN across.

### Day, night and weather

| Conditions | Visible channel | Thermal channel | Medium camera (both channels) |
|---|---|---|---|
| Clear day | 1 | 1 | 650 m |
| Dusk | 0.5 | 1 | 650 m |
| Night | 0.1 | 1 | 650 m |
| Rain and haze | 0.5 | 0.6 | 390 m |

A camera uses its better channel ([`conditions.js:28`](../frontend/src/sim/conditions.js#L28)). These factors are assumptions. Because they scale the camera's reach, they also shrink the pixel count used for classification, so a camera at night names a drone at a shorter range, not just detects it later.

### The human eye

Crews working a gun or jammer by hand see a drone where its span fills 0.065°, from field trials in which half the observers saw a Phantom 4 at 245 m and a Mavic Air at 307 m, capped at 3 km for haze, scaled by the visible-light factor but never below half with night sights ([`crew.js:13`](../frontend/src/sim/config/crew.js#L13), [`crew.js:19`](../frontend/src/sim/crew.js#L19)). That gives 309 m for an FPV and 2,204 m for a Shahed-class drone in daylight. They need a clear line, as a camera does.

**Real physics.** Real detection range depends on target contrast against the sky or ground background, atmospheric transmission (Beer-Lambert extinction from haze and rain, which falls off exponentially with range), the system's modulation transfer function and noise, and the observer or algorithm. The game has none of these, only geometry (pixels on target) with fixed weather factors. Its pixel thresholds are a sound basis, so the geometric parts (zoom, resolution, size) scale correctly. The weather and night factors are the weakest part.

## 6. Acoustic sensing

Reach is the catalogue range against a small FPV times the drone's loudness (`sound`, an assumption: 1 for an FPV, 3 for the spotter, 5 for the Shahed class) ([`site-range.js:41`](../frontend/src/sim/site-range.js#L41)). Sound needs no line of sight, but ([`site-range.js:59`](../frontend/src/sim/site-range.js#L59)):

- behind a hill or building (the line is blocked) it keeps 0.5 of its reach;
- a sensor standing in a built-up cell keeps 0.5, for background noise;
- in rain it keeps 0.5 ([`conditions.js:15`](../frontend/src/sim/conditions.js#L15)).

All three factors are assumptions and multiply together. Trees do not affect it.

Sound is late: the sensor hears where the drone was when the sound left it, r / 343 s ago ([`network/sensors.js:19`](../frontend/src/sim/network/sensors.js#L19), [`network/sensors.js:24`](../frontend/src/sim/network/sensors.js#L24)). For a Shahed-class drone 1 km away that is about 3 s and 130 m behind.

| Sensor | vs FPV | vs spotter | vs Shahed class | Bearing / elevation error |
|---|---|---|---|---|
| Small acoustic sensor (`acoustic_s`) | 300 m | 900 m | 1,500 m | 10° / none |
| Medium acoustic sensor (`acoustic`) | 500 m | 1,500 m | 2,500 m | 4° / 6° |
| Large acoustic sensor (`acoustic_l`) | 1,000 m | 3,000 m | 5,000 m | 10° / none |

Crews also hear drones: 300 m per unit of loudness, halved in rain ([`crew.js:21`](../frontend/src/sim/crew.js#L21)).

**Real physics.** Sound pressure falls 6 dB for each doubling of distance (spherical spreading), plus atmospheric absorption that rises steeply with frequency, plus refraction by wind and temperature gradients, which can create shadow zones much shorter than the still-air range. A source 6 dB louder is heard twice as far under spherical spreading, so a linear "loudness times range" is consistent with that law if `sound` is read as a pressure ratio. The game's "rain adds about 6 dB of noise, so half the reach" note uses the same law. Wind, temperature and frequency content are not modelled.

## 7. Jamming, spoofing and take-over

### Does a jammer reach the drone?

A jammer reaches a drone on a band when all of these hold ([`jamming.js:19`](../frontend/src/sim/jamming.js#L19)):

- the band is fitted and switched on;
- the drone (or, for video, the operator) is inside the jammer's arc (sector antenna) and its beam (handheld, `beam` degrees wide, pointed by its soldier, [`jamming.js:17`](../frontend/src/sim/jamming.js#L17));
- the distance is within `range x k`, and within the reach on the real radio path at that band's frequency, times `k`.

`k` carries the jamming-to-signal physics. A drone's control receiver hears its operator from distance d_s and the jammer from d_j. With both in free space,

$$\frac{J}{S} = \frac{P_j G_j}{P_s G_s}\left(\frac{d_s}{d_j}\right)^2$$

so for a fixed J/S needed to break the link, the jammer's reach d_j grows in proportion to d_s. The game uses k = d_s / 4,500 m, with the drone's launch point standing in for its operator ([`jamming.js:36`](../frontend/src/sim/jamming.js#L36)): a jammer's quoted range is taken as true against a drone 4.5 km from its operator, an assumption. A drone 13 km from its launch point is jammed out to 2.9 times the quoted range.

- **Control link:** jammed at the drone, k = d_s / 4,500.
- **Video link:** jammed where it is received, at the operator, on a 2 m antenna at the launch point ([`jamming.js:28`](../frontend/src/sim/jamming.js#L28)), with the same k. A jammer near the site therefore almost never reaches an operator kilometres away (worked example 3).
- **GNSS:** jammed at the drone with k = 1.

Transmit power scales jamming range with √(W / W₀) ([`unit-config.js:54`](../frontend/src/sim/unit-config.js#L54)), and a 60° sector antenna with 10 dB of gain multiplies it by √10 = 3.16 ([`unit-config.js:26`](../frontend/src/sim/unit-config.js#L26)): the Medium jammer's 1,000 m becomes 3,162 m through its arc.

### What jamming does to a drone

Each step, every jammer that reaches a drone contributes ([`drones.js:197`](../frontend/src/sim/drones.js#L197)). `eff = 1 - jamResist` is how far the drone's anti-jam measures let it through.

| Effect | What happens | Constants |
|---|---|---|
| Control link jammed | Speed falls to 1 - (1 - slow) x eff (0.5 at eff 1). A jam timer runs at eff x rate per second. When it reaches the jammer's `killTime` the link is lost: a hand-flown drone crashes; one that flies itself (`lostLink: 'home'`) turns for home, unless its GNSS is also jammed, when it crashes | slow 0.5 and killTime 5 s for every catalogue jammer; rate 2 for a reactive jammer, else 1 ([`jamming.js:40`](../frontend/src/sim/jamming.js#L40)) |
| Video link only, hand-flown drone | Speed falls to 1 - 0.3 x eff, and the timer runs at half rate, so it comes down after about twice the kill time | [`drones.js:219`](../frontend/src/sim/drones.js#L219) |
| Video link only, autonomous drone | Blinded only: a spotter with jammed video gives no strike bonus | [`drones.js:86`](../frontend/src/sim/drones.js#L86) |
| Not jammed | The timer decays at 0.5 per second | [`drones.js:236`](../frontend/src/sim/drones.js#L236) |
| GNSS jammed | Heading error does a random walk, σ = 0.08 x eff x √t radians (18° after 60 s at eff 0.5); the drift stays | [`drones.js:238`](../frontend/src/sim/drones.js#L238) |
| GNSS spoofed | Heading is pulled towards 2.1 rad (120°) off course at 0.15 x eff rad/s, so it spirals away | [`drones.js:18`](../frontend/src/sim/drones.js#L18), [`drones.js:217`](../frontend/src/sim/drones.js#L217) |
| Taken over (commercial links only) | After killTime / eff seconds the drone is landed whole, with no blast | [`drones.js:213`](../frontend/src/sim/drones.js#L213) |

Heading drift only acts on strike drones; a spotter's orbit ignores it. A drone within `terminal` metres of its target flies on by its own homing and is immune ([`drones.js:198`](../frontend/src/sim/drones.js#L198)).

**Fibre-optic drones** have no links, so nothing jams them. **The Shahed-class fixed-wing drone** has only GNSS. **Reactive jamming** acts only on links its receiver hears and its library knows, never on GNSS, and not on a drone that hops frequency faster than it can follow (`hops`) ([`jamming.js:70`](../frontend/src/sim/jamming.js#L70)). Your own jammers deafen your own RF detectors and degrade your own network links on the bands they fill ([`jamming.js:45`](../frontend/src/sim/jamming.js#L45), [section 8](#8-network-links-between-nodes)).

Later waves are harder to jam: `jamResist` rises by 0.05 per wave per unit of `adapt`, capped at 0.95 ([`world.js:126`](../frontend/src/sim/config/world.js#L126), [`drones.js:29`](../frontend/src/sim/drones.js#L29)). An FPV goes from 0 at wave 1 to 0.45 at wave 10.

| Jammer | Range (m) | Rated power (W) | Mast (m) | Bands | Beam |
|---|---|---|---|---|---|
| DroneGun Mk4 (`jammer_mk4`) | 1000 | 40 | 1.5 | control900, control24, video58, gnss | 30° |
| DroneGun MkIII (`jammer_dgmk3`) | 500 | 10 | 1.5 | control900, control24, video58 | 30° |
| Small RF jammer (`jammer_s`) | 500 | 10 | 1.5 | control24, video58 | omni |
| DroneGun Tactical (`jammer_dgtac`) | 1000 | 40 | 1.5 | control900, control24, video58 | 30° |
| Kvertus G-6 (`jammer_kvertus`) | 1500 | 110 | 1.5 | control900, control24, video58, gnss | 30° |
| SkyWiper (`jammer_skywiper`) | 3000 | 40 | 1.5 | control900, control24, video58, gnss | 30° |
| Medium RF jammer (`jammer`) | 1000 | 40 | 1.5 | control24, video58 | omni |
| K-CEMA NEO (`jammer_neo`) | 1100 | 45 | 1.5 | control900, control24, video58, gnss | omni |
| K-CEMA Jupiter (`jammer_jupiter`) | 3900 | 600 | 3 | control900, control24, video58, gnss | omni |
| AUDS jammer (`jammer_auds`) | 2000 | 150 | 9 | control900, control24, video58, gnss | omni |
| Large RF jammer (`jammer_l`) | 3000 | 400 | 9 | control24, video58 | omni |
| Sensofusion jammer (`jammer_sf`) | 4500 | 800 | 3 | control900, control24, video58, gnss | omni |

Every catalogue jammer is a barrage jammer by default, with slow 0.5 and killTime 5 s. Techniques, receivers and triggers are in [EFFECTORS.md](EFFECTORS.md).

**Real physics.** The J/S scaling with the operator's distance is the right first-order physics, and so is the square-root power law. The game departs from reality in these ways:

- Ranges are each jammer's quoted figure, not computed from power and antenna gain. Rated powers only scale them.
- Real satellite navigation signals arrive far weaker than a control link, so real GNSS jamming usually reaches much further than link jamming at the same power. The game gives GNSS jamming the jammer's quoted range (k = 1).
- Link loss is a timer, not a J/S threshold. Spread-spectrum processing gain, frequency hopping (except the `hops` flag), adaptive links and burn-through close to the operator are not modelled; `jamResist` stands in for all of them as a rate.
- Low jammer masts (1.5 m) get no ground-reflection penalty (see [section 3](#3-terrain-canopy-and-the-radio-path-model)), so short-mast jamming range on flat ground is probably optimistic.

## 8. Network links between nodes

Every sensor and effector reaches the fusion node over Starlink or cellular ([`comms.js`](../frontend/src/sim/comms.js), constants in [`comms.js:20`](../frontend/src/sim/config/comms.js#L20)). This is a geometric model, not a link budget:

- **Starlink:** 12 lines of sight 1.5 km long at the dish's 25° minimum elevation. Quality = 1 - (share blocked) / 0.4, so the link fails once 40% of that sky is blocked ([`comms.js:41`](../frontend/src/sim/comms.js#L41)). Up above 0.12 quality.
- **Cellular:** a tower within 12 km (x 1.0 for 900 MHz, 0.55 for 1800 MHz, 0.3 for 3.5 GHz) with a line clear of ground and buildings. Quality = (1 - d / range) x e^(-canopy / 900 m) ([`comms.js:71`](../frontend/src/sim/comms.js#L71)), using `rfCanopyLength` of 300 m ([`world.js:59`](../frontend/src/sim/config/world.js#L59)). Up above 0.1.
- **Own jamming:** each switched-on jammer whose noise bands overlap the link's band, within range and arc, multiplies quality by 0.5 x (distance / range) ([`comms.js:79`](../frontend/src/sim/comms.js#L79)). With the current bands only the 900 MHz cellular band overlaps a jammer band (`control900`). Starlink's Ku band and the 1800 MHz and 3.5 GHz cellular bands overlap none, so your jammers never affect them.

Message timing, capacity and loss are covered in [SAPIENT.md](SAPIENT.md).

## 9. Weather and light

Conditions are an input to the run, saved with the laydown ([`conditions.js:11`](../frontend/src/sim/conditions.js#L11)). Each factor is the share of clear-day range a system keeps, and every one is an assumption.

| Conditions | Visible camera | Thermal camera | Laser | Acoustic and crew hearing | Radar | Crew eyesight |
|---|---|---|---|---|---|---|
| Clear day | 1 | 1 | 1 | 1 | 1 | 1 |
| Dusk | 0.5 | 1 | 1 | 1 | 1 | 0.5 |
| Night | 0.1 | 1 | 1 | 1 | 1 | 0.5 (night-sight floor) |
| Rain and haze | 0.5 | 0.6 | 0.5 | 0.5 | 1 (S), 0.95 (X), 0.85 (Ku), 0.75 (K) | 0.5 |

Weather does **not** change RF detection, jamming, network links, guns, missiles, interceptors, the RF directed-energy weapon (`rfBeam`), or how drones fly. A laser's range shrinks in rain, and because its full-strength zone is a share of its range, its damage rate at a given distance falls too: at 1 km in rain the medium laser burns at half the clear-day rate as well as reaching half as far.

## 10. Flight and kinematics

Drones are point masses moving at constant speed along straight lines, recomputed every 0.05 s step ([`drones.js:242`](../frontend/src/sim/drones.js#L242)). There is no acceleration, no turn radius and no wind: a drone can reverse direction in one step.

| Drone | Speed (m/s) | Height band (m) | Minimum height (m) | hp | evade | jamResist | RCS (m²) | Size (m) | rfPower | sound | Lost link |
|---|---|---|---|---|---|---|---|---|---|---|---|
| First-person-view strike drone (`fpv`) | 30 | 30 to 90 | 15 | 20 | 0.6 | 0 | 0.01 | 0.35 | 1 | 1 | crash |
| Fibre-optic strike drone (`fo`) | 18 | 10 to 25 | 8 | 20 | 0.8 | 1 | 0.01 | 0.35 | 1 | 1 | crash |
| Fixed-wing strike drone (`fw`) | 45 | 150 to 300 | 30 | 60 | 0.8 | 0.5 | 0.2 | 2.5 | 1 | 5 | crash |
| Fixed-wing spotter drone (`spotter`) | 30 | 400 to 500 | none | 50 | 0.9 | 0.75 | 0.15 | 3 | 2.5 | 3 | home |

These are the four generic types ([`drones.js:20`](../frontend/src/sim/config/drones.js#L20)). The 31 real drones inherit from them and override what is published ([DRONES.md](DRONES.md)); across all 35, speed runs from 10 to 90 m/s and RCS from 0.01 to 2 m².

**Strike drones** ([`drones.js:164`](../frontend/src/sim/drones.js#L164)):

- Each step they move `speed x slow x dt` horizontally straight at the target (or rotated by any GNSS heading error).
- Height target: a fixed-wing drone holds its launch height until it can reach the target diving at 45° (`SITE.diveAngle`, an assumption), then follows the line 20 m + distance x tan 45°. A multirotor descends linearly from its launch height to 20 m over its whole run ([`drones.js:179`](../frontend/src/sim/drones.js#L179), [`world.js:34`](../frontend/src/sim/config/world.js#L34)).
- It stays above its minimum height until 400 m out, then that floor shrinks linearly to nothing ([`drones.js:181`](../frontend/src/sim/drones.js#L181)).
- It follows the ground, using the higher of the ground below and 150 m ahead, with vertical movement limited to 0.8 x speed climbing and 1.2 x speed descending, and never closer than 3 m to the ground ([`drones.js:182`](../frontend/src/sim/drones.js#L182) to [`drones.js:184`](../frontend/src/sim/drones.js#L184)). Climbing is added to the horizontal speed, not taken from it.
- It hits the site when within 150 m of its centre, or within 30 m of a system or aim point ([`drones.js:172`](../frontend/src/sim/drones.js#L172)).

**Spotters** fly to their standoff radius (2.5 km), orbit at angular speed v / r for their loiter time (60 s), then leave. They hold at least 30 m above the ground ([`drones.js:131`](../frontend/src/sim/drones.js#L131)).

**Evasion is not a manoeuvre.** `evade` (1 = none, lower = harder to hit) never changes a drone's path. It is a statistical factor in hit chance and laser burn time ([section 11](#11-weapons-hit-chance-time-of-flight-and-beam-dwell)). Later waves have lower `evade`: it falls by 7% per wave per unit of `adapt`, to a floor of 0.25 ([`drones.js:28`](../frontend/src/sim/drones.js#L28)). An FPV goes from 0.60 at wave 1 to 0.43 at wave 5 and 0.25 at wave 10.

**Real physics.** Real drones have limited acceleration, turn rate and climb rate, lose speed when climbing, and drift with wind. FPV pilots jink to spoil a shot. None of that is modelled; the statistical `evade` stands in for it. Times to target are right for the stated speeds, which is what matters most for engagement timing.

## 11. Weapons: hit chance, time of flight and beam dwell

### Hit chance per round

One function decides every roll and every odds figure shown in the panel ([`hit-chance.js:34`](../frontend/src/sim/hit-chance.js#L34)):

$$P_{hit} = \min\!\Big(1,\ p_k \cdot D \cdot S \cdot \big(1 - \ell\,(r/R)^2\big) \cdot C\Big)$$

| Term | Formula | Meaning | Source |
|---|---|---|---|
| p_k | catalogue `pk` | Chance against an easy, slow target close in on a good track | each weapon's `ref` (mostly assumptions) |
| D, dodge | 1 - (1 - (0.5 + 0.5 evade)) x min(1, 3 v_t / v_m) | Evasion matters fully to a round up to 3 times the target's speed, less to a faster one | [`hit-chance.js:31`](../frontend/src/sim/hit-chance.js#L31), DODGE_SPEED 3 an assumption |
| S, lead | max(0.1, 1 - 0.5 (v_t / v_m)²) | A faster target needs a sharper lead | [`hit-chance.js:11`](../frontend/src/sim/hit-chance.js#L11) |
| range loss | ℓ = 0.25, or the weapon's `rangeLoss` | Longer flight, less energy; guns without airburst lose 0.75 at their limit | [`hit-chance.js:8`](../frontend/src/sim/hit-chance.js#L8) |
| C, cue | 1 / (1 + (e / 300 m)²) | The seeker must find the drone from where the track says it is | [`hit-chance.js:38`](../frontend/src/sim/hit-chance.js#L38), `acquireRadius` [`world.js:101`](../frontend/src/sim/config/world.js#L101) |

`v_t` is the drone type's catalogue speed (not its current, possibly jammed, speed), `v_m` the round's speed, `r` the range when fired and `e` the track's position error when fired. The table, computed with `hitChance` and a perfect cue unless stated, shows how speed and range change it:

| Weapon | Range (m) | Round speed (m/s) | pk | FPV at 25% range | FPV at limit | Shahed class at 25% | Shahed class at limit | FPV at 25%, 150 m cue error |
|---|---|---|---|---|---|---|---|---|
| Small interceptor (`interceptor_s`) | 3000 | 25 | 0.85 | 0.19 | 0.14 | 0.08 | 0.06 | 0.15 |
| Interceptor drones (`interceptor`) | 25000 | 80 | 0.9 | 0.66 | 0.50 | 0.67 | 0.51 | 0.53 |
| P1-SUN interceptor (`interceptor_p1`) | 30000 | 80 | 0.5 | 0.37 | 0.28 | 0.37 | 0.28 | 0.29 |
| Large interceptor (`interceptor_l`) | 15000 | 78 | 0.88 | 0.64 | 0.49 | 0.65 | 0.50 | 0.51 |
| Small missile (`missile_s`) | 2000 | 200 | 0.98 | 0.87 | 0.66 | 0.88 | 0.67 | 0.69 |
| Missile (`missile`) | 10000 | 150 | 0.98 | 0.83 | 0.63 | 0.84 | 0.64 | 0.67 |
| Large missile (`missile_l`) | 25000 | 400 | 1 | 0.94 | 0.71 | 0.95 | 0.72 | 0.75 |
| Rapid Ranger (`missile_rr`) | 7000 | 400 | 0.98 | 0.92 | 0.70 | 0.93 | 0.71 | 0.73 |
| Stormer HVM (`missile_hvm`) | 7000 | 400 | 0.98 | 0.92 | 0.70 | 0.93 | 0.71 | 0.73 |
| Sky Sabre (`missile_skysabre`) | 25000 | 400 | 0.98 | 0.92 | 0.70 | 0.93 | 0.71 | 0.73 |
| Terrahawk Paladin (`missile_paladin`) | 2000 | 300 | 1 | 0.92 | 0.70 | 0.93 | 0.71 | 0.74 |
| Small gun (`gun_s`) | 600 | 840 | 0.08 | 0.07 | 0.02 | 0.07 | 0.02 | 0.06 |
| Crewed .50 cal (`gun_50`) | 1000 | 890 | 0.12 | 0.11 | 0.03 | 0.11 | 0.03 | 0.09 |
| Heavy machine gun (`gun_hmg`) | 1200 | 850 | 0.2 | 0.19 | 0.05 | 0.19 | 0.05 | 0.15 |
| Gepard (`gun_gepard`) | 3500 | 1175 | 0.73 | 0.68 | 0.18 | 0.69 | 0.18 | 0.55 |
| Skyranger 30 (`gun_skyranger`) | 3000 | 1100 | 0.85 | 0.82 | 0.63 | 0.83 | 0.63 | 0.66 |
| Skynex (`gun_l`) | 4000 | 1050 | 0.9 | 0.87 | 0.66 | 0.87 | 0.67 | 0.70 |

The Shahed-class drone is faster than the FPV but less evasive (0.8 against 0.6), so for most weapons the two come out close. The slow small interceptor (25 m/s) is poor against both. For the heavy machine gun, one shot is a 20-round burst ([EFFECTORS.md](EFFECTORS.md)).

### Time of flight and how a round flies

A round leaves its launcher at a constant `missileSpeed` ([`effectors.js:34`](../frontend/src/sim/effectors.js#L34)). A gun round starts straight at the target; a missile or interceptor starts climbing at 0.6 of its speed. Each step its velocity is blended towards the direction of its target with factor 1 - e^(-4 dt), a first-order steering lag with a 0.25 s time constant ([`effectors.js:126`](../frontend/src/sim/effectors.js#L126)). It fuzes when within `fuze` metres of the target, checked along the whole path flown in the step so a fast round cannot pass through ([`effectors.js:134`](../frontend/src/sim/effectors.js#L134)). Only then is the hit rolled, with the range and cue error from launch ([`effectors.js:137`](../frontend/src/sim/effectors.js#L137)). A round's life is 1.5 x range / speed; it dies on the ground; if its target dies, it turns to the nearest tracked drone within 1.5 km ([`effectors.js:121`](../frontend/src/sim/effectors.js#L121)).

Before firing, the fusion node checks that a round can meet the track within its range, using `meetTime`, which solves |p + vt| = v_m t ([`hit-chance.js:18`](../frontend/src/sim/hit-chance.js#L18), [`network/tasking.js:175`](../frontend/src/sim/network/tasking.js#L175)). Examples from the function:

| Engagement | Time to meet |
|---|---|
| Interceptor (80 m/s) against a Shahed-class drone (45 m/s) head on at 5 km | 40.0 s |
| Same, chasing it from behind at 2 km | 57.1 s |
| Small interceptor (25 m/s) against an FPV (30 m/s) flying away at 500 m | never |
| Heavy machine gun (850 m/s) against an FPV coming in at 1 km | 1.14 s |

A launcher keeps firing until the rounds in the air have at least an 80% combined chance (`SALVO_ASSURANCE`, an assumption), unless the target is far enough off to shoot, look and shoot again ([`effectors.js:48`](../frontend/src/sim/effectors.js#L48)).

### Lasers and the RF directed-energy weapon

A beam needs a clear optical line ([`effectors.js:25`](../frontend/src/sim/effectors.js#L25)). It takes 4 s to lay on a new target (0 for the RF weapon, which steers electronically; [`hit-chance.js:49`](../frontend/src/sim/hit-chance.js#L49)), then does damage continuously at ([`hit-chance.js:44`](../frontend/src/sim/hit-chance.js#L44), [`effectors.js:71`](../frontend/src/sim/effectors.js#L71)):

$$\text{rate} = \text{dps}\cdot(0.5 + 0.5\,\text{evade})\cdot\min\!\left(1,\ \frac{0.25\,R}{r}\right)$$

So dwell doubles when range doubles beyond a quarter of the weapon's range, as ST Engineering publishes for its CDLE laser (5 s at 0.5 km, 10 s at 1 km). Computed with `burnTime`:

| Weapon | Beam damage (hp/s) | Range (m) | Full strength to | FPV at 500 m | FPV at its limit | Shahed class at 1 km |
|---|---|---|---|---|---|---|
| RapidDestroyer (`laser_rfdew`) | 56 | 1000 | 250 m | 0.9 s | 1.8 s | 4.8 s |
| Small laser (`laser_s`) | 14 | 2000 | 500 m | 1.8 s | 7.1 s | 9.5 s |
| Laser (`laser`) | 28 | 3000 | 750 m | 0.9 s | 3.6 s | 3.2 s |
| Large laser (`laser_l`) | 56 | 10000 | 2500 m | 0.4 s | 1.8 s | 1.2 s |

Add the lay time for each new target: 4 s, or none for the RF weapon.

**Real physics.** Real kill probability comes from the miss distance distribution against the warhead's lethal radius (for a Gaussian miss with σ per axis and lethal radius R_l, P_k = 1 - e^(-R_l²/2σ²)), which depends on guidance, target manoeuvre and fuzing. The game's product of factors has the right trends (faster targets, longer ranges and poor cues all lower it), but every factor's size is an assumption except where `pk` is anchored on a reported figure. Guns are modelled as steered rounds: a real burst is unguided, and its chance comes from dispersion at range, which the gun `rangeLoss` approximates. A laser's real dwell depends on atmospheric transmission, turbulence, jitter and the target's material; the 1/r rule beyond a quarter of range is a fit to one published pair of figures.

## 12. Blast and damage

### Damage to drones

A round that hits does its `damage` to the target and to every other drone within `splash` metres ([`effectors.js:141`](../frontend/src/sim/effectors.js#L141)). A drone is destroyed when its hp reaches 0.

### Damage to the site and to systems

A drone's damage to the site follows its warhead mass by cube-root scaling ([`real-drones.js:9`](../frontend/src/sim/config/real-drones.js#L9)):

$$\text{damage} = \operatorname{round}\!\left(9.5\,\sqrt[3]{W_{kg}}\right)$$

chosen so a 2 kg FPV does 12 and a 30 kg Shahed-class drone 30. A strike's damage is multiplied by 1 plus 0.5 for each spotter orbiting on station with working video ([`drones.js:86`](../frontend/src/sim/drones.js#L86), [`drones.js:103`](../frontend/src/sim/drones.js#L103)). A strike on a system does the same damage divided by its armour, the greater of its own and its vehicle's ([`targeting.js:95`](../frontend/src/sim/targeting.js#L95)).

### Casualties

The lethal and injury radii for an unprotected person are ([`people.js:17`](../frontend/src/sim/config/people.js#L17)):

$$r_{lethal} = 9\sqrt[3]{W_{kg}},\qquad r_{injury} = 25\sqrt[3]{W_{kg}}$$

anchored on the M67 grenade (0.18 kg of explosive, US Army figures of 5 m lethal and 15 m casualty radius; the formula gives 5.1 m and 14.1 m). Each protection level scales the radii and sets the chance at the point of the blast ([`people.js:6`](../frontend/src/sim/config/people.js#L6)):

| Protection | Chance at the blast (pCasualty) | Radius scale |
|---|---|---|
| Unarmoured, in the open | 0.9 | 1 |
| In a building | 0.35 | 0.6 |
| In a bunker | 0.03 | 0.2 |

For each person, with d the 3D distance from the burst, one roll decides ([`people.js:120`](../frontend/src/sim/people.js#L120)): killed if below pCasualty x (1 - d / r_lethal), otherwise injured if below pCasualty x (1 - d / r_injury). A drone shot down bursts where it is, so its height above a group protects them; a drone that reaches the site lands at a random point inside the 150 m site radius ([`people.js:138`](../frontend/src/sim/people.js#L138), [`people.js:148`](../frontend/src/sim/people.js#L148)). A drone landed by take-over does not go off.

| Drone | Warhead | Site damage | Lethal radius | Injury radius |
|---|---|---|---|---|
| FPV and fibre-optic | 2 kg | 12 | 11.3 m | 31.5 m |
| Shahed class (`fw`) | 30 kg | 30 | 28.0 m | 77.7 m |
| Geran-2 (`geran2`) | 50 kg | 35 | 33.2 m | 92.1 m |
| Spotter | none | 0 | 0 | 0 |

Shahed-class burst at ground level, computed from these formulas:

| Protection | Killed at 10 m | Hurt at all at 10 m | Killed at 30 m | Hurt at all at 30 m |
|---|---|---|---|---|
| Open | 0.58 | 0.78 | 0 | 0.55 |
| Building | 0.14 | 0.27 | 0 | 0.12 |
| Bunker | 0 | 0.01 | 0 | 0 |

The casualty side and how people are placed are in [PEOPLE.md](PEOPLE.md).

**Real physics.** Blast overpressure does scale with the cube root of charge mass (Hopkinson-Cranz scaled distance Z = R / W^(1/3)), so the form is right for blast. Casualties from drone warheads are mostly from fragments, whose range depends on casing and fragment mass and does not scale as a cube root; the config says the radii are probably low for big warheads. Warhead mass is used as given, without TNT equivalence. Protection is three fixed levels, with no line of sight to the burst, no building damage and no secondary effects. These numbers teach the idea; they are not casualty estimates.

## 13. Worked examples

All figures here were produced by running the game's own functions in a Node script outside the repo, from `frontend/`. The script imports the config and sim modules, builds a 16 km square flat world with `makeWorld` (the same way [`propagation.test.js`](../frontend/tests/propagation.test.js) does), adds a ridge or a block of trees where stated, and calls `reachFor`, `reachOnPath`, `pathLoss`, `jamming`, `hitChance` and `burnTime`. Detection chances come from the real `pd()` in `network/sensors.js`, created with `createSensors` over a minimal network core, with `pointing: false`. Clear day throughout.

### Example 1: Medium radar against an FPV

The Medium radar (Robin Radar IRIS class) is on its 25 m mast, at 9.35 GHz, with a 3,100 m range against 0.01 m². An FPV (0.01 m²) has an open-field reach of 3,100 m. A Shahed-class drone (0.2 m²) has 3,100 x 20^(1/4) = 6,556 m.

Detection chance per scan on flat open ground, drone flying straight in:

| Range (m) | FPV 60 m up at 30 m/s | FPV 30 m up, hovering | Shahed class 200 m up at 45 m/s |
|---|---|---|---|
| 1,000 | 1.000 | 0.300 | 1.000 |
| 2,000 | 0.988 | 0.296 | 1.000 |
| 2,500 | 0.957 | 0.287 | 0.999 |
| 3,100 | 0.858 | 0.257 | 0.998 |
| 3,500 | 0.745 | 0.224 | 0.996 |
| 4,000 | 0.567 | 0.170 | 0.991 |
| 5,000 | 0.256 | 0.077 | 0.968 |
| 6,000 | 0.103 | 0.031 | 0.911 |

The hovering FPV is below the 40 m clutter height and beyond 500 m x 1.5 (open ground) = 750 m, so it takes the 0.3 clutter penalty; at 500 m it is back to 1.000. An FPV at the same 30 m height flying at 30 m/s gets exactly the 60 m column, because the Doppler rule lets anything faster than 5 m/s through. With the High clutter filter, an FPV at 2 km flying straight in is seen at 0.988, but one crossing at right angles is not seen at all (radial speed below 4 m/s).

Terrain, on a 3 km path:

| Ground between | FPV height | Loss | Reach | Pd at 3 km |
|---|---|---|---|---|
| Flat, open | 30 m | 0 dB | 3,100 m | 0.881 |
| Ridge 30 m high, 120 m wide, at 1.5 km | 60 m | 0 dB | 3,100 m | 0.880 |
| Same ridge | 30 m | 21.2 dB | 269 m | 0 |
| Ridge 60 m high at 1.5 km | 60 m | 37.2 dB | 43 m | 0 |
| 18 m trees from 1.4 to 1.8 km | 15 m | 0 dB | 3,100 m | 0.881 |

With the drone at 60 m the ray passes 12.5 m over the 30 m ridge, more than the 4.9 m Fresnel radius, so there is no loss. At 30 m the ridge cuts 2.5 m into the ray, and the loss of 21.2 dB leaves under a tenth of the reach. From a 25 m mast the ray to a drone 15 m up still passes over 18 m trees, so the radar loses nothing; the RF detector in example 2, on a 9 m mast, does not.

### Example 2: Medium RF detector against an FPV and a spotter

The Medium RF detector (Dedrone class) is on its 9 m mast, with 3,500 m range and -90 dBm sensitivity.

| Drone | Radiates on | Heard on | Open-field reach |
|---|---|---|---|
| FPV | control24, video58 | control24 (2.442 GHz), which carries furthest | 3,500 m |
| Spotter (rfPower 2.5) | control900, video58 | control900 (0.895 GHz) | 3,500 x √2.5 x 2.73 = 15,098 m |
| Fibre-optic | nothing | none | 0 |
| Shahed class | nothing (GNSS is receive only) | none | 0 |

Set to -96 dBm sensitivity, its reach against the FPV doubles to 7,000 m.

On a 3 km path to the FPV:

| Ground between | FPV height | Loss at 2.44 GHz | Reach | Pd at 3 km |
|---|---|---|---|---|
| Flat, open | 60 m | 0 dB | 3,500 m | 0.938 |
| Ridge 30 m high at 1.5 km | 60 m | 4.3 dB | 2,127 m | 0.435 |
| 18 m trees, 100 m deep, from 1.4 km | 15 m | 22.5 dB | 261 m | 0 |
| 18 m trees, 400 m deep, from 1.4 km | 15 m | 23.0 dB | 248 m | 0 |

The ridge is the same one the radar cleared from 25 m: from 9 m the clearance is smaller than the Fresnel radius at 2.44 GHz, so the detector loses 4.3 dB. Through trees, 100 m of canopy at 2.44 GHz costs 25.7 dB by Weissberger, but diffraction over the treetops costs less, and the model takes the lesser; that is why 400 m of forest costs barely more than 100 m. On flat ground the detection chance is 1.000 at 1 km, 0.994 at 2 km, 0.858 at 3.5 km, 0.573 at 4.5 km and 0.193 at 6 km.

### Example 3: Medium jammer against an FPV

The Medium RF jammer has 1,000 m range on control24 and video58, on a 1.5 m mast. The FPV is 60 m up over flat ground; its operator is at its launch point.

| Jammer to drone | Drone to operator | k | Control jammed | Video jammed |
|---|---|---|---|---|
| 800 m | 4.5 km | 1.00 | yes | no |
| 1,500 m | 4.5 km | 1.00 | no | no |
| 1,500 m | 13 km | 2.89 | yes | no |
| 3,000 m | 13 km | 2.89 | no | no |
| 1,000 m | 1 km | 0.22 | no | no |

The video link is never jammed here, because it is received at the operator, several kilometres from the jammer. Once the control link is jammed, the FPV (jamResist 0 at wave 1) slows to half speed and crashes after 5 s.

## 14. How far to trust the numbers

| Model | Physics form | Numbers | Trust |
|---|---|---|---|
| Radar range against RCS, power, scan time, sector | Right (radar and search radar equations) | Anchored on vendor figures; RCS values assumed | Relative comparisons good; absolute ranges as good as the datasheets |
| Pd curve and false alarms | Shape plausible, not derived from SNR and threshold | Game constants | Good for "about where"; not for Pd at a given range |
| Ground clutter | Rule of thumb | Assumed; dormant for drones in flight | Weak |
| Terrain and building diffraction | Standard (ITU-R P.526 Bullington) | Computed | Good for single ridges; optimistic on multi-obstacle paths and low antennas |
| Foliage | Standard (Weissberger) | Computed | Reasonable through trees; season, wetness and treetops in the Fresnel zone ignored |
| RF detection range | Friis scaling | Assessed from datasheets | Moderate |
| Optical detection | Pixel geometry, Johnson-style thresholds | Optics from vendors; thresholds standard | Geometry good; weather and night factors weak |
| Acoustic | Spreading-law consistent | Ranges from vendor or procurement figures; loudness assumed | Weak to moderate |
| Jamming reach | Right J/S scaling with operator distance | Quoted ranges, 4.5 km reference assumed | Moderate for control links; GNSS reach probably short |
| Jamming effect | Timer, not a link model | Assumed | Illustrative |
| Flight | Point mass, constant speed | Published speeds | Good for timing; no manoeuvre |
| Hit chance | Trend-correct product of factors | Mostly assumptions | Illustrative; compare weapons, not absolute Pk |
| Blast | Cube-root scaling is right for blast | Anchored on one grenade | Teaching only |

The models are good for comparing laydowns, seeing why a mast or a ridge matters, and understanding which sensor sees which drone. They are not a substitute for a site survey, a propagation tool such as ITM checked against measurements, or a weapons effects model.

## Limits and simplifications

- **Radio:** no ground reflection (plane-earth loss), multipath, ducting, gas absorption, rain on radio paths, or statistical variability. One Bullington edge per path, at most 256 samples per path, so beyond 5.1 km not every 20 m cell is looked at. An RF detector's reach by band assumes the same antenna gain on every band and ignores a link's duty cycle. Trees count only where the ray passes through them, not where they enter the Fresnel zone. Not checked against ITM or measurements. Rain changes radar range by one factor per band.
- **Radar:** no Swerling fluctuation, aspect-dependent RCS, or multipath lobes. The clutter rule uses total speed rather than radial speed, and no current drone flies slowly enough to trigger it. Pd is a function of range ratio, not of SNR and threshold. False alarms are one roll per scan, at most one per scan.
- **RF detection:** the lowest covered band is used, not the strongest. No duty cycle, antenna pattern, noise floor or interference beyond your own jammers. RF detectors give bearing only.
- **Optical:** no contrast, background, atmospheric transmission or turbulence; a clear line is all or nothing; no earth curvature on optical lines. Weather factors are fixed shares.
- **Acoustic:** no wind, temperature gradients or frequency content; three fixed halving factors.
- **Jamming:** quoted ranges, not link budgets. GNSS jamming reach equals link jamming reach. Link loss is a timer; anti-jam is a rate. The operator is always at the launch point.
- **Flight:** point masses at constant speed with instant turns; no wind; evasion is statistical only.
- **Weapons:** guns are modelled as steered rounds, and a beam-riding missile's line of sight is checked when it fires and when it arrives, not along its flight; the hit roll uses the type's catalogue speed, not its current speed. Most `pk` values are assumptions.
- **Blast:** cube-root radii anchored on one grenade; fragments, TNT equivalence and building damage are not modelled.

## Where this lives in the code

- [`frontend/src/sim/propagation.js`](../frontend/src/sim/propagation.js): free-space loss, earth bulge, Fresnel radius, knife edge, Bullington, Weissberger, loss to reach.
- [`frontend/src/sim/site-range.js`](../frontend/src/sim/site-range.js): open-field reach per drone type, reach on a path, measurement error, the clutter rule, range prediction.
- [`frontend/src/sim/network/sensors.js`](../frontend/src/sim/network/sensors.js): the per-scan detection chance, measurements, false alarms, camera aiming, sound delay.
- [`frontend/src/sim/sensor-model.js`](../frontend/src/sim/sensor-model.js): radar arcs, elevation bands, bands, clutter filter settings, micro-Doppler.
- [`frontend/src/sim/rf-model.js`](../frontend/src/sim/rf-model.js): what a drone radiates, which band a detector hears, classifier libraries.
- [`frontend/src/sim/camera-model.js`](../frontend/src/sim/camera-model.js): pixels on target, detect, recognise and identify thresholds, thermal sharpness, zoom.
- [`frontend/src/sim/conditions.js`](../frontend/src/sim/conditions.js): light and weather factors.
- [`frontend/src/sim/world.js`](../frontend/src/sim/world.js): the height grids, optical line of sight, canopy tolerance.
- [`frontend/src/sim/terrain.js`](../frontend/src/sim/terrain.js): generated ground, forest and buildings.
- [`frontend/src/sim/jamming.js`](../frontend/src/sim/jamming.js): jammer reach, operator distance, deafness, reactive, spoofing and take-over rules.
- [`frontend/src/sim/drones.js`](../frontend/src/sim/drones.js): flight, wave adaptation, effects of jamming, impacts.
- [`frontend/src/sim/hit-chance.js`](../frontend/src/sim/hit-chance.js): hit chance, time to meet, beam dwell.
- [`frontend/src/sim/effectors.js`](../frontend/src/sim/effectors.js): round flight, fuzing, splash, beams, salvo rule.
- [`frontend/src/sim/people.js`](../frontend/src/sim/people.js): casualty rolls from a blast.
- [`frontend/src/sim/comms.js`](../frontend/src/sim/comms.js): network link quality from sky view, towers and jamming.
- [`frontend/src/sim/unit-config.js`](../frontend/src/sim/unit-config.js): every per-unit setting and the range factor it applies.
- [`frontend/src/sim/config/world.js`](../frontend/src/sim/config/world.js): `SENSING`, `TERRAIN`, `SITE`, `ADAPT`, `FUSION` constants.
- [`frontend/src/sim/config/tx-power.js`](../frontend/src/sim/config/tx-power.js), [`config/comms.js`](../frontend/src/sim/config/comms.js), [`config/drones.js`](../frontend/src/sim/config/drones.js), [`config/people.js`](../frontend/src/sim/config/people.js), [`config/crew.js`](../frontend/src/sim/config/crew.js): rated powers, spectrum and links, drone physical figures, casualty radii, crew eyesight and hearing.
