# Backend API

The HTTP API of the Site Guard backend: every route, what it accepts and returns, its status codes, and the rules that apply to all of them. It is for developers working on the frontend client, the backend or the tests. The route list was generated from the running application's OpenAPI schema on 2026-11-09 and checked against the code.

## Contents

- [Global rules](#global-rules)
- [Route list](#route-list)
- [Status codes and errors](#status-codes-and-errors)
- [Auth and accounts](#auth-and-accounts)
- [Deployment packs (units)](#deployment-packs-units)
- [Laydowns](#laydowns)
- [Runs](#runs)
- [Figure sets](#figure-sets)
- [Map packs and builds](#map-packs-and-builds)
- [Lab results](#lab-results)
- [Health, schema and the game](#health-schema-and-the-game)
- [Shared types and limits](#shared-types-and-limits)
- [Limits and simplifications](#limits-and-simplifications)
- [Where this lives in the code](#where-this-lives-in-the-code)

## Global rules

- **Base path.** Every route is under `/api/v1`. The OpenAPI schema is at `/api/v1/openapi.json`. The interactive docs pages are switched off, because they load scripts from a CDN and the game works offline ([`main.py:40`](../backend/app/main.py#L40)).
- **This machine only.** The server listens on `127.0.0.1:8200` ([`__main__.py:9`](../backend/app/__main__.py#L9)). A request whose `Host` header is not `localhost` or `127.0.0.1` gets `400` with the plain text `Invalid host header` ([`security.py:8`](../backend/app/security.py#L8), [`main.py:83`](../backend/app/main.py#L83)). This stops DNS rebinding, where a hostile site's name is pointed at 127.0.0.1.
- **JSON only.** A `POST`, `PUT` or `PATCH` whose `Content-Type` is not `application/json` (a `charset` parameter is fine) gets `415` `{"detail": "Send JSON"}` ([`security.py:30`](../backend/app/security.py#L30)). This applies even to routes that read no body, such as sign-out.
- **1 MiB cap.** A body over 1,048,576 bytes gets `413` `{"detail": "Request too large"}`. The declared `Content-Length` is checked first, and a non-numeric one is refused the same way. The bytes are then counted as they arrive, so a body that hides its size is still stopped ([`security.py:33`](../backend/app/security.py#L33)).
- **Sessions.** Signing in or registering sets a cookie `sg_session` with `HttpOnly`, `SameSite=Strict` and `Path=/api` ([`routes/auth.py:40`](../backend/app/routes/auth.py#L40)). It is not `Secure`, because the game is served over plain http on localhost. With "keep me signed in" it has a `Max-Age` of 30 days; otherwise it is a browser-session cookie. The server forgets a session after 12 hours, or 30 days if remembered ([`accounts.py:20`](../backend/app/services/accounts.py#L20)). The token is 32 random bytes, and only its SHA-256 is stored.
- **Cross-site requests.** There is no CSRF token. Instead: the cookie is `SameSite=Strict`, so another site's pages do not send it; writes must be JSON, which a cross-site form cannot send and a script can only send after a CORS preflight; and the server sends no CORS headers, so that preflight never succeeds. The host check covers the DNS rebinding route round these.
- **Strict input.** Every request body refuses unknown fields and non-finite numbers (`Strict`, [`schemas.py:66`](../backend/app/schemas.py#L66)), and every string, list and number has a limit (see [Shared types and limits](#shared-types-and-limits)). Validation errors never echo the input back.
- **Record ids** in a path are integers from 1 to 2^63 - 1. Anything else gets `422` ([`routes/api.py:17`](../backend/app/routes/api.py#L17)).
- **Timestamps** (`created_at`, `updated_at`, `finished_at`, `last_sign_in`) are set by the server, as ISO 8601 text in UTC ([`records.py:15`](../backend/app/services/records.py#L15)).
- **Money.** Costs and budgets are US dollars, as the game's config and simulation hold them. The game shows them in pounds at 0.75 ([`economy.js:26`](../frontend/src/sim/economy.js#L26)); the API does no conversion.
- **Headers on every response,** refusals included: a strict `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cross-Origin-Resource-Policy: same-origin` ([`security.py:10`](../backend/app/security.py#L10)). Responses under `/api/` also carry `Cache-Control: no-store`, so profiles and saves do not linger in the browser cache after signing out.

## Route list

"Session" means the route needs a valid `sg_session` cookie, and answers `401` `{"detail": "Sign in first"}` without one ([`routes/auth.py:28`](../backend/app/routes/auth.py#L28)).

| Method | Path | Session | Success |
|---|---|---|---|
| GET | `/api/v1/health` | No | 200 |
| POST | `/api/v1/auth/register` | No | 201 |
| POST | `/api/v1/auth/sign-in` | No | 200 |
| POST | `/api/v1/auth/sign-out` | No | 204 |
| POST | `/api/v1/auth/reset` | No | 200 |
| GET | `/api/v1/auth/me` | Yes | 200 |
| PUT | `/api/v1/auth/me` | Yes | 200 |
| POST | `/api/v1/auth/password` | Yes | 204 |
| POST | `/api/v1/auth/recovery-code` | Yes | 200 |
| POST | `/api/v1/auth/delete-account` | Yes | 204 |
| GET | `/api/v1/units` | Yes | 200 |
| POST | `/api/v1/units` | Yes | 201 |
| GET | `/api/v1/units/{unit_id}` | Yes | 200 |
| PUT | `/api/v1/units/{unit_id}` | Yes | 200 |
| DELETE | `/api/v1/units/{unit_id}` | Yes | 204 |
| GET | `/api/v1/laydowns` | Yes | 200 |
| POST | `/api/v1/laydowns` | Yes | 201 |
| GET | `/api/v1/laydowns/{laydown_id}` | Yes | 200 |
| PUT | `/api/v1/laydowns/{laydown_id}` | Yes | 200 |
| DELETE | `/api/v1/laydowns/{laydown_id}` | Yes | 204 |
| GET | `/api/v1/runs` | Yes | 200 |
| POST | `/api/v1/runs` | Yes | 201 |
| GET | `/api/v1/runs/{run_id}` | Yes | 200 |
| DELETE | `/api/v1/runs/{run_id}` | Yes | 204 |
| GET | `/api/v1/figure-sets` | Yes | 200 |
| POST | `/api/v1/figure-sets` | Yes | 201 |
| GET | `/api/v1/figure-sets/{figure_set_id}` | Yes | 200 |
| DELETE | `/api/v1/figure-sets/{figure_set_id}` | Yes | 204 |
| GET | `/api/v1/packs` | Yes | 200 |
| GET | `/api/v1/packs/downloads` | Yes | 200 |
| GET | `/api/v1/packs/build` | Yes | 200 |
| POST | `/api/v1/packs/build` | Yes | 202 |
| GET | `/api/v1/packs/{name}` | Yes | 200 |
| GET | `/api/v1/lab` | Yes | 200 |
| GET | `/api/v1/lab/laydowns/{name}` | Yes | 200 |
| GET | `/api/v1/lab/report` | Yes | 200 |
| GET | `/api/v1/openapi.json` | No | 200 |

Which routers need a session is set where they are included ([`main.py:45`](../backend/app/main.py#L45)). The unit routes check it through their own dependency ([`routes/units.py:17`](../backend/app/routes/units.py#L17)), which also gives them the account id.

## Status codes and errors

Refusals carry `{"detail": "<text>"}`, except validation errors, which carry a list of `{"loc": [...], "msg": "..."}` that says what is wrong and where without repeating the value ([`main.py:69`](../backend/app/main.py#L69)).

| Code | When | Detail |
|---|---|---|
| 400 | `Host` is not `localhost` or `127.0.0.1` | `Invalid host header` (plain text) |
| 401 | No valid session on a route that needs one | `Sign in first` |
| 401 | Wrong username, password or recovery code | `Wrong username, password or recovery code`. Which part was wrong is never said |
| 403 | Registering when the server already holds 500 accounts | `This server has as many accounts as it allows` |
| 404 | No record with that id, another account's deployment pack, or no pack file of that name | `Not found` |
| 409 | Username taken; an account's 51st deployment pack; a map build already running, or one that would cross the disk limits (see [Build limits](#map-packs-and-builds)) | See each route |
| 413 | Body over 1 MiB, or a `Content-Length` that is not a number | `Request too large` |
| 415 | A write that is not JSON | `Send JSON` |
| 422 | A body, path or query that fails validation | A list of `loc` and `msg` |
| 422 | A new password equal to the username, on `/auth/password` | `The new password must not be the username` |
| 429 | The account is locked after five failed tries | `Too many failed attempts. Try again in N minutes.` (`1 minute` when one is left), with a `Retry-After` header in seconds ([`main.py:64`](../backend/app/main.py#L64)) |
| 429 | A map build past the daily limit (see [Build limits](#map-packs-and-builds)) | `The map build daily limit has been reached.`, with a `Retry-After` header in seconds |
| 503 | `GET /` when the game has not been built | `The game has not been built yet. Run: npm --prefix frontend run build` |

The browser client ([`client.js:21`](../frontend/src/api/client.js#L21)) treats a network failure or any `5xx` as "the save server is not running", and a `401` from `/auth/me` or any non-auth route as the session ending, which brings the login page back over the game.

## Auth and accounts

Accounts are local to the machine ([ADR 0004](adr/0004-local-accounts-with-recovery-codes.md)). Passwords and recovery codes are hashed with scrypt (N = 2^14, r = 8, p = 5, [`accounts.py:17`](../backend/app/services/accounts.py#L17)), each with its own salt.

**Lockout.** Five failed tries lock the account for 300 seconds ([`accounts.py:18`](../backend/app/services/accounts.py#L18)). Password and recovery code tries share the count, and so do the password confirmations on `/auth/password`, `/auth/recovery-code` and `/auth/delete-account`. Each try is counted before the slow hash, so a burst sent at once still locks after five. An unknown username is checked against a dummy hash, so it takes as long to refuse as a wrong password ([`accounts.py:60`](../backend/app/services/accounts.py#L60)). Usernames are unique whatever their case ([`0002_accounts.sql:5`](../backend/app/db/migrations/0002_accounts.sql#L5)).

**Recovery codes** are 120 random bits written as four groups of six base-32 characters joined by hyphens ([`accounts.py:63`](../backend/app/services/accounts.py#L63)). When one is checked, case and anything that is not a letter or digit are ignored.

**The profile** returned by several routes (`Profile`, [`account_schemas.py:84`](../backend/app/account_schemas.py#L84)):

```json
{ "username": "...", "display_name": "...", "rank": "...", "organisation": "...", "created_at": "...", "last_sign_in": "..." }
```

`last_sign_in` can be `null`.

| Route | Body | Response | Notes |
|---|---|---|---|
| `POST /auth/register` | `username`: 3 to 32 characters, a letter or digit then letters, digits, `_`, `.` or `-`; `display_name`: 1 to 60 characters; `password`: 10 to 128 characters, not the username in any case | `201` `{ "user": Profile, "recovery_code": "..." }` | Signs the new account in with a browser-session cookie. The recovery code is shown this once; only its hash is kept. `409` `That username is taken`; `403` at 500 accounts |
| `POST /auth/sign-in` | `username`: 1 to 32 characters; `password`: 1 to 128; `remember`: boolean, default `false` | `200` Profile | Sets the cookie. `401` on a wrong username or password, `429` when locked |
| `POST /auth/sign-out` | Ignored, but sent as JSON (the client sends `{}`) | `204` | Forgets the session if there is one and clears the cookie. Needs no session |
| `POST /auth/reset` | `username`: 1 to 32; `recovery_code`: 1 to 64 characters; `new_password`: 10 to 128, not the username | `200` `{ "recovery_code": "..." }` | Sets the new password, signs the account out everywhere, and returns a new recovery code; the old one stops working |
| `GET /auth/me` | | `200` Profile | |
| `PUT /auth/me` | `display_name`: 1 to 60; `rank`, `organisation`: up to 60 each, default empty | `200` Profile | No control characters in any of them |
| `POST /auth/password` | `current_password`: 1 to 128; `new_password`: 10 to 128 | `204` | Signs out every other session of the account. `422` if the new password is the username |
| `POST /auth/recovery-code` | `password`: 1 to 128 | `200` `{ "recovery_code": "..." }` | Replaces the recovery code |
| `POST /auth/delete-account` | `password`: 1 to 128 | `204` | Deletes the account with its sessions and deployment packs, and clears the cookie. Laydowns, runs and figure sets stay, as they are shared |

Sources: [`routes/auth.py`](../backend/app/routes/auth.py#L48), [`account_schemas.py:25`](../backend/app/account_schemas.py#L25), [`accounts.py`](../backend/app/services/accounts.py#L83).

## Deployment packs (units)

A deployment pack is a military unit with the systems, vehicles and people assigned to it. Each belongs to the account that made it: every query includes the account's id, so another account's pack is a `404` ([`account_stores.py:150`](../backend/app/db/account_stores.py#L150)). An account may keep 50 packs; the 51st is `409` `You have as many deployment packs as you may keep. Delete one first.` ([`units.py:9`](../backend/app/services/units.py#L9)).

| Route | Body | Response |
|---|---|---|
| `GET /units` | | `200` list of `UnitSummary`, newest change first |
| `POST /units` | `UnitIn` | `201` `UnitOut` |
| `GET /units/{unit_id}` | | `200` `UnitOut` |
| `PUT /units/{unit_id}` | `UnitIn` | `200` `UnitOut` |
| `DELETE /units/{unit_id}` | | `204` |

`UnitIn` ([`account_schemas.py:132`](../backend/app/account_schemas.py#L132)):

| Field | Rule |
|---|---|
| `name` | `Name` |
| `echelon` | `fireteam`, `section`, `platoon`, `troop`, `company`, `squadron`, `battery` or `battalion` |
| `callsign` | `Callsign`, or `null` (default) |
| `assets.systems` | Up to 40 lines, each system id once: `{ id: SystemId, count: 1 to 50, settings?: Settings }` |
| `assets.vehicles` | Up to 3 lines, each vehicle once: `{ id: PatrolVehicle, count: 1 to 50 }` |
| `assets.people` | Up to 20 lines, each one group: `{ count: 1 to 500, protection: Protection }` |

`UnitSummary` is `{ id, name, echelon, callsign, created_at, updated_at }`; `UnitOut` adds `assets`.

## Laydowns

A laydown is a saved set of placed systems, wiring, people, the area to defend and any patrol, on a named world. Laydowns are shared by every account. They can be replaced.

| Route | Body | Response |
|---|---|---|
| `GET /laydowns` | | `200` list of `{ id, name, world, game_version, created_at, updated_at }`, newest change first |
| `POST /laydowns` | `LaydownIn` | `201` `LaydownOut` |
| `GET /laydowns/{laydown_id}` | | `200` `LaydownOut` |
| `PUT /laydowns/{laydown_id}` | `LaydownIn` | `200` `LaydownOut` |
| `DELETE /laydowns/{laydown_id}` | | `204` |

`LaydownIn` is `{ name: Name, world: Seed, spec: LaydownSpec, game_version: GameVersion }` ([`schemas.py:150`](../backend/app/schemas.py#L150)). `LaydownOut` is the summary plus `spec`. `world` is a terrain seed or a real-map id (see [ARCHITECTURE.md](ARCHITECTURE.md#how-a-world-is-chosen-and-built)).

`LaydownSpec` ([`schemas.py:110`](../backend/app/schemas.py#L110)) is the shape of `captureLaydown()` in [`laydown.js`](../frontend/src/sim/laydown.js):

| Field | Rule |
|---|---|
| `structures` | Up to 200 `PlacedSystem` |
| `fusionUplinks` | Up to 2 of `Uplink` |
| `fusionCell` | `CellBand` |
| `attack` | Optional. 1 to 64 `DroneTypeId`: the drones the waves send |
| `conditions` | Optional. `day`, `dusk`, `night` or `rain` |
| `people` | Optional. Up to 50 `{ x, z: Coordinate, count: 1 to 500, protection: Protection, role?: "military" }` |
| `zone` | Optional. 3 to 32 points `[x, z]` of `Coordinate`: the area to defend |
| `patrol` | Optional. 2 to 32 points `[x, z]`: a patrol route ([PATROL_MODE.md](PATROL_MODE.md)) |
| `patrolColumn` | Optional. 1 to 6 escorts `{ vehicle: PatrolVehicle, system: SystemId, gap: -200 to 200 m, side?: -100 to 100 m }` |
| `patrolPlan` | Optional. `{ width, formation }`: `width` 20 to 1,000 m, `formation` one of `file`, `staggered` or `wedge` |

`PlacedSystem` ([`schemas.py:70`](../backend/app/schemas.py#L70)):

| Field | Rule |
|---|---|
| `id` | `SystemId` |
| `x`, `z` | `Coordinate` |
| `uplink` | `Uplink` or `null` |
| `cellBand` | `CellBand` |
| `jam` | Up to 4 `JamBand`, or `null` |
| `on` | Optional. `true` for a jammer switched on by hand |
| `settings` | Optional. `Settings` |
| `name` | Optional. 1 to 40 characters after trimming, no control characters |
| `callsign` | Optional. `Callsign` |
| `vehicle` | Optional. `PatrolVehicle` it is parked on |

Optional fields left out by the game are left out of the response too.

## Runs

A run is the record of a finished game, made by the browser when the run ends ([`run-record.js:10`](../frontend/src/sim/run-record.js#L10)). Runs can be deleted but never edited: there is no `PUT` ([`records.py:67`](../backend/app/services/records.py#L67)). The server stores the results it is sent and does not replay them, so a run is not proof of a score.

| Route | Body or query | Response |
|---|---|---|
| `GET /runs` | `limit`: 1 to 100, default 25; `offset`: 0 or more, default 0 | `200` `{ "items": [RunSummary], "total": n }`, newest first |
| `POST /runs` | `RunIn` | `201` `RunOut` |
| `GET /runs/{run_id}` | | `200` `RunOut` |
| `DELETE /runs/{run_id}` | | `204` |

`RunIn` ([`schemas.py:170`](../backend/app/schemas.py#L170)):

| Field | Rule |
|---|---|
| `scenario_seed`, `world` | `Seed` |
| `spec` | `LaydownSpec`: the laydown the run started with |
| `figures` | `Figures`: the figures in force |
| `commands` | Up to 20,000 `{ step: Count, name: 1 to 40 letters, args: up to 8 JSON values }` |
| `game_version` | `GameVersion` |
| `digest` | 1 to 16 lower-case hex digits |
| `waves_completed`, `kills`, `leaks` | `Count` |
| `health` | 0 to 100 |
| `budget_left`, `capex`, `consumables`, `enemy_cost` | `Money` |

`RunSummary` is every field but `spec`, `figures` and `commands`, plus `id` and `finished_at`. `RunOut` adds those three back.

## Figure sets

A figure set is a named set of edits to the researched figures, as exported by the Sources tab. Shared by every account. Created and deleted, never edited.

| Route | Body | Response |
|---|---|---|
| `GET /figure-sets` | | `200` list of `{ id, name, game_version, created_at }`, newest first |
| `POST /figure-sets` | `{ name: Name, figures: Figures, game_version: GameVersion }` | `201` `FigureSetOut` |
| `GET /figure-sets/{figure_set_id}` | | `200` `FigureSetOut`: the summary plus `figures` |
| `DELETE /figure-sets/{figure_set_id}` | | `204` |

`Figures` ([`schemas.py:131`](../backend/app/schemas.py#L131)) is the shape of `exportFigures()` in [`figures.js`](../frontend/src/sim/config/figures.js), holding only figures that differ from the researched ones:

| Field | Rule |
|---|---|
| `structures`, `drones`, `comms`, `people`, `patrol` | Up to 40 items, each `{ FigureKey: Figure }` with up to 40 figures. `people` and `patrol` are left out of responses when empty |
| `world`, `waves`, `adapt` | Up to 4 `{ FigureKey: Figure }` each |

## Map packs and builds

Map packs are files in the maps folder's `packs/` (`~/site-guard-maps`, or `SITE_GUARD_MAPS`, [`services/packs.py:45`](../backend/app/services/packs.py#L45)). The server only lists and serves them: the browser checks every file in full before use ([`pack-store.js:48`](../frontend/src/api/pack-store.js#L48)). See [MAPS.md](MAPS.md) for the format and how packs are built.

| Route | Body | Response |
|---|---|---|
| `GET /packs` | | `200` list of `{ file, hash, name, east, north, half, tier, lidarHalf }`, one per readable `.sgmap` file, read from each file's header. A file that is not a readable pack is left out |
| `GET /packs/downloads` | | `200` `{ "terrain50": bool, "squares": ["SU", ...], "estonia": { "heights": bool, "surface": bool, "features": bool } }`: the OS and Estonian downloads already on this computer. A 100 km square counts only when both of its OS products are there |
| `GET /packs/build` | | `200` `{ "running": bool, "ok": bool or null, "message": "..." }` |
| `POST /packs/build` | `{ east: 0 to 999,999, north: 0 to 9,999,999, lidar: bool }` | `202` the build status |
| `GET /packs/{name}` | | `200` the file, as `application/octet-stream` |

**Building.** `east` and `north` are metres on the British National Grid, or on the Estonian grid inside eastings 360,000 to 749,999 and northings 6,365,000 to 6,639,999 ([`services/packs.py:23`](../backend/app/services/packs.py#L23)). A position on neither grid is a `422` whose message says it is outside the maps this can build ([`routes/packs.py:21`](../backend/app/routes/packs.py#L21)). Only one build runs at a time; a second is `409` `A map is already being built.` The build runs the map builder as a separate process with fixed arguments: a pack 70 km across named `area_<east km>_<north km>.sgmap`, with lidar across 54 km in Great Britain or the whole 70 km in Estonia when `lidar` is true ([`services/packs.py:166`](../backend/app/services/packs.py#L166)). `202` is returned even when the builder could not start: the status then has `ok: false` and says why. Poll `GET /packs/build` for progress; `message` is the last line the builder printed, cut to 200 characters.

**Build limits** ([`services/packs.py:25`](../backend/app/services/packs.py#L25)). All accounts share one map store and one builder, so builds are bounded on the server.

| Limit | Value | Refusal |
|---|---|---|
| Builds started in any rolling 24 hours | 12 across all accounts, 8 for one account | `429` with `Retry-After` |
| Free disk space before a build starts | At least 8,000,000,000 bytes | `409` `The map build stopped at the free disk reserve.` |
| Everything in the maps folder | Under 40,000,000,000 bytes | `409` `The map build stopped at the map storage limit.` |
| One build's running time | 4 hours | The build is stopped |

The disk checks run before a build starts and again every second while it runs; a build that crosses one, or the time limit, is stopped with the builder's child processes, and the status says which limit stopped it ([`services/packs.py:225`](../backend/app/services/packs.py#L225)). If the disk cannot be checked, the build is refused with `409` `The map storage could not be checked.` The start counts are kept in memory, so restarting the server clears them.

**Fetching a file.** `name` must match `^[A-Za-z0-9_-]{1,64}\.sgmap$` and be a file in the packs folder; anything else is `404` ([`services/packs.py:18`](../backend/app/services/packs.py#L18)), so a request cannot reach any other file.

## Lab results

Read-only, for what [`frontend/tools/lab`](../frontend/tools/lab/lab.mjs) writes in `frontend/lab-results/` (set `SITE_GUARD_LAB` to read another folder). The Lab tab in the game uses these ([`routes/lab.py`](../backend/app/routes/lab.py)).

| Route | Body | Response |
|---|---|---|
| `GET /lab` | | `200` `{ "laydowns": [{ file, name, world, systems, lab }], "report": bool }`. One row per readable laydown file in `laydowns/`, those with a measured result first, best first. `lab` is what the search recorded for it (sites, waves on unseen seeds, cost, cost per £1 destroyed), or `null` |
| `GET /lab/laydowns/{name}` | | `200` the laydown file, as JSON. `{name}` must be a plain `.json` file name in that folder, and the file must hold a laydown, or it is `404` |
| `GET /lab/report` | | `200` the lab's report page, or `404` if none has been built |

The report is one self-contained page with its own inline script and style. It is the only response sent with a looser `Content-Security-Policy`: it may run its own inline script and style, and may load or connect to nothing ([`security.py`](../backend/app/security.py)).

## Health, schema and the game

| Route | Response |
|---|---|
| `GET /api/v1/health` | `200` `{ "status": "ok" }`. The login page uses it to show whether the server is running ([`AuthScreen.jsx:24`](../frontend/src/ui/account/AuthScreen.jsx#L24)) |
| `GET /api/v1/openapi.json` | `200` the OpenAPI schema |
| `GET /` and any other path | The built game from `frontend/dist`, and nothing else from the project folder ([`main.py:75`](../backend/app/main.py#L75)). `503` from `GET /` if it has not been built |

## Shared types and limits

From [`schemas.py`](../backend/app/schemas.py) and [`account_schemas.py`](../backend/app/account_schemas.py). "Trimmed" means leading and trailing spaces are removed before the length is checked.

| Type | Rule | Line |
|---|---|---|
| `Name` | 1 to 100 characters, trimmed, no control characters | [`schemas.py:47`](../backend/app/schemas.py#L47) |
| `Seed` | 1 to 64 characters, no control characters | [`schemas.py:48`](../backend/app/schemas.py#L48) |
| `GameVersion` | `^[0-9A-Za-z.+-]{1,32}$` | [`schemas.py:49`](../backend/app/schemas.py#L49) |
| `Coordinate` | -1,350 to 1,350 scene units (20 m a unit, so 27 km either way of the site) | [`schemas.py:29`](../backend/app/schemas.py#L29) |
| `Count` | Integer, 0 to 1,000,000,000 | [`schemas.py:51`](../backend/app/schemas.py#L51) |
| `Money` | -10^10 to 10^10, US dollars | [`schemas.py:52`](../backend/app/schemas.py#L52) |
| `FigureKey` | `^[A-Za-z0-9_]{1,32}$` | [`schemas.py:55`](../backend/app/schemas.py#L55) |
| `Figure` | 0 to 10^12 | [`schemas.py:56`](../backend/app/schemas.py#L56) |
| `SystemId` | One of the 50 system ids in the game's catalogue | [`schemas.py:9`](../backend/app/schemas.py#L9) |
| `Uplink` | `starlink`, `cellular` | [`schemas.py:15`](../backend/app/schemas.py#L15) |
| `CellBand` | `B8`, `B3`, `n78` | [`schemas.py:16`](../backend/app/schemas.py#L16) |
| `JamBand` | `control900`, `control24`, `video58`, `gnss` | [`schemas.py:17`](../backend/app/schemas.py#L17) |
| `DroneTypeId` | `^[a-z][a-z0-9_]{0,31}$`. Shape only: the game keeps only ids it knows | [`schemas.py:19`](../backend/app/schemas.py#L19) |
| `Protection` | `open`, `building`, `bunker` | [`schemas.py:21`](../backend/app/schemas.py#L21) |
| `PatrolVehicle` | `patria`, `hilux`, `themis` | [`schemas.py:22`](../backend/app/schemas.py#L22) |
| `Callsign` | `^[A-Za-z0-9][A-Za-z0-9 -]{0,11}$` | [`schemas.py:63`](../backend/app/schemas.py#L63) |
| `Settings` | Up to 16 entries `{ FigureKey: value }`, where a value is a number from -150 to 10^12, a choice `^[a-z]{1,16}$`, up to 3 arcs `[from, to]` of whole degrees 0 to 359, or 1 to 4 `JamBand`. Shape and coarse bounds only: the game clamps each to the system's own limits on load | [`schemas.py:79`](../backend/app/schemas.py#L79) |

The game's own limits are set to fit inside these: for example the game stops placing systems at 200, the most a save holds ([`world.js:39`](../frontend/src/sim/config/world.js#L39)). Tests compare the names and limits here with the game's config so the two cannot drift; see [DEVELOPING.md](DEVELOPING.md#values-copied-between-programs).

## Limits and simplifications

- **No versioning beyond the path.** Saved records carry the game's `GAME_VERSION`, but the API itself has one version, `v1`, and no deprecation scheme.
- **Little rate limiting.** Only sign-in (the per-account lockout) and map builds (the daily limit) are limited. The server is reachable only from this machine.
- **Shared saves.** Laydowns, runs and figure sets have no owner: any signed-in account can read and delete any of them ([ADR 0004](adr/0004-local-accounts-with-recovery-codes.md)). Only deployment packs are private.
- **Results are trusted as sent.** The server checks a run's shape and bounds, not that its results follow from its log.
- **Single process.** One build at a time, tracked in memory: restarting the server forgets a build's status and the daily build count.
- **Plain http.** Before serving this beyond localhost it needs HTTPS and `Secure` cookies, and more; see [SECURITY_NOTES.md](SECURITY_NOTES.md).

## Where this lives in the code

- [`backend/app/main.py`](../backend/app/main.py): routers, error mapping, static files and middleware order.
- [`backend/app/security.py`](../backend/app/security.py): host list, JSON-only writes, the body cap and headers.
- [`backend/app/routes/auth.py`](../backend/app/routes/auth.py), [`api.py`](../backend/app/routes/api.py), [`units.py`](../backend/app/routes/units.py), [`packs.py`](../backend/app/routes/packs.py): the routes.
- [`backend/app/schemas.py`](../backend/app/schemas.py) and [`account_schemas.py`](../backend/app/account_schemas.py): every request and response shape.
- [`backend/app/services/`](../backend/app/services/): the rules behind each route.
- [`frontend/src/api/client.js`](../frontend/src/api/client.js): the browser's client for all of these.
- [`backend/tests/`](../backend/tests/): the API, security, accounts, units, packs and contract tests.
