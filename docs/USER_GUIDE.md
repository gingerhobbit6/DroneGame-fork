# User guide

How to play Site Guard, from signing in to reading the debrief. It is for players and for anyone demonstrating the game. The numbers behind each system, drone and model are in the reference documents linked throughout, so this guide stays about what to do.

## Contents

- [Signing in](#signing-in)
- [Choosing a world](#choosing-a-world)
- [The area you defend](#the-area-you-defend)
- [1. Build a laydown](#1-build-a-laydown)
- [2. Network it](#2-network-it)
- [3. Check what it can see](#3-check-what-it-can-see)
- [4. Rehearse in the sandbox](#4-rehearse-in-the-sandbox)
- [5. Fight the waves](#5-fight-the-waves)
- [6. Read the messages](#6-read-the-messages)
- [7. Rewind and review](#7-rewind-and-review)
- [8. Count the cost](#8-count-the-cost)
- [9. Question the numbers](#9-question-the-numbers)
- [Deployment packs](#deployment-packs)
- [Simulated people](#simulated-people)
- [Patrol mode](#patrol-mode)
- [Maps in the game](#maps-in-the-game)
- [Keys](#keys)
- [Saved data](#saved-data)

Screenshots use scenario seed 7 and terrain seed 3 (`?seed=7&terrain=3`) with the mixed laydown from [`scenarios.js`](../frontend/tests/support/scenarios.js). Some were taken before costs were shown in pounds.

## Signing in

The game opens on a login page. **Create account** asks for your name, a username and a password of at least 10 characters ([`account_schemas.py:25`](../backend/app/account_schemas.py#L25)), then shows a recovery code once. Save it: there is no email, so the code is the only way to reset a forgotten password, and each reset gives a new code. Five wrong tries lock the account for 5 minutes ([`accounts.py:19`](../backend/app/services/accounts.py#L19)). **Keep me signed in** lasts 30 days, otherwise a session lasts 12 hours ([`accounts.py:20-21`](../backend/app/services/accounts.py#L20)). If a session runs out during a game, the login page comes back over the paused game, and signing in again carries on where you were.

Signing in opens your profile, where you can change your name, rank and organisation, your password or your recovery code, and manage deployment packs. The badge at the bottom left of the game brings the profile back, and pauses a wave in progress. Nothing on screen behind the profile is drawn while it is open.

## Choosing a world

The start screen offers generated ground or a real map. If map packs are installed, a real map is ready to play straight away. To defend somewhere else, press **Use my location**, move the map and click a spot, or type a position: a grid reference, decimal latitude and longitude (51.39, -1.68), British eastings and northings (422000 166000), or Estonian ones (611700 6570700). Most laptops estimate their position from Wi-Fi, so the app says how good the fix is.

Real maps cover Great Britain and Estonia. Choose a spot with no map yet and the card lists what a build would use from this computer and what it would download. Everything about map types, building, importing and exporting packs, and privacy is in [MAPS.md](MAPS.md).

New to the game? Press **Guide me through it** on the start screen. The wizard walks you from an empty site to the first wave: mark the area you are defending, place sensors and effectors, network them, check coverage, rehearse in the sandbox, adjust the figures if you want to, then commit. It works out where you are from the game itself, so you can skip around or close it, and **Open the wizard** brings it back. Once a wave starts it steps back. When the site falls, a debrief shows what got through and can replay the first leak.

## The area you defend

By default you defend a power station, and systems must stand between 250 m and 2.5 km from it ([`world.js:39`](../frontend/src/sim/config/world.js#L39)). Draw an **area to defend** instead and it becomes the site: the enemy attacks spots inside it, spotters circle it, and you can build anywhere on the map ([`attack-area.js:9-13`](../frontend/src/sim/attack-area.js#L9)). Systems always stand at least 60 m apart, and a laydown holds up to 200 systems. The area saves with the laydown and locks when the first wave starts.

## 1. Build a laydown

Press **Deploy**, then click a kind of system on the left, such as Radar, to open its list of systems: generic small, medium and large ones, and real products such as the Blighter A400 or Rapid Ranger. Drag one onto the map, or click it and then click the ground. A number key picks that kind's systems in turn (see [Keys](#keys)). Pick a row to see the settings for the next one you place.

![Eleven systems placed around the site, with their ranges drawn over the terrain](screenshots/laydown.jpg)

There are nine kinds:

| Kind | What it is for | Reference |
|---|---|---|
| Radar | Range, bearing and speed. Low flyers hide in ground clutter until close | [SENSORS.md](SENSORS.md) |
| RF detector | Passive bearings to a drone's radio. Cannot see radio-silent drones | [SENSORS.md](SENSORS.md) |
| EO/IR camera | A narrow view, cued by other sensors, that classifies well | [SENSORS.md](SENSORS.md) |
| Acoustic sensor | Hears drones by their sound, at short range (300 m to 1 km) | [SENSORS.md](SENSORS.md) |
| RF jammer | Breaks radio links while tracks are in range. Fibre-optic drones ignore it | [EFFECTORS.md](EFFECTORS.md) |
| Interceptor drones | Fly out and hit a drone | [EFFECTORS.md](EFFECTORS.md) |
| Missile | Long reach, and the answer to fast fixed-wing drones | [EFFECTORS.md](EFFECTORS.md) |
| Gun | Shorter-range fire, from machine guns to radar-guided cannon | [EFFECTORS.md](EFFECTORS.md) |
| Laser | Very cheap shots, but needs dwell time on target | [EFFECTORS.md](EFFECTORS.md) |

Everything comes out of one fixed budget, including every shot fired, and nothing is earned back. The budget is $15 million in config, shown in the game as £11.3M because costs are shown in pounds at 0.75 ([`economy.js:26`](../frontend/src/sim/economy.js#L26)). No single system handles every drone.

Where a system stands changes what it really sees. The ring on the map follows the predicted range over the real ground, and the Range side of its panel shows each bearing and what is in the way ([ADR 0003](adr/0003-range-from-a-terrain-path-model.md), [PHYSICS_AND_PROPAGATION.md](PHYSICS_AND_PROPAGATION.md)). Some systems ride on vehicles: see [VEHICLES.md](VEHICLES.md).

Rounds can miss. The Unit panel gives each weapon's chance against each drone, close in and at its limit, or for a laser the time to burn through. Sensor error grows as the signal weakens, and a poor track lowers a shot's chance. Most hit chances are labelled assumptions, because few are published.

The attack is built from four generic drone types: first-person-view (FPV) strike drones, fibre-optic strike drones that fly low and emit no radio, fixed-wing strike drones, and fixed-wing spotters that make strikes hit harder. They get harder to hit and jam each wave. Press **Attack** in the top right to choose what the waves send: tick any mix of the generic types and the real Russian, Iranian, Chinese and commercial drones, which take turns in the place of their type. The choice saves with the laydown and locks when the first wave starts. Every drone and its figures are in [DRONES.md](DRONES.md).

## 2. Network it

Every system is a SAPIENT node, and an unwired one cannot report or be tasked. Open **SAPIENT > Network > Auto-wire**, or wire each one to Starlink or cellular by hand. Links depend on the sky, the terrain, cell towers and your own jammers. Click a system or a wire to see its link and the packets on it, or step through the simulation one packet at a time. See [SAPIENT.md](SAPIENT.md).

![The Network tab showing each system wired through Starlink or cellular to the fusion node](screenshots/network.jpg)

## 3. Check what it can see

The **Plan** tab maps sensor coverage for a chosen drone. In this example the laydown sees very little of a fibre-optic drone at 18 m, while a spotter at 450 m is almost entirely covered. **Spectrum** shows where your jamming overlaps your own links.

![Sensor coverage for a low, RF-silent drone, mostly red beyond the immediate site](screenshots/coverage.jpg)

## 4. Rehearse in the sandbox

The **Sandbox** launches any wave's attack, or a custom one, without risk: the site cannot be damaged and shots are free. You can still change the laydown. Leaving it resets the run and keeps your systems.

![The sandbox launching ten FPV drones from the north-east](screenshots/sandbox.jpg)

## 5. Fight the waves

Press **Start wave**. The laydown locks and the fusion node takes over: it builds tracks from noisy detections, cues cameras and tasks effectors. **Engagement authority** decides whether it fires by itself, or asks you first for costly shots or for every engagement. Space pauses, and the speed control runs time at 1 to 10 times real speed.

With **Truth overlay** on, a tag like `First-person-view` marks where a drone really is, and a marker like `T88 · UAV ±52 m` marks where the fusion node believes it is. Tracks can lag, get confused or turn out to be ghosts, and effectors only hit a real drone they find at the cued position. How the fusion engine decides, and how well it does, is in [FUSION_AND_TARGETING.md](FUSION_AND_TARGETING.md).

Zoomed out, each drone has a ring round it: white while no sensor has it, then the colour of its type once it is tracked. Where name tags would overlap, the ones further down the order give way: the selected system or drone first, then drones, then tracks, then systems and people. Tick **Map symbols** to show NATO map symbols in place of the drone and system models when zoomed out. It is off by default.

With the truth overlay on, click a drone to open the **Selected drone** panel: what it is, whether a sensor tracks it, its speed, height, range and bearing from the site, warhead, health, radio links, how well it resists jamming, how hard it is to hit and what it costs. **Follow** keeps it in the middle of the view. Once it is shot down, hits its target or leaves, the panel says which. Esc or a click on empty ground closes it. Turning off **Truth overlay** also closes the panel and stops following, so hidden drone positions are no longer revealed.

![Wave 5 in progress: drones approach the site while the fusion node tracks them and tasks interceptors](screenshots/wave.jpg)

## 6. Read the messages

The **Messages** tab shows every SAPIENT message between nodes, filterable by node. Tick **Explain** for a plain-English note beside each field, or use **Inject fault** to see how errors are reported. **Learn** walks through the protocol using messages from your own run.

![A fused detection report with a plain-English note on each field](screenshots/messages.jpg)

## 7. Rewind and review

Pause at any moment and scrub back through the run. Markers on the timeline show kills, leaks and other events, and a banner shows the state at that moment. The left and right arrow keys step through a replay.

![A paused replay 6 seconds behind live, with the timeline and its event markers](screenshots/replay.jpg)

## 8. Count the cost

The **Cost** tab compares what you spent with what the attack cost the enemy, broken down by system, effector and drone type. The sandbox can also launch the real drones, and their public figures, with how solid each one is, are in the **Sources** tab.

![The Cost tab showing the budget, cost exchange and shots fired per effector](screenshots/cost.jpg)

When the site falls, the run is saved to your history in the **Runs** tab. You can retry the same laydown or start a new one, and laydowns are kept in the **Saved** tab.

![The Site Lost card after 12 full waves](screenshots/gameover.jpg)

The same scenario seed, terrain seed and laydown give the same run. Time between later waves is part of what you did, so it changes the run's noise but not the attack.

## 9. Question the numbers

The **Sources** tab shows the evidence and confidence behind each figure, labelled as published, price or game rule, and every figure can be edited. Changes take effect at once and can be saved as a named set, exported or imported. The figures come from public sources, mostly vendor claims and press reports, and many are labelled assumptions. This is a game and a teaching tool, not a model to base real decisions on.

![The Sources tab with editable figures, each labelled as published, price or game rule](screenshots/sources.jpg)

## Deployment packs

A deployment pack is a military unit, from a fireteam to a battalion, with a callsign and the real sensors, effectors, vehicles and groups of people assigned to it. Build packs in your profile. Press **Deploy** on a pack and the game lists its kit in a tray at the top of the toolbar, with how many of each are left to place. Drag each onto the map. A pack's systems come out of the same budget as any other. A vehicle is placed with one of the pack's systems on board, chosen in the tray, and stands it at the vehicle's mast height. With a pack deployed, a patrol's column takes only the pack's vehicles. Packs belong to your account; laydowns, runs and figure sets are shared by every account on this computer.

## Simulated people

The **People** tool (key 9) places groups of simulated people to see what an attack would do to them: 1 to 500 people a group, up to 50 groups ([`people.js:12`](../frontend/src/sim/config/people.js#L12)), unarmoured, in a building, or in a bunker. They cost nothing and lock with the laydown. Around the station they never change the attack. Inside a drawn area to defend they do: strikes choose between systems, people and buildings in the area, with people taking about 30% of aims ([`targeting.js:17`](../frontend/src/sim/targeting.js#L17)). **Look** in the People panel flies the camera down to them, since they are drawn to true scale. Every casualty figure is a round-number assumption, not real weapons-effects data. Details are in [PEOPLE.md](PEOPLE.md).

## Patrol mode

Instead of a site, protect soldiers on patrol. In the area to defend panel, press **Draw a patrol route**, click waypoints, and double-click at the end. Set the corridor width, the soldiers' formation and the escorting vehicles. From the first wave the patrol walks to the end, waits, and walks back. Spotters must search the corridor to find it, and strikes head for the last fix they passed. The design and what it leaves out are in [PATROL_MODE.md](PATROL_MODE.md), and vehicles in [VEHICLES.md](VEHICLES.md).

## Maps in the game

The buttons beside the minimap open the map switcher, centre on your location, centre on the site, show the whole laydown, turn north up, draw the area to defend, and switch between 3D and plan view. The compass among them points to north on the screen.

To move the camera, drag the ground, right-drag (or Shift-drag) to turn and tilt, and scroll or pinch to zoom. Double-click the ground, with no tool picked, to glide there and close in by half. From the keyboard, hold W, A, S and D to move, Q and E to turn, and + and - to zoom; the keys go by position, so they sit in the same place on any layout. H frames every system, group of people and the area you defend (with nothing placed, the area you may build in), N turns north up, and F flies to the selected system. Clicking the minimap jumps there.

On a real map the switcher offers OS (or the Estonian basic map), light, dark, satellite, hybrid, topographic, shaded relief and live OpenStreetMap, with roads and names, contours and a national or MGRS grid on top. A typed grid reference moves the camera there, or places the system you have picked. **Change world** goes back to the start screen. See [MAPS.md](MAPS.md).

## Keys

Keys are ignored while you type in a field, and Ctrl, Alt and Cmd combinations belong to the browser ([`useHotkeys.js:21`](../frontend/src/ui/useHotkeys.js#L21)).

| Key | Does |
|---|---|
| 1 to 8, 0 | Pick a kind's systems in turn: 1 radar, 2 RF detector, 3 camera, 4 jammer, 5 interceptor, 6 missile, 7 laser, 8 acoustic, 0 gun ([`systems.js:13`](../frontend/src/sim/config/systems.js#L13)). With a deployment pack deployed, they open that kind's list of the pack's kit instead ([`game.js:123`](../frontend/src/game.js#L123)) |
| 9 | The People tool |
| X | The Remove tool: the next system clicked is removed, with its cost back unless a pack is deployed |
| Esc | The first that applies: leave the mast view, close the map panel, drop the tool, close the list, clear the selected system and drone |
| Space | Pause and resume, or play and pause a replay |
| Left, Right | Step back and forward through a replay |
| R, T, L | Range rings, truth overlay, labels |
| W, A, S, D (held) | Move the camera ahead, left, back and right |
| Q, E (held) | Turn the view left and right (not in plan view) |
| +, - (held) | Zoom in and out |
| H | Frame the whole laydown |
| N | Turn north up |
| F | Fly to the selected drone, or the selected system |
| P | Plan view (look straight down) |
| M | Next map (real maps only) |
| G, C | Next grid, contours (real maps only) |

Drag the wizard, the Sandbox panel, an approval card or most other boxes out of the way. Double-click a box (anywhere but its buttons) to put it back where it started.

## Saved data

Laydowns, run history, figure sets, accounts and deployment packs are kept in `backend/data/siteguard.db`, one SQLite file that git ignores. To back it up or move it, copy that file while the game is closed, or set `SITE_GUARD_DB` to keep it elsewhere. Signing in needs the server. If the server stops during a game, the game still plays, panels say so, and a finished run is kept in the browser until the server returns. Map files live in `~/site-guard-maps` ([MAPS.md](MAPS.md)).
