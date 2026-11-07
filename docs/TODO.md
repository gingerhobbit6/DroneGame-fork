# To do

What is still open now the rebuild to React, FastAPI and SQLite is on `main`. Detail lives in the documents linked from each item.

## Decisions for you

- [x] **Add a remote backup.** The code is on GitHub.
- [x] **Commit or drop the uncommitted mapping plan edits.** Committed.
- [ ] **Confirm the mapping plan's assumptions.** Grid format, Great Britain coverage, what "offline" means, open data only, and whether the app is for commercial, non-commercial or public sector use, which decides the satellite imagery allowed. See "Assumptions to confirm" in `docs/REAL_MAPPING_PLAN.md`.
- [ ] **Decide what happens to `parked-friendlies-roe-spectrum`** (also on GitHub). It is untested and predates the rebuild, so it cannot be merged. Its spectrum, defence targeting and water rules are on `main` in newer forms; only friendly drones and rules of engagement are not. Rebuild those as new work, or delete it.
- [ ] **Delete the merged branches?** All of these are in `main`: `refactor/client-server`, `feature/leaflet-start`, `feature/map-styles`, `feature/map-views`, `feature/real-mapping` (also on GitHub), `feature/real-threats`, `fix/defend-anywhere`, `feature/simulated-people`, `claude/amazing-bassi-40110b` and `claude/stoic-pare-bfbde0`, with their worktrees. `feature/assistant-wizard` (also on GitHub) is the wizard's first draft, replaced by later commits, so it needs a forced delete.
- [ ] **Leave the early mapping plan draft in commit `393ac0e`?** It was included by accident in Phase 3. It is on GitHub now, so removing it would mean rewriting history and a force push. The suggestion is to leave it.

## Now there is a remote

- [ ] Add CI: both test suites, the map builder's tests, the reference digests, the build, `npm audit` and `pip-audit`. There are no workflows yet.

## Planned features

Full detail is in `docs/MASTER_IMPLEMENTATION_PLAN.md`.

**Feature A: configurable sensors and jammers**

- [x] A1: per-unit definitions and kind checks, with digests unchanged
- [x] A2: small, medium and large catalogue entries, and the toolbar
- [x] A3: editing in the unit panel, with names and settings in laydowns and the API
- [x] A4 part 1: coverage arcs and elevation for every radar, panels and facing on fixed-panel radars, drawn in every view. Small radars now see 120° per panel
- [x] A4 part 2: tracker timing scaled to each sensor's update interval, so a radar's scan period now goes up to 5 s
- [x] A4 part 3: 2D radars, band, clutter filter, the beam's low and top edges, blanking arcs and micro-Doppler
- [x] A4 left over: arc per panel on fixed-panel radars. A narrower arc reaches further: a quarter of the arc gains about 40%
- [x] A5: conditions (clear day, dusk, night, rain and haze) for cameras by channel, radar by band and lasers, and camera optics: pixels on target, zoom on a cue, channels, resolution, lens, rangefinder, search arc and slew
- [x] A5 left over: rain noise halves an acoustic sensor's reach, thermal light blurs past the lens (a slower lens or finer pixels gain less), and a camera that identifies a drone names its model, so cameras come back to a classified track once it is near enough. Replays still show the airframe only
- [x] A6 part 1: radio detection. Drones are heard on the bands of their own links, a detector hears only bands it covers, your own jamming deafens it on the bands it jams, and classifier libraries, sensitivity and direction finding are fields
- [x] A6 part 2: how far a jammer reaches: bands fitted as paid modules, an omni or sector antenna with its facing, a control link easier to jam the further the drone is from its operator, and a louder jammer for each band it jams
- [x] A6 part 3: the jammer's own receiver and library, barrage or reactive, what switches it on (the fusion node, its own receiver or you), and receiver blanking
- [x] A6 left over: monitored bands and instantaneous bandwidth on RF detectors. A sensitivity for a jammer's receiver is not offered: hearing further than it can jam would change nothing
- [x] A7: balance pass. A laser now takes 4 s to swing onto each new drone, so lasers with all-round radar cover lose too. No unit setting was a free win. Later waves on other bands were left out

