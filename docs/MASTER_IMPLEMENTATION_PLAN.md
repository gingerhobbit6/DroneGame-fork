# Site Guard: client-server re-engineering plan

Status: approved 2026-11-04. Work happens on `refactor/client-server`, branched from `main`.

## Goal

Move Site Guard from static files to a React frontend, a FastAPI backend and a SQLite database, with no loss of existing features and a structure that follows SOLID.

## Decisions already made

| Decision | Choice | Reason |
|---|---|---|
| Where the simulation runs | In the browser | Same performance and offline use. A server simulation only pays for itself with multiplayer, real hardware or tamper-proof scores. |
| What the backend does | Stores and serves saved data, and serves the built frontend | It takes no part in live play |
| Engineering rules | SOLID and Ponytail (see below) | Requested |

## How SOLID and Ponytail work together

Ponytail asks for the smallest complete change and no unrequested abstractions. It also says never to cut anything the user asked for, and SOLID was asked for. So SOLID applies wherever it separates things that really do change for different reasons.

**The test for a new seam:** add one only if it has two real implementations today, or a test needs it, or it separates two reasons to change that already exist in the code. Otherwise leave it out and record any known limit in a comment: `shortcut: <the limit>, <when to upgrade>`.

| Principle | Where it applies | Where it does not |
|---|---|---|
| **S**ingle responsibility | Split `main.js` into simulation rules, Three.js rendering and React UI. Split `network.js` by job. Routes, services and SQL stay in separate files. | No one-function files, and no splitting of code that always changes together |
| **O**pen/closed | Effector behaviour moves to a table keyed by `def.fire`. Today only `guided` exists, so the laser gains `beam` and the jammer gains `jam`, replacing the `def.id === 'laser'` and `def.id === 'jammer'` branches. Drone movement is keyed by role. Dock tabs come from a list. | No plugin system. Adding a system still means editing the data files. |
| **L**iskov substitution | Every effector honours one contract: `act(system, target, dt)`. Every sensor honours one detection contract. Every store honours its Protocol. | No class hierarchies. Plain functions and objects are enough. |
| **I**nterface segregation | The simulation exposes three small surfaces: `commands`, `snapshot()` and `on(event)`. Each React component reads only its own hook, replacing the 10-argument `initDock`. | No interface for a single caller inside one module |
| **D**ependency inversion | The simulation knows nothing about rendering or the UI: they subscribe to it. Backend services depend on small Protocols, and routes receive them through `Depends`. | No dependency injection container. No repository base classes. |

## Target layout

```text
frontend/
  package.json, package-lock.json, vite.config.js, index.html
  src/
    sim/      Rules only: no React, no DOM, no rendering (runs in Node)
    render/   Three.js only: reads simulation state, never changes it
    ui/       React components and hooks
    api/      One small fetch client
backend/
  pyproject.toml, uv.lock
  app/
    main.py        App creation, middleware, static files
    routes/        HTTP only: parse, call a service, return
    services/      Rules and limits
    db/            SQL, migrations/*.sql, connection handling
    schemas.py     Pydantic models
  tests/
docs/
```

### Where the existing code goes

Files stay under the 350-line target, with 400 as the exceptional limit. `config.js` is data, and is split because it is 557 lines, not because the split adds any design value.

| Today | Lines | Target |
|---|---|---|
| `main.js`: state, placement rules, drones, targeting, effectors, missiles, waves, economy, sandbox, reset, snapshots | 1,469 | `sim/simulation.js`, `sim/drones.js`, `sim/targeting.js`, `sim/effectors.js`, `sim/waves.js`, `sim/economy.js`, `sim/laydown.js`, `sim/snapshot.js` |
| `main.js`: scene, models, rings, beliefs, labels, effects, ghost, input | | `render/scene.js`, `render/models.js`, `render/drone-view.js`, `render/belief-view.js`, `render/labels.js`, `render/effects.js`, `render/placement.js` |
| `main.js`: HUD, toolbar, tuning, sandbox panel, approvals, minimap | | `ui/` components. The minimap canvas drawing code moves as it is. |
| `network.js` | 702 | `sim/sensors.js`, `sim/registration.js`, `sim/fusion.js`, `sim/tasking.js`, `sim/authority.js`, `sim/network.js` |
| `config.js` | 557 | `sim/config/` split into world, systems, drones, comms and figures |
| `sapient-ui.js`, `network-ui.js` | 467, 470 | One component per dock tab under `ui/dock/`. The plan, network and spectrum canvas drawing code moves as it is. |
| `replay.js` | 221 | `sim/recorder.js`, `render/replay-view.js`, `ui/Timeline.jsx` |
| `terrain-view.js` | 245 | `render/terrain-view.js`, unchanged |
| `tracker.js`, `comms.js`, `terrain.js`, `sapient.js`, `rng.js`, `sapient-help.js` | | `sim/`, unchanged. These already have no browser dependencies, and `sapient-help.js` holds plain text. |
| `style.css` | 224 | Kept and imported as it is |
| `tools/` (regression checks and digests) | | `tests/` in Vitest, and `tools/balance.js` for balance runs |
| `serve.py`, `vendor/` | | Deleted in Phase 2 |
| `README.txt` | | Replaced at cut-over |

## Choices made to keep it small

These are deliberately left out. Each can be added later if a real need appears.

| Left out | Used instead | When to reconsider |
|---|---|---|
| SQLAlchemy and Alembic | Standard library `sqlite3`, numbered SQL files and `PRAGMA user_version` | Moving to Postgres or hosting for many users |
| TypeScript | Plain JavaScript, as the codebase is today | A later project of its own. Changing language during the restructure would make regressions harder to trace. |
| Redux, TanStack Query, React Router | `useSyncExternalStore` and `fetch` | The UI gains real page navigation |
| react-three-fiber | One component that mounts the existing Three.js scene | Never, for this game: per-frame updates should not go through React |
| Rewriting vector maths | Keep `Vector3` from `three` inside `sim/`, as math only | See the note below |
| Web Worker for the simulation | Main thread, as today | Frame rate becomes a measured problem |
| CORS, Docker, sign-in | Same-origin only, local run, bound to `127.0.0.1` | Hosting (see Security) |
| A scenarios table | Three tables only | Custom scenarios become a feature |
| Reopening a saved run in replay | The run's inputs are stored, but no replay feature is built | Someone wants it. The inputs cannot be recovered later, which is why they are stored now. |

**Why `Vector3` stays:** I confirmed it loads and runs in Node. Hand-written replacements could round floats differently, which would change results and break the reference runs that prove the restructure is safe. Importing it is a maths dependency, not a rendering one, and a test enforces that no other part of `three` is used in `sim/`.

## Database

SQLite file at `backend/data/siteguard.db`, which is git-ignored. JSON columns hold structured game data, and are validated by Pydantic on the way in.

