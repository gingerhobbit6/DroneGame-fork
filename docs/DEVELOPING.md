# Developing

How to set up, run and test Site Guard, how the reference digests pin its behaviour, the project's conventions, and how to add a drone, a sensor or an effector. It is for developers. For how the parts fit together, read [ARCHITECTURE.md](ARCHITECTURE.md) first; for the HTTP routes, [API.md](API.md).

## Contents

- [Prerequisites](#prerequisites)
- [Running it](#running-it)
- [Tests](#tests)
- [Reference digests](#reference-digests)
- [Saved records and the database](#saved-records-and-the-database)
- [Values copied between programs](#values-copied-between-programs)
- [Conventions](#conventions)
- [Adding a real drone](#adding-a-real-drone)
- [Adding a sensor or effector](#adding-a-sensor-or-effector)
- [Adding a new kind](#adding-a-new-kind)
- [Other tools](#other-tools)
- [Limits and simplifications](#limits-and-simplifications)
- [Where this lives in the code](#where-this-lives-in-the-code)

## Prerequisites

| Tool | Version | Where the requirement comes from |
|---|---|---|
| Node.js | 22.12 or later on the 22 line, or 24, or 26 and later | The installed Vitest 5.0.5 declares `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`, and Vite 8.3.5 `^20.19.0 \|\| >=22.12.0`, in their `engines` fields. [`package.json`](../frontend/package.json) sets none of its own |
| npm | The one that comes with Node | Installs exactly what [`package-lock.json`](../frontend/package-lock.json) lists |
| uv | A current release | Runs the backend and the map builder from their `uv.lock` files |
| Python | 3.12 or later | `requires-python` in [`backend/pyproject.toml:5`](../backend/pyproject.toml#L5) and [`tools/mapbuild/pyproject.toml:5`](../tools/mapbuild/pyproject.toml#L5). uv installs one if needed |

Install the frontend's packages once, and again after they change:

```bash
npm --prefix frontend ci
```

uv installs the Python packages the first time `uv run` needs them. Both Python projects set `exclude-newer = "2026-10-21T00:00:00Z"` ([`backend/pyproject.toml:13`](../backend/pyproject.toml#L13)), so uv only resolves packages released before that date; the comment says the aim is that a compromised release has two weeks to be caught. Move the date forward on purpose when updating dependencies. The frontend's dependencies are pinned to exact versions in `package.json`.

## Running it

**As a player runs it.** Build the game, then start the backend, which serves the build:

```bash
npm --prefix frontend run build
uv --directory backend run --no-dev python -m app
```

Open <http://localhost:8200>. The backend listens on 127.0.0.1 only ([`__main__.py:9`](../backend/app/__main__.py#L9)) and accepts only the host names `localhost` and `127.0.0.1` ([`security.py:8`](../backend/app/security.py#L8)). Without a build, `/` answers 503 and says how to build.

**For development**, run the backend and the Vite dev server in two terminals:

```bash
uv --directory backend run --no-dev python -m app
```

```bash
npm --prefix frontend run dev
```

Open <http://localhost:5199>. Vite listens on 127.0.0.1:5199, refuses to move to another port, reloads as you edit, and passes `/api` through to the backend ([`vite.config.js:4`](../frontend/vite.config.js#L4)), so the browser sees one origin. The backend is needed to get past the login page. `npm --prefix frontend run preview` serves the production build on the same port with the same pass-through.

The dev server does not send the backend's security headers, such as the Content Security Policy ([`security.py:10`](../backend/app/security.py#L10)). Check anything that depends on them against the built game on port 8200.

Useful while developing:

- `?seed=7&terrain=3` in the address sets the scenario seed and the generated ground ([`main.jsx:10`](../frontend/src/main.jsx#L10)).
- In the dev server the game is on `window.game` ([`main.jsx:17`](../frontend/src/main.jsx#L17)). Setting `game.debug.frozen = true` stops the frame loop stepping the simulation, so a script can drive it ([`game.js:245`](../frontend/src/game.js#L245)).
- `SITE_GUARD_DB` moves the database file ([`main.py:32`](../backend/app/main.py#L32)), and `SITE_GUARD_MAPS` the maps folder ([`services/packs.py:45`](../backend/app/services/packs.py#L45)). A throwaway database is a quick way to test sign-up from scratch.
- To build a map pack by hand, see [MAPS.md](MAPS.md). The builder's options are in [`mapbuild/__main__.py:41`](../tools/mapbuild/mapbuild/__main__.py#L41).

## Tests

| Suite | Runner | Files | Coverage gate |
|---|---|---|---|
| Frontend | Vitest, in Node, or jsdom for files that start with `// @vitest-environment jsdom` | [`frontend/tests/`](../frontend/tests/) | Statements 90%, branches 80%, functions 90%, lines 90%, over `game.js`, `api/`, `sim/` and `ui/` ([`vitest.config.js:12`](../frontend/vitest.config.js#L12)). `render/` is left out of coverage, but label lifecycle, model and symbol behaviour have unit tests |
| Backend | pytest, pytest-cov and FastAPI's test client | [`backend/tests/`](../backend/tests/) | 90%, with branch coverage, and the run fails below it ([`pyproject.toml:19`](../backend/pyproject.toml#L19)) |
| Map builder | pytest | [`tools/mapbuild/tests/`](../tools/mapbuild/tests/) | None set |

### Frontend, gently

Many frontend test files build a generated world 54 km across before their tests, which takes seconds and a lot of memory. Tests and setup hooks both allow 180 s: under precise V8 coverage on GitHub's runners a test that builds two worlds took 96 s, and many others 45 to 57 s ([`vitest.config.js:7`](../frontend/vitest.config.js#L7)), after a measured setup reached about 130 s. UI-only fixtures that do not assert terrain extent can use a small real world and restore `WORLD.radius` afterwards, as the drone panel and frame tests do. Many files building worlds side by side multiply the memory used. Run one file at a time where you can, with more heap and one worker. From `frontend/`, in a POSIX shell:

```bash
export NODE_OPTIONS=--max-old-space-size=4096
npx vitest run tests/tracker.test.js --maxWorkers=1 --no-file-parallelism
```

In PowerShell:

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=4096'
npx vitest run tests/tracker.test.js --maxWorkers=1 --no-file-parallelism
```

- The whole suite: leave out the file name. Run it on its own, with nothing else heavy on the machine.
- Coverage: add `--coverage` (what `npm run coverage` does).
- One test by name: add `-t "part of its name"`.
- `npm --prefix frontend test` runs everything with Vitest's default parallelism, which this project's memory use does not suit.

UI tests drive the real simulation and a real `createGame`, with an in-memory stand-in for the backend ([`support/fake-api.js`](../frontend/tests/support/fake-api.js)), so they need no server.

### Backend

```bash
uv --directory backend run pytest
```

Each test gets a fresh database in a temporary folder ([`conftest.py:40`](../backend/tests/conftest.py#L40)), and the scrypt cost is lowered so tests stay quick ([`conftest.py:45`](../backend/tests/conftest.py#L45)). For one file, add `--no-cov`, as the 90% gate applies to whatever ran:

```bash
uv --directory backend run pytest tests/test_api.py --no-cov
```

### Map builder

```bash
uv --directory tools/mapbuild run pytest
```

These tests use small made-up inputs and download nothing.

### Continuous integration

[CI.md](CI.md) describes the workflows, dependency audits, secret scan and update proposals. CI runs the full frontend coverage suite, including the reference digests, with one worker; it also builds the frontend and checks both Python suites. New workflows have been validated locally and still need their first GitHub run after push. Required-check rules and private-repository CodeQL eligibility are configured in GitHub, not by these files.

## Reference digests

### What they pin

A digest is a 32-bit FNV-1a fingerprint of a run: every [SAPIENT](SAPIENT.md) message still kept, plus kills, health, budget, leaks, game time, the message count and the ledger ([`simulation.js:241`](../frontend/src/sim/simulation.js#L241)). Any change to what a sensor reports, when a message arrives, what a weapon hits or how a drone flies changes it. How this fits with determinism is in [ARCHITECTURE.md](ARCHITECTURE.md#determinism).

Five scripted runs are pinned ([`scenarios.js:11`](../frontend/tests/support/scenarios.js#L11)). Each places its systems with no budget checks, auto-wires them and plays the waves:

| Name | Seed | Laydown | Waves |
|---|---|---|---|
| `mixed-seed1` | 1 | `MIXED`: a medium radar, 2 RF detectors, 2 cameras, 2 jammers, 3 interceptor launchers, a missile launcher | 6 |
| `mixed-seed7` | 7 | `MIXED` | 6 |
| `mixed-gnss-seed42` | 42 | `MIXED`, with GNSS added to the jammers' bands | 4 |
| `lasers-seed42` | 42 | `LASERS`: a medium radar, 2 small radars, 5 lasers | 8 |
| `jammers-seed1` | 1 | `JAMMERS`: 3 small radars, 6 jammers | 4 |

For each, [`reference-digests.json`](../frontend/tests/support/reference-digests.json) holds the digest and the wave reached, kills, leaks, health and budget left (in US dollars, as the simulation holds it).

### Comparing

Run the reference test. It replays all five and fails on any difference, showing which numbers moved:

```bash
npx vitest run tests/reference.test.js --maxWorkers=1 --no-file-parallelism
```

To see the current values without changing anything, print them (from `frontend/`, with `NODE_OPTIONS` set as above):

```bash
node tests/support/print-digests.js
```

The same runs work in the real page. With the dev server open, in the browser console ([`scenarios.js:3`](../frontend/tests/support/scenarios.js#L3)):

```js
const r = await import('/tests/support/scenarios.js'); window.game.debug.frozen = true; r.runReferences(window.game.sim)
```

### Re-recording on purpose

Only when a change is meant to alter results. If a refactor changes a digest, that is a bug: find it rather than re-record.

1. Run the reference test and read what moved. Be able to explain each change.
2. Write the new values: `node tests/support/print-digests.js > tests/support/reference-digests.json`. On Windows, run this from Git Bash or PowerShell 7: the `>` of Windows PowerShell 5.1 writes UTF-16, which the test cannot read.
3. Review it with `git diff tests/support/reference-digests.json`.
4. Raise `GAME_VERSION` ([`world.js:9`](../frontend/src/sim/config/world.js#L9)), so laydowns saved by the old version warn that they may not play the same.
5. If the shape of a saved laydown, run or figure set changed, regenerate the backend's fixtures (below).
6. Run the reference test again, and commit the digests with a message that says why they changed.

## Saved records and the database

**Fixtures.** [`write-fixtures.js`](../frontend/tests/support/write-fixtures.js) writes a sample laydown, run and figure set from the real game into [`backend/tests/fixtures/`](../backend/tests/fixtures/). The frontend checks that today's game still produces records of that shape ([`saving.test.js:273`](../frontend/tests/saving.test.js#L273)), and the backend checks that it accepts them and gives them back unchanged ([`test_contract.py`](../backend/tests/test_contract.py)). After a deliberate change of shape, from `frontend/`:

```bash
node tests/support/write-fixtures.js
```

Then update [`schemas.py`](../backend/app/schemas.py) to accept the new shape, and run both suites.

**Migrations.** A database change needs a new file in [`backend/app/db/migrations/`](../backend/app/db/migrations/) named with the next four-digit number, such as `0003_something.sql` ([`connection.py:8`](../backend/app/db/connection.py#L8)). At start-up each newer file runs inside one transaction and sets `PRAGMA user_version`; a database newer than the code is refused and left alone ([`connection.py:28`](../backend/app/db/connection.py#L28)). Never edit a migration that has shipped. Game data lives in JSON columns ([ADR 0002](adr/0002-sqlite-with-json-columns.md)), so a new tuning figure needs no migration, only a schema change.

## Values copied between programs

The game, the backend and the map builder cannot import each other, so some values are written in more than one place. Each copy has a comment naming the other, and a test reads the other program's source and fails if they drift.

| Values | Copies | Checked by |
|---|---|---|
| System ids, uplinks, cell bands, jam bands, protection levels, people's roles and limits, the 200-system cap, patrol vehicles and escort limits | [`schemas.py`](../backend/app/schemas.py#L9) and `frontend/src/sim/config/` | [`test_security.py:244`](../backend/tests/test_security.py#L244) |
| The shape of a drone id | `DroneTypeId` and the drone config | [`test_security.py:234`](../backend/tests/test_security.py#L234), which reads `drones.js`, `real-drones.js` and `real-drones-extra.js` |
| Echelons and deployment pack limits | [`account_schemas.py`](../backend/app/account_schemas.py#L25) and [`config/units.js`](../frontend/src/sim/config/units.js#L20) | [`test_units.py:113`](../backend/tests/test_units.py#L113) |
| World and pack widths, the Estonian file names, the northing that splits the British and Estonian grids | [`services/packs.py`](../backend/app/services/packs.py#L21), the builder and the game | [`test_mirrors.py`](../backend/tests/test_mirrors.py) |
| Saved record shapes | The game and `backend/tests/fixtures/` | [`saving.test.js:273`](../frontend/tests/saving.test.js#L273), [`test_contract.py`](../backend/tests/test_contract.py) |

## Conventions

- **UK English** in documentation, comments and on screen. **No em dashes**: use commas, colons, brackets or short sentences. A search on 2026-11-09 found none in the source or docs. Spell terms out on screen: a test refuses `FPV`, `FO`, `FW` or `SPT` as a drone's label ([`real-drones.test.js:28`](../frontend/tests/real-drones.test.js#L28)).
- **Hand-written source files stay within 350 lines.** [`boundary.test.js:47`](../frontend/tests/boundary.test.js#L47) checks every `.js` and `.jsx` file under `frontend/src`. When a file nears the limit, split it by responsibility, as the drone catalogue is split across `real-drones.js`, `real-drones-extra.js` and `real-drones-cots.js`.
- **Comments explain why,** not what the code plainly does. Each module opens with a comment saying what it is for.
- **`shortcut:` comments name a known limit** and when to lift it, in the form `shortcut: <the limit>, <when to upgrade>`, for example [`propagation.js:4`](../frontend/src/sim/propagation.js#L4). There are 18 in the source; list them with `grep -rn "shortcut:" frontend/src backend/app tools/mapbuild/mapbuild`.
- **Every figure carries its evidence.** A system's `ref` gives its sources, the basis for the game's number and a confidence; a drone's `costRef` the same for its price. A figure with no public source is labelled an assumption. The Sources tab shows all of it.
- **Money is stored in US dollars** and shown in pounds through `pounds()` and `money()` in [`economy.js:27`](../frontend/src/sim/economy.js#L27). Never format a price by hand.
- **The simulation's randomness comes only from [`rng.js`](../frontend/src/sim/rng.js).** Never `Math.random`, `Date.now` or the wall clock in `sim/`.
- **Every change to a game goes through a command,** so it is logged and replays. View-only state belongs in `render/view.js`, `tools.js` or a component.
- **Saved and imported data is untrusted.** The backend refuses anything outside its schemas; the game clamps saved settings to each system's limits ([`unit-config.js:3`](../frontend/src/sim/unit-config.js#L3)) and checks a map pack in full before use.

## Adding a real drone

A real drone is a variant of one of the four generic types (`spotter`, `fo`, `fpv`, `fw`). It starts from its type's values and overrides only what is public, or what would be plainly wrong ([`drones.js:81`](../frontend/src/sim/config/drones.js#L81)). The waves keep sending the generic types unless the player ticks it in the attack mix.

1. **Add the entry** to [`real-drones.js`](../frontend/src/sim/config/real-drones.js#L16), [`real-drones-extra.js`](../frontend/src/sim/config/real-drones-extra.js#L7) or, for a commercial drone, [`real-drones-cots.js`](../frontend/src/sim/config/real-drones-cots.js#L17), keeping each file under 350 lines. The id must match `^[a-z][a-z0-9_]{0,31}$`, the shape a save accepts. Give it at least: `variantOf`; `origin` as `Russia`, `Iran`, `China` or `Commercial off the shelf` (the pickers group by these); `name` (not the type's), `label`, `published`, `usedBy`, `speed`, `alt` as `[low, high]`, `cost` in US dollars, and `costRef` with `note`, `confidence` and `https` `sources`. Add `assumed` for anything not published, and the overrides that matter: `size`, `warhead`, `evade`, `rcs` and so on. The comment at the top of [`drones.js:6`](../frontend/src/sim/config/drones.js#L6) explains each field. Keep to published flight performance and reported warhead mass ([`real-drones.js:5`](../frontend/src/sim/config/real-drones.js#L5)).
2. **Give it a shape** if its type's does not fit: add it to `SHAPES` in [`drone-models.js:217`](../frontend/src/render/drone-models.js#L217). Otherwise it takes its type's shape.
3. **Paint it**: add a colour to `DRONES` in [`paint.js`](../frontend/src/render/paint.js#L28), with its source in [PAINT_SOURCES.md](PAINT_SOURCES.md). Without one it takes its type's colour.
4. **Run** `real-drones.test.js` (data complete, sources cited, flies in the sandbox), `drone-models.test.js` (the model's span is 0.9 to 1.8 times `size`, and the rotor count rule, which names two exceptions by id), `model-paint.test.js` and `attack-mix.test.js`. Run the reference test: it should not change, because the default waves do not send real drones.
5. **If you added a new file of drones**, add it to the list in [`test_security.py:237`](../backend/tests/test_security.py#L237) so its ids are checked too.
6. **Document it** in [DRONES.md](DRONES.md).

## Adding a sensor or effector

A real product is either one of a kind's three standard sizes (`size: 'S'`, `'M'` or `'L'`) or a further real system of a size, marked with `variantOf`. Copy the nearest existing entry of the same kind as a template.

1. **Add the entry** to [`sensors.js`](../frontend/src/sim/config/sensors.js#L7) or [`effectors.js`](../frontend/src/sim/config/effectors.js#L5), or to [`uk-systems.js`](../frontend/src/sim/config/uk-systems.js#L4), [`eu-systems.js`](../frontend/src/sim/config/eu-systems.js#L4) or, for a crewed system off the network, [`crew.js`](../frontend/src/sim/config/crew.js#L27). Every system needs `product`, `name`, `short`, `kind`, `role`, `cost`, `shotCost`, `color`, `published` (the open-field range in metres), `health`, `signature`, `emits`, `desc`, a `sapient` block, and a `ref` with `class`, `analogues`, `published`, `basis`, `confidence`, `sources` and `cost.capex`. Then what its kind reads:
   - A sensor: `mount`, `falseAlarm`, and for a radar `lowAlt`, `lowRange` and `elevation` (plus `arc` for a fixed panel); an RF detector's `sensitivity`; a camera's view and optics. Read the sibling entries.
   - An effector: `fire` (`guided`, `beam` or `jam`). Anything but a jammer needs `magazine`, `reloadTime` and a `shotCost` above zero ([`magazine.test.js:36`](../frontend/tests/magazine.test.js#L36)). A guided weapon needs `pk` between 0 and 1, and a `ref.basis` that states the hit chance ([`hit-chance.test.js:21`](../frontend/tests/hit-chance.test.js#L21)). An interceptor lists the drone types it can take in `engages`. A jammer needs `bands`, `slow` and `killTime`.
2. **List it** in its kind's row of `TOOLBAR` ([`systems.js:13`](../frontend/src/sim/config/systems.js#L13)), small to large. A test checks every system is in exactly one row of its own kind, and that a row's standard sizes run S, M, L ([`sizes.test.jsx:27`](../frontend/tests/sizes.test.jsx#L27)).
3. **Let saves accept it**: add the id to `SystemId` in [`schemas.py:9`](../backend/app/schemas.py#L9).
4. **Radars and jammers** need their transmit power in `TX_POWER` ([`tx-power.js:9`](../frontend/src/sim/config/tx-power.js#L9)), published or labelled an assumption; the Unit panel's power setting reads it.
5. **Give it settings**: every system needs at least one field in `UNIT_FIELDS` ([`unit-config.js:44`](../frontend/src/sim/unit-config.js#L44)). Most radar, RF, camera and jammer fields apply to the whole row automatically, but some limits are listed by id: mast height (`mount`), fixed panels (`PANELLED`), zoom lenses (`ZOOMS`), lens F-number, and for weapons the time between shots (`reload`) or beam damage (`beam`). Add the id wherever it applies.
6. **Vehicles**: if a patrol vehicle can carry it, add it to `MOUNTS` ([`patrol.js:35`](../frontend/src/sim/config/patrol.js#L35)).
7. **Paint it**: add a colour to `SYSTEMS` in [`paint.js:11`](../frontend/src/render/paint.js#L11), with its source in [PAINT_SOURCES.md](PAINT_SOURCES.md). Its model comes from its kind's shape ([`models.js:17`](../frontend/src/render/models.js#L17)), which may read its fields; check it in a browser.
8. **Run** `sizes.test.jsx` (which also plays a wave with each system), `system-models.test.js`, `model-paint.test.js`, `unit-config.test.jsx`, `unit-panel.test.jsx`, `tool-picker.test.jsx`, `real-ranges.test.js` and, for weapons, `magazine.test.js`, `hit-chance.test.js` and `new-kinds.test.js`. Run the backend's `test_security.py`. Run the reference test: a system no scenario places should not change it.
9. **Document it** in [SENSORS.md](SENSORS.md) or [EFFECTORS.md](EFFECTORS.md).

## Adding a new kind

A new kind of system, fire mode or generic drone type reaches much further than a product, and needs its own design.

- **A kind of system** needs a new `TOOLBAR` row with its own hotkey, a model shape in `SYSTEM_SHAPES` ([`models.js:17`](../frontend/src/render/models.js#L17)), map symbols, and handling wherever the code branches on `def.kind`: detection and classification in [`network/sensors.js`](../frontend/src/sim/network/sensors.js#L154), [`sensor-model.js`](../frontend/src/sim/sensor-model.js), [`site-range.js`](../frontend/src/sim/site-range.js), [`unit-config.js`](../frontend/src/sim/unit-config.js), tasking, the Unit panel and the wizard. `grep -rn "kind === '" frontend/src` lists them.
- **A fire mode** needs a handler in `FIRE` ([`effectors.js:57`](../frontend/src/sim/effectors.js#L57)) and changes wherever `def.fire` is read: magazines, tasking, statistics, the Cost tab and the HUD. `grep -rn "fire === '" frontend/src` lists them.
- **A generic drone type** changes the waves themselves. A wave has four fixed slots, one per generic type ([`attack-mix.js:22`](../frontend/src/sim/attack-mix.js#L22), [`waves.js:58`](../frontend/src/sim/waves.js#L58)), and the default mix is every generic type ([`attack-mix.js:7`](../frontend/src/sim/attack-mix.js#L7)), so it changes every reference digest. `real-drones.test.js` also spells out the four types by name.

## Other tools

- `npm --prefix frontend run balance` plays several laydowns on several seeds in Node and prints how far each got ([`tools/balance.js`](../frontend/tools/balance.js)). It is heavy: run it alone.
- `npm --prefix frontend run measure` plays the five reference runs and three more seeds of the mixed laydown, watches the fusion node's picture and tasking at every step, and prints the tables of [FUSION_AND_TARGETING.md](FUSION_AND_TARGETING.md#measured-performance) ([`tools/measure-fusion.js`](../frontend/tools/measure-fusion.js)). It stops if a reference run does not end on its recorded digest. Run it after recording digests again, and copy the new figures into that page.
- `npm --prefix frontend run models -- [folder]` saves every drone model as a `.glb` file, by default to `frontend/models/`, which git ignores ([`tools/export-drone-models.js`](../frontend/tools/export-drone-models.js)).

## Limits and simplifications

These are the tooling gaps as of 2026-11-09, checked by searching the repository:

- **No JavaScript linter or formatter.** There is no ESLint or Prettier configuration, and neither is installed, yet eight files carry `eslint-disable` comments: `game.js`, `ui/hooks.js`, `ui/MapControls.jsx`, `ui/SiteMap.jsx`, `ui/SiteStatus.jsx`, `ui/WorldPicker.jsx`, `ui/account/ProfileHub.jsx` and `ui/assistant/Wizard.jsx`. Those comments do nothing today.
- **No Python linter or type checker.** Neither `pyproject.toml` configures ruff, flake8, black, mypy or pyright, and there are no separate configuration files for them.
- **No automated browser test.** `render/` is outside the coverage measure and is checked by hand.
- **The 350-line check covers JavaScript under `frontend/src` only.** It does not look at CSS, Python or tests. The former 446-line stylesheet is now split into the 274-line `style.css`, `ui/unit-panels.css`, `ui/assistant/wizard.css` and `ui/map-panels.css`, imported in the original cascade order. Several older test files exceed 350 lines.
- **The map builder's tests have no coverage gate.**
- **No gentle test script.** The memory-safe frontend command above is not an npm script.

## Where this lives in the code

- [`frontend/package.json`](../frontend/package.json): npm scripts and pinned packages.
- [`frontend/vite.config.js`](../frontend/vite.config.js): the dev server, its port and the `/api` pass-through.
- [`frontend/vitest.config.js`](../frontend/vitest.config.js): test files, timeouts and coverage thresholds.
- [`backend/pyproject.toml`](../backend/pyproject.toml) and [`tools/mapbuild/pyproject.toml`](../tools/mapbuild/pyproject.toml): Python versions, dependencies and pytest settings.
- [`frontend/tests/support/`](../frontend/tests/support/): the scenarios, digest printer, saved-run replay, fixtures writer and fake backend.
- [`frontend/tests/boundary.test.js`](../frontend/tests/boundary.test.js): the layer rules and the file-size check.
- [`backend/tests/conftest.py`](../backend/tests/conftest.py): the backend's test fixtures.
- [`backend/app/db/migrations/`](../backend/app/db/migrations/): numbered database migrations.
- [`frontend/src/sim/config/`](../frontend/src/sim/config/): every drone, sensor and effector, with its evidence.