**Feature B: magazine depth**

- [x] B1: magazine, storage and reload rules in the simulation. Shots are still paid for from the budget, at the user's request
- [x] B2: balance rack size, storage and reload time. Measured, and nothing changed: only the Sting's magazine decides anything, about two waves on the mixed laydown
- [x] Resupply between waves: buy back used rounds, emptiest launcher first. A bought round is paid for once
- [x] B3: the Cost tab is now Magazine depth, with a row for each launcher and laser. Expanding rows and Refill buttons are not built

**Systems added outside the plan**

- [x] Small and large interceptors, missiles and lasers, and three acoustic sensors, all from public sources
- [x] Sensofusion Airfence 7 (RF detector, 10 km) and its 800 W jammer, and Kirintec K-CEMA NEO and Jupiter (45 W jammers with their own receiver). No jammer range is published, so each is set from its power, reach going with the square root. Jupiter publishes almost nothing and plays as a NEO on a vehicle. Airfence also finds the pilot, which is not modelled
- [x] Carried systems stand lower: 1.5 m for manpack (the Wingman, both DroneGuns, K-CEMA NEO) and 3 m for vehicle-mounted (K-CEMA Jupiter, the Sensofusion jammer, Giraffe 1X, RapidDestroyer, LOCUST), against 9 m or more on a fixed mast. On the game's ground that cuts their mean reach by 7 to 17%, more against low flyers. The mast can still be raised, at a price
- [ ] Ground reflection for low antennas. A radio antenna 1.5 m up loses more to the ground than the path model counts, so short masts are probably still too kind
- [x] A threat library in the fusion node (`sim/network/threats.js`): what it may believe about each track from what its sensors named, never the real drone. Jammers switch on only for drones they could touch; tracks are ranked by the harm they would do over how soon they arrive; RF detectors name a commercial drone's model, as DJI's DroneID allows; and rounds are held for a drone with a link to break while a jammer has time on its way in, unless it comes close, the jammer has had it 10 s, or jamming keeps failing against that model
- [ ] Against the Russian mix the mixed laydown lasts 15.4 waves with the threat library against 16.9 before, over twelve seeds. Near chance, but every other laydown and mix gained or held, so it is worth a look
- [ ] Jammer power is left where you set it. The fusion node turning it down to what each target needed cost about 1.5 waves, because the power that breaks a control link depends on how far the drone is from its operator, which the node cannot know
- [ ] Review the placeholder prices. The DragonFire's $2M looks low beside about $8M reported for the smaller LOCUST, and the Iron Beam and NASAMS launcher prices are set low only so that they fit the budget
- [x] Balance the new systems. Measured on the mixed laydown, and none is too strong, so no figure changed. Six $50k Medium acoustic sensors help (16.5 waves against 15.2). The NASAMS in place of the Coyote costs $4M more for 15.5 waves. Twelve $500 Large acoustic stations in place of the radar last 8 waves. Added to it, they made things worse (11.2 waves) until launchers stopped chasing empty tracks, and now help (16.0)
- [x] Ghost tracks no longer tie up the launchers. Once an effector finds nothing where a track says a drone is, no effector is sent there for 10 s. With twelve acoustic stations the Stings had a task 5% of the time and the mixed laydown lasted 11.2 waves; now 31% and 16.0. Holding the Coyote until a track came within 2.5 km was tried first and dropped: it fired on tracks no Sting was on, so holding it let bursts through
- [ ] The Coyote earns little for $1M on the mixed laydown: 9 rounds in 15 waves, and a second radar in its place lasts about two waves longer. Its launcher price is a placeholder
- [ ] Many bearing-only sensors can hand one drone's classification to another's track: with twelve acoustic stations, 5 of the Coyote's 29 tasks were on quadcopters whose tracks said fixed wing
- [ ] Most runs end when the one radar is destroyed, as nothing else sees fixed-wing drones far out: the mixed laydown lost its radar in wave 14 and fell in wave 15. Systems cannot be repaired