```sql
CREATE TABLE laydowns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  world TEXT NOT NULL,            -- the terrain seed today
  spec TEXT NOT NULL,            -- JSON: systems, positions, wiring, bands, names, unit settings, rounds loaded
  game_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  scenario_seed TEXT NOT NULL,
  world TEXT NOT NULL,            -- the terrain seed today
  spec TEXT NOT NULL,            -- a copy, so editing a laydown never rewrites history
  figures TEXT NOT NULL,         -- tuning in force, since it changes the result
  commands TEXT NOT NULL,        -- operator inputs by simulation step
  game_version TEXT NOT NULL,
  digest TEXT NOT NULL,
  waves_completed INTEGER NOT NULL,
  kills INTEGER NOT NULL,
  leaks INTEGER NOT NULL,
  health REAL NOT NULL,
  budget_left REAL NOT NULL,
  capex REAL NOT NULL,
  munitions_bought REAL NOT NULL,
  consumables REAL NOT NULL,     -- value of rounds fired and laser energy used
  enemy_cost REAL NOT NULL,
  finished_at TEXT NOT NULL
);

CREATE TABLE figure_sets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  figures TEXT NOT NULL,         -- JSON: the same shape as exportFigures()
  game_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

**Correction to the earlier outline:** a seed and laydown alone cannot regenerate a run. Engagement approvals, jam band changes and the moment each wave starts all affect the result, as do tuned figures. That is why `figures` and `commands` are stored too.

[SAPIENT](SAPIENT.md) messages are not stored, because one run produces thousands. The existing NDJSON export still covers saving a log.

## API

All under `/api/v1`, JSON only.

| Method and path | Purpose |
|---|---|
| `GET /health` | Liveness check |
| `POST /auth/register`, `/auth/sign-in`, `/auth/sign-out`, `/auth/reset` | Accounts: sign up, sign in and out, reset with a recovery code |
| `GET, PUT /auth/me`, `POST /auth/password`, `/auth/recovery-code`, `/auth/delete-account` | Profile, change password, new recovery code, delete the account (with the password) |
| `GET, POST /units`, `GET, PUT, DELETE /units/{id}` | Deployment packs, for the signed-in account only |
| `GET, POST /laydowns` | List, create |
| `GET, PUT, DELETE /laydowns/{id}` | Read, replace, delete |
| `GET, POST /runs` | List with paging, record a finished run |
| `GET, DELETE /runs/{id}` | Read, delete |
| `GET, POST /figure-sets` | List, create |
| `GET, DELETE /figure-sets/{id}` | Read, delete |
| `GET /packs`, `GET /packs/{name}` | List map packs, fetch one |
| `GET, POST /packs/build` | Progress of a map build, start one |

Run results are reported by the browser, so they cannot be trusted as proof of a score. They are labelled as such, and there is no leaderboard.

## Security

Runs locally. Accounts were added later (Feature E), so every route except `/health`, `/auth` and the OpenAPI schema needs a session, but laydowns, runs and figure sets stay shared by every account on the machine.

- **Bind to `127.0.0.1` only.** This also fixes the `serve.py` issue of exposing the folder to the LAN.
- **Block attacks from web pages you visit:** `TrustedHostMiddleware` limited to `localhost` and `127.0.0.1` stops DNS rebinding. With no CORS and JSON-only writes, other sites cannot post to the API.
- **Validate all input with Pydantic:** known system IDs only, coordinates inside the world, finite numbers, name length limits, a capped number of systems and a request size limit. Seeds are length-limited. Unit settings and rounds loaded are checked for shape and coarse bounds here. Class limits belong to the game, so `restoreLaydown` clamps to its field table on load and the backend holds no game rules. Only keys in that table are read, because the API's key pattern allows `__proto__` and `constructor`.
- **SQL uses bound parameters only.**
- **No raw HTML from data in React:** `dangerouslySetInnerHTML` is banned. Source links in the Sources tab allow `https:` only.
- **Content Security Policy** on served pages, with no inline scripts and same-origin connections only.
- **Keep the database out of reach:** only the built frontend folder is served as static files, never the project root.
- **Hosting is not covered:** it would need HTTPS, per-user ownership checks on every object, and a new security review before any deployment.

## Phases

Every phase leaves the game working and ends with a commit or small series of commits. Each behaviour-preserving phase must reproduce the reference digests exactly.

### Phase 0: Repo hygiene

- [x] Add `.gitattributes` and normalise line endings, which clears the 13 noise-only modified files
- [x] Add `.gitignore`: `node_modules`, `dist`, `.venv`, `__pycache__`, coverage output, `backend/data/`, `.claude/`
- [x] Rename `master` to `main` and create a working branch from it
- [x] Settle the open decisions (see Settled decisions)

**Done when:** `git status` shows only intended changes.

### Phase 1: Fix the small bugs and make runs repeatable

- [x] `serve.py`: use `ThreadingHTTPServer` and bind to `127.0.0.1`
- [x] Stop the seed in the URL being injected as HTML at `main.js:1101`
- [x] Remember the laydown at the first wave, so Reset and Retry restore destroyed systems
- [x] Remove strike drones that leave the world, so a wave cannot stay open for ever
- [x] Rebuild the run from its laydown when the first wave starts, so build time and placement order cannot affect it. Time between later waves remains an operator input, recorded in Phase 3.
- [x] Replace `Math.random` in `injectFault` at `network.js:673` with a seeded draw that cannot shift the simulation stream. The two UI uses, the seed button and the packet pulses, can stay.
- [x] Correct the Sell tooltip, the stale comment at `network.js:5` and the variance formula at `tracker.js:236`
- [x] Remove `addTracer` and `FUSION.trackTimeout`
- [x] Record reference runs: several seeds and laydowns, scripted through `window.game`, saved as digest fixtures

**Done when:** a run's digest no longer depends on idle time, and each bug has a check that failed before its fix.

### Phase 2: Move to Vite, with no behaviour change

- [x] Move the current files to `frontend/src/`, and install `three@0.160.0` (the same version as `vendor/`) and Vite
- [x] Update the imports, keeping the current `index.html` and UI

- [x] Delete `serve.py` and `vendor/` early, because nothing can use them after the move. The npm copy of Three.js is byte-identical to the vendored one.
- [x] Use port 5199, because Docker holds 5173 on this machine

**Done when:** `npm run dev` plays the game, and reference digests match in both the dev server and the production build.

### Phase 3: Separate the simulation

- [x] Add a command dispatcher: every action that changes state goes through `commands`, and is logged by simulation step
- [x] Move rules from `main.js` into `sim/`, one area at a time, replacing direct mesh creation with events
- [x] Replace `d.group.rotation.y` in snapshots with a heading stored in the simulation
- [x] Split `network.js` and `config.js`
- [x] Add a boundary test: `sim/` has no DOM or React, and takes only `Vector3` from `three`
- [x] Add Vitest and run reference digests in Node. If Node and Chromium disagree on floats, record that and baseline in Node, after proving the browser still matches its own fixtures.
- [x] Add a Node balance script that reproduces the laydown table from the review

**Done when:** a full game runs in Node with no browser, digests match, and every source file meets the size target. `ui/sapient-ui.js` and `ui/network-ui.js` stay over it until Phase 5 replaces them, and a test holds everything else to the limit.

**Result:** Node and Chromium agree on every digest, so no re-baselining was needed. 201 tests pass, with 98.8% statement and 93.2% branch coverage of `sim/`. `main.js` went from 1,469 lines to about 100.

**Accepted limit:** `bus`, `clock`, `terrainState` and the random number streams stay as module-level singletons, because two simulations never run at once. Record it as a `shortcut:` comment. Upgrade if parallel runs are ever needed.

### Phase 4: Fix ghost-track engagement and check balance

This is the one restructure phase that deliberately changes results, so it gets its own re-baselined digests. The planned gameplay features also change results, and record their own re-baselines.

- [x] An effector only acquires a real drone close to the track's estimated position, not any drone the track was tied to
- [x] Display and behaviour text must come from the track, not from the true drone
- [x] Rerun the balance table. The review measured a defence that depends on this bug, so expect a sharp drop.
- [x] Tune only enough to restore a playable game, mainly radar clutter. A full rebalance (lasers, budget, the wave 4 wall) is separate work.

**Done when:** engagements happen only near real drones, balance results are recorded in the development story, and new digests are committed with the reason.

**Result:** the plan expected radar clutter to be the problem. Measuring showed trees were: they caused 80-86% of radar misses inside its range, and clutter only 4%, because a 6 m mast sits below the 12-20 m canopy. Engagements now happen only within 300 m of a real drone, against up to 8.5 km before.

- **Changed:** masts raised to 25 m (radar) and 15 m (compact radar and camera), clutter penalty 0.3, and bearing-only tracks need three different sensors to confirm.
- **Wave lost, seeds 1 / 7 / 42, before and after this phase:** Mixed 7/6/6 to 12/13/13. 3 lasers 7/8/4 to 8/9/8. One of everything 10/11/11 to 12/11/12. 8 interceptors and 6 jammers stay at 4/4/4.
- **Still open for the rebalance:** 5 lasers now reach the 30-wave cap on all three seeds, so that laydown never loses. With RF detectors in the mix, only about half of confirmed tracks sit on a real drone.

### Phase 5: React frontend

- [x] Add React with no extra libraries. One `GameCanvas` component owns the Three.js scene.
- [x] Add a `useSimulation` hook on `useSyncExternalStore`, updating panels about 5 to 10 times a second
- [x] Port one panel at a time, deleting its old DOM code each time: HUD, toolbar, control panel, approvals, sandbox, tuning, timeline, minimap, then each dock tab
- [x] Keep name tags and other per-frame labels in `render/`, outside React

**Done when:** every item on the parity checklist passes in a browser, and no `innerHTML` built from data remains.

**Result:** every panel is React, and every source file is within 350 lines. `style.css` is unchanged, and class names and ids were kept, so the game looks the same. Reference digests match in Node and the browser, 304 tests pass, with 97.8% statement and 91.2% branch coverage of `sim/` and `ui/`. The parity checklist passes in a browser, except that figure import and log and figure export were only tested with stubbed files.

### Phase 6: Backend

- [x] Create the project with `uv` and Python 3.12 or later, adding FastAPI and Uvicorn only, with pytest and httpx for tests
- [x] Add the migration runner, the three tables, the Protocols and SQLite stores, services, routes and the security items above
- [x] Test against real SQLite, including rejected input, oversized requests, wrong hosts, and migrations from empty and from the previous version

**Done when:** tests pass at 90% coverage or higher, and the API docs match the table above.

**Result:** 106 tests pass at 98.9% coverage, against real SQLite files, and the API table is checked by a test. The protections were also checked against the real server over sockets. Interactive docs are off because they load scripts from a CDN, and the schema is at `/api/v1/openapi.json`. Packages are limited to releases at least two weeks old through `exclude-newer` in `pyproject.toml`.

**Schema decisions:** the column is `world`, not `terrain_seed`, as the mapping plan asked, because renaming later would also change the API. The `munitions_bought` column is left for Feature B to add in its own migration, because nothing can fill it until then. Coordinates are checked against a fixed limit, which real-world packs will need to replace.

### Phase 7: Connect saving to the game

- [x] Add a save and load laydown panel, a run history panel, and saved figure sets in the Sources tab
- [x] Record a run when it ends, however it ends
- [x] **Keep playing if the backend is down:** the game still runs and panels show a clear message. A run that fails to save is reported to the player and not silently lost.
- [x] Have the Vite dev server proxy `/api` to the backend, so no CORS is needed

**Done when:** a laydown saved in one session loads in another and plays with the same digest, given the same inputs.

**Result:** verified end to end against the real backend: a laydown saved in one page session, reloaded and played with the same inputs gave the same digest, kills, budget and health. With the backend stopped, panels say so, the game keeps playing and runs are kept in the browser, then saved when it returns.

**Additions:** figure edits and enemy learning now go through logged commands, and enemy learning joined the figures, because both change results. The authority and auto-start settings in force are logged at the start of a run. A saved run replays to its own digest, tested with tuning, operator inputs, decisions and time between waves. Sample records in `backend/tests/fixtures/` are checked by both test suites, so a change of shape on either side fails.

### Phase 8: Cut-over and documentation

- [x] FastAPI serves the built frontend, with one documented command to build and one to run
- [x] Replace `README.txt` with a proper README
- [x] Write the README, `docs/DEVELOPMENT_STORY.md`, `docs/SECURITY_NOTES.md` and ADRs for the simulation location and for choosing `sqlite3`
- [x] Add CI only if a remote exists by then
- [x] Run the security and code quality reviewers over the whole branch

**Done when:** a clean clone can be installed and played by following only the README.

## Planned gameplay features

Status: agreed 2026-11-04, and rechecked the same day against the refactored code. Stages C1, A1, A2 and A3 are built; everything else is not started. These change game rules, so they are separate from the behaviour-preserving restructure.

**When they land:** the restructure phases are complete, so nothing here is waiting on them. Each stage gets its own branch from `main`. The order from here is B1 with C2, B2, B3, A4, A5, A6, A7. Raise `GAME_VERSION` at every stage that re-baselines digests, so the Saved tab warns about older laydowns.

**Evidence:** vendor figures are marketing claims. They came from search summaries, because the vendor PDFs could not be opened, so check each one against its source when it enters the code. Every figure gets a `ref` entry with its confidence, and anything unsourced is labelled ASSUMPTION in the Sources tab.

### Checks against the refactored code

The design still holds. File references were out of date and some assumptions were wrong, so the tables below are corrected. These were tried on a throwaway copy of the last commit, using the frontend tests:

| Claim | Result |
|---|---|
| A1: `Object.create` per unit leaves digests unchanged | Holds, as a one-line change with no editing. Results matched the unchanged copy. Two contract tests failed in both, because that copy had no backend fixtures. |
| A2: adding catalogue entries leaves digests unchanged | Holds |
| A2: renaming Compact radar leaves digests unchanged | **Wrong.** It changes `lasers-seed42` and `jammers-seed1`, because names are in registration messages. The stage is now two commits. |
| Starting wave 1 keeps the same unit objects | **Wrong.** All are replaced, node ids change, and default callsigns renumber: INT-01 became INT-03. Saved settings and the Unit panel both have to allow for this. |
| Magazine wave table | Still right: recalculated from `makeWave` |

The other corrections came from reading the code and have not been run.

**Measured when A2 was built:** a small RF detector's ±30° bearing does not flood the tracker with ghost tracks. Over wave 1 on three seeds, four small detectors alone averaged 0.6 confirmed tracks, only 8% of them on a real drone, and tracked 1% of drones, against 3.2 tracks, 32% and 29% for four medium ones. Beside a radar they do no harm: 71% of tracks sat on a real drone, against 60% with medium detectors, though fewer drones were tracked (44% against 54%). A small detector alone is close to useless as a locator, which suits its price and is one for A7 to look at.

### Feature A: configurable sensors and jammers

Radar, RF detector, EO/IR camera and RF jammer each get Small, Medium and Large classes. Compact radar becomes Small radar. Any placed unit can be renamed and edited when selected.

**Design rules**

1. Every editable field changes the simulation. If it does not, it is a read-out or it is left out.
2. The class sets the hardware limits and base price.
3. Every gain has a cost: price, slower scans, a louder signature or more false alarms.
4. Range is computed, not edited: `published range x physics ratio`, where the ratio is 1 at the class default. An absolute calculation would need vendor losses that are not published. The base figure stays editable in the Sources tab.
5. Hardware fields change the price and settings are free. Both lock at the first wave, except active jam bands, which stay live as they are today.

**Every system has:** name, callsign, class, price, and a live read-out of predicted range against each drone type.

**Sensors also have** a mast height, as hardware with a class limit and a price. Phase 4 found that trees caused 80-86% of radar misses inside range, so a free mast would always be set to the maximum. Effectors have no mast field: `opticalLos` uses a fixed 4 m, and effector range ignores `def.mount`.

#### Radar

| | Small | Medium | Large |
|---|---|---|---|
| Based on | Today's Compact radar (EchoGuard) | Today's Radar (IRIS) | Spexer 2000 3D MkIII class |
| Build | Fixed panel | Rotating | Multi-panel AESA |
| Default band | K, 24.45–24.65 GHz | X, about 9 GHz | X |
| Coverage per unit or panel | 120° x 80° | 360° x 60° | 120° x 60° (elevation is an assumption) |
| Scan period | 1 s (the real radar updates at 10 Hz; capped to limit message volume) | 1 s | 1 s (assumption) |
| Range, small quadcopter | 1 km | 2 km | 4.3 km (about 9 km is reported against a 0.2 m² drone, scaled by the radar range equation) |
| Price | $45k per panel | $900k | $2.5M (assumption) |

| Field | Kind | Effect |
|---|---|---|
| 3D or 2D (2D on Medium and Large only) | Hardware | 2D is cheaper but gives no height, so cameras must search vertically and altitude estimates are poor |
| Panels, 1–4 (Small and Large) | Hardware | Each adds an arc and its price |
| Band | Hardware | Sets angular accuracy, rain loss, small-target performance and the Spectrum tab entry |
| Micro-Doppler classifier | Hardware | Identifies fixed wing or multirotor at closer ranges |
| Boresight and azimuth arc | Setting | Where it looks. A narrower panel arc gains range; a rotating radar does not gain from it |
| Elevation low and high edge | Setting | Too high leaves low flyers unseen, too low adds clutter, and a low top edge leaves a gap overhead |
| Blanking arcs, up to 3 | Setting | Removes false alarms from those directions, but it sees nothing there |
| Scan period, 0.5–5 s | Setting | Slower gives more range but older data |
| Transmit power, 10–100% of rated | Setting | More range, but louder to emitter-seeking drones |
| Clutter filter, low, medium or high | Setting | Trades low-flyer range against false alarms, and can miss slow or crossing targets |
| Detection threshold | Setting | Trades detection chance against false alarms |

Range follows the search radar equation: `range ∝ (power x aperture x scan time x RCS / volume searched)^¼`. Doubling power gains 19%, and halving scan time loses 16%. Aperture is fixed by class and shown as a read-out, along with beamwidth and range resolution.

#### Electro-optical camera

| | Small | Medium | Large |
|---|---|---|---|
| Based on | Boson-class thermal core | Today's EO/IR camera | Cooled MWIR long-zoom turret |
| Sensor | LWIR 640 x 512, 12 µm | HD visible plus LWIR | MWIR 640 x 512, 15 µm |
| Lens and view | 36 mm, 12° | 10° search, 2.5° track (assumption) | 80–1200 mm, 7.1° to 0.5° |
| Range, small quadcopter | About 260 m | 650 m in search, 2.6 km on a cue | About 450 m in search, 6.4 km on a cue |
| Price | $25k (assumption) | $100k | $500k (assumption) |

| Field | Kind | Effect |
|---|---|---|
| Channels: visible, thermal or both | Hardware | Visible fades at night; thermal works day and night |
| Resolution and wide and narrow focal length | Hardware | Together set the field of view and pixels on target |
| F-number (aperture) | Hardware | Sets low-light performance and the diffraction limit on thermal |
| Laser rangefinder | Hardware | Adds range, so a cued camera can create a track by itself |
| Search arc, sweep rate, slew rate, dwell | Setting | How well it finds targets alone, and how quickly it can switch between them |
| Detection threshold | Setting | Trades detection chance against false alarms |

Pixels on target are `drone size / (pixel pitch / focal length x range)`. Detection needs about 4 pixels, an assumption that reproduces today's 1 km. Recognition needs 8, the first point at which it can name the airframe type. Identification needs about 13, shown as a higher-confidence type. A narrow view can miss the target if the track estimate is poor, so a good radar cue succeeds where a vague RF bearing may not.

#### RF detector

| | Small | Medium | Large |
|---|---|---|---|
| Based on | Wingman-class detector | Today's RF detector (Dedrone class) | AARTOS class |
| Coverage | 900 MHz, 2.4 and 5.8 GHz | 70 MHz–6 GHz | 20 MHz–8 GHz |
| Sensitivity (all assumptions) | -90 dBm | -100 dBm | -110 dBm |
| Bearing error | ±30° | 3° (assumption; an older Dedrone lists ±5°) | 2° (assumption) |
| Range, small FPV | 1 km | 3.5 km | 8 km (assumption; vendor claims conflict) |
| Price | $10k (assumption) | $40k (today's placeholder) | $400k (assumption) |

| Field | Kind | Effect |
|---|---|---|
| Bands monitored | Setting, within class limits | More bands means a slower revisit |
| Receiver sensitivity | Hardware | Every 6 dB doubles free-space range |
| Instantaneous bandwidth | Hardware | Sets the revisit time and the chance of catching a hopping link |
| Direction finding: sector or angle-of-arrival | Hardware | Sets bearing accuracy, and so whether triangulation is usable |
| Classifier library | Hardware | See below |
| Detection threshold | Setting | Trades detection chance against false alarms |

**Classifier libraries, shared with the jammer:**

| Library | Recognises | Result |
|---|---|---|
| None | Energy in the band only | Type unknown, double false alarms |
| Commercial (the standard one) | DJI and Autel links | Names the commercial quadcopters |
| FPV and hobby | ELRS, Crossfire, analogue video | Identifies the FPV |
| Tactical | Long-range control and digital video | Identifies the spotter |
| Full | All three | Costs the most |

FO Strike and FW Strike emit nothing, so no library helps against them. The real commercial quadcopters joined the roster after this table was first drawn, so there is a commercial library after all, and every catalogue detector comes with it. A library that does not know a link still reports a drone, as today's detectors do.

#### RF jammer

| | Small | Medium | Large |
|---|---|---|---|
| Based on | DroneGun MkIII | Today's jammer (DroneGun Tactical) | Fixed multi-band site system |
| Power per band (assumption) | 10 W | 40 W | 100 W |
| Range | 500 m | 1 km | 1.6 km omni, 5 km with a 10 dB sector antenna |
| Price | $40k | $60k | $350k (assumption) |

| Field | Kind | Effect |
|---|---|---|
| Bands fitted | Hardware | Each band is a paid module |
| Power per band | Hardware | Range scales with √power |
| Antenna: omni or sector, plus boresight and arc | Both | A sector reaches further but only in that arc |
| Receiver: none, or fitted with a sensitivity | Hardware | Lets it hear threats itself; sensitivity sets how far |
| Classifier library | Hardware | Needed for reactive jamming |
| Active bands | Live setting | Only fitted bands can be active. More active bands means a louder signature and more risk to your own links |
| Technique: barrage or reactive | Setting | Barrage hits anything in band. Reactive is stronger and quieter, but only against library matches |
| Trigger: fusion track, own receiver or manual | Setting | Own receiver keeps working if comms fail, but cannot hear silent drones |

Three new effects:

- **Distance from the operator:** a control link is easier to jam the further the drone is from its operator, so that distance scales the jam range. The launch point stands in for the operator's position. GNSS is unaffected. **Done in A6 part 2.**
- **Self-interference:** an active jammer deafens your own RF detectors in the same band, as it already degrades your comms in `sim/comms.js`. **Done in A6 part 1,** within the jammer's own range.
- **Receiver blanking:** a receiver cannot listen while its jammer transmits, so reactive mode needs short listening gaps. **Done in A6 part 3:** a jammer's receiver is deaf on the bands its own barrage fills, so a barrage switched on by it stops for 1 s in every 4 to listen, while a reactive jammer hears between its bursts. Your other jammers nearby deafen it as they deafen your detectors.

**Known simplification:** a video receiver sits with the operator, not on the drone, so jamming it at the drone in `sim/drones.js` is not accurate. It stays for readability, marked with a `shortcut:` comment.

#### Environment

Add one scenario setting on the start screen and in the sandbox: clear day (default), dusk, night, or rain and haze. It changes the scene lighting and the performance of each camera channel and radar band. The factors are assumptions. The setting is an input to the run, so it is stored and logged with the seed. SAPIENT reports it through `STATUS_TYPE_ILLUMINATION` and `STATUS_TYPE_WEATHER`.

#### Code issues to handle

| Issue | Where | Fix |
|---|---|---|
| All units of a type share one `def`, so edits would change all of them. `Object.create` is shallow, so writing to a nested object such as `def.sapient.interval` or `def.sapient.noise` would still change every unit, and scan period and accuracy live there. | `addStructure` in `sim/laydown.js` | `s.def = Object.create(catalogDef)`, with the unit's own copy of `sapient` and any other nested value it changes. A test edits one unit and checks that another unit and the catalogue did not move. |
| A unit's own derived value will not follow a figure edit, because `setFigure` only changes the catalogue | `setFigure`, `resetFigure`, `resetAllFigures`, `applyFigures`, `importFigures` and `setRangeScale` in `commands` | Recalculate units after these commands |
| Tracks cannot confirm if the scan period is over 2.5 s, and flicker to coasting over 1.6 s. Bearings expire after 3 s, so a slow RF revisit could never triangulate, and sources older than 3 s drop out of fused reports. | `TRACKER` in `sim/tracker.js`, `confirmedTracks` and `fusedReport` in `sim/network/fusion.js` | Scale timeouts and `candidateLife` to the sensor's update interval. **Done in A4 part 2.** |
| A 2D radar would be placed at antenna height with false precision. Since Phase 4, an effector only finds a drone within 300 m of the track in 3D, so a track with the wrong height could miss a spotter at 400-500 m or a FW Strike at 150-300 m. | `asMeasurement` in `sim/tracker.js`, `droneAt` in `sim/network/fusion.js`, `distToTrack` in `sim/network/core.js` | Treat height as unknown when there is no elevation, and compare horizontal distance only for those tracks | **Done in A4 part 3.**
| `def.fov` is used to mean "this is a camera", and the view is square. False alarms use it too, and would appear inside blanked radar arcs. | `sim/network/sensors.js` including `falseGeometry`, `registration.js`, `index.js`, `tasking.js`, `ui/dock/plan-canvas.js` | Check `kind`, use separate names for radar arcs, and use separate horizontal and vertical values | False alarms in blanked arcs: **done in A4 part 3.**
| The RF model never checks frequency, and a drone's reported frequency is random rather than taken from its links. The Spectrum tab shows one fixed detector range. | `pd` in `sim/network/sensors.js`, `sim/waves.js`, `sim/sandbox.js`, `SPECTRUM.detectorListens` in `ui/dock/spectrum-canvas.js` | Derive frequencies from `links`, test them against monitored bands, and show each unit's own bands. Frequencies and band matching: **done in A6 part 1.** The Spectrum tab already shows each type's own bands; per unit waits for monitored bands. |
| The Cost tab multiplies catalogue price by count, and its "Each" column assumes one price per type. Refunds and the saved-laydown price check use the catalogue price. | `LaydownTable` in `ui/dock/CostTab.jsx`, `sell`, `restoreLaydown` and `costProblem` in `sim/laydown.js` | Use each unit's own price, and show totals where units of a type differ |
| Custom names are new untrusted text | Registration, alerts, labels and panels | Trim, limit length and require unique callsigns, including against later automatic numbering. React and `textContent` already escape them on output. |
| The coverage map will not refresh on edits, and rings are always full circles | `coverageGrid` and the drawing in `ui/dock/plan-canvas.js`, `render/structure-view.js`, `render/placement.js`, `ui/minimap.js` | Include unit settings in the cache key, and draw arcs in all four views |
| Laydowns only save position, wiring and bands. Edits made before the first wave are not in the command log, because starting wave 1 clears it and rebuilds from the saved laydown. | `captureLaydown` and `restoreLaydown` in `sim/laydown.js` | Add name, callsign and settings. Pass them to `addStructure` before `registerNode`, because the registration message carries the name and range. Then charge the budget. |
| Default callsigns renumber when wave 1 starts | `captureLaydown` sorts, `registerNode` counts | A3 saves custom names, and automatic numbering skips callsigns that saved units will need. Saving default callsigns too changes digests, so do it at the first re-baseline. |
| The API refuses the new data: `PlacedSystem` forbids unknown fields, and `SystemId` is a fixed list | `backend/app/schemas.py` | Done in A2 and A3. The new fields are optional and left out of records when empty, so older saves load and records keep their shape. The running server must be restarted to pick up schema changes. |
| Unit types are hard-coded by id. `buildModel` has no default case, so a new id would draw a bare base. | `def.id === 'jammer'` and similar in `sim/drones.js`, `sim/targeting.js`, `sim/network/core.js`, `sim/network/tasking.js`, `ui/dock/spectrum-canvas.js`, `ui/dock/plan-canvas.js`, `STRUCTURES.jammer.slow` in `sim/drones.js`, `render/models.js`, `render/structure-view.js` | Use `kind`, and a `model` field for drawing. Keep ids `radar`, `radar_s`, `rf`, `camera` and `jammer`, so figure exports and test scenarios still load |
| The catalogue will pass the 350-line limit that `frontend/tests/boundary.test.js` enforces | `sim/config/systems.js` | Split sensors from effectors. `test_the_names_the_api_accepts_match_the_game` in `backend/tests/test_security.py` reads `systems.js` by name, so it must read both files. |
| Edits must be reproducible | `commands` in `sim/simulation.js` | Add `configureUnit` and `renameUnit` as logged commands, for edits after wave 1 starts. Only keys in the field table are written, because `s.def[key]` with `__proto__` would change the unit's prototype. `configureUnit` re-sends registration, since capabilities include range. |

#### Stages

| Stage | Work | Done when |
|---|---|---|
| A1 (built) | Per-unit `def` and `kind` in place of id checks. Laydown data, API fields and the Cost tab's per-unit prices moved to A3, because nothing can write them until then. Sell, refund and lost value already read each unit's own price. | Reference digests are unchanged |
| A2 (built) | Two commits. First: S, M and L catalogue entries, the API's `SystemId`, models, and the toolbar: 7 systems, with a repeat hotkey press cycling the class. Second: the renames. | The first leaves digests unchanged. The second re-baselines them: all five reference digests changed, and kills, leaks, health and budget are identical in every scenario, because only names in messages moved. `GAME_VERSION` is 0.2.0. |
| A3 (built) | The Configure side of the Unit panel: rename, Sell, and fields from one table in `sim/unit-config.js` that drives the UI, limits and price changes. Refuses edits you cannot afford. Also names and settings in laydowns, optional API fields, and each unit's own price in `LaydownTable` and `costProblem`. Unit values are worked out when read, so figure edits reach them with no recalculation step. | Tests cover limits, pricing, rename, reset and sell. Reference digests are unchanged, and a run with custom settings replays to its own digest. |
| A4 part 1 (built) | Coverage in `sim/sensor-model.js`: a fixed-panel radar covers its arc per panel, side by side and centred on where it faces, and every radar covers a band of elevation from 10° below the horizon. Unless turned, a radar faces away from what is defended, so it follows a drawn area or a walking patrol. Panels (paid) and facing are unit fields. Detection, false alarms, the range prediction, the rings, the plan map, the minimap, the placing preview, the coverage map and the wizard's spot search all use it. | Digests re-baselined: Small radars dropped from 360° to 120°, a deliberate balance change. The laser and jammer reference laydowns, which rely on Small radars, now let more through; the mixed ones only change in their messages. `GAME_VERSION` is 0.6.0. |
| A4 part 2 (built) | Tracker timing in `sim/tracker.js`: each measurement carries its sensor's update interval, and a sensor slower than once a second stretches the tentative, confirmed and coasting timeouts and the bearing life by that interval. A track drops or coasts only when every sensor that fed it has missed as many of its own updates. Fused reports keep a slow source as long, and kill confirmation waits for the track's slowest sensor. The radar scan period now goes to 5 s. | Reference digests are unchanged by this part, because every catalogue sensor reports once a second or faster. |
| A4 part 3 (built) | Radar fields in `sim/unit-config.js`, with their rules in `sim/sensor-model.js`. 2D on Medium and Large radars, 30% cheaper: no height, so its tracks are flat, compared across the ground, and a cued camera looks at the guessed height, then steps up a view at a time. Band: angle error goes with wavelength, small drones are seen a little further higher up, and the Spectrum tab shows it. The beam's low and top edges, up to 3 blanking arcs, and a clutter filter that can miss slow and crossing drones. Micro-Doppler names multirotor or fixed wing inside half the reach, standard on the IRIS and A400. The API's settings allow negative numbers and lists of arcs. | Digests re-baselined: micro-Doppler changes the messages of every laydown with an IRIS, the mixed laydown on seed 1 kills one more drone for $600k less, and on seed 7 ends the same for $400k more. `GAME_VERSION` is 0.7.0. |
| A4, left over (built) | Arc per panel on fixed-panel radars, from 30° up to the panel's own arc, at no price. A narrower arc spends the same scan on less sky, so range goes with the fourth root of the arc given up: a quarter of the arc reaches about 40% further. A rotating radar has no such field. Rain loss by band came with A5. | Tests confirm the range, the cover with more panels, that it costs nothing, that it sees further in front and nothing at the old edges, and saving. The standard is the catalogue arc, so the digests did not change. |
| A5 (built) | Conditions in `sim/conditions.js`: clear day, dusk, night, or rain and haze, chosen on the start card or in the control panel until the first wave, saved with the laydown, reported as `STATUS_TYPE_ILLUMINATION` and `STATUS_TYPE_WEATHER`, and lighting the scene. They scale a unit's own range: a camera by its better channel and its lens, radar in rain by band, and lasers in rain. Camera optics in `sim/camera-model.js`: 4 pixels detect, 8 name the airframe, 13 name it surely. A zoom camera searches at its wide view, zooms to its track view on a cue, and widens again when half its dwell finds nothing. Fields for channels, resolution, F-number, rangefinder, track view, search arc, sweep and slew. | Tests confirm the pixel maths, the zoom, night and rain behaviour, saving and replay. Digests re-baselined: sensor statuses carry the conditions, and cameras now name only what covers 8 pixels. `GAME_VERSION` is 0.8.0. |
| A6 part 1 (built) | Radio detection in `sim/rf-model.js`. A drone radiates on the bands of its control and video links, and one with a radio but no known band is taken as 2.4 GHz. A detector hears it only on a band it covers, works out the path on the lowest such band, and reports that band's frequency. Your own jammer, while jamming, deafens a detector within its range on the bands it jams. A jammer works out each link on that link's own band. Fields for a classifier library (none, commercial, FPV and hobby, tactical, full), receiver sensitivity and direction finding (sector or angle of arrival). | Tests confirm band matching, the reported band, self-interference, libraries, sensitivity and direction finding. Digests re-baselined: only the mixed laydowns changed, as reports now carry real bands. Over twelve seeds of the mixed laydown it ended at 781 kills and 11 leaks against 814 and 5, but HEAD with one extra dice roll per scan ended at 793 and 12, so that is within chance. `GAME_VERSION` is 0.9.0. |
| A5, left over (built) | Rain and haze is noise to an acoustic sensor, about 6 dB more, so it keeps half its reach, as a built-up area costs it. Thermal light blurs: a lens spreads a point over about its wavelength times the F-number (10 µm long-wave, 4 µm mid-wave), so a slower lens loses thermal reach, a faster one gains it where the catalogue lens already blurred past its pixels, and finer pixels add nothing past the spot. The Small camera has published 12 µm long-wave pixels, the Large 15 µm mid-wave, and the Medium's 12 µm long-wave core is an assumption. A camera that identifies a drone, at 13 pixels, names its model as a third level of its classification, carried on the track, its label and the plan map, the authority prompt and the kill alert. Cameras now come back to a classified track once it is close enough for its model to be named, still taking unclassified tracks first, and an unclassified track cuts such a look short. | Tests confirm rain on acoustic sensors, the blur against lens and pixels by day and night, that a camera names models in a wave and the track keeps one, and that only a look to name a model is cut short. Digests re-baselined: camera reports carry models and cameras look again. Over 36 seeds the mixed laydown killed 2,336 drones with 21 leaks, 2 runs lost and an average health of 79, against 2,337, 32, 2 and 68. Coming back to every classified track, near or far, had cost 6 runs lost against 2, as cameras were busy when a new track came in. Replays still show only the airframe. `GAME_VERSION` is 0.11.0. |
| A6 part 2 (built) | How far a jammer reaches. Bands fitted are paid modules, all four as standard, as the catalogue already let every jammer jam any band; leaving one out saves 15% of the price, and only fitted bands can be jammed. An omni or sector antenna: the sector gives 10 dB over 60°, so about three times the reach, only through its arc, which faces away from what is defended unless turned. Jamming, the switch-on, deafening your detectors and cutting your links all follow the arc, and so do the rings. A control link's jam reach goes with the drone's distance from its operator (the launch point), taken as 4.5 km for the quoted range. Each band jammed makes it louder to emitter-seeking drones, against the bands it jams as standard. | Tests confirm fitted bands, the sector's reach and arc, its ring, deafening only in front of it, the operator distance, and loudness by band. Digests re-baselined. Over twelve seeds the jammer laydown killed 223 against 217, and the mixed laydown 768 with 11 leaks against 781 and 11, within chance; its jammers, 800 m out, killed 120 drones against 142, because a drone that meets them is still nearer its operator. `GAME_VERSION` is 0.10.0. |
| A6 part 3 (built) | A jammer's own ears, in `sim/jamming.js`. A receiver (paid, priced as a Small RF detector with the same library) hears a drone on the link bands the jammer is fitted for, as far as the jammer reaches, but not through noise on them. Technique: barrage jams every drone on its active bands; reactive jams only the links of a drone its library knows and its receiver hears, breaks them twice as fast, is half as loud, and never jams GNSS. Trigger: the fusion node on a track, as before; its own receiver, which works with the network down but cannot hear a silent drone; or by hand, a switch in the Unit panel that a saved laydown keeps as `on`. | Tests confirm hearing, blanking, reactive jamming only against what its library knows, own-receiver switching with comms down, the barrage's listening gap and the hand switch. Reference digests are unchanged, as every new setting's standard is the old behaviour. |
| A6, left over (built) | Bands monitored and instantaneous bandwidth on RF detectors. A detector hears only the bands it monitors, from those its hardware covers, and each one monitored brings its share of false alarms. A narrow receiver costs 25% less but takes in one band at a time, so it reports once per band it monitors: 3 s for a Medium detector on all three, 1 s on one. | Tests confirm the bands heard, false alarms, revisit and price, and that a narrow detector reports less often in a run. Reference digests are unchanged, as both standards are the old behaviour. |
| A7 (built) | Balance with `tools/balance.js`, and a sweep of the unit settings one at a time over six seeds. No setting was a free win: on the mixed laydown a 5 s radar scan lost at wave 9 against 15, P1-SUNs in place of Stings at 9.5, and the faster lens, a sector jammer, more sensitivity, faster reloads, dusk, night and rain stayed within the spread of 13 to 17. Lasers were the problem: with three panels on each Small radar, all-round cover for $180k more, two to five lasers passed wave 30 on every seed, and half the beam power did as well as full. A laser now takes 4 s to swing onto each new drone, or one it lost from view, before its beam goes on (`layTime` in `sim/hit-chance.js`); the RF weapon steers electronically and has none. The balance tool gained the all-round laydown. Later waves on non-standard bands were left out. | With full cover, five lasers lose between waves 26 and 32, two at about 20, and beam power matters: two lasers last about 15 waves at half power and 23 at one and a half times. In the balance tool, wave lost on seeds 1 / 7 / 42 went from 12 / 12 / 11 to 8 / 8 / 9 for 3 lasers, 21 / 21 / 21 to 18 / 18 / 19 for one of everything, and 13 / 16 / 12 to 13 / 13 / 11 for 5 lasers; the new all-round laydown reaches 30+ / 26 / 30+, and the rest did not move. Digests re-baselined: only the laser laydown moved, 121 kills in eight waves against 124 with the same leak. `GAME_VERSION` is 0.12.0. |

**Which drones attack:** `sim/attack-mix.js` holds the ticked mix, `state.attack`, and `makeWave` fills each type's place from it. It saves in the laydown's `spec` only when changed, and the backend checks its shape alone. `ui/AttackMix.jsx` is the picker. `config/real-drones-extra.js` holds the Geran-3, ASN-301 and Wing Loong II, and `antiRadar` with `seekRange` in `targeting.js` sends the ASN-301 after radars.

**Hit chance and accuracy:** `sim/hit-chance.js` gives each guided round's chance and a beam's fall with distance, used by play and by the Unit panel. `pk` is tunable in the Sources tab, and each system's `ref` says whether it is evidence or an assumption. `errorScale` in `sim/site-range.js` widens sensor error as the signal weakens, in the reports and the tracker alike. `enoughInAir` in `sim/effectors.js` decides between waiting, a salvo and the next target.

**Range from where you stand:** a catalogue range means an open field on the standard mast. `sim/propagation.js` (ITU-R P.526 Bullington, Weissberger foliage, 4/3 earth) gives the loss on a real path, and `sim/site-range.js` turns it into a reach, used by detection, jamming, the rings, the plan map, the placing preview and the Range side of the Unit panel. See [ADR 0003](adr/0003-range-from-a-terrain-path-model.md). RF detectors and jammers default to a 9 m mast. UK systems are in `config/uk-systems.js`.

**Real systems in the toolbar:** clicking a row opens `ui/ToolPicker.jsx`, which lists the real systems of that kind by name, with the settings the next one will be placed with. S, M and L stay as quick choices. The list starts with the systems the Sources tab already named, three of which gained their own entries, marked `variantOf`: Blighter A800 (Ku band, 3 km against a Phantom, price assumed), Hensoldt Elysion RF DF (unverified ±30° and bands, range and price assumed) and SkyFall P1-SUN (about $1,000 a drone, performance copied from the Sting). "Generic EO/IR turret" and "Generic fixed site jammer" have no real product behind them. The P1-SUN is cheaper to fire than the Sting but hits half as often, and A7 measured the mixed laydown lasting 9.5 waves with it against 15.2 with the Sting. Since A4 the A800 looks through its published 90° cone, so it no longer simply beats the IRIS.

**Added later:** Sensofusion Airfence 7 and its Portable Asymmetric Jammer in `sim/config/eu-systems.js`, and Kirintec K-CEMA NEO and Jupiter in `sim/config/uk-systems.js`. A jammer with no published range is set from its output power, from Aaronia's 40 W handheld at half its 2 km claim, with reach going with the square root of power. A jammer may now come with its own receiver as standard (`receiver` in its entry): the setting starts there, and taking it off refunds its price.

**Carried systems:** a `mobile` field marks a system as `manpack` (1.5 m up) or `vehicle` (3 m up), set from what the real product is; everything else stands on its fixed mast. Range in an open field is unchanged, and the path model and line of sight do the rest, as trees and hills block a low antenna sooner. The mast field now steps by 0.5 m.

**Threat library:** `sim/network/threats.js` builds, from the drone catalogue each tasking pass, what the fusion node may believe about a track: a named model's own figures, the spread of drones of a named airframe, or any drone. `sim/network/tasking.js` uses it four ways. Jammers switch on only for tracks with a band they jam. Effectors take the most urgent track, its distance over its speed divided by the harm it would do, and switch only for one 25% more urgent. RF detectors name a commercial drone's model, as DJI's DroneID allows. A kinetic round is held for a drone with a known link to break when its way in spends at least `FUSION.softKillWait` (10 s) inside a jammer's reach before 800 m, judged over the ground, until it comes within 800 m, a jammer has had it that long, or jamming has failed against over half of three or more held drones of that model. Turning jammer power down to the need was tried and dropped.

**Drone flight:** a drone may fly more than one height band (`altModes`); its roll picks the band, then a height in it, and `alt` stays the envelope for everything else, with `typicalAltitude` the average of the bands' middles. A fixed-wing strike drone holds its height until it can reach its target at `SITE.diveAngle` (45°), then dives; a multirotor eases down over its whole run, as before. The commercial drones are in `sim/config/real-drones-cots.js`. Agility (`evade`) is set by the rule at the top of `sim/config/real-drones.js`. `GAME_VERSION` is 0.14.0.

**Drone models:** `render/drone-models.js` builds each drone type's model in metres from its `size` (span, or motor-to-motor diagonal for a multirotor) with a shape per airframe family: a cropped delta (the Shahed kind), an X-wing (Lancet), a tube-launched body (CH-901), a high wing with a pulling propeller (Orlan-10, Molniya-2), a canard (Ababil-2), a twin boom (Mohajer-6, ASN-209), a long-endurance V-tail (Wing Loong II), a flying wing (Skywalker), a folding camera quadcopter (Mavic, Mini, EVO), an enterprise quadcopter (Matrice), a hexacopter (Agras) and a first-person-view quadcopter. A drone not listed takes its type's shape. Parts merge into one mesh per material, plus one disc per propeller, so each drone is at most 8 meshes and under 1,000 triangles. The drawn span is `12 * size^0.4` scene units (`drawScale`), so a Shahed draws as before. `npm run models` saves them as .glb files to `frontend/models/`, which git ignores.

**System models:** `render/models.js` `buildModel` gives each system kind to its builder in `render/sensor-models.js` (radar, RF, camera, acoustic, jammer) or `render/effector-models.js` (interceptor, missile and gun, laser), which picks the product's shape by id and builds it from the parts in `render/system-parts.js` with the drone models' parts kit. A sensor or jammer stands on a tripod (`mobile: 'manpack'`), a truck (`mobile: 'vehicle'`) or a fixed mast drawn `0.65 * sqrt(mount)` units tall. `structure-view.js` rebuilds a model when the unit is reconfigured (its mast, panels or facing), and turns its head to `s.point.az` for a camera, `def.facing` for anything with an arc under 360°, else `s.aim`; a radar with no arc spins.

**Drawing scale:** systems and drones are true size when the camera is close, then keep a steady share of the screen's height (`WORLD.systemOnScreen` for a system taken as 3 model units tall, `WORLD.droneOnScreen` for a 2.5 m span, other spans by the 0.4 power), capped at `STRUCT_SCALE` and `droneVisualScale` zoomed right out (`drawnUnit` in `render/system-parts.js`, `drawScale` in `render/drone-models.js`, both from `view.zoom`, the camera's distance from its target). A system model unit is `SYSTEM_UNIT_M` (2.2 m) at true size; a mast or tripod is its real height then and grows with the square root of the exaggeration beyond (`parts.raise`). The sim's muzzle is `muzzleY` model units at true size, which moved results, so `GAME_VERSION` is 0.15.0. The camera's near plane is 0.02 units with a logarithmic depth buffer, its least distance 0.25 units (5 m), and it zooms towards the cursor.

**People:** a group has a `role`, `'civilian'` or `'military'` (`PEOPLE_ROLES`), chosen in the People picker; a laydown saves it only for soldiers, and the API accepts `role: 'military'` or none. A patrol's group is military. `render/figures.js` builds the figures in metres: civilians as trousers, top and skin meshes coloured per person, soldiers in vertex-coloured MultiCam with the skin. The role changes nothing in the simulation.

**Patrol column:** `PATROL.foot.column` is the default column, a list of `{ vehicle, system, gap }`; `PATROL_VEHICLES` (Patria 6x6, Toyota Hilux, Mule UGV) says what each carries (1 light, 2 medium, 3 heavy) and its mast height, and `MOUNTS` the class of each system that can ride. `setPatrol(points, column)` checks both (`columnProblem`), keeps the column on a redraw, and pays for each system and its Starlink terminal (not the vehicle). An escort's definition gets `vehicle`, which `buildModel` draws it on (`render/vehicle-models.js`), and `mount` from the vehicle's mast. The patrol halts while any escort other than a jammer has an engagement task. A laydown saves `patrolColumn`; the API checks it (`Escort`). `gun_hmg` is a 12.7 mm gun on a remote weapon station, a guided-round effector like the Paladin with assumed hit chance.

**Casualties:** each drone has `warhead` (kg, reported; the generic types keep the mass their site damage was scaled from, and site damage is `blast(warhead)`). `casualtyRadii(def)` gives the lethal and injury radii as `CASUALTY.lethalK` and `injuryK` times the cube root of it. In `sim/people.js` one roll per person against a chance of death falling to nothing at the lethal radius and of any harm falling to nothing at the injury radius (both scaled by protection) sets `down` to 2 (killed) or 1 (injured); `state.killed` and `state.injured` add up to `state.casualties`.

**Guns and crews:** guns are their own kind, `gun`, with a toolbar row (key 0, as 9 is the people tool); `gun_hmg` and `missile_paladin` keep their ids. Systems with `networked: false` (the crewed machine guns in `sim/config/crew.js` and the handheld jammers there) are left out of wiring (`isNode`), contact checks and tasking; `sim/crew.js` gives each its own target every half second: the nearest drone in reach that its crew can see (`sightRange`: `CREW.eyeBase + eyePerMetre * span`, up to `eyeMax`, times the light down to `nightFloor`, with a clear line of sight), or for a jammer one its detector hears (a radio-linked drone within `CREW.alertRange`). It fires or jams after `CREW.reaction` seconds, or at once if its detector warned it that long before. A handheld jammer jams only inside its `beam` (degrees) around `s.aim`, where its soldier points it (`jamming.js`). Handheld jammers (`handheld`) are drawn as a soldier holding the jammer, the crewed guns with a gunner behind the pintle (`render/gun-models.js`).

**What A3 can edit today:** only fields that already change the game, as design rule 1 requires. The limits, prices and threshold factors are assumptions in `sim/unit-config.js`.

| Kind | Fields |
|---|---|
| Radar | Mast height (paid), transmit power, scan period 0.5–5 s, detection threshold, band (paid), micro-Doppler (paid), low and top edge of the beam, up to 3 blanking arcs, clutter filter, 2D on Medium and Large (cheaper), and on fixed-panel radars, panels (paid), arc per panel and facing |
| RF detector | Mast height (paid), classifier library (paid), receiver sensitivity (paid), direction finding (paid), bands monitored, instantaneous bandwidth (narrow is cheaper), detection threshold |
| EO/IR camera | Mast height (paid), channels (paid), resolution (paid), lens F-number (paid), laser rangefinder (paid), slew rate (paid), search view and track view (medium and large), search arc, sweep rate, dwell, detection threshold |
| RF jammer | Transmit power, bands fitted (paid), antenna (paid), facing, receiver and library (paid), technique, what switches it on, and active bands and the hand switch, which stay live during a run |
| Interceptor, missile | Time between shots (paid) |
| Laser | Beam damage (paid) |

Radar 2D or 3D, band, blanking arcs, elevation edges, clutter filter and micro-Doppler came in A4 part 3, and arc per panel after it. Camera channels, resolution, lens, rangefinder, zoom, search arc and slew came in A5, and the thermal blur of the lens after it; a different lens is not offered, so each camera keeps its own zoom range. RF libraries, sensitivity and direction finding came in A6 part 1. Monitored bands and instantaneous bandwidth came after A6 part 3. A narrow receiver takes one report interval per band it monitors, a stand-in for stepping that a real receiver does far faster, and the chance of catching a hopping link is not modelled. Jammer bands fitted, antenna and facing came in A6 part 2, but not a sector's arc as a setting: it is fixed at 60°. The jammer's receiver and library, technique and trigger came in A6 part 3, but not the receiver's own sensitivity: it hears as far as the jammer reaches, and hearing further would change nothing, as a jammer can only act on what it reaches.

**Left out:** track capacity limits, GNSS spoofing and protocol takeover, operator geolocation, separating drones that are very close together, reusable custom presets, and changing hardware during a run.

### Feature B: Magazine depth

The Cost tab becomes **Magazine depth** and keeps all its cost information.

**What was built differs from the rules below, on the user's decisions.** Read this first; where it conflicts with the rest of this section, this wins.

- **Both limits apply.** The budget still pays for every shot, and launcher prices do not include rounds. A launcher also has a magazine and storage, so it can run out of either. `munitions` and the `munitions_bought` column are therefore not needed.
- **Ready and reserve stocks are separate, with a reload between them**, which this plan had left out. An emptied magazine reloads from storage: 12 and 24 rounds with 30 s for interceptors, 4 and 8 rounds with 60 s for missiles. The laser stores 300 s of beam, recharges while not firing, and locks out for 300 s if drained. Only the four-round missile magazine and the laser store have a source behind them; the rest are assumptions, editable in the Sources tab.
- **The fusion node reads the magazine directly**, not through a SAPIENT `Empty` mode. A launcher that cannot fire fails its task with the reason, and is offered nothing until it can.
- **The sandbox** reloads without using up storage, and its resupply is free.
- **Large systems reload only when the fighting stops.** A size L system (NASAMS, Skynex, Gepard, Sky Sabre) holds its reload while a wave, or a sandbox attack, is under way, and finishes it after (`reloadsInFight` in `sim/magazine.js`). Small and medium ones reload as they fight. Alex chose this rule.
- **Resupply** is allowed between waves and buys back every missing round, emptiest launcher first if the budget is short. Rounds a launcher came with are paid for when fired, and rounds bought are paid for now and marked `prepaid`, so no round is paid for twice. `ledger.consumables` therefore includes bought rounds not yet fired, while `ledger.shots` counts only what was fired.
- **Not built:** loading fewer rounds, rounds on 3D labels, expanding rows in the tab.

#### Tab layout

```text
MAGAZINE DEPTH                    37 of 44 rounds · $1.36M in stock
▾ Interceptor drones    31 / 36    $155k left
     INT-01 North rack  10 / 12    Ready      [Refill $10k]
     INT-02             12 / 12    Ready
     INT-03              9 / 12    Engaging   [Refill $15k]
