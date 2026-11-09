# Glossary

Terms and abbreviations used in the game and in these documents, in alphabetical order. Each entry says what the word means here; where the game uses a term in a narrower sense than the real world does, the entry says so.

| Term | Meaning |
|---|---|
| Acoustic sensor | A passive sensor that hears a drone's motors and propellers. Short range. See [SENSORS.md](SENSORS.md). |
| Area to defend | An area the player draws, which becomes the site the enemy attacks. Once drawn, systems can stand anywhere on the map. |
| Association | Deciding which existing track a new detection belongs to, or that it starts a new one. See [FUSION_AND_TARGETING.md](FUSION_AND_TARGETING.md). |
| Auto-wire | The button that links every unwired system to the fusion node by the best available bearer. |
| Bearer | The communications link a node uses: Starlink or cellular in this game. |
| BNG | British National Grid: the Ordnance Survey's grid of eastings and northings in metres, used for British maps and grid references. See [MAPS.md](MAPS.md). |
| BSI Flex 335 | The British Standards Institution's publication of the SAPIENT interface. The game follows version 2.0. See [SAPIENT.md](SAPIENT.md). |
| C2 | Command and control: the operator, or the part of the system that gives orders and approves engagements. |
| C-UAS | Counter-uncrewed aircraft systems: the sensors, effectors and procedures used against drones. |
| Clutter | Radar returns from the ground, trees and buildings that hide a low, slow target. The game models it as a low-flyer limit per radar. See [PHYSICS_AND_PROPAGATION.md](PHYSICS_AND_PROPAGATION.md). |
| Coasting | A confirmed track that has stopped receiving updates and is being predicted forward until it is updated again or dropped. |
| Confirmed track | A track that has had enough detections to be believed. Only confirmed tracks are engaged. |
| Copernicus DEM | The European Space Agency's global surface height model, used for ground just beyond Estonia's border. |
| Cost exchange | What the defence spent set against what the attack cost the enemy. Shown on the Cost tab. |
| Deployment pack | A military unit (fireteam to battalion) with a callsign and its assigned systems, vehicles and people, deployed as a tray of kit to place. Belongs to one account. |
| Detection | One sensor's report that something is at a place or bearing, with its uncertainty. Many detections make one track. |
| Digest | A short hash of a whole run's results. The reference digests pin the simulation's behaviour, so any unintended change shows up in tests. See [DEVELOPING.md](DEVELOPING.md). |
| Direction finding (DF) | Measuring the bearing to a radio transmitter. RF detectors do this without measuring range; two bearings that cross give a position. |
| DTM, DSM, nDSM | Digital terrain model (bare ground), digital surface model (ground plus trees and buildings), and normalised DSM (only the height of things above the ground). |
| Effector | Anything that acts on a drone: a jammer, interceptor, missile, gun or laser. See [EFFECTORS.md](EFFECTORS.md). |
| EHAK | Estonia's register of administrative and settlement units, used for place names on Estonian maps. |
| Engagement authority | The rule for whether the fusion node fires by itself, asks first for costly shots, or asks for every engagement. |
| EO/IR | Electro-optical and infrared: a daylight and thermal camera, here cued by other sensors to look at a track. |
| ETAK | The Estonian topographic database: buildings, land cover, transport, water and utilities. |
| False alarm | A detection of something that is not a drone. Sensors have a false alarm rate. |
| Fibre-optic drone | A drone controlled through a thin optical fibre it unspools behind it. It emits no radio, so RF detectors cannot hear it and jammers cannot affect it. |
| Figure set | A named, saved set of edits to the game's figures, made on the Sources tab. Can be exported and imported. |
| Fixed-wing | A drone with wings rather than rotors: faster and longer-ranged than a quadcopter. |
| FO | In this game's code and legend, fibre-optic: the fibre-optic strike drone type (`fo` in [`drones.js`](../frontend/src/sim/config/drones.js)). Not forward observer, which the game calls a spotter. |
| FPV | First-person view: a small strike drone flown through its own camera's video link. |
| Fusion node | The SAPIENT node that combines every sensor's detections into tracks, classifies them, and tasks cameras and effectors. |
| Generated ground | A world made from a terrain seed, with invented hills, woods and buildings. |
| GeoNames | A free gazetteer of place names, used for names across the Russian border near Narva. |
| GNSS | Global navigation satellite systems, such as GPS. Some jammers deny it. |
| Ghost track | A track with no real drone behind it, built from false alarms or a wrong bearing crossing. |
| Grid reference | A position written on a national grid, such as `SU 220 660`, or on MGRS. |
| ICD | Interface control document: the formal description of messages between systems. SAPIENT's ICD is BSI Flex 335. |
| Interceptor | A drone launched to hit another drone. |
| Jammer | An effector that transmits radio noise to break a drone's control, video or navigation links. |
| Kalman filter | A method that keeps a best estimate of a track's position and velocity, and its uncertainty, updated from noisy measurements. |
| L-EST97 | The Estonian national grid of eastings and northings in metres. |
| Laydown | The set of systems placed for a run, with their settings, the area defended, the attack mix and any people. Can be saved. |
| Leak | A drone that reaches its target. |
| Lidar | Laser-scanned heights. Gives true tree and building heights. In Great Britain the game has it for England only; in Estonia, everywhere. |
| Magazine | The rounds or interceptors an effector holds before it needs a reload or resupply. |
| Map pack | A `.sgmap` file holding a real area's heights, trees, buildings, ground cover, features and map pictures. See [MAPS.md](MAPS.md). |
| Mast | The height a sensor or jammer stands at. Higher masts see further over terrain and trees. |
| MGRS | The Military Grid Reference System, which covers the world. Offered on every real map. |
| Node | Any system on the SAPIENT network: a sensor, an effector or the fusion node. |
| OS Terrain 50 | Ordnance Survey's open height model of Great Britain, on a 50 m grid. |
| OS OpenMap Local, VectorMap District | Ordnance Survey's open map data, used for features and the OS map picture. |
| Patrol mode | Defending soldiers walking a route instead of a fixed site. See [PATROL_MODE.md](PATROL_MODE.md). |
| RCS | Radar cross-section: how large a target looks to a radar, in square metres. Small drones have very small values. |
| Reference runs | Fixed scenarios in `frontend/tests/support` whose digests every change is checked against. |
| RF | Radio frequency. |
| RF detector | A passive sensor that hears a drone's radio and measures its bearing. |
| Sandbox | A risk-free mode for launching any attack against the laydown, with free shots and no damage to the site. |
| SAPIENT | A UK interface standard that lets sensors, effectors and a fusion node from different makers work together. See [SAPIENT.md](SAPIENT.md). |
| Scenario seed, terrain seed | The two numbers that fix a run's random events and its generated ground. The same seeds and laydown give the same run. |
| Sensor | Anything that detects drones: radar, RF detector, EO/IR camera or acoustic sensor. See [SENSORS.md](SENSORS.md). |
| Spotter | A drone that finds and watches the target for strike drones. |
| Tentative track | A new track that has not yet had enough detections to be confirmed. |
| Track | The fusion node's belief about one drone: where it is, how it moves, what it is, and how sure it is. |
| Truth overlay | A view that shows where drones really are beside where the fusion node believes they are. |
| Wave | One attack. Waves grow harder as the run goes on. See [DRONES.md](DRONES.md). |
| WGS84 | The worldwide latitude and longitude system used by GPS. |