**Feature C: unit panel** (build this first)

- [x] C1: click a sensor or effector on the map to see its details, read-only
- [x] C2: every system shows its magazine, rounds fired, storage, reload, cost per round and range. Sensors and jammers show their own figures instead of rounds

**Feature D: wizard** (the guided steps, zone and debrief are built)

- [ ] Tuning one unit from the wizard, as in wireframe frame 7b. Kept as a to-do by choice: A3 is built, so nothing blocks it.
- [x] Setting the site's location on the start card: click a map, use this laptop's location, or type a BNG grid reference, decimal latitude and longitude, or eastings and northings.
- [x] Choosing the site without the wizard, or with the guide's first part on the start card, with what is on this computer highlighted on the map and what a build would download listed.
- [x] Real maps of Estonia, starting with Tapa. See "Estonia" in `docs/REAL_MAPPING_PLAN.md`.
- [ ] Narva. Estonian data stops at the border, so about half of a world around the city counts as water. Test Copernicus 30 m heights for the Russian side.
- [x] Place names on Estonian maps, from the agency's settlement units, as ETAK has none. A pack built before this has none: rebuild it.
- [ ] Real maps of other countries. Each needs its own open data and grid, as Estonia did. A spot elsewhere is refused.
- [ ] Typing the site's location as MGRS. Not in the mapping plan, and not small: it needs the lettering of MGRS squares and a UTM conversion that the code does not have.
- [ ] The Ask box, for typing your own questions. Not built, and the one part still to decide: it needs a language model, so it would go through FastAPI, off by default and blocked on real-site worlds.

**Later: named real systems**

