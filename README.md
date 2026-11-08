# Site Guard

A counter-drone defence game and command-and-control simulator. You place and network sensors and weapons around a power station on a fixed $15M budget, then watch a fusion node detect, track and engage inbound drones using SAPIENT (BSI Flex 335 v2.0) messages. The heart of it is the gap between where drones really are and where your system believes they are.

![Wave 5 in progress: drones approach the site while the fusion node tracks them and tasks interceptors](docs/screenshots/wave.jpg)

## Tech stack

| Layer | Technology | What it does here |
|---|---|---|
| Simulation | JavaScript (ES modules), no dependencies | Game rules, sensor models, Kalman filter tracking and SAPIENT messages. Runs in the browser or in Node |
| 3D view | [Three.js](https://threejs.org) 0.160 | Terrain, systems, drones, tracks and range rings |
| Interface | [React](https://react.dev) 19 | HUD, toolbar and the SAPIENT dock, with canvas diagrams inside it |
| Build | [Vite](https://vite.dev) 8 | Development server and production bundle |
| Backend | Python 3.12+, [FastAPI](https://fastapi.tiangolo.com), Pydantic, Uvicorn | Stores saved data, validates it and serves the built game |
| Database | SQLite, through Python's `sqlite3` | One local file, with JSON columns for game data |
| Tests | [Vitest](https://vitest.dev), Testing Library, jsdom, pytest, pytest-cov, HTTPX | Simulation, UI and API tests, plus reference runs that pin down behaviour |
| Tooling | npm, [uv](https://docs.astral.sh/uv/) | Pinned dependencies, with lockfiles for both |

## Run it

You need [Node.js](https://nodejs.org) 22.12 or later and [uv](https://docs.astral.sh/uv/). uv installs a suitable Python by itself. Run these from the project folder:

```bash
npm --prefix frontend ci
```

```bash
npm --prefix frontend run build
```

```bash
uv --directory backend run --no-dev python -m app
```

Then open <http://localhost:8200>. The first two commands are only needed once, or again after changing the frontend.

It runs entirely on your machine, works offline, and is only reachable from this computer. The first time, press **Create account** on the login page: see [Accounts and deployment packs](#accounts-and-deployment-packs).

## How it works

Screenshots use scenario seed 7 and terrain seed 3 (`?seed=7&terrain=3`) with the mixed laydown from [`scenarios.js`](frontend/tests/support/scenarios.js).

New to it? Press **Guide me through it** on the start screen. The wizard walks you from an empty site to the first wave: mark the area you are defending, place sensors and effectors, network them, check coverage, rehearse in the sandbox, adjust the figures if you want to, then commit. It works out where you are from the game itself, so you can skip around or close it at any time, and **Open the wizard** brings it back. Drag it by its header if it is in the way. Once a run starts it steps back, with no tips during a wave. When the site falls, a debrief shows what got through and can replay the first leak.

You can mark an area anywhere on the map, and it becomes the site: you can build anywhere, and the attack starts out from it. The area you mark is what the enemy attacks. Strike drones aim for spots inside it instead of the station, spotters circle it, and it saves with the laydown. FPV and FO strikes can still turn on a loud emitter. It must stay within 5 km of the station, and it locks when the first wave starts.

### 1. Build a laydown

Press **Deploy**, then click a kind of system on the left, such as Radar, to open its list of real systems. Drag one onto the map, or click it and then click the ground. Keys 1 to 8 pick a kind's systems in turn. Everything comes out of one budget, including every shot fired, and nothing is earned back. No single system handles every drone.

![Eleven systems placed around the site, with their ranges drawn over the terrain](docs/screenshots/laydown.jpg)

| Key | System | Small | Medium | Large | Per shot | Notes |
|---|---|---|---|---|---|---|
| 1 | Radar | $45k, 1 km | $900k, 3.1 km | $2.5M, 4.3 km | | Range, bearing and velocity. Low flyers hide in ground clutter until close |
| 2 | RF detector | $10k, 2 km | $40k, 3.5 km | $400k, 14 km | | Passive direction finding with no range, on a 9 m mast. Cannot see RF-silent drones |
| 3 | EO/IR camera | $25k, 260 m | $100k, 650 m | $500k, 1.6 km | | Narrow view cued by other sensors, with strong classification |
| 4 | RF jammer | $40k, 500 m | $60k, 1 km | $350k, 3 km | | On only while tracks are in range, on a 9 m mast. Fibre-optic drones ignore it |
| 5 | Interceptor drones | $100k, 3 km | $100k, 25 km | $300k, 15 km | $1,000 to $15,000 | Take any drone but the small net carrier, which only takes small, slow ones. Faster targets are harder to hit |
| 6 | Missile | $100k, 2 km | $1M, 10 km | $5M, 25 km | $45,000 to $1.2M | Can hit fixed-wing drones |
| 7 | Laser | $8M, 2 km | $2M, 3 km | $14M, 10 km | $3.50 to $13 | Needs dwell time, so evasive targets take longer |

These ranges are for an open field, on the standard mast, and sensors are against a small quadcopter. Where you place a system changes what it really gets: the ring on the map follows the predicted range, and the Range side of its panel shows each bearing and the ground in the way ([ADR 0003](docs/adr/0003-range-from-a-terrain-path-model.md)). UK systems such as Rapid Ranger, Stormer HVM, Sky Sabre, Terrahawk Paladin, RapidDestroyer, AUDS and the Blighter A400 are listed with the rest. Pick a row to see the real systems of that kind, such as the Robin Radar IRIS or Blighter A800, and the settings for the next one you place. Press a key again for the next one.

Rounds can miss. The Unit panel gives each weapon's chance against each drone, close in and at its limit, or for a laser the time to burn through. Sensor error grows as the signal weakens, and a poor track lowers a shot's chance. Most hit chances are labelled assumptions, because few are published.

The attack is made of first-person-view (FPV) strike drones ($400), fibre-optic strike drones that fly low and emit no radio ($1,000), fixed-wing strike drones ($35,000) and fixed-wing spotters that make strikes hit harder ($100,000). They get harder to hit and jam each wave.

Press **Attack** in the top right to choose which drones the waves send: tick any mix of the generic types and the real Russian, Iranian, Chinese and commercial drones. Waves keep their size and timing, and the drones you tick take turns in the place of their type. The choice saves with the laydown and locks when the first wave starts.

### 2. Network it

Every system is a SAPIENT node, and an unwired one can't report or be tasked. Open **SAPIENT > Network > Auto-wire**, or wire each one to Starlink or cellular by hand. Links depend on the sky, the terrain, cell towers and your own jammers. Click a system or a wire to see its link and the packets on it, or step through the simulation one packet at a time.

![The Network tab showing each system wired through Starlink or cellular to the fusion node](docs/screenshots/network.jpg)

### 3. Check what it can see

The **Plan** tab maps sensor coverage for a chosen drone. Here, this laydown sees very little of a fibre-optic drone at 18 m, while a spotter at 450 m shows almost entirely covered. **Spectrum** shows where your jamming overlaps your own links.

![Sensor coverage for a low, RF-silent drone, mostly red beyond the immediate site](docs/screenshots/coverage.jpg)

### 4. Rehearse in the sandbox

The **Sandbox** launches any wave's attack, or a custom one, without risk: the site can't be damaged and shots are free. You can still adjust the laydown. Leaving it resets the run and keeps your systems.

![The sandbox launching ten FPV drones from the north-east](docs/screenshots/sandbox.jpg)

### 5. Fight the waves

Press **Start wave**. The laydown locks at this point and the fusion node takes over: it builds tracks from noisy detections, cues cameras and tasks effectors. **Engagement authority** decides whether it fires by itself, or asks you first for costly shots or for every engagement.

With **Truth overlay** on, as in the screenshot at the top, a tag like `First-person-view` marks where a drone really is, and a marker like `T88 · UAV ±52 m` marks where the fusion node believes it is. Tracks can lag, get confused or turn out to be ghosts, and effectors only hit a real drone they find at the cued position.

### 6. Read the messages

The **Messages** tab shows every SAPIENT message between nodes, filterable by node. Tick **Explain** for a plain-English note beside each field, or use **Inject fault** to see how errors are reported. **Learn** walks through the protocol using messages from your own run.

![A fused detection report with a plain-English note on each field](docs/screenshots/messages.jpg)

### 7. Rewind and review

Pause at any moment and scrub back through the run. Markers on the timeline show kills, leaks and other events, and a banner shows the state at that moment.

![A paused replay 6 seconds behind live, with the timeline and its event markers](docs/screenshots/replay.jpg)

### 8. Count the cost

The sandbox can also launch 21 real drones: Russian, Iranian and Chinese types, and commercial drones reported carrying munitions. Tick any mix of them. Their public figures, and how solid each one is, are in the **Sources** tab. The waves still send the four generic types.

The **Cost** tab compares what you spent with what the attack cost the enemy, broken down by system, effector and drone type.

![The Cost tab showing the budget, cost exchange and shots fired per effector](docs/screenshots/cost.jpg)

When the site falls, the run is saved to your history in the **Runs** tab. You can retry the same laydown or start a new one, and laydowns are kept in the **Saved** tab.

![The Site Lost card after 12 full waves](docs/screenshots/gameover.jpg)

### 9. Question the numbers

The **Sources** tab shows the evidence and confidence behind each figure, and every figure can be edited. Changes take effect at once and can be saved as a named set, exported or imported. See [Accuracy](#accuracy).

![The Sources tab with editable figures, each labelled as published, price or game rule](docs/screenshots/sources.jpg)

### Controls

| Keys | |
|---|---|
| 1 to 8, X, Esc | Choose a system, sell, cancel |
| Space | Pause, or play and pause a replay |
| Left, Right | Step back and forward through the timeline |
| R, T, L | Ranges, truth overlay, labels |

Drag the wizard, the Sandbox panel or an approval card out of the way. Double-click to put it back.

The same scenario seed, terrain seed and laydown give the same run. Time between later waves is part of what you did, so it changes the run's noise but not the attack.

## Architecture

The simulation runs in the browser, and the backend only stores and serves. It takes no part in live play, so the game still plays if the backend stops. [ADR 0001](docs/adr/0001-simulation-runs-in-the-browser.md) explains why. Signing in is the exception, as it needs the backend ([ADR 0004](docs/adr/0004-local-accounts-with-recovery-codes.md)).

```mermaid
flowchart LR
  subgraph browser["Browser"]
    ui["ui/<br/>React panels"]
    game["game.js<br/>wiring and frame loop"]
    sim["sim/<br/>rules, SAPIENT network, tracker"]
    render["render/<br/>Three.js view"]
    api["api/<br/>client and run saver"]
    kept[("localStorage<br/>runs kept while offline")]
  end
  subgraph local["FastAPI on 127.0.0.1:8200"]
    routes["routes/<br/>HTTP only"]
    services["services/<br/>rules for saved records"]
    db["db/<br/>SQL and migrations"]
    file[("SQLite file")]
    static["frontend/dist<br/>the built game"]
  end
  ui -- "commands" --> game
  game -- "sim.commands, sim.step" --> sim
  sim -- "state and events" --> ui
  sim -- "state and events" --> render
  game -- "draws each frame" --> render
  game -- "finished runs" --> api
  ui -- "laydowns, figure sets, history" --> api
  api <--> kept
  api -- "JSON over /api/v1" --> routes
  routes --> services --> db --> file
  static -. "page load" .-> browser
```

Three rules hold this together:

- **`sim/` has no DOM and no rendering,** so a full game runs in Node for tests and balance work. A test enforces the boundaries.
- **The view and panels only read simulation state.** Everything that changes the game goes through `sim.commands`, which logs it by simulation step, so a saved run can be reproduced exactly.
- **The simulation moves in fixed steps** of 0.05 game seconds, so results don't depend on frame rate or game speed. Panels refresh about 10 times a second, and the recorder keeps a snapshot every half game second for rewinding.

### Inside the SAPIENT network

The fusion node never gets told which drone a detection came from. It associates noisy measurements with Kalman filter tracks, so it can make mistakes. Messages are shaped like the proto3 JSON form of the official BSI Flex 335 v2.0 files, and each one is delayed or dropped by the communications model on its way.

```mermaid
sequenceDiagram
  participant S as Sensor
  participant F as Fusion node
  participant C as C2 operator
  participant E as Effector
  S->>F: registration
  F-->>S: registration_ack
  E->>F: registration
  F-->>E: registration_ack
  loop Throughout the run
    S->>F: status_report
    E->>F: status_report
    S->>F: detection_report (one sensor's view)
    F->>C: detection_report (the fused track)
  end
  F->>C: alert (new track confirmed)
  C-->>F: alert_ack
  F->>S: task (camera: look at this track)
  S-->>F: task_ack
  opt Engagement authority asks first
    F->>C: alert (engagement request)
    C-->>F: alert_ack (approve or refuse)
  end
  F->>E: task (engage this track)
  E-->>F: task_ack
  F->>C: alert (kill reported, then confirmed)
```

### Where things live

```text
frontend/src/
  sim/        The rules. No DOM, no rendering, so a full game runs in Node.
    config/   Every figure, with its evidence.
    network/  SAPIENT nodes: sensors, fusion, tasking and engagement authority.
    tracker.js  Kalman filter tracks, association and triangulation.
    comms.js    Starlink, cellular and jamming: each message's delay or drop.
    sapient.js  Message envelope, validation and the message bus.
  render/     Three.js. Reads simulation state each frame, and never changes it.
  ui/         React panels, refreshed about 10 times a second.
    assistant/  The wizard: its steps, and what it reads from the game.
    account/    The login page, the profile hub and the deployment pack editor.
  zone.js     The area to defend. Stays out of the simulation.
  patrol-draw.js  Drawing a patrol route, which goes to the simulation once finished.
  api/        The backend client, and keeping runs safe when it is down.
  game.js     Wires the simulation to the view and runs the frame loop.
backend/app/
  routes/     HTTP only.
  services/   The rules for saved records, behind small Protocols.
  db/         All the SQL, and numbered migrations.
  schemas.py  What the API accepts: the trust boundary.
  security.py Headers and request limits for a local service.
```

### API

Everything is under `/api/v1`, with the schema at `/api/v1/openapi.json`.

| Resource | Routes |
|---|---|
| `/health` | `GET` |
| `/auth` | `POST` `/register`, `/sign-in`, `/sign-out`, `/reset`, `/password`, `/recovery-code` and `/delete-account`, and `GET`, `PUT` `/me` |
| `/units` | Deployment packs: `GET`, `POST`, and `GET`, `PUT`, `DELETE` by ID, for the signed-in account only |
| `/laydowns` | `GET`, `POST`, and `GET`, `PUT`, `DELETE` by ID |
| `/runs` | `GET`, `POST`, and `GET`, `DELETE` by ID |
| `/figure-sets` | `GET`, `POST`, and `GET`, `DELETE` by ID |
| `/packs` | `GET` the list, `GET` a pack file by name, `GET` `/packs/downloads` for the OS data already here, and `GET`, `POST` `/packs/build` |

Every route except `/health`, `/auth` and the schema needs a signed-in session. The service binds to this machine only, and refuses other hosts and cross-site writes. See the [security notes](docs/SECURITY_NOTES.md), which also say what would be needed before hosting it.

## Real maps

The start screen opens with a real map ready, if map packs are installed, so you can deploy straight away. To defend somewhere else, use any of three ways, all on the start card: press **Use my location**, move the map and click a spot, or type a position. **Guide me through it** starts by helping with this choice, and nothing needs the guide. The map opens on the world, with what this computer already has marked on it: a blue dot or square for each map pack ready to play (click a dot to go there), green for lidar heights inside them, and dashed orange for 100 km squares of OS data already downloaded. **My maps** zooms to your packs, and **World** zooms back out. Tick boxes under the map turn each of these on and off, and add the offline OS and satellite pictures from the packs. Choose somewhere with no map and the card lists what a build would use from this computer, and what it would download. You can move around the whole world, but real maps only cover Great Britain and Estonia so far, so a spot elsewhere is refused. Buttons above the map switch between street, light, dark, satellite and hybrid styles, or **No live map**. Satellite and hybrid come from EOxCloudless, which is free for non-commercial use only (CC BY-NC-SA 4.0), at 10 m per pixel. Positions can be a grid reference, decimal latitude and longitude (51.39, -1.68), or eastings and northings (422000 166000). Most laptops have no GPS chip and estimate from Wi-Fi, so the app shows how good the position is. If there is no map there yet, the app offers to build one.

In the game, the buttons beside the minimap open the map switcher, centre on your location, centre on the site, draw the area to defend, and change between 3D and plan view. The switcher shows a preview of each map: OS, light, dark, satellite, hybrid, topographic, shaded relief and live OpenStreetMap. M moves to the next one. The topographic map uses the world's own heights, with height colours, hill shading and labelled contours. Contours (C), roads and names, and the national grid (G) can be added to any map. If your location is outside the current world, **Open a map here** goes back to the start screen on that spot, and **Change world** switches between generated ground and real maps. A typed grid reference moves there, or places the system you have picked.

To share a map, choose it on the start screen and press **Export** to save it as a `.sgmap` file. Anyone else presses **Import** and picks that file. It is checked in full, kept in their browser, and needs no further downloads.

Maps live in `~/site-guard-maps` (set `SITE_GUARD_MAPS` to move them), which holds the OS downloads and the finished packs. To build one by hand:

```bash
uv --directory tools/mapbuild run python -m mapbuild --centre "SU 22 66" --name "Savernake" --data ~/site-guard-maps/os --out ~/site-guard-maps/packs/savernake.sgmap --fetch
uv --directory tools/mapbuild run python -m mapbuild --centre 611700,6570700 --name "Tapa" --data ~/site-guard-maps/estonia --out ~/site-guard-maps/packs/tapa.sgmap --fetch --lidar-km 30
```

Real ground plays differently from generated ground. In Great Britain, lidar covers England only, and elsewhere the ground uses OS Terrain 50 with assumed tree and building heights. In Estonia, lidar covers the whole country, and a position can also be typed as eastings and northings on the Estonian grid (611700 6570700). Estonian data stops at the national border, so at Narva about half of a world around the city counts as water. Estonian maps download 6.8 GB of national files the first time, and come from the [Land and Spatial Development Board](https://geoportaal.maaruum.ee/opendata-licence). British map data is under the Open Government Licence, satellite pictures contain modified Copernicus Sentinel data, and live tiles are © OpenStreetMap contributors.

## Accounts and deployment packs

The game opens on a login page. **Create account** asks for your name, a username and a password of at least 10 characters, then shows a recovery code once. Save it: there is no email, so the code is the only way to reset a forgotten password, and each reset gives a new one. Five wrong tries lock the account for 5 minutes. **Keep me signed in** lasts 30 days, otherwise a session lasts 12 hours. If it runs out during a game, the login page comes back over the game, paused, and signing in again carries on where you were.

Signing in opens your profile, where you can change your name, rank and organisation, your password or your recovery code. The badge at the bottom left of the game brings it back, and pauses a wave in progress.

A deployment pack is a military unit, from a fireteam to a battalion, with a callsign and the real sensors, effectors, vehicles and groups of people assigned to it. Press **Deploy** on a pack and the game lists its kit in a tray at the top of the toolbar, with how many of each are left to place. Drag each onto the map. A pack's systems come out of the same budget as any other. A vehicle is placed with one of the pack's systems on board, chosen in the tray, and stands it at the vehicle's mast height. With a pack deployed, a patrol's column takes only the pack's vehicles, as many as it has less any parked.

Packs belong to your profile. Laydowns, runs and figure sets are shared by every account on this computer.

## Saved data

Laydowns, run history, figure sets, accounts and deployment packs are in `backend/data/siteguard.db`, a single SQLite file that git ignores. To back it up or move it, copy that file while the game is closed. Set `SITE_GUARD_DB` to keep it somewhere else.

Signing in needs the server. If it stops during a game, the game still plays, panels say so, and a finished run is kept in the browser and saved when the server returns.

## Developing

Run these in two terminals. The game is at <http://localhost:5199>, reloads as you edit, and sends sign-in and saves through to the backend:

```bash
uv --directory backend run --no-dev python -m app
```

```bash
npm --prefix frontend run dev
```

| Task | Command |
|---|---|
| Frontend tests | `npm --prefix frontend test` |
| Frontend coverage | `npm --prefix frontend run coverage` |
| Backend tests and coverage | `uv --directory backend run pytest` |
| How far each laydown gets | `npm --prefix frontend run balance` |

### Changing behaviour on purpose

Five reference runs in `frontend/tests/support/` pin down the simulation's behaviour exactly. If a change is meant to alter results, re-record them and say why in the commit:

```bash
cd frontend
node tests/support/print-digests.js > tests/support/reference-digests.json
```

Raise `GAME_VERSION` in `frontend/src/sim/config/world.js` at the same time, so old saves warn that they may not play the same. If a saved record changes shape, also run `node tests/support/write-fixtures.js`, because both test suites check those files. A database change needs a new numbered file in `backend/app/db/migrations/`.

### More

- [To do](docs/TODO.md)
- [Implementation plan](docs/MASTER_IMPLEMENTATION_PLAN.md)
- [Development story](docs/DEVELOPMENT_STORY.md)
- [Security notes](docs/SECURITY_NOTES.md)
- [Decision records](docs/adr/)

## Accuracy

The figures are drawn from public sources, mostly vendor claims and press reports, and many are labelled assumptions. The **Sources** tab shows the evidence and confidence for each one, and lets you change it. This is a game and a teaching tool, not a model to base real decisions on.

## Patrol mode

Instead of a site, protect soldiers on patrol. In the Area to defend panel, press **Draw a patrol route**, click waypoints from the start, and double-click at the end. Set how wide the corridor is, the soldiers' formation (single file, staggered column or wedge), and the vehicles that escort them, each ahead, behind or to one side. Systems from the toolbar stand anywhere inside the corridor and stay put.

From the first wave the patrol walks to the end, waits a minute, and walks back, then holds at the start until the next wave. Weapons in the column halt it to fire. Strikes do not know where it is: spotters must search the corridor and keep it in sight, and strikes head for the last fix they passed, shown as a red ring. Jam or shoot down the spotter, or walk into woods, and they strike where the patrol was. Every speed, spacing and search figure is a labelled assumption in the Sources tab. The design and what is left out are in [docs/PATROL_MODE.md](docs/PATROL_MODE.md).

## Simulated people

The **People** tool (key **9**) places groups of simulated people to see what an attack would do to them. Choose how many (1 to 500, up to 50 groups) and their protection: unarmoured, in a building (click on a building, and on a real map they stand inside its true outline) or in a bunker (drawn as a low concrete block). They cost nothing, and they lock with the laydown when the first wave starts. The wizard has the same choices in its optional step 6, "Who is on site?".

People are drawn to true scale, so they are too small to see from far away: each group has a name tag, and **Look** in the People panel flies the camera down to them. A blast can make anyone near it a casualty: likelier the closer they are and the less protected. Blasts come from a strike on the site, a strike on a system, and a drone destroyed in flight, where its height shelters those below. Casualties drop to the ground in the view, and appear in the HUD, on the timeline and in the end-of-run summary. They also count in the sandbox, and come back on leaving it.

People are not targets and never change the attack: their rolls come from a random stream of their own, so a run plays out the same with or without them. **Every casualty figure is a round-number assumption, not real casualty or weapons-effects data.** They are all labelled so in the Sources tab, where you can change them. A laydown's people are saved with it.