▸ Missile                6 / 8     $1.2M left
▸ Laser                 Stored beam 82%, recharging
  RF jammer             No rounds, unlimited while powered
                                   [Resupply all $425k]

BUDGET  $15M for the whole run
[ systems ▓▓▓▓▓ | munitions ▓▓ | left ░░░░░░░░ ]
Sensors $1.04M · Effectors $4.3M · Network $4k
Munitions bought $1.78M · Laser energy $1k · Left $7.88M
```

- Clicking an effector row expands it to show each launcher.
- A row turns amber at 25% of rounds left and red when empty.
- Launcher labels in the 3D view show rounds, for example `INT-01 · 10/12`, in `updateLabels` in `render/structure-view.js` and in `render/replay-view.js`.
- Cost exchange, Laydown, Shots fired, Enemy attack and cost sources stay below the budget. Laydown splits into sensors and effectors, and launcher prices no longer include rounds.

#### Magazines

| Effector | Magazine | Basis |
|---|---|---|
| Missile | 4 rounds | FS-LIDS has a four-round Coyote launcher |
| Interceptor drones | 12 rounds | ASSUMPTION: no published launcher capacity was found |
| Laser | 300 s of stored beam, recharging only while not firing | EOS claims 200+ stored engagements for its Apollo laser. The conversion at about 1.5 s per kill is an assumption. |
| RF jammer | None | Shown as unlimited while powered |

The laser limit will rarely run out at its default, because a laser's real limit is engaging one target at a time. It can be lowered in the Sources tab to test a weaker system.

#### Rules

1. **Buying:** rounds are paid for when loaded. A launcher comes fully loaded, and its price and refund include the rounds. The Unit panel (A3) can load fewer to save money. If the budget cannot cover a full load, it buys what it can and says so, so `placementProblem` only requires the launcher price.
2. **Firing:** each guided shot uses one round and costs nothing more, so a launcher with rounds can still fire on an empty budget. The laser still pays $13 per second of beam, because it uses energy.
3. **Running empty:** the launcher reports empty, fails any task it holds, and the fusion node passes the target to another launcher. An alert and a timeline marker record it.
4. **Resupply:** allowed only between waves, even though the laydown is locked. Rounds arrive instantly, up to launcher capacity. If the budget is short, it buys what it can, filling the emptiest launcher first.
5. **Losing a launcher:** its remaining rounds are lost and added to the lost-value figure.
6. **Sandbox:** rounds deplete so depth can be tested, with a free Refill button. Leaving the sandbox restores the original load.
7. **Exchange ratio:** "shots per $1 destroyed" counts only rounds fired, and a second figure covers all defence spend, including unfired stock.

Total spend stays about the same as today, because each kill still uses a round at the same price. The new pressure comes from launcher capacity during a wave, and from choosing between more launchers and keeping cash for resupply.

| Wave | Interceptor targets | Missile targets | Launchers needed at 100% hit rate |
|---|---|---|---|
| 1 | 5 | 0 | 1 rack |
| 6 | 17 | 4 | 2 racks, 1 missile launcher (no spare rounds) |
| 10 | 27 | 7 | 3 racks, 2 missile launchers |

Real miss rates will push those numbers higher. These are calculated from `makeWave`, not measured in play.

#### Code changes

| Area | Change | Where |
|---|---|---|
| Unit state | Keep `s.load` (bought) separate from `s.rounds` (now). Laydowns save `load`, or leaving the sandbox would save a depleted magazine. | `sim/laydown.js` |
| Firing | Check rounds instead of budget for guided weapons, and add the laser's beam store | `FIRE` in `sim/effectors.js`, `sim/economy.js` |
| Task acceptance | Reject a task when the launcher is empty | `acceptTask` in `sim/simulation.js` |
| Fusion node | Stop offering tracks to a launcher it has heard is empty. Otherwise the message log fills with rejected tasks. | `eligible` in `sim/network/tasking.js` |
| SAPIENT | Add an `Empty` mode, and report rounds as a `STATUS_TYPE_OTHER` status, so the empty state travels through the normal network | `sim/network/` |
| Ledger | Add `munitions` and split system spending by sensor, effector and network. Keep `consumables` as the value fired, so the exchange ratio keeps its meaning. Defence spend in the Cost tab and the HUD budget bar must add `munitions`, or bought stock disappears from the totals. Ledger fields feed the digest, so this lands with B1. | `sim/economy.js`, `ui/Hud.jsx`, `ui/dock/CostTab.jsx` |
| Saved runs | Add `munitions_bought` in a new migration, with `DEFAULT 0` for existing rows, through `runRecord`, the API models and the Runs tab. Regenerate fixtures. | `backend/app/db/migrations/`, `backend/app/schemas.py`, `backend/app/db/stores.py`, `sim/run-record.js`, `ui/dock/RunsTab.jsx` |
| Commands | Add `resupply` as a logged command | `commands` in `sim/simulation.js` |
| Tab | Keep expanded rows in `useState`. The Dock keeps every tab mounted, so they survive switching tabs. Change only the label in `TABS`, keeping the `cost` id that tests and styles use. | `ui/dock/CostTab.jsx`, `ui/dock/Dock.jsx` |
| Tuning | Add `magazine`, beam store and recharge to the editable figures | `sim/config/figures.js` |
| Replay | Record rounds in snapshots, so labels and the Unit panel show the right count when rewinding | `sim/recorder.js`, `render/replay-view.js` |
| Toolbar | Show launcher price plus cost per round | `ui/Toolbar.jsx`, descriptions in `sim/config/systems.js` |

#### Stages

| Stage | Work | Done when |
|---|---|---|
| B1 | Magazine rules in the simulation: rounds, empty handling, resupply, sandbox, reset and replay | Tests cover running empty, handing over to another launcher, resupply limits, and load surviving a reset |
| B2 (measured, no change) | Re-baseline and balance rack size and missile capacity using `tools/balance.js`. The re-baseline came with B1. Over six seeds, halving, doubling or lifting each limit changed nothing for one of everything (it runs out of money at wave 18), for 8 interceptors (blind once its compact radars are destroyed, about wave 5), or for a radar with 3 missiles (it holds its missiles for fixed-wing tracks and loses at wave 3). On the mixed laydown no missile figure mattered either, as Stings take the fixed-wing tracks first, and the Sting's magazine was the only limit that did: 6 rounds 14.0 waves, 12 15.2, 24 18.0, none 17.3. That is a limit worth refilling for, not a wall, so the figures stay. | No digests changed, as no figure did |
| B3 | The tab, as new work in `ui/dock/CostTab.jsx` | The expanded rows, spend split and all existing sections work in a browser |

**Left out:** separate ready and reserve stocks with crew reload times, resupply lead times or resupply during a wave, auto-refill between waves, and holding back the last rounds for particular targets.

### Feature C: Unit panel

Click a placed sensor or effector on the map to see what it is, what it is doing, how far it reaches and how much ammunition it has. Nothing can be selected today: with no tool active, a click on the map is ignored. The panel starts read-only and needs no rule changes. Stage A3 adds editing to this same panel, rather than building a second one.

#### What it looks like

```text
INT-01 · Interceptor drones                     [×]
Cheap ram-type interceptor drones. Good against FPV
and FO strikes; cannot catch the fixed-wing drones.