- [x] Real systems listed by name when you pick a kind in the toolbar, with settings for the next one placed
- [x] UK systems added: Blighter A400, Saab Giraffe 1X, AUDS jammer, Rapid Ranger, Stormer HVM, Terrahawk Paladin, Sky Sabre, RapidDestroyer
- [x] Ranges checked against datasheets and sources, with each assessment stated, and open-field range separated from predicted range at a spot
- [x] One terrain path model for radar, RF and jamming, with rings, a polar plot and a path profile ([ADR 0003](adr/0003-range-from-a-terrain-path-model.md))
- [ ] More real systems, such as Giraffe AMB and Aveillant Gamekeeper, and replacing the two generic entries. A row for guns and one for RF weapons, which sit under Missile and Laser for now
- [x] Hit chance for guided rounds, by weapon, evasion, target speed, range and track quality. Launchers shoot, look and shoot while there is time, salvo when there is not, and move to the next target while rounds fly
- [x] A beam's damage falls with distance, and sensor error grows as the signal weakens
- [ ] Better figures for hit chance. NASAMS (94%, Norwegian Air Force) and the Paladin (Gepard crews' one burst a Shahed) are set to published figures, and the Sting's three rounds a Shahed matches what is reported. Systems with no published rate take their class's, 2 points lower: 0.98 for the Coyote, Frankenburg, Rapid Ranger, Starstreak and Sky Sabre, below NASAMS, and 0.88 for Merops, below the Sting. Replace those with real rates if any are published. Lasers have none either
- [ ] Jamming strength that falls with distance: inside its reach a jammer works fully, then stops. The drone's distance from its operator sets that reach since A6 part 2
- [x] Use the bands a detector listens on, and work out each jammed link on its own band (A6 part 1)
- [x] A radar that classifies by micro-Doppler: standard on the IRIS and A400, and a paid option on the others
- [x] Geran-3 jet, ASN-301 anti-radar drone and Wing Loong II added to the real drones
- [x] Waves send any ticked mix of drone types, saved with the laydown
- [x] Interceptor drones may take fixed-wing drones, as the Sting is built to, with hit chance falling for faster targets. The small net carrier still only takes small, slow drones
- [ ] Wave sizes were set for cheap first-person-view drones. When a mix has none, the same number of Shaheds take their place, which may be too many
- [ ] Check the path model offline against NTIA ITM, and against any real measurements
- [x] Rain and haze for lasers and cameras (A5)
- [ ] Ground reflection lobes for radar

**Real drones**

- [x] Letting the waves send real drones. The Attack button picks any mix of types, real drones included, and it saves with the laydown.
- [ ] Spelling out the systems' own short names (RDR, RFS, EO/IR, RF) as the threat names now are. They appear on the map, in the node list and in logs.
- [x] More commercial drones reported with Russian forces: DJI Mavic 3T and Mavic 3 Pro, Autel EVO II Dual 640T, a DJI Mini 4 Pro as a reconnaissance spotter, and 10-inch and 13-inch first-person-view classes. The Agras T50 was left out: no report names it with either side
- [x] Realistic heights, speeds and agility. Shahed-type drones fly low (50 to 300 m) or high (2 to 4 km), as Ukrainian officials report, and fixed-wing strike drones hold their height, then dive at 45°; multirotors still ease down over their run. Other heights are reported or set from their ceiling and role, and labelled. Agility is set by a stated rule, from airframe and who flies it. The four generic types keep their figures
- [ ] Heights for most military drones are set by role, as only the Shahed family, Gerbera, Orlan-10 and CH-901 have reported operating heights. Lancet's 500 to 800 m rests on an unverified summary
- [x] A 3D model for every drone type, built in code from its published span and the outline in press photos (`frontend/src/render/drone-models.js`), drawn bigger the bigger the drone, and saved as .glb files by `npm run models`. Open-licence models exist for about nine of the types on Sketchfab (CC BY), but each needs a sign-in to download and most are 25,000 to 900,000 triangles, so none was used
- [x] A 3D model for every system, after its real product: what it stands on (a tripod if carried, a truck if on a vehicle, else a mast whose drawn height grows with its real one) and a head that turns: a camera where it looks, fixed radar panels the way they face (one panel each), a weapon where it aims, and only a radar that turns all round spins
- [x] True size close up. Systems and drones had been drawn 10 to 140 times larger than life at every zoom (a 25 m radar mast stood 164 m tall, a Shahed spanned 346 m). Now they are true size when the camera is close, keep a steady share of the screen farther out (5% of its height for a system, 6% for a Shahed), and are no bigger than before zoomed right out. Masts are their real height close up. The camera comes to 5 m and zooms towards the cursor, so it can close in on a drone in the air
- [x] Missiles and interceptors leave from their launcher's real height (about 3.5 to 6 m) instead of the drawn one (about 80 m). Over 12 seeds the waves survived did not move beyond the noise
- [x] People are civilians or soldiers, chosen when placing a group and kept in a saved laydown; soldiers wear MultiCam with helmet, body armour, daysack and rifle, and a patrol walks as soldiers. It changes only the drawing. The K-CEMA NEO is drawn as a soldier carrying it in a bergen
- [ ] Trees, pylons and houses on generated ground are still drawn twice life size (`TERRAIN.visualScale`), so close up they dwarf the true-size people and systems
- [ ] The DroneGun and the Wingman are carried by a soldier in reality, but are drawn on tripods
- [x] Patrol vehicles: a column of 1 to 6, each a Patria 6x6, a Toyota Hilux or a Mule UGV (THeMIS class), carrying a sensor, jammer, missile, gun or interceptor it can take (light, medium or heavy), at a gap ahead of or behind the soldiers. Chosen in the Area panel and saved with the laydown. A 12.7 mm heavy machine gun on a remote weapon station is new, its performance assumed
- [x] Casualties are killed or injured. Each drone carries its reported warhead, and its lethal and injury radii grow with the cube root of it (9 and 25 m per cube-root kg, anchored on the M67 grenade). The HUD and the debrief count both
- [ ] The vehicles are not priced and drive at walking pace with the soldiers; sensors on them are assumed to work on the move
- [ ] The casualty radii are anchored on one small munition; bigger warheads are likely more lethal than K x cube root gives. A second published anchor (a mortar or shell with its fill and radii) would firm them up
- [x] A Gun row of its own (key 0): a crewed L7A2 GPMG and L111A1 .50 cal on pickups, the 12.7 mm remote weapon station, Terrahawk Paladin, Skyranger 30, Gepard and Skynex. Guns with a radar of their own are networked; the hit chances of the crewed machine guns (8% and 12% a burst) are well below the networked guns'
- [x] Handheld jammers carried by a soldier, off the network: DroneShield DroneGun Mk4, NT Service EDM4S SkyWiper and Kvertus AD G-6
- [x] Crews off the network (`networked: false`): they cannot be wired and nothing tasks them. They see a drone by eye 100 to 200 m off by its size (half that at night), and a wearable detector warns them of a drone with a radio link within 400 m, so they are ready when it comes into sight and a jammer can be pointed down its bearing
- [x] A handheld jammer's beam (30°, published for the Kvertus, assumed for the rest) points at the drone its soldier is jamming. The DroneGun Tactical and MkIII are handheld crew entries of their own; the standard small and medium jammers are now generic networked tripod jammers with the same figures, so saved laydowns and results do not move
- [ ] Every gun's hit chance, range and price is an assumption; the crews' sight, detector range and reaction time are assumptions too
- [x] Fast rounds passed through their targets: a GPMG round flies about 42 m a step against a 2 m fuze, so it never burst, and the .50 cal hit about a third as often as its figure. Rounds now burst where their path came closest, and gun rounds leave the muzzle aimed at the target rather than climbing like a missile. The reference digests did not move

**From the figures audit (2026-11-07)**

- [ ] Ammunition: 8 of the 17 systems that fire rounds take their magazine from a published figure; storage is published for Starstreak only, and reload time for the DroneHunter only. The Sting's magazine, storage and reload, which decide play more than any other, are all assumed
- [ ] Hit chance: 5 of 17 rest on a reported figure (NASAMS, Sting, DroneHunter, P1-SUN, Gepard). The Paladin's 1.0 and the Gepard's 0.4 come from the same Gepard crew reports, which needs a look, and the Paladin's 300 m/s round is about a quarter of the other 30 to 35 mm guns
- [ ] No effector has a ceiling or a minimum range: reach is a sphere round the system. Starstreak's published 300 m minimum is ignored, and interceptor drones can climb to a Geran at 2 to 4 km
- [ ] Starstreak, NASAMS, Rapid Ranger and Sky Sabre are capped at 400 m/s, well below the real missiles. Guns now fly at 840 to 1,175 m/s and hit, so the reason for the cap needs checking
- [ ] The P1-SUN flies at 80 m/s, copied from the Sting, though its own source gives 310 km/h (about 86 m/s)
- [ ] Heights are reported for only about 7 of 30 real drones, and warheads are assumed or unverified for the Matrice 30T, Matrice 300, EVO Max 4T, Agras T30, ASN-301 and Skywalker. No range is published for the AUDS jammer or the K-CEMA Jupiter
- [ ] The Skywalker is drawn at 0.35 m, its type's size, as its own span is not public; a Skywalker X8 is 2.1 m. Lancet-3's 1 m span is assumed and its length taken as 1.65 times that

**Patrol prototype** (see `docs/PATROL_MODE.md`)

- [x] A first playable slice: people walk a looped route with a radar and a launcher, and strike drones attack the patrol
- [x] Routes, people and systems may go anywhere on the map, and an area and a patrol refuse each other
- [ ] What the slice leaves out, listed under "Left out of the slice" in `docs/PATROL_MODE.md`: a spotter's fix that goes stale, choosing the escort, sensing penalties on the move, routes along roads, winning by laps, escort positions in replays, and a hotkey
- [ ] The wizard's "Show me a good spot" still searches round the station when you protect a patrol. It follows a drawn area, but not a patrol

**Real-world mapping** (see `docs/REAL_MAPPING_PLAN.md`)

- [x] M0 to M4, and the map building and live layer from M5
- [ ] Model site, live OS map and place search (these need an OS API key), Wales and Scotland lidar, sharper aerial photos, and a test on a dense city
- [ ] Read coordinate limits from the world. The backend still checks against the fixed `WORLD_LIMIT` in `backend/app/schemas.py`, one of the mapping plan's small asks of the rebuild, and it matters once real worlds differ in size.

**Accounts and deployment packs** (Feature E)

- [x] Login page with sign-in, sign-up and recovery-code reset, a profile hub, and deployment packs dragged from a tray in the game
- [x] The toolbar's S, M and L buttons replaced by each kind's list of real systems, dragged or clicked onto the map, with the wizard's numbered steps
- [x] Place a pack's vehicles on the map: parked with one of the pack's systems on board, and as the patrol's column, which a pack with vehicles limits to its own. One vehicle list, `PATROL_VEHICLES`
- [x] Delete an account, with its password. Its sessions and packs go with it; shared saves stay
- [x] Keep the deployed pack across a page reload. Its id is kept in the browser with the owner's username, so only they get it back
- [x] Sign out without a page reload, so a half-built laydown is not lost. The game stays for whoever signs in next; the last account's pack and tray are cleared
- [x] A run whose save is refused while signed out says to sign in again, not that the server is down
- [x] An end-of-deployment report, for a fixed site and a patrol: how it ended, drones launched, intercepted and through, what shot down what, rounds, missiles and beam fired and time spent jamming, the cost, systems lost and casualties. An End deployment button ends a run by choice
- [x] With a pack deployed, the budget is no limit and only counts the cost, so the pack and magazines are the limits. The HUD hides the budget and site integrity then, apart from in the sandbox
- [x] A deployed pack is all that can be placed: each toolbar row lists only the pack's systems of its kind, with how many are left, a hotkey opens that list rather than picking a system, and placing beyond the pack is refused
- [x] Each system line in a pack holds the settings its systems are placed with (the Unit panel's fields), and a pack can be edited from inside the game with Edit this pack, which goes back to the game
- [x] Large systems (size L, such as NASAMS, Skynex and Gepard) reload from storage only once the wave is over; small and medium ones, such as a GPMG, reload as they fight. Alex chose this over a reserve of rounds per pack
- [ ] With a pack deployed, resupply between waves still refills every launcher in full
- [ ] A loaded saved laydown and the patrol column's systems are not checked against the pack's kit
- [x] The wizard plans with the deployed pack: its sensor step lists only the kinds the pack holds, with the pack's own system, and its effector step suggests only what is left in the pack. Each step is done once nothing left in the pack would help
- [x] Map controls suit a trackpad: drag pans over the ground, right-drag or Shift, Ctrl or Cmd with a drag turns the view, and a pinch zooms four times faster per step than a wheel notch (`WHEEL_ZOOM` and `PINCH_ZOOM` in `render/game-view.js`, tuned by hand)
- [x] Transmit power is set in watts, from a tenth of each radar's or jammer's rated RF output up to it (`config/tx-power.js`). 7 of the 15 real systems publish an output, 3 more come from secondary sources, and the rest are labelled assumptions, said so beside the setting. A power saved as a percentage loads as that share of the rated watts
- [ ] Rated outputs to confirm: EchoGuard (2 W), Giraffe 1X (150 W) and Spexer 2000 3D (100 W) are worked out from their power draw, and the DroneGun Mk4, MkIII and Tactical publish none. The IRIS may be 2 x 12 W
- [x] Strike drones attacking a drawn area go for what is in it: one of your systems, a group of people or a building, by kind first (45%, 30% and 25% of strikes among the kinds there, an assumption) and then one of that kind. A spot at random only if the area holds none. A strike on a system damages it; one on people or a building lands there. Drones homing on radio still go for the loudest emitter, and a station without a drawn area is still the target
- [x] A ground view: View from here, in a system's panel, puts the camera at the top of its mast during a wave, turning to the drone it engages or the nearest one your sensors have, with drones and rounds drawn at a size you can see whatever their distance. A drag looks round; Esc or Back to the map returns (`render/eye-view.js`)
- [ ] Strikes in station mode (no drawn area) still all go for the station; the same choice of systems, people and buildings round it would be a balance change
- [x] Ground clutter hides a low flyer from radar only when it moves slower than 5 m/s (`SENSING.clutterSpeed`, an assumption): drone radars are Doppler radars, and line of sight already hides a drone behind trees and hills. Before, every drone below 30 to 40 m was lost beyond 300 to 800 m, which counted the same low flight twice: a fibre-optic drone was seen over 3 to 5% of a radar's area on test ground, and is now seen over 49 to 57%. Reference runs moved (mixed seed 1: 67 kills and no leaks, against 56 and 2) and `GAME_VERSION` is 0.16.0
- [x] Long ranges can be seen at their true size: rings are drawn outside the distance fog, the camera zooms out to 60 km (it stopped at 24 km), the haze starts beyond what the camera looks at, and the Plan tab zooms out to 30 km. A NASAMS or Sky Sabre's full 25 km ring shows round the 14 km map; its range is unchanged
- [x] The coverage map on its own: three colours (not seen, one sensor, two or more) with small markers and a key, and the share of the area seen. Unticking it shows the full plan with ranges, links and tracks
- [x] The start screen has a Deployment pack choice after where to defend: one of your packs, deployed at once, or none to buy systems on a budget, with a link to build or edit packs (`ui/account/PackPicker.jsx`)
- [x] The HUD shows kills, leaks, people killed and injured, and ammunition (rounds left of all carried, and how many are loaded), with the spend below in smaller, quieter text. Site integrity and the budget bar show only in the sandbox
- [x] The K-CEMA Jupiter is rated at up to 600 W (Alex; one trade report gives 450 W), so by the same square-root rule as the other jammers it reaches 3.9 km, against 1.1 km for the NEO
- [x] The game's page is sent with `Cache-Control: no-cache`, so a browser checks for a new build each time it loads (`security.py`)
- [x] Range rings: a selected system's ring is its bright line-of-sight ring again, not a faint white copy, and rings on generated ground are stronger (55% against 35%) and thicker

## Known limits to fix if they start to matter

- [ ] **A test that sometimes fails.** `save-panels.test.jsx`, "shows kept runs and saves them when the server is back", failed in about 1 of 4 runs on a busy machine: it checks for the error message before the list has finished reloading.
- [ ] **The wizard on a small window.** Below about 1,380 px wide, the popup covers the left edge of the SAPIENT panel. It can be moved or collapsed. See `#wizard` in `frontend/src/style.css`.
- [ ] **Automated browser test.** The frame loop and page-load code in `frontend/src/game.js` and most of `frontend/src/render` need WebGL, so they are only checked by hand.
- [ ] **Duplicate saved runs.** A run can be saved twice if the page closes or the connection drops just after the server stored it, or if two tabs retry together. Fix: send an id the server deduplicates on. See `frontend/src/api/run-saver.js`.
- [ ] **Back/forward cache.** A page restored this way keeps playing a run that was already recorded when it closed. See `frontend/src/game.js`.
- [ ] **One simulation at a time.** The bus, clock, terrain and random streams are module-level singletons. Pass them in if parallel runs are needed. See `frontend/src/sim/simulation.js`.
- [ ] **Stored figure keys.** The backend accepts keys such as `constructor`. They are harmless there, and the frontend ignores them on import. Reject them at the API if the backend ever uses them.

## Only if this is ever hosted

- [ ] Work through "Before hosting" in `docs/SECURITY_NOTES.md`: ownership of shared saves, rate limits, HTTPS and `Secure` cookies, a move off SQLite and a new security review.
