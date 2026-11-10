# Vehicles, mounts and crews

This document covers what the defender's systems stand on and who works them: masts, the vehicles that carry systems, patrols and their escorts, the crews of the hand-worked systems, the rules for where a system may be placed, and every setting a player can change on a placed unit. It is written for a reader planning a laydown who wants to know what the numbers mean, and for a developer who wants to change them. The systems themselves are in [SENSORS.md](SENSORS.md) and [EFFECTORS.md](EFFECTORS.md), the drones they face in [DRONES.md](DRONES.md), and simulated people, including soldiers on patrol, in [PEOPLE.md](PEOPLE.md).

## Contents

- [How a system stands](#how-a-system-stands)
- [Masts](#masts)
- [Vehicles](#vehicles)
- [Patrols and escorts](#patrols-and-escorts)
- [Crews](#crews)
- [Placement rules](#placement-rules)
- [Unit settings](#unit-settings)
- [Limits and simplifications](#limits-and-simplifications)
- [Where this lives in the code](#where-this-lives-in-the-code)

The tables below were generated from the config modules, and the vehicle and crew figures by running the game's own functions, so the numbers are copied exactly. If you change a figure in config, these tables go out of date. Money is shown in pounds, as the game shows it; config holds US dollars, converted at 0.75 ([`economy.js:26`](../frontend/src/sim/economy.js#L26)).

## How a system stands

Each system has a `mobile` field: `'manpack'` is drawn on a tripod, `'vehicle'` on a truck or its own vehicle, and none on a fixed mast or its own mount. That field only changes the drawing ([`system-parts.js:84`](../frontend/src/render/system-parts.js#L84)). The simulation reads heights:

- a sensor's or jammer's antenna stands at its mast height, `mount`, which sets its line of sight ([`site-range.js:32`](../frontend/src/sim/site-range.js#L32));
- a laser's emitter stands at `mount`, or 4 m without one;
- a launcher's rounds leave from its muzzle, `muzzleY` model units of 2.2 m, scaled with the model ([`effectors.js:22`](../frontend/src/sim/effectors.js#L22)). An interceptor drone or a missile with its own seeker is cued over the terrain, so its launcher needs no line of sight; a gun or a beam-riding missile sights from its muzzle ([`site-range.js:32`](../frontend/src/sim/site-range.js#L32));
- a crewed gun's gunner looks from 2.5 m, standing in the vehicle ([`crew.js:14`](../frontend/src/sim/crew.js#L14)).

Once placed, a system stays where it is for the whole run. The only systems that move are a patrol's escort.

The generated world's trees are 12 to 20 m tall ([`world.js:55`](../frontend/src/sim/config/world.js#L55)), and trees within 50 m of a sensor or weapon are taken as cleared ([`world.js:61`](../frontend/src/sim/config/world.js#L61)). How trees and terrain block each kind of system is in [PHYSICS_AND_PROPAGATION.md](PHYSICS_AND_PROPAGATION.md).

| System | Kind | Stands on | Works from | Mast limits (m) | Rides in a patrol | Armour | Health |
|---|---|---|---|---|---|---|---|
| [`radar_s`](../frontend/src/sim/config/sensors.js#L38) | radar | fixed | 15 m | 5 to 25 | medium | 1 | 30 |
| [`radar_a400`](../frontend/src/sim/config/uk-systems.js#L5) | radar | fixed | 25 m | 5 to 35 | medium | 1 | 30 |
| [`radar_a800`](../frontend/src/sim/config/sensors.js#L62) | radar | fixed | 25 m | 5 to 35 | medium | 1 | 30 |
| [`radar`](../frontend/src/sim/config/sensors.js#L8) | radar | fixed | 25 m | 5 to 35 | no | 1 | 30 |
| [`radar_giraffe`](../frontend/src/sim/config/uk-systems.js#L29) | radar | vehicle | 3 m | 2 to 20 | heavy | 1 | 30 |
| [`radar_l`](../frontend/src/sim/config/sensors.js#L85) | radar | fixed | 30 m | 10 to 40 | no | 1 | 30 |
| [`rf_s`](../frontend/src/sim/config/sensors.js#L137) | rf | manpack | 1.5 m | 1 to 10 | light | 1 | 30 |
| [`rf`](../frontend/src/sim/config/sensors.js#L110) | rf | fixed | 9 m | 2 to 15 | light | 1 | 30 |
| [`rf_elysion`](../frontend/src/sim/config/sensors.js#L161) | rf | fixed | 9 m | 2 to 15 | no | 1 | 30 |
| [`rf_airfence`](../frontend/src/sim/config/eu-systems.js#L5) | rf | fixed | 9 m | fixed | no | 1 | 30 |
| [`rf_l`](../frontend/src/sim/config/sensors.js#L180) | rf | fixed | 9 m | 2 to 20 | no | 1 | 30 |
| [`camera_s`](../frontend/src/sim/config/sensors.js#L230) | camera | fixed | 15 m | 5 to 20 | light | 1 | 30 |
| [`camera`](../frontend/src/sim/config/sensors.js#L203) | camera | fixed | 15 m | 5 to 25 | medium | 1 | 30 |
| [`camera_l`](../frontend/src/sim/config/sensors.js#L250) | camera | fixed | 25 m | 5 to 30 | no | 1 | 30 |
| [`acoustic_s`](../frontend/src/sim/config/sensors.js#L270) | acoustic | fixed | 3 m | 2 to 6 | no | 1 | 30 |
| [`acoustic`](../frontend/src/sim/config/sensors.js#L289) | acoustic | fixed | 3 m | 2 to 6 | no | 1 | 30 |
| [`acoustic_l`](../frontend/src/sim/config/sensors.js#L307) | acoustic | fixed | 6 m | 2 to 10 | no | 1 | 30 |
| [`jammer_mk4`](../frontend/src/sim/config/crew.js#L52) | jammer | manpack, crewed, off the network, handheld | 1.5 m | 1 to 20 | no | 1 | 15 |
| [`jammer_dgmk3`](../frontend/src/sim/config/crew.js#L88) | jammer | manpack, crewed, off the network, handheld | 1.5 m | 1 to 20 | no | 1 | 15 |
| [`jammer_s`](../frontend/src/sim/config/effectors.js#L32) | jammer | manpack | 1.5 m | 1 to 20 | light | 1 | 30 |
| [`jammer_dgtac`](../frontend/src/sim/config/crew.js#L104) | jammer | manpack, crewed, off the network, handheld | 1.5 m | 1 to 20 | no | 1 | 15 |
| [`jammer_kvertus`](../frontend/src/sim/config/crew.js#L76) | jammer | manpack, crewed, off the network, handheld | 1.5 m | 1 to 20 | no | 1 | 15 |
| [`jammer_skywiper`](../frontend/src/sim/config/crew.js#L64) | jammer | manpack, crewed, off the network, handheld | 1.5 m | 1 to 20 | no | 1 | 15 |
| [`jammer`](../frontend/src/sim/config/effectors.js#L6) | jammer | manpack | 1.5 m | 1 to 20 | light | 1 | 30 |
| [`jammer_neo`](../frontend/src/sim/config/uk-systems.js#L71) | jammer | manpack | 1.5 m | 1 to 20 | no | 1 | 30 |
| [`jammer_jupiter`](../frontend/src/sim/config/uk-systems.js#L89) | jammer | vehicle | 3 m | 1 to 20 | medium | 1 | 30 |
| [`jammer_auds`](../frontend/src/sim/config/uk-systems.js#L53) | jammer | fixed | 9 m | 1 to 20 | no | 1 | 30 |
| [`jammer_l`](../frontend/src/sim/config/effectors.js#L54) | jammer | fixed | 9 m | 1 to 20 | no | 1 | 30 |
| [`jammer_sf`](../frontend/src/sim/config/eu-systems.js#L28) | jammer | vehicle | 3 m | 1 to 20 | medium | 1 | 30 |
| [`interceptor_s`](../frontend/src/sim/config/effectors.js#L172) | interceptor | fixed | rounds leave 2.5 m up; no sight line needed | fixed | no | 1 | 30 |
| [`interceptor`](../frontend/src/sim/config/effectors.js#L69) | interceptor | fixed | rounds leave 3.5 m up; no sight line needed | fixed | light | 1 | 30 |
| [`interceptor_p1`](../frontend/src/sim/config/effectors.js#L95) | interceptor | fixed | rounds leave 3.5 m up; no sight line needed | fixed | light | 1 | 30 |
| [`interceptor_l`](../frontend/src/sim/config/effectors.js#L197) | interceptor | fixed | rounds leave 4.9 m up; no sight line needed | fixed | no | 1 | 30 |
| [`missile_s`](../frontend/src/sim/config/effectors.js#L217) | missile | fixed | rounds leave 3.4 m up; no sight line needed | fixed | light | 1 | 30 |
| [`missile_rr`](../frontend/src/sim/config/uk-systems.js#L107) | missile | fixed | rounds leave 4.8 m up, and it sights from there | fixed | medium | 1 | 30 |
| [`missile_hvm`](../frontend/src/sim/config/uk-systems.js#L134) | missile | fixed | rounds leave 4.8 m up, and it sights from there | fixed | no | 2 | 30 |
| [`missile`](../frontend/src/sim/config/effectors.js#L114) | missile | fixed | rounds leave 4.8 m up; no sight line needed | fixed | no | 1 | 30 |
| [`missile_l`](../frontend/src/sim/config/effectors.js#L237) | missile | fixed | rounds leave 6.8 m up; no sight line needed | fixed | no | 1 | 30 |
| [`missile_skysabre`](../frontend/src/sim/config/uk-systems.js#L175) | missile | fixed | rounds leave 6.8 m up; no sight line needed | fixed | no | 1 | 30 |
| [`gun_s`](../frontend/src/sim/config/crew.js#L28) | gun | vehicle, crewed, off the network | rounds leave 2.6 m up; the gunner looks from 2.5 m | fixed | medium | 1 | 20 |
| [`gun_50`](../frontend/src/sim/config/crew.js#L40) | gun | vehicle, crewed, off the network | rounds leave 2.6 m up; the gunner looks from 2.5 m | fixed | medium | 1 | 20 |
| [`gun_hmg`](../frontend/src/sim/config/effectors.js#L305) | gun | vehicle | rounds leave 2.6 m up, and it sights from there | fixed | light | 1 | 30 |
| [`missile_paladin`](../frontend/src/sim/config/uk-systems.js#L155) | gun | fixed | rounds leave 3.9 m up, and it sights from there | fixed | heavy | 1 | 30 |
| [`gun_skyranger`](../frontend/src/sim/config/eu-systems.js#L65) | gun | vehicle | rounds leave 5.3 m up, and it sights from there | fixed | heavy | 2 | 40 |
| [`gun_gepard`](../frontend/src/sim/config/eu-systems.js#L83) | gun | vehicle | rounds leave 5.3 m up, and it sights from there | fixed | no | 2 | 40 |
| [`gun_l`](../frontend/src/sim/config/eu-systems.js#L47) | gun | fixed | rounds leave 5.3 m up, and it sights from there | fixed | no | 1 | 40 |
| [`laser_rfdew`](../frontend/src/sim/config/uk-systems.js#L200) | laser | vehicle | 3 m | fixed | no | 1 | 30 |
| [`laser_s`](../frontend/src/sim/config/effectors.js#L258) | laser | vehicle | 3 m | fixed | no | 1 | 30 |
| [`laser`](../frontend/src/sim/config/effectors.js#L143) | laser | fixed | 4 m | fixed | no | 1 | 30 |
| [`laser_l`](../frontend/src/sim/config/effectors.js#L281) | laser | fixed | 4 m | fixed | no | 1 | 30 |

"Rides in a patrol" is the class of vehicle it needs (`MOUNTS`, below). Armour and health are explained in [EFFECTORS.md](EFFECTORS.md#how-to-read-the-tables).

## Masts

A sensor's or jammer's mast height can be changed on each unit, within the limits in the table above, at 1.5% of the system's price per metre above or below standard (`MAST_PRICE`, [`unit-config.js:33`](../frontend/src/sim/unit-config.js#L33)). Higher sees over more trees and terrain. The standard masts are mostly assumptions from photos or mounting guidance, as each entry's `ref` says.

Weapons that fire rounds, lasers and the Sensofusion Airfence have no mast setting. For the Airfence this looks like an omission: every other RF detector has one. The setting is offered on every jammer, the five handheld ones included, so a soldier's handheld jammer can be set to stand, and look, up to 20 m up; a crew's eye is at the system's mast height ([`crew.js:28`](../frontend/src/sim/crew.js#L28)).

## Vehicles

Three vehicles can carry a system, in a patrol's column or parked from a deployment pack (`PATROL_VEHICLES`, [`patrol.js:27`](../frontend/src/sim/config/patrol.js#L27)). Their mast heights and armour are assumptions; their sizes and speeds are the published figures in the description.

| Vehicle | Carries up to | Mast (m) | Armour | Description (config) |
|---|---|---|---|---|
| Patria 6x6 | heavy | 3.5 | 2 | Armoured six-wheeler, 7.5 by 2.9 m, over 100 km/h on roads. Carries anything that rides in a patrol. |
| Toyota Hilux | medium | 3 | 1 | Double-cab pickup, 5.3 by 1.9 m, its system on the load bed. Carries light and medium systems. |
| Milrem THeMIS (`themis`) | light | 2 | 1 | Milrem Robotics' tracked uncrewed ground vehicle: 2.47 by 2.04 m, 1.17 m high, 1,650 kg, 20 km/h, 750 kg rated payload (1,200 kg at most), from [Milrem](https://milremrobotics.com/product/themis-transport). Carries light systems. |

Each system that can ride is given a class by weight and how it is shown mounted, an assumption (`MOUNTS`, [`patrol.js:35`](../frontend/src/sim/config/patrol.js#L35)): light rides on any vehicle, medium on a Hilux or a Patria, heavy only on a Patria. The two crewed machine guns are medium because the gunner stands in the back, so they cannot go on the uncrewed Mule. Systems drawn on their own vehicles but missing from `MOUNTS` (the Gepard, the LOCUST and the RapidDestroyer) cannot join a patrol.

- **Vehicles cost nothing.** The budget is for counter-drone systems, so only the system on a vehicle is charged ([`patrol.js:49`](../frontend/src/sim/patrol.js#L49)).
- **Armour.** A system on a Patria takes half the damage of a strike, the same as a system with armour of its own; the higher of the two counts ([`targeting.js:95`](../frontend/src/sim/targeting.js#L95)).
- **Mast on a vehicle.** A system with a mast is set to the vehicle's mast height ([`laydown.js:76`](../frontend/src/sim/laydown.js#L76)). That value then passes through the unit's mast limits and mast price like any other setting ([`unit-config.js:239`](../frontend/src/sim/unit-config.js#L239)). So a radar or camera whose lowest allowed mast is 5 m stands at 5 m on any vehicle, not at the vehicle's 2 to 3.5 m, and it costs less because its mast is lower than standard. The table shows what each system ends up with on each vehicle, worked out by the game's own functions:

| System | Class | Standard mast and price | Patria 6x6 | Toyota Hilux | Milrem THeMIS |
|---|---|---|---|---|---|
| [`rf_s`](../frontend/src/sim/config/sensors.js#L137) | light | 1.5 m, £7,500 | 3.5 m, £7,725 | 3 m, £7,669 | 2 m, £7,556 |
| [`rf`](../frontend/src/sim/config/sensors.js#L110) | light | 9 m, £30,000 | 3.5 m, £27,525 | 3 m, £27,300 | 2 m, £26,850 |
| [`camera_s`](../frontend/src/sim/config/sensors.js#L230) | light | 15 m, £18,750 | 5 m, £15,938 | 5 m, £15,938 | 5 m, £15,938 |
| [`jammer_s`](../frontend/src/sim/config/effectors.js#L32) | light | 1.5 m, £30,000 | 3.5 m, £30,900 | 3 m, £30,675 | 2 m, £30,225 |
| [`jammer`](../frontend/src/sim/config/effectors.js#L6) | light | 1.5 m, £45,000 | 3.5 m, £46,350 | 3 m, £46,013 | 2 m, £45,338 |
| [`interceptor`](../frontend/src/sim/config/effectors.js#L69) | light | £75,000 | £75,000 | £75,000 | £75,000 |
| [`interceptor_p1`](../frontend/src/sim/config/effectors.js#L95) | light | £75,000 | £75,000 | £75,000 | £75,000 |
| [`missile_s`](../frontend/src/sim/config/effectors.js#L217) | light | £75,000 | £75,000 | £75,000 | £75,000 |
| [`gun_hmg`](../frontend/src/sim/config/effectors.js#L305) | light | £187,500 | £187,500 | £187,500 | £187,500 |
| [`radar_s`](../frontend/src/sim/config/sensors.js#L38) | medium | 15 m, £33,750 | 5 m, £28,688 | 5 m, £28,688 | cannot carry |
| [`radar_a400`](../frontend/src/sim/config/uk-systems.js#L5) | medium | 25 m, £300,000 | 5 m, £210,000 | 5 m, £210,000 | cannot carry |
| [`radar_a800`](../frontend/src/sim/config/sensors.js#L62) | medium | 25 m, £450,000 | 5 m, £315,000 | 5 m, £315,000 | cannot carry |
| [`camera`](../frontend/src/sim/config/sensors.js#L203) | medium | 15 m, £75,000 | 5 m, £63,750 | 5 m, £63,750 | cannot carry |
| [`jammer_jupiter`](../frontend/src/sim/config/uk-systems.js#L89) | medium | 3 m, £225,000 | 3.5 m, £226,688 | 3 m, £225,000 | cannot carry |
| [`jammer_sf`](../frontend/src/sim/config/eu-systems.js#L28) | medium | 3 m, £34,500 | 3.5 m, £34,759 | 3 m, £34,500 | cannot carry |
| [`missile_rr`](../frontend/src/sim/config/uk-systems.js#L107) | medium | £1,125,000 | £1,125,000 | £1,125,000 | cannot carry |
| [`gun_s`](../frontend/src/sim/config/crew.js#L28) | medium | £15,000 | £15,000 | £15,000 | cannot carry |
| [`gun_50`](../frontend/src/sim/config/crew.js#L40) | medium | £30,000 | £30,000 | £30,000 | cannot carry |
| [`radar_giraffe`](../frontend/src/sim/config/uk-systems.js#L29) | heavy | 3 m, £3,750,000 | 3.5 m, £3,778,125 | cannot carry | cannot carry |
| [`missile_paladin`](../frontend/src/sim/config/uk-systems.js#L155) | heavy | £2,250,000 | £2,250,000 | cannot carry | cannot carry |
| [`gun_skyranger`](../frontend/src/sim/config/eu-systems.js#L65) | heavy | £9,000,000 | £9,000,000 | cannot carry | cannot carry |

A deployment pack can hold vehicles. The pack tray offers each one with a system from the pack that it can carry, to drag onto the map ([`UnitTray.jsx:15`](../frontend/src/ui/account/UnitTray.jsx#L15)); placing refuses a system the vehicle cannot carry ([`laydown.js:79`](../frontend/src/sim/laydown.js#L79)). A parked vehicle does not move.

## Patrols and escorts

In patrol mode the player protects soldiers walking a route, escorted by vehicles carrying systems. The design and its reasoning are in [PATROL_MODE.md](PATROL_MODE.md); the figures are here. Every patrol figure is a labelled assumption and can be changed in the Sources tab (`PATROL`, [`patrol.js:9`](../frontend/src/sim/config/patrol.js#L9)).

| Figure | Value | Meaning |
|---|---|---|
| Walking speed | 1.4 m/s | How fast the group walks its route |
| People | 12 | Soldiers in the patrol, a group of unprotected military people ([`patrol.js:64`](../frontend/src/sim/patrol.js#L64)) |
| Spacing | 5 m | Between soldiers in the formation |
| Wait at the end | 60 s | Before it walks back |
| Gap to each escort | 40 m | Where a vehicle added to the column is placed, from the last |
| Formations | single file, staggered column, wedge | [`formation.js:7`](../frontend/src/sim/formation.js#L7) |
| Corridor width | 20 to 1,000 m, 200 m to start | [`route.js:10`](../frontend/src/sim/route.js#L10), [`patrol.js:17`](../frontend/src/sim/patrol.js#L17) |
| Route | 2 to 32 waypoints | [`route.js:9`](../frontend/src/sim/route.js#L9) |
| Column | 1 to 6 vehicles | `MAX_ESCORTS` ([`patrol.js:41`](../frontend/src/sim/config/patrol.js#L41)) |
| Vehicle place | up to 200 m ahead or behind, 100 m to either side | `MAX_ESCORT_GAP`, `MAX_ESCORT_SIDE` |

A new patrol's column is a Hilux with a Blighter A800 40 m ahead of the lead soldier and a Patria with a Rapid Ranger 40 m behind ([`patrol.js:12`](../frontend/src/sim/config/patrol.js#L12)). Each vehicle carries one system, which must be one it can take ([`patrol.js:20`](../frontend/src/sim/patrol.js#L20)).

**How it moves** ([`patrol.js:114`](../frontend/src/sim/patrol.js#L114)). From the first wave the patrol walks to the end of its route, waits, walks back, and holds at the start until the next wave. Every member, vehicles included, follows the route at its own place in the formation, so the column bends round turns ([`formation.js:22`](../frontend/src/sim/formation.js#L22)). Sensors work on the move. While any weapon in the column has an engagement task the whole patrol halts; a jammer does not halt it ([`patrol.js:117`](../frontend/src/sim/patrol.js#L117)).

**What it costs.** The escort's systems are charged at their price as set up on their vehicles, each networked one is wired to Starlink (£262) as the patrol starts, and the fusion node gets a Starlink terminal if it has none ([`patrol.js:54`](../frontend/src/sim/patrol.js#L54)). The affordability check beforehand uses the catalogue prices instead ([`patrol.js:51`](../frontend/src/sim/patrol.js#L51)), which differ from the charge where a vehicle's mast changes the price. Clearing the patrol before the first wave refunds the escort's systems and their terminals; the fusion node keeps its terminal ([`patrol.js:74`](../frontend/src/sim/patrol.js#L74)). An escort cannot be sold on its own ([`laydown.js:94`](../frontend/src/sim/laydown.js#L94)).

With a patrol set, static systems from the purchase bar stand anywhere inside its corridor and stay put, and the patrol, not the station, is what the enemy attacks.

## Crews

Only seven systems have a crew in the simulation: the two machine guns on a vehicle pintle and the five handheld jammers, all off the network (`networked: false`, [`crew.js:1`](../frontend/src/sim/config/crew.js#L1)). How they choose targets is in [EFFECTORS.md](EFFECTORS.md#crewed-systems-off-the-network). Every other system is worked through the network, and its crew is not modelled: it needs no staff, and a strike on it puts no one at risk unless you place people beside it (see [PEOPLE.md](PEOPLE.md)). The K-CEMA NEO is drawn on a soldier's back but is networked like the other jammers.

| System | Kind | Worked by | Can ride |
|---|---|---|---|
| `gun_s`, L7A2 GPMG | Gun | A gunner on a vehicle pintle | Hilux or Patria |
| `gun_50`, L111A1 .50 cal | Gun | A gunner on a vehicle pintle | Hilux or Patria |
| `jammer_mk4`, `jammer_dgmk3`, `jammer_dgtac`, `jammer_skywiper`, `jammer_kvertus` | Handheld jammer | A soldier, aiming a 30° beam | No |

A crew finds drones with its own senses (`CREW`, [`crew.js:13`](../frontend/src/sim/config/crew.js#L13)):

- **By eye.** A crew sees a drone where its span fills 0.065° of view. In field trials half of observers saw a Phantom 4 at 245 m and a Mavic Air at 307 m at that angle ([MDPI Applied Sciences](https://www.mdpi.com/2076-3417/10/16/5501)). Sight is capped at 3 km for haze (an assumption) and scaled by the light, but never below half, as night sights are assumed ([`crew.js:19`](../frontend/src/sim/crew.js#L19)). It needs a clear line of sight from the system's mast height, 1.5 m for a handheld jammer, or 2.5 m for a gunner.
- **By ear.** 300 m for each unit of the drone's loudness, half in rain (an assumption, [`crew.js:21`](../frontend/src/sim/crew.js#L21)).
- **By detector.** A wearable detector warns of a drone with a radio link within 400 m (an assumption).
- **Reaction.** 3 s from seeing a drone to firing or jamming, unless warned at least that long before (an assumption).

How far a crew sees and hears each drone type, in each of the run's conditions, worked out with the game's functions:

| Drone type | Clear day: sight / hearing (m) | Dusk: sight / hearing (m) | Night: sight / hearing (m) | Rain and haze: sight / hearing (m) |
|---|---|---|---|---|
| Fixed-wing spotter drone | 2,644 / 900 | 1,322 / 900 | 1,322 / 900 | 1,322 / 450 |
| Fibre-optic strike drone | 309 / 300 | 154 / 300 | 154 / 300 | 154 / 150 |
| First-person-view strike drone | 309 / 300 | 154 / 300 | 154 / 300 | 154 / 150 |
| Fixed-wing strike drone | 2,204 / 1,500 | 1,102 / 1,500 | 1,102 / 1,500 | 1,102 / 750 |

Deployment packs record a military unit's systems, vehicles and people, from a fire team to a battalion (`ECHELONS`, [`units.js:6`](../frontend/src/sim/config/units.js#L6)), up to 40 lines, 50 of an item and 20 groups of people (`UNIT_LIMITS`, [`units.js:20`](../frontend/src/sim/config/units.js#L20)).

## Placement rules

Why a system can or cannot go at a spot ([`laydown.js:43`](../frontend/src/sim/laydown.js#L43)):

- Only before the first wave: after that the laydown is locked ([`lock.js:5`](../frontend/src/sim/lock.js#L5)).
- At most 200 systems, which is what a save holds (`BUILD.maxSystems`, [`world.js:39`](../frontend/src/sim/config/world.js#L39)).
- Defending the station: no closer than 250 m and no further than 2,500 m from it (`minDist`, `maxDist`, [`attack-area.js:10`](../frontend/src/sim/attack-area.js#L10)).
- With a drawn area to defend or a patrol, anywhere on the map, with no minimum distance; with a patrol, inside its corridor.
- Not on a building, not in water, and not on ground steeper than a slope of 0.4.
- At least 60 m from any other system (`spacing`).
- With a deployment pack deployed, only systems in its kit, and no more of each than it holds.
- Without a pack, its price must fit the budget left.

Clicking to sell removes the nearest system within 150 m and refunds its price and terminal ([`laydown.js:91`](../frontend/src/sim/laydown.js#L91)). A saved laydown is refused if it costs more than the budget at today's prices ([`laydown.js:124`](../frontend/src/sim/laydown.js#L124)).

## Unit settings

Each placed system has settings that change how it works, each with a cost: a price, older data, a louder signature or more false alarms. One table drives the panel, the limits, the prices and what loads from a save (`UNIT_FIELDS`, [`unit-config.js:44`](../frontend/src/sim/unit-config.js#L44)). A setting can be changed only before the first wave; the difference in price is charged or refunded at once, and a change the budget cannot pay for is refused ([`laydown.js:183`](../frontend/src/sim/laydown.js#L183)). Only values that differ from standard are saved. A saved value is untrusted: only fields offered for that system are read, a choice must be one of its options, and a number is clamped to its limits and snapped to its step ([`unit-config.js:239`](../frontend/src/sim/unit-config.js#L239)).

| Setting | Offered on | Choices or limits | Effect and price |
|---|---|---|---|
| Mast height (m) | all radars; `rf_s`, `rf`, `rf_elysion`, `rf_l`; all cameras; all acoustic sensors; all jammers | per system | Height of the antenna or sensor, for line of sight over trees and terrain. Price: 1.5% of the system’s price per metre above or below standard. |
| Transmit power (W) | all radars; all jammers | per system | Radar range goes with the fourth root of power, a jammer’s with the square root; signature in proportion. No price change. |
| Scan period (s) | all radars | 0.5 to 5 s | Range goes with the fourth root of the period over the standard; tracks are held longer between updates. No price change. |
| Panels | `radar_s`, `radar_a400`, `radar_a800`, `radar_l` | per system | Each panel adds its arc beside the others. Price: one more radar head per panel. |
| Arc per panel (°) | `radar_s`, `radar_a400`, `radar_a800`, `radar_l` | per system | Range goes with the fourth root of standard arc over chosen arc. No price change. |
| Facing (°) | `radar_s`, `radar_a400`, `radar_a800`, `radar_l`; all jammers | 0 to 355 ° | Compass bearing of the middle of the arc. Unset, it faces away from what is defended. |
| Bands fitted | all jammers | a list of bands | A band left out can never be jammed. Price: 15% less per band left out. |
| Antenna | all jammers | Omni, all round; Sector, 60° | Sector: range x √10 (about 3.2) through a 60° arc only. Price: +20%. |
| Receiver | all jammers | None; Fitted, no library; Fitted, commercial library; Fitted, FPV and hobby library; Fitted, tactical library; Fitted, full library | Hears drones on fitted bands as far as it can jam them. Price: a Small RF detector’s price, adjusted by the library’s share. |
| Technique | all jammers | Barrage; Reactive; GNSS spoofing; Take over commercial drones | Anything but barrage halves the signature. Reactive breaks links twice as fast, but only links its library knows, and never GNSS. Spoofing and takeover: +25% price. |
| Switched on by | all jammers | Fusion node, on a track; Its own receiver; You, by hand | Who switches it on. Own receiver works with the network down; a barrage stops to listen. |
| Height | `radar_a400`, `radar_a800`, `radar`, `radar_giraffe`, `radar_l` | 3D, measures height; 2D, no height | 2D gives no height. Price: 30% less. |
| Band | all radars | S band, 3 GHz; X band, 9.4 GHz; Ku band, 16 GHz; K band, 24.5 GHz | Range x (new GHz / old GHz)^(1/8); angle error x old GHz / new GHz; rain loss by band. Price: by band (S 0.85, X 1, Ku 1.15, K 1.3, as a ratio to its own band). |
| Micro-Doppler classifier | all radars | No; Yes | Names multirotor or fixed wing inside half its reach. Price: ±15% of the radar’s price. |
| Low edge of the beam (°) | all radars | -10 to 5 ° | False alarms x 2^((−10 − v)/10): halved per 10° raised. The narrower band also reaches a little further. Low flyers close in pass under it. |
| Top edge of the beam (°) | `radar_s`, `radar_a800`, `radar`, `radar_giraffe`, `radar_l` | per system | A narrower elevation band reaches further: range x (standard span / chosen span)^(1/4). It leaves a gap overhead. |
| Blanking arcs | all radars | up to 3 arcs | No detections and no false alarms inside the arcs. |
| Clutter filter | all radars | Low; Medium; High | Low: low-flyer range x1.4, false alarms x2. High: x0.7 and x0.5, and blind to radial speed under 4 m/s. |
| Classifier library | all RF detectors | None: energy only; Commercial (DJI, Autel); FPV and hobby (ELRS, Crossfire); Tactical (long-range military); Full: all three | Names airframes of known link families. None doubles false alarms. Price: −20%, 0, +15%, +25% or +40% of the detector’s price. |
| Receiver sensitivity (dBm) | all RF detectors | per system | Range x 2^((standard − v)/6): twice as far per 6 dB. Price: (range factor − 1) x 50%. |
| Direction finding | all RF detectors | Sector, ±30°; Angle of arrival | Angle of arrival: 5° bearing error; sector: 30°. Price: ±50% of the detector’s price. |
| Bands monitored | all RF detectors | a list of bands | False alarms x share of its bands monitored. An unmonitored band is not heard. |
| Instantaneous bandwidth | all RF detectors | Wide, all its bands at once; Narrow, one band at a time | Narrow: report interval x number of bands monitored. Price: 25% less. |
| Detection threshold | all radars; all RF detectors; all cameras; all acoustic sensors | Low; Normal; High | Low: range x1.1, false alarms x2. High: range x0.9, false alarms x0.5. |
| Search view (°) | `camera`, `camera_l` | per system | Range x standard view / chosen view. |
| Track view (°) | `camera`, `camera_l` | per system | How far it zooms on a cue: reach x search view / track view. |
| Channels | all cameras | Visible; Thermal; Visible and thermal | Visible fades at dusk and night; thermal does not. Price: visible 0.5, thermal 0.8, both 1, as a ratio to its own. |
| Resolution | all cameras | 640 pixels across; 1280 pixels across; 1920 pixels across | Range x pixel ratio (thermal limited by the lens). Price: 30% of the price per doubling of pixels. |
| Lens F-number | all cameras | per system | Light gathered goes with 1/F², which keeps range at dusk, night and in haze. Price: ((standard/v)² − 1) x 10%. |
| Laser rangefinder | all cameras | No; Yes | Measures range to 5 m, so a cued camera can start a track alone. Price: +$20,000 (£15,000). |
| Search arc (°) | all cameras | 30 to 360 ° | The arc it sweeps when idle, facing away from what is defended. |
| Sweep rate (°/s) | all cameras | 4 to 40 °/s | Idle sweep speed; faster than its view between looks leaves gaps. |
| Slew rate (°/s) | all cameras | 30 to 180 °/s | Turn speed onto a cue. Price: (v/standard − 1) x 10%. |
| Dwell on a cue (s) | all cameras | 1 to 10 s | How long it holds on a cue before moving on. |
| Time between shots (s) | all interceptors; all missiles; all guns | per system | Seconds between shots. Price: 10% of the price per second faster (refund per second slower). |
| Beam damage (hp/s) | all lasers | per system | Beam damage per second. Price: in proportion to the change. |

Limits that differ by system (mast limits are in the table under [How a system stands](#how-a-system-stands)):

| System | Transmit power (W) | Time between shots (s) | Beam damage (hp/s) | Lens F-number | Search view (°) |
|---|---|---|---|---|---|
| [`radar_s`](../frontend/src/sim/config/sensors.js#L38) | 0.2 to 2 (standard 2) |  |  |  |  |
| [`radar_a400`](../frontend/src/sim/config/uk-systems.js#L5) | 0.4 to 4 (standard 4) |  |  |  |  |
| [`radar_a800`](../frontend/src/sim/config/sensors.js#L62) | 0.4 to 4 (standard 4) |  |  |  |  |
| [`radar`](../frontend/src/sim/config/sensors.js#L8) | 1 to 12 (standard 12) |  |  |  |  |
| [`radar_giraffe`](../frontend/src/sim/config/uk-systems.js#L29) | 20 to 150 (standard 150) |  |  |  |  |
| [`radar_l`](../frontend/src/sim/config/sensors.js#L85) | 10 to 100 (standard 100) |  |  |  |  |
| [`camera_s`](../frontend/src/sim/config/sensors.js#L230) |  |  |  | 1 to 2 (standard 1) |  |
| [`camera`](../frontend/src/sim/config/sensors.js#L203) |  |  |  | 1.4 to 4 (standard 2) | 2.5 to 10 (standard 10) |
| [`camera_l`](../frontend/src/sim/config/sensors.js#L250) |  |  |  | 4 to 5.6 (standard 5.5) | 0.5 to 7.1 (standard 7.1) |
| [`jammer_mk4`](../frontend/src/sim/config/crew.js#L52) | 4 to 40 (standard 40) |  |  |  |  |
| [`jammer_dgmk3`](../frontend/src/sim/config/crew.js#L88) | 1 to 10 (standard 10) |  |  |  |  |
| [`jammer_s`](../frontend/src/sim/config/effectors.js#L32) | 1 to 10 (standard 10) |  |  |  |  |
| [`jammer_dgtac`](../frontend/src/sim/config/crew.js#L104) | 4 to 40 (standard 40) |  |  |  |  |
| [`jammer_kvertus`](../frontend/src/sim/config/crew.js#L76) | 10 to 110 (standard 110) |  |  |  |  |
| [`jammer_skywiper`](../frontend/src/sim/config/crew.js#L64) | 4 to 40 (standard 40) |  |  |  |  |
| [`jammer`](../frontend/src/sim/config/effectors.js#L6) | 4 to 40 (standard 40) |  |  |  |  |
| [`jammer_neo`](../frontend/src/sim/config/uk-systems.js#L71) | 4 to 45 (standard 45) |  |  |  |  |
| [`jammer_jupiter`](../frontend/src/sim/config/uk-systems.js#L89) | 60 to 600 (standard 600) |  |  |  |  |
| [`jammer_auds`](../frontend/src/sim/config/uk-systems.js#L53) | 20 to 150 (standard 150) |  |  |  |  |
| [`jammer_l`](../frontend/src/sim/config/effectors.js#L54) | 40 to 400 (standard 400) |  |  |  |  |
| [`jammer_sf`](../frontend/src/sim/config/eu-systems.js#L28) | 100 to 800 (standard 800) |  |  |  |  |
| [`interceptor_s`](../frontend/src/sim/config/effectors.js#L172) |  | 2 to 8 (standard 4) |  |  |  |
| [`interceptor`](../frontend/src/sim/config/effectors.js#L69) |  | 1.5 to 6 (standard 3) |  |  |  |
| [`interceptor_p1`](../frontend/src/sim/config/effectors.js#L95) |  | 1.5 to 6 (standard 3) |  |  |  |
| [`interceptor_l`](../frontend/src/sim/config/effectors.js#L197) |  | 1.5 to 6 (standard 3) |  |  |  |
| [`missile_s`](../frontend/src/sim/config/effectors.js#L217) |  | 1 to 4 (standard 2) |  |  |  |
| [`missile_rr`](../frontend/src/sim/config/uk-systems.js#L107) |  | 2 to 8 (standard 3) |  |  |  |
| [`missile_hvm`](../frontend/src/sim/config/uk-systems.js#L134) |  | 2 to 8 (standard 3) |  |  |  |
| [`missile`](../frontend/src/sim/config/effectors.js#L114) |  | 2 to 8 (standard 4) |  |  |  |
| [`missile_l`](../frontend/src/sim/config/effectors.js#L237) |  | 3 to 10 (standard 5) |  |  |  |
| [`missile_skysabre`](../frontend/src/sim/config/uk-systems.js#L175) |  | 3 to 10 (standard 5) |  |  |  |
| [`gun_s`](../frontend/src/sim/config/crew.js#L28) |  | 0.5 to 4 (standard 1.5) |  |  |  |
| [`gun_50`](../frontend/src/sim/config/crew.js#L40) |  | 0.5 to 4 (standard 1.5) |  |  |  |
| [`gun_hmg`](../frontend/src/sim/config/effectors.js#L305) |  | 0.5 to 4 (standard 1.5) |  |  |  |
| [`missile_paladin`](../frontend/src/sim/config/uk-systems.js#L155) |  | 0.5 to 3 (standard 1) |  |  |  |
| [`gun_skyranger`](../frontend/src/sim/config/eu-systems.js#L65) |  | 0.5 to 3 (standard 1) |  |  |  |
| [`gun_gepard`](../frontend/src/sim/config/eu-systems.js#L83) |  | 0.5 to 3 (standard 1) |  |  |  |
| [`gun_l`](../frontend/src/sim/config/eu-systems.js#L47) |  | 0.5 to 3 (standard 1) |  |  |  |
| [`laser_rfdew`](../frontend/src/sim/config/uk-systems.js#L200) |  |  | 28 to 112 (standard 56) |  |  |
| [`laser_s`](../frontend/src/sim/config/effectors.js#L258) |  |  | 7 to 28 (standard 14) |  |  |
| [`laser`](../frontend/src/sim/config/effectors.js#L143) |  |  | 14 to 56 (standard 28) |  |  |
| [`laser_l`](../frontend/src/sim/config/effectors.js#L281) |  |  | 28 to 112 (standard 56) |  |  |

The lowest transmit power is a tenth of the rated output, rounded to a step of about a twentieth of it ([`unit-config.js:37`](../frontend/src/sim/unit-config.js#L37)). The Panels limits are 1 to 3 for `radar_s` and `radar_l` and 1 to 4 for the A400 and A800; the arc per panel runs from 30° up to the catalogue arc. The top edge of the beam is offered only where the beam reaches above 15°, from 15° to its standard top.

Settings that can be changed at any time, wave or not:

- **Jamming bands.** Which of its fitted bands a jammer jams ([`laydown.js:240`](../frontend/src/sim/laydown.js#L240)).
- **Jam by hand.** A jammer switched by hand is on only while you switch it on ([`laydown.js:260`](../frontend/src/sim/laydown.js#L260)).

Names, callsigns and the network are also set per unit before the first wave:

- **Name and callsign.** A name is up to 40 characters, with control characters removed ([`unit-config.js:311`](../frontend/src/sim/unit-config.js#L311)). A callsign is up to 12 letters, digits, spaces or dashes, starting with a letter or digit, and must not be in use ([`unit-config.js:312`](../frontend/src/sim/unit-config.js#L312), [`laydown.js:200`](../frontend/src/sim/laydown.js#L200)).
- **Network terminal.** Starlink (£262) or cellular (£450), and for cellular the band: 900 MHz, 1800 MHz or 3.5 GHz ([`comms.js:45`](../frontend/src/sim/config/comms.js#L45)). Crewed systems cannot be wired. How links work is in [SAPIENT.md](SAPIENT.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Limits and simplifications

- **No movement but the patrol's.** Systems are not redeployed during a run, and parked vehicles do not move. A patrol walks its route at a constant speed with its vehicles in formation, whatever the ground; there are no roads, fuel, breakdowns or recovery.
- **One system per vehicle.** Each vehicle carries exactly one system. The vehicles are free, and their mast heights, armour and carrying classes are assumptions.
- **Mast limits override the vehicle.** A system's own minimum mast wins over the vehicle's mast height, so some vehicle-mounted radars and cameras stand higher, and cost less, than the vehicle suggests.
- **Crews are thin.** Only the seven crewed systems have a crew, and it is a set of senses and a reaction time, not people: crews do not tire, are not hurt by strikes, and are not counted as casualties. Soldiers placed as people, and the patrol's soldiers, are modelled separately ([PEOPLE.md](PEOPLE.md)).
- **Escorts are on Starlink.** An escort's terminal is assumed to work on the move.
- **Settings are priced by rule.** Every setting's price and effect is a rule of thumb from `unit-config.js`, not a vendor option list.

## Where this lives in the code

- [`config/patrol.js`](../frontend/src/sim/config/patrol.js): the foot patrol, vehicles, carrying classes and column limits.
- [`config/crew.js`](../frontend/src/sim/config/crew.js): crewed systems and how a crew sees and hears.
- [`config/units.js`](../frontend/src/sim/config/units.js): deployment pack echelons, what a vehicle carries, and pack limits.
- [`laydown.js`](../frontend/src/sim/laydown.js): placing, selling, vehicles, unit settings, names and wiring.
- [`unit-config.js`](../frontend/src/sim/unit-config.js): every unit setting, its limits, price and effect.
- [`patrol.js`](../frontend/src/sim/patrol.js), [`formation.js`](../frontend/src/sim/formation.js) and [`route.js`](../frontend/src/sim/route.js): the patrol, its formation and its route.
- [`crew.js`](../frontend/src/sim/crew.js): crews working systems by hand.
- [`render/system-parts.js`](../frontend/src/render/system-parts.js) and [`render/vehicle-models.js`](../frontend/src/render/vehicle-models.js): how systems and vehicles are drawn. Their colours are in [PAINT_SOURCES.md](PAINT_SOURCES.md).