Status      Engaging T88
Health      18 / 30
Ammunition  10 / 12 rounds   Reloading 1.2 s
Range       5.0 km, target at 2.1 km
Engages     FPV Strike, FO Strike
Network     Cellular B8, up · 42 ms · 0.4% loss
Position    620 m from site, bearing 072°
Cost        $100k launcher · $5,000 a round
All INT     8 shots · 5 kills · $8,000 a kill
Modelled on Wild Hornets Sting, SkyFall P1-SUN
```

```text
RDR-01 · Radar                                  [×]
Medium-range surveillance radar. Low flyers hide in
ground clutter until close.

Status      Detect, scanning every 1 s
Health      30 / 30
Range       2.0 km against a small quadcopter
            FPV 2.0 · FO 2.0 · Spotter 3.9 · FW 4.2 km
Limits      Below 40 m, only reliable inside 500 m
Measures    Range, bearing, elevation, velocity
Network     No terminal: this system is offline
Position    600 m from site, bearing 090°, mast 25 m
Cost        $900k
Modelled on Robin Radar IRIS, Blighter A800
```

#### What each row shows

| Row | Shown for | Where it comes from |
|---|---|---|
| Name, type, description | All | `s.short`, `def.name`, `def.desc` |
| Status | All | `s.mode`, `s.task` and the track's short name, or the camera's `s.cue`. `s.offline` and no `s.uplink` are stated in words, because a unit with no link does nothing. |
| Health | All | `s.health` out of `def.health` |
| Ammunition | Effectors | See below |
| Range | All | `def.range` in km, to one decimal place. Effectors add the distance to the current target. |
| Range by drone | Sensors | A new `reachFor(def, droneDef)`, taken out of `pd` in `sim/network/sensors.js`, so the panel cannot disagree with the simulation. RF shows "cannot hear" for FO and FW. |
| Limits | Sensors and laser | Clutter from `lowAlt` and `lowRange`, the camera's view from `def.fov`, and line of sight for the laser |
| Measures | Sensors | `def.sapient.noise` and `velocity`: an RF detector gives a bearing only, a camera gives bearing and elevation with no range |
| Engages | Effectors | `def.engages`, or the missile's `engagePolicy`. The jammer lists its active bands from `s.jamBands`, and how each drone type is affected, from `links` and `jamResist`. |
| Network | All | `comms.nodeLink` and `comms.pathFor`, as the Network tab's `LinkStats` uses them |
| Position | All | Distance and bearing from the site, ground height, and `def.mount` for sensors |
| Cost | All | `def.cost` and `def.shotCost` |
| Totals for this type | Effectors | `ledger.shots` and `ledger.killedBy`, which are kept per type, so the row is labelled as a type total |
| Modelled on | All | `def.ref.analogues` and `def.ref.confidence`, so nobody reads an assumption as fact |

Sensor range means about 86% chance of detection per scan at that distance, with clear line of sight (`SENSING` in `sim/config/world.js`). The panel says so in a tooltip. Effector range is a hard limit. At today's figures:

| Sensor | FPV | FO | Spotter | FW |
|---|---|---|---|---|
| Radar | 2.0 km | 2.0 km | 3.9 km | 4.2 km |
| Small radar | 1.0 km | 1.0 km | 2.0 km | 2.1 km |
| RF detector | 3.5 km | none | 5.5 km | none |
| EO/IR camera, once cued | 1.0 km | 1.0 km | 8.6 km | 7.1 km |

#### Ammunition row

| Effector | Before B1 | After B1 |
|---|---|---|
| Interceptor, missile | "Paid per shot: $5,000. Budget covers 2,080 shots", calculated from the current budget, with Ready or Reloading | `10 / 12 rounds` with a small bar, Ready or Reloading (from `s.cd`). Amber at 25% and "EMPTY" at zero, in words as well as colour, matching the Magazine depth tab. A Refill button appears when `resupply` is allowed. |
| Laser | "Paid per second of beam: $13. Budget covers 999,880 s" | Stored beam as a percentage, and whether it is recharging |
| Jammer | "None needed: no cost per use" | The same |
| Sensors | Row hidden | Row hidden |

#### How selection works

| Part | Change | Where |
|---|---|---|
| State | `view.selected` holds the unit, set through `game.select(s)`. It is view state, not a command, so it is never logged and cannot change a run. | `render/view.js`, `game.js` |
| Picking | Project each unit to the screen and take the nearest within about 16 px of the line from its base to its name tag. Name tags take no pointer events, so their boxes are checked first, because players will click them. The existing `sell` lookup is not reused, because it measures from a ground point, which lands well behind a tall model at a low camera angle. A plain function, so it can be tested in Node without WebGL. | `render/placement.js` |
| Clicks | A click with no tool active selects, and a click on empty ground clears. A system or its name tag also opens the panel with a placement tool active, within a tighter 8 px, because clicking a model otherwise bought a second system on the ground behind it. The Sell tool uses the same picking, and falls back to the ground point under the click. The zone tool always uses the ground point. The first placement shows a one-time hint, and the Legend mentions it too. The existing 5 px drag test keeps camera moves from selecting. | `render/placement.js`, `game.js`, `ui/Panels.jsx` |
| Rebuild at the first wave | Starting wave 1 replaces every unit object and changes its node id (measured), so a held reference goes stale and the panel would show a dead unit. On the `reset` event, find the unit again by position, which is restored exactly. Do not match by callsign or id. | `game.js` |
| Sold or destroyed | `getSelected()` clears it when the unit is no longer in `sim.structures`. The destroyed toast already explains why. | `game.js` |
| Rewinding | Mode, target, rounds and health come from the snapshot being reviewed, not the live unit, and the panel is tagged with the review time. Adding `health` and `rounds` to `takeSnapshot` is safe, because snapshots do not feed the digest. | `sim/recorder.js`, `render/replay-view.js` |
| On the map | The selected unit's range ring is drawn brighter, and stays visible with ranges switched off. Its name tag is highlighted. Arcs replace circles once A4 lands. | `render/structure-view.js`, `ui/minimap.js`, `ui/dock/plan-canvas.js` |
| Keyboard | Escape clears the tool first, then the selection. Rows in the Nodes tab get a button that selects the unit, which gives a route that does not need the canvas and picks out units whose tags overlap. | `ui/useHotkeys.js`, `ui/dock/NodesTab.jsx` |
| Panel | New `ui/UnitPanel.jsx`, using `useTick` like the HUD, and showing nothing when no unit is selected. Sits at `right: 214px; bottom: 60px`, beside the control panel, because the assistant wizard took the slot beside the minimap. With the dock open it moves to `left: 256px`, so it does not cover the toolbar. | `ui/App.jsx`, `style.css` |
| Small exports | Add `distToTrack` to what `createNetwork` returns, and export `stateWord` from `NetworkSide.jsx` | `sim/network/index.js`, `ui/dock/NetworkSide.jsx` |

**Security:** the panel only shows text through React or `textContent`, so custom names cannot inject markup, and `frontend/tests/boundary.test.js` already bans raw HTML in `ui/`. It sends no new requests.

**Existing text to fix on the way:** `def.desc` hard-codes prices ("Each launch costs $5,000"), which go wrong after a Sources edit, so take them out and let the Cost row state them. `hitStructure` in `sim/targeting.js` reports `s.health` as a percentage, but health is out of 30, so "18% health left" really means 60%. That alert goes on the message bus, so fix it at the next re-baseline.

#### Stages

| Stage | Work | Done when |
|---|---|---|
| C1 (built) | Selection, picking, map highlight and the read-only panel, with today's data | Reference digests are unchanged. Tests cover picking, every catalogue entry rendering, no uplink, offline, selection surviving the first wave, and clearing on sale and destruction. Checked in a real browser, because the click path needs WebGL. |
| C2 | With B1: the ammunition row from `s.rounds`, rounds in snapshots, and the Refill button. C1 already records health in snapshots and shows the moment being reviewed. | Tests cover low, empty, refill and rewinding |

Stage A3 then adds rename, editing and Sell to the same panel.

**Left out:** hover tooltips, selecting drones, tracks or the station, selecting several units, per-unit kill counts (the ledger keeps them by type), and moving a placed unit.

### Sources for these figures

- **Radar:** [EchoGuard listing](https://everythingrf.com/products/radar-systems/echodyne-corp/1069-2160-echoguard), [IRIS product sheet](https://www.robinradar.com/hubfs/IRIS%20product%20sheet%20042026.pdf), [Spexer 2000 3D MkIII](https://www.hensoldt.net/products/spexer-2000-3d-mkiii-land-ground-based-air-defence), [Janes on Spexer](https://www.janes.com/osint-insights/defence-news/c4isr/hensoldt-to-deliver-trml-4d-and-spexer-2000-3d-mkiii-radars-to-ukraine)
- **RF:** [Dedrone RF-360](https://www.dedrone.com/products/hardware/rf-sensors/rf-360), [Dedrone RF-300 datasheet](https://nwsnext.com/wp-content/uploads/5a981fc9d790df0001e798f7_dedrone-datasheet-rf-300-en.pdf), [Wingman comparison](https://aviationsouk.com/compare-products/dedrone-dedronesensors-rf-rf-160-rf-360-vs-mydefence-wingman-103-105-drone-detector/), [AARTOS](https://aviationsouk.com/products/aaronia-aartos-dds-drone-detection-system/)
- **EO:** [Boson lens options](https://www.oem.flir.com/products/boson/), [80–1200 mm MWIR lens and Johnson thresholds](https://www.ophiropt.com/f/motorized-80-1200mm-f-5.5-mwir-hd-zoom-lens)
- **Jammer:** [DroneGun MkIII](https://www.asx.com.au/asxpdf/20190715/pdf/446lzqk0qszn9n.pdf), [DroneGun Tactical](https://athlonoutdoors.com/?p=132292), [power per band guide](https://www.rfwireless-world.com/vendors/rf-components/anti-drone-jammer-manufacturers-and-providers)
- **Magazines:** [Raytheon Coyote launchers](https://Www.Wikipedia.org/wiki/Raytheon_Coyote), [The Myth of the Infinite Magazine](https://www.laserwars.net/p/laser-weapon-infinite-magazine-myth)
- **Messages and enemy bands:** [SAPIENT status_report.proto](https://raw.githubusercontent.com/dstl/SAPIENT-Proto-Files/main/bsi_flex_335_v2_0/status_report.proto), [non-standard FPV bands](https://newsukraine.rbc.ua/news/ukraine-faces-new-threat-as-russia-rolls-1781645404.html)

### Feature D: Wizard

A popup that guides a new player from an empty site to the first wave. Built, apart from the items in `docs/TODO.md`. The wireframe is a Design canvas, which Alex edits directly to steer it.

| Step | Done when | Reads |
|---|---|---|
| 1 Zone | A zone is closed, or the player skips | `view.zone` |
| 2 Sensors | A radar and one other kind are placed | `sim.structures` |
| 3 Effectors | Every drone type has an answer | `engages`, `jamResist`, `engagePolicy` in the config |
| 4 Network | Nothing is unwired, and the fusion node has a terminal | `sim.unwired()`, `net.fusion.uplinks` |
| 5 Coverage | The player moves on | `coverageGrid`, clipped to the zone |
| 6 Rehearse | The player moves on | `state.sandbox` |
| 7 Refine (optional) | The player moves on | The Sources tab |
| 8 Pre-flight | The first wave starts | All of the above |

**Rules:**

- **Suggested spots** come from `ui/assistant/spots.js`: it tries spots across the build zone, and scores what each would see or reach in the zone using the simulation's own checks, weakest drone types first. It says why, and the camera slides the spot into view if a panel hides it.
- **It only reads the game,** and anything that changes it goes through `commands`. A test runs the same game with the wizard reading it throughout and compares digests.
- **It only uses what the player could see:** the config and the laydown, never `state.queue` or true drone positions. The debrief reads the truth, because the run is over.
- **Progress comes from the game,** not from stored state, so loading a laydown or selling a radar moves it. Skipped steps are remembered until the run ends.
- **The zone is a rule.** It began as a planning aid, and Alex then asked for drones to attack it. A closed zone goes to `sim/` through `setZone`, and saves in the laydown's `spec`. With no zone a run is unchanged, so the digests still hold.
- **No tips during a wave,** so a run plays like a simulation. It closes when the first wave starts.

### Feature E: Accounts and deployment packs

Built. Alex asked for a login page, a profile for each person, and deployment packs: a military unit with the real sensors, effectors, vehicles and people assigned to it, to make deploying easier. Alex chose a recovery code for forgotten passwords, a required login, a tray to drag a pack's kit from, and shared saves. See [ADR 0004](adr/0004-local-accounts-with-recovery-codes.md).

- **Backend:** migration `0002_accounts.sql` adds `users`, `sessions` and `units`. `services/accounts.py` holds the rules (scrypt, lockout, sessions, recovery codes) and `services/units.py` the pack limits. Unit queries always include the account's id.
- **Frontend:** `ui/account/Root.jsx` gates the game behind `AuthScreen.jsx`, then shows `ProfileHub.jsx`. `PackEditor.jsx` builds packs from the same catalogue as the toolbar. A deployed pack reaches the game through `AccountContext`, and its id is kept in the browser so a reload keeps it. Signing out or deleting the account clears the pack but keeps the game, without a reload.
- **The catalogue:** the S, M and L buttons are gone. A toolbar row opens its list of real systems (`ToolPicker.jsx`), and each card can be dragged onto the map (`drag.js`, `render/placement.js`) or clicked, then the map clicked. `tools.js` holds the tool and the open list. A deployed pack opens as its own list, the tray, with how many of each are left.
- **The wizard** gives three numbered steps for each system it recommends, and the ring moves from the toolbar row to the card in the list.
- **Vehicles** are the patrol's (`PATROL_VEHICLES`). A pack's vehicle is parked with one of the pack's systems it can carry (`carries` in `sim/config/units.js`), which stands at the vehicle's mast height and is saved with a `vehicle` field. With a pack that has vehicles, the patrol's column takes only those, as many as it has less any parked (`PatrolColumn.jsx`).
- **The budget and the report:** a deployed pack sets `state.packed` (the `setPacked` command, kept in the run log), under which no budget check refuses anything: the budget still falls with every purchase and shot, below zero if need be, so it counts the cost. The HUD then hides the budget and site integrity, except in the sandbox. A run ends when the site or patrol is lost or when the operator ends it (`endDeployment`, which sets `state.ended`). The end card shows `sim/report.js`, read from the ledger, which now also keeps each jammer type's time switched on (`jamTime`, left out of the digest so recorded digests still match).
- **The pack's kit:** `setPacked` also takes the kit, `{ system id: how many }` (`kitOf` in `ui/account/pack.js`), and `placementProblem` refuses a system the pack does not hold, or one more than it holds, counting every system on the map. Each toolbar list shows only the pack's systems of its kind, with how many are left, and a hotkey opens the list instead of picking. A pack's system line can hold `settings`, checked by the backend like a placed system's and cleaned by the game (`usePackLoadouts` in `game.js`), so each is placed with them. Edit this pack, in the tray or a list, opens the editor on the deployed pack and goes back to the game (`editPack` and `doneEditing` in `Root.jsx`). The wizard plans with what is left of the pack (`kitLeft` in `ui/assistant/guide.js`).
- **What strikes aim at:** `chooseAim` in `sim/targeting.js` picks one drone's target in a drawn area at launch: a kind by `AIM_SHARE` among the systems, people groups and building cells inside it, then one of that kind, or `aimInZone`'s random spot if it holds none. A system that has gone by the time it arrives leaves the strike on the ground where it stood. Runs without a drawn area are unchanged, so the reference digests did not move.
- **Ground view:** `view.eye` is the system whose mast the camera sits on (`render/eye-view.js`): it follows the system's task, else the nearest detected drone in reach, else looks out over the area, and a drag offsets the look and eases back. OrbitControls is off meanwhile, and the map camera comes back as it was. Drones and rounds are sized by their own distance from the camera, so they stay visible.
- **Realistic models:** `render/paint.js` holds each system's and drone's paint, from photos and approximate. `modelMat` is smooth, has no glow, and takes the RoomEnvironment reflection `game-view.js` makes (`setModelEnv`), on the models only so the map keeps its true colours. A ring in `def.color` sits at each system's foot (`foot` in `models.js`). The sun casts shadows within `SHADOW_ZOOM` (300 m) or in the ground view. Each rotor is a group of blades with a faint disc.
- **Map symbols:** `render/symbols.js` draws APP-6(D) style symbols to shared canvas textures: a friend circle (#80E0FF) with a kind icon for our systems, the hostile air frame (#FF8080) for a tracked drone and grey for one no sensor has, unknown (#FFFF80) or dashed pending for tracks (`trackSymbol`). Systems and true drones change from model to symbol when drawn more than `SYMBOL_OVER` (12) times life size, never in the ground view. Tracks are always symbols, live and in replay.
- **People in motion:** `figures.js` splits each figure into parts that `render/poses.js` poses: idle, walking (from the group's movement) and cover within 400 m of a live drone (an assumption): soldiers prone, civilians face down with hands over heads. Parts are posed each frame only within 1.5 km of zoom; farther out the one-piece meshes are drawn as before.
- **Effects:** `render/particles.js` is a fixed pool of soft particles (4,096 smoke, 512 glow) drawn with the logarithmic depth buffer. `render/wide-lines.js` draws lines a few pixels wide with three's `LineSegments2`, in fixed buffers, for laser beams (red, from the symbol when zoomed out, `rfBeam` in its own colour) and tracer. `effects.js` adds a glow a fixed size on the screen on each missile and interceptor in flight (256), missile smoke trails and launch puffs, red tracer for gun rounds (256), muzzle flashes, fireballs tinted by the event's colour, smoke, debris, dust, and scorch marks (32, fading over 60 s).
- **Clutter and speed:** `inClutter` in `sim/site-range.js` takes the drone's speed and applies only below `SENSING.clutterSpeed` (5 m/s, an assumption), in play and in predictions. Line of sight over terrain, trees and buildings does the rest. This moved the reference runs; `GAME_VERSION` is 0.16.0.
- **Choosing a pack:** the start screen's Deployment pack choice (`ui/account/PackPicker.jsx`) deploys one of the profile's packs straight away, or none; the profile's Deploy button does the same.
- **The HUD** shows kills, leaks, people killed and injured, and ammunition left (`ammunition` in `ui/Hud.jsx`), with the spend below in quieter text; site integrity and the budget bar are the sandbox's only.
- **Transmit power in watts:** the `watts` field runs from a tenth of the rated RF output in `config/tx-power.js` up to it, in steps of about a twentieth, and range and signature go with the share used, as the percentage did. Each rating says whether it is published, secondary or assumed, and a saved `power` percentage converts on load (`cleanSettings`).
- **World size:** `WORLD.radius` is 27,000 m, so a world is 54 km across, and `WORLD.spawnDist` 26,000 m, the furthest a drone starts. Everything that sizes itself reads `data.R` or `WORLD.radius`: the minimap's span, the coverage grid (still 250 m cells, 45,796 of them), the edge for launches and placing. `parsePack` refuses a pack narrower than a world; `BUILT_HALF` is 35,000 m and `MAX_N` 4,001 posts (80 km). The builder's `--size` default is 70 km and `--lidar-km` 54, the backend's builds pass the same (`PACK_KM` and `WORLD_KM` in `services/packs.py`, with lidar across the whole pack in Estonia), and `WORLD_LIMIT` in `backend/app/schemas.py` is 1,350 units. Real maps draw a mesh vertex at least every `ceil((N - 1) / 540)` posts, and the generated relief picture is `R / 22` px. `generateTerrain` keeps the last ground it made, keyed on the seed, radius and `TERRAIN`, as making it takes about 4 s. Reference runs moved; `GAME_VERSION` is 0.18.0.
- **Where drones start:** `launchDistance` in `sim/attack-area.js` turns a drone's launch band (`WORLD.launchBand`: short 12 to 15 km for a quadcopter, long 12 to 26 km for a fixed-wing, or the drone's own `launch`) and a share from 0 to 1 into metres; `launch: 'edge'` gives `Infinity`, which `launchPoint` stops 200 m inside the map. `makeWave` rolls one share for each launch area, the sandbox one per attack, and `spawnDrone` reads it as `rolls.dist`. `moveStrike` in `sim/drones.js` removes a strike that leaves the map, or one turned by GNSS drift (`d.nav`) more than `WORLD.radius` from the area.
- **Heights past Estonia's border:** `beyond_border` in `tools/mapbuild/mapbuild/estonia.py` fills posts with no Estonian height from `copernicus.py`: GLO-30 tiles and their water body masks, reprojected onto the pack's posts, and fetched with `--fetch` into `copernicus/` beside the national files, each checked against its S3 checksum. The pack header's `credits.heights` carries the licence's notice, and `MapControls.jsx` always shows it.
- **Names and topography past the border:** `tools/mapbuild/mapbuild/geonames.py` reads GeoNames' `RU.zip` (fetched with `--fetch` into `geonames/`), keeps the settlements in the window, and `estonia.gather` adds them to the names, with `credits.names`. `beyond.py` samples the basic map's pictures at each post, keeps the blank patches that reach a post Copernicus filled (`reaching`, labelling patches through `shapes` and `rasterize`), outlines them and writes `features.beyond`, rings in metres from the pack's middle. `paintBeyond` in `render/map-texture.js` clips to those rings, even-odd, and draws the world's topographic picture and contours there, before the light and dark restyles.
- **Grids:** `view.mapGrid` is `'national'`, `'mgrs'` or `false`; the map panel's grid chips set it and G steps through (`nextGrid` in `ui/MapControls.jsx`). `sim/mgrs.js` has UTM on WGS 84 through `transverseMercator` in `sim/bng.js`, the 100 km square letters and `mgrsRef`; `mgrsAt` in `sim/grids.js` gives the cursor's readout. `paintMgrs` in `render/map-texture.js` draws the middle's UTM zone across the map, each line through points every 5 km.

### Feature F: Run statistics, movable boxes and drone trails

Built. Alex asked for far more statistics for a wave and the whole run, overall and per sensor and effector, with cost in pounds, hit rate and the range drones are downed at, the same with and without the wizard; for every box to be minimisable and draggable; and for a switch that draws drones' tracks as they move. Alex chose pounds across the whole game, trails for every drone, a per-wave breakdown and a kill-range chart, and the HUD's boxes as well as pop-ups.

- **Recording:** `sim/flight-log.js` gives every drone a record at launch (`d.log`, also in `ledger.flights`): its wave, each sensor type's first detection (time, slant range, distance from the site), each effector type's shots, cost and hits (a round's hit is counted on the shot's own tally, `m.shot`), the first shot's time, and how it ended (`killed`, `leaked`, `struck` a system, or `left`), with who downed it, its distance from the site and from the shooter. `ledger.falseAlarms` counts false alarms by wave and sensor through `ctx.onFalseAlarm`. A jamming crash is credited to the jammer type with the shortest `killTime`. None of it draws a random number, and the digest leaves `flights` and `falseAlarms` out, so the reference digests did not change.
- **Statistics:** `runStats(sim, wave)` in `sim/stats.js` works out everything for one wave or the whole run (`wave` null): counts, hit rate over guided rounds, rounds per kill, beam and jamming kills, `spread` (mean, standard deviation, least, most) of kill range from the site and the shooter and of first detection range, kill-range bins (`RANGE_BINS`), first seen to engaged and to downed, costs, and rows per effector, sensor and drone type. Systems bought, munitions bought and systems lost, and jamming time, are for the whole run.
- **On screen:** `ui/RunStats.jsx` has `StatsHeadline` (six tiles) and `RunStats` (wave picker, headline, lists, chart, three tables). The HUD and the wizard's run card show the same headline only once a drone has launched, each with All statistics, which opens the SAPIENT panel's Statistics tab (`StatsTab`). The end card shows `DeploymentReport` (outcome, cost and losses; who shot what moved to the statistics), the debrief, then `RunStats`. So the wizard and non-wizard paths show the same figures.
- **Pounds:** prices stay in dollars in the config, as sourced. `money` and `pounds` in `sim/economy.js` convert at `GBP_PER_USD` (0.75, an assumption) for display; `usd` is gone. The Sources tab edits figures in US$.
- **Movable boxes:** `ui/Movable.jsx` wraps a box in a title bar with a minimise button; `useMovable` (now also arrow keys, Shift and Home) drags it, and `placed` fixes its width and takes it out of the left column when moved. A shrunk box hides everything but its bar with CSS (`ui/movable.css`), so nothing inside unmounts. The start and end cards move and shrink too, and shrunk they let the map behind be used.
- **Trails:** `render/trail.js` keeps up to 600 points, one every 50 m, with the newest following the drone. `drone-view.js` gives each drone one, shown when `view.trails` and the truth overlay are on; `belief-view.js` gives each track one, shown when trails are on and the truth overlay is off. Both record while hidden, so switching on shows the whole flight.

### Threat names and real drones

Built. `frontend/src/sim/config/real-drones.js` holds 21 real drones as variants of the four types (`variantOf`), grouped by `origin`. `DRONE_CLASSES` is what the waves send and the wizard scores. `THREAT_GROUPS` is what the pickers show. `systemFor` in `frontend/src/ui/assistant/guide.js` recommends a system by threat, using the warning times in `WARNING`, which are assumptions. Still open: see `docs/TODO.md`.

## Feature parity checklist

Check in a real browser at the end of Phase 5 and again at the end of Phase 8.

- [x] Start screen: scenario seed, terrain seed, random seed, Deploy, and seeds in the URL
- [x] Placement: every system, its size buttons and its hotkey, ghost preview and reasons for refusal, sell and refund, laydown lock
- [x] Camera controls and the minimap (click, drag, scroll)
- [x] Waves: start, auto-start, speeds, pause, wiring warning, adaptation, game over and retry
- [x] Toggles: ranges, truth overlay, labels, highlight tracks
- [x] Engagement authority: all three modes, approval cards, auto-pause and expiry
- [x] Sandbox: wave levels, custom attacks, clear, exit keeps the laydown
- [x] Reset run and Clear map (once New laydown), including the two-click confirmation
- [x] Replay: timeline, stepping, play, event markers, keyboard shortcuts
- [x] Messages tab: filters, freeze, clear, export, inject fault, explain
- [x] Nodes tab, and Plan tab with coverage maps
- [x] Network tab: auto-wire, clear, click to wire, tapped wires, step to next packet, band settings
- [x] Spectrum tab, and Learn tab with follow a track
- [x] Cost tab (Magazine depth once stage B3 lands), and Sources tab with edit, reset, import, export and the range scale
- [x] Tuning panel, legend, and `window.game` in development builds

## Testing

| Area | Tool | Target |
|---|---|---|
| `sim/` | Vitest in Node, plus reference digests | 90% coverage |
| `ui/` logic and hooks | Vitest with React Testing Library | 90% coverage |
| `render/` | Excluded from coverage because it needs WebGL, and checked with a browser smoke test | Smoke test passes |
| `backend/` | pytest with httpx | 90% coverage, stronger on validation |

Tests cover behaviour that could really break. Coverage thresholds go in the config and are not lowered to pass.

## Risks

| Risk | Mitigation |
|---|---|
| Phase 3 changes results without anyone noticing | Reference digests after every step, in small commits |
| Node and Chromium disagree on floating-point results | Check early in Phase 3, and baseline in Node if needed |
| The Phase 4 fix leaves the game unplayable | The Node balance script makes tuning cheap, and the phase has its own stopping point |
| React slows the game | Panels update on a throttle, and nothing per-frame goes through React |
| Long pause in new features | Each phase leaves a playable game and can be stopped at |
| Saved laydowns break when rules change | `game_version` is stored, and a mismatch shows a warning |
| Ponytail's plugin changes on update | Version 5.3.3 was reviewed. Review again before updating. |
| Sensor classes weaken small radars and cameras | Stage A7 tunes with the balance script, and every figure stays editable in the Sources tab |
| A 4-round missile launcher makes wave 6 onwards too hard | Stage B2 tests capacity with the balance script before the tab is built |

## Settled decisions

1. **`parked-friendlies-roe-spectrum` stays parked.** It is untested and branched before Three.js was bundled locally. The feature gets rebuilt on the new structure after Phase 5, using the branch as reference only.
2. **GitHub backup and CI.** A remote now exists. CI, audits, secret scanning and dependency updates were added on 9 November 2026. The new workflows still need their first remote run and required-check rules; see [CI.md](CI.md).
3. **Default branch renamed from `master` to `main`.**
4. **Rounds are paid for when loaded, not when fired.** This matches how stock is really bought, and separates money tied up in munitions from money fired.

## Quality review fixes, 9 November 2026

- [x] Deduplicate replay labels, discard label work at every frame boundary even when drawing is skipped, and measure rectangles before changing visibility.
- [x] Close the selected-drone panel and stop Follow when Truth overlay is disabled. Report a strike on a deployed system explicitly.
- [x] Keep patrol strikes finite at the exact hold point, without consuming randomness or changing nonzero movement.
- [x] Display map-build failures returned immediately, and cover the start, success, failure and retry paths.
- [x] Refuse negative lidar widths before fitting or fetching, and verify cached OS files by checksum before reuse.
- [x] Split the oversized stylesheet into smaller files while preserving the cascade order.
- [x] Check replay labels, Truth overlay/Follow, and returning from the profile screen in a real browser using a disposable database.
- [x] Add CI, dependency audits, secret scanning and dependency updates with pinned actions and read-only permissions for pull request jobs.
- [ ] Finish the full frontend coverage run and review its reference digest results. Targeted regression checks and the map builder suite pass.
- [ ] After the changes are pushed, inspect the first GitHub runs and configure required checks. CodeQL and dependency review also need an eligible private-repository licence before enabling them.

## Realism audit, 9 November 2026

A read-through of the sensor, effector, drone, radio terrain and SAPIENT models. The ticked items are done. The rest are candidates from the audit, not yet agreed.

- [x] Guns and beam-riding missiles (`beamRider`: `missile_rr`, `missile_hvm`) need a clear line of sight from the muzzle to accept a task and to fire, and a beam-rider misses if the line is lost before it arrives. Range rings and the Range panel follow.
- [ ] Add confusers: birds and neutral aircraft that form tracks, and classification that can be wrong.
- [ ] Let your own jammers affect your own radio-controlled interceptor drones.
- [x] Give an RF detector's open-field reach a frequency term: `bandReach` in `sim/rf-model.js` scales it by wavelength against the 2.4 GHz control link its range is quoted for, with a video sender 5 dB louder. Reference digests recorded again.
- [x] Sample radio paths at up to 256 points, not 64, so every 20 m cell is looked at out to 5.1 km. Reading every cell on longer paths gave the same mean ranges to three figures and cost up to twice as much again, so it was not done.
- [x] Measure the tables in `FUSION_AND_TARGETING.md` again. The script that first made them was not kept, so `frontend/tools/measure-fusion.js` (`npm run measure`) was written from the page's definitions and checked against the old tables on the old behaviour: it gave every figure but one.
- [ ] Consider the operator's transmitter as an emitter an RF detector can hear, and a control link's duty cycle.
- [ ] SAPIENT: send a TaskAck when its Task arrives, report `field_of_view` and `coverage` in status reports, and keep the conformance check in `tools/`.
- [ ] Drone flight: wind, endurance, turn limits and terrain-masking routes. Replace the jamming slow-down and timer with a signal threshold.
