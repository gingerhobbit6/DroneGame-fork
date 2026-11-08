# Security notes

## What this protects against

Site Guard runs on one machine, with no configured secrets. Each player signs in to a local account, which holds their profile and deployment packs. Saved laydowns, run history and tuning figures stay shared by every account on the machine, by choice. The realistic threats are:

1. **A web page you visit** trying to read or change the local service through your browser.
2. **Someone on your network** reaching the service.
3. **A crafted link or file** running script in the game, or corrupting saved data.
4. **Another account on the same machine** reading or changing someone's packs, or guessing their password.
5. **A compromised dependency.**

It is not built to be hosted. See [Before hosting](#before-hosting).

## Protections

| Threat | Protection | Where |
|---|---|---|
| Network access | Binds to `127.0.0.1` | `backend/app/__main__.py` |
| DNS rebinding | Only `localhost` and `127.0.0.1` are accepted as hosts | `TrustedHostMiddleware` in `main.py` |
| Cross-site writes | Writes must be `application/json`, and no CORS is offered, so a browser refuses the cross-site request | `RequestGuard` in `security.py` |
| Large requests | 1 MB limit, counting what actually arrives, so chunked bodies can't dodge it | `RequestGuard` |
| Bad input | Pydantic: known names only, coordinates in the world, finite numbers, length limits, capped lists, unknown fields refused. A unit's settings are checked for shape only (numbers from -150, for a receiver's sensitivity in dBm, lowercase choices, up to 3 pairs of whole-degree bearings, or up to 4 known jammer bands), and a jammer's hand switch can only be `on: true` or absent; the game clamps each to its own limits when it loads them | `schemas.py`, `frontend/src/sim/unit-config.js` |
| SQL injection | Bound parameters only, with tests that check the source of both store files | `db/stores.py`, `db/account_stores.py` |
| Script injection | React escapes everything, and a test bans `innerHTML` and similar in `ui/` | `tests/boundary.test.js` |
| Loading other scripts | Content Security Policy with no inline scripts and same-origin connections only | `security.py` |
| Being framed | `frame-ancestors 'none'` | `security.py` |
| Reaching files | Only `frontend/dist` is served, never the project folder or the database | `main.py` |
| Malicious links in data | Source links render only if they are `https`, with `noopener` | `SourceLinks.jsx` |
| Imported figure files | Only known keys and finite numbers are applied | `sim/config/figures.js` |
| Input echoed back | Validation errors say what is wrong, without repeating the input | `main.py` |
| Sign-in | Every route except `/health`, `/auth/*` and the OpenAPI schema needs a session. Passwords of 10 to 128 characters, not the username, stored with scrypt (n 2^14, r 8, p 1) and a random salt. An unknown username costs the same hashing, so timing does not reveal it | `routes/auth.py`, `services/accounts.py` |
| Sessions | A random 256-bit token in an `HttpOnly`, `SameSite=Strict` cookie scoped to `/api`. Only its SHA-256 is stored. 12 hours, or 30 days with "Keep me signed in". Sign-out deletes it. A password change signs out every other session, and a reset or a deleted account signs out all of them | `services/accounts.py` |
| Guessing | Five wrong passwords or recovery codes in a row lock the account for 5 minutes, with `429` and `Retry-After`. Both count towards the same lockout. Each try is counted in one statement before the slow hash, so tries sent at the same moment still lock it after five | `services/accounts.py` |
| Forgotten passwords | A 120-bit recovery code, shown once at sign-up and stored only as a scrypt hash. Each use replaces it. There is no email, so nothing leaves the machine | `services/accounts.py` |
| Other people's packs | Every unit query includes the signed-in account's id, so another account's pack is `404`, never `403` | `db/account_stores.py` |
| Cached account pages | `Cache-Control: no-store` on every `/api` answer | `security.py` |
| Too many records | 500 accounts, 50 packs an account, 40 lines a pack and 50 of each item. The counts are checked before the insert, so requests sent at the same moment can pass a limit by a few | `services/`, `account_schemas.py` |
| Dependencies | Exact versions and lockfiles, with Python packages limited to releases at least two weeks old | `package.json`, `pyproject.toml` |

## How this was checked

The automated tests cover refused input, wrong hosts, non-JSON writes, oversized and chunked bodies, path traversal, finite numbers and the Content Security Policy headers.

These were also checked by hand on a running server, on 2026-11-04:

- Real sockets for chunked bodies, a bogus `Content-Length`, path traversal and the LAN address.
- A play-through in a real browser with a `securitypolicyviolation` listener running, which recorded no violations.

An independent security review on the same date found one low-severity bug, now fixed: an imported figures file could overwrite built-in JavaScript objects through keys such as `constructor`. Figure import and the enemy learning command now accept only their own known keys, tested through `JSON.parse` because that is what real input goes through. The backend still accepts those keys in stored figures. They are harmless there, because it only stores them.

Accounts and packs were checked on 2026-11-07. `backend/tests/test_accounts.py` and `test_units.py` cover hashing, lockout, expiry, cookie flags, revocation, every route refusing a missing session, and another account's packs answering `404`. Since 2026-11-08 the session test calls every route in the API schema rather than a hand-kept list, which had missed several writes, so a router added without the session check fails the tests. The whole flow was also walked through in a real browser against a local server. An independent security review on the same date found the lockout could be beaten by sending many tries at once, as each was counted after its slow hash and they overwrote each other. Tries are now counted first, in one statement, with a test that fails on the old code. The review's other findings are low and listed under accepted limits.

`npm audit` and `pip-audit` reported nothing on that date. Neither is run automatically: the repository has a GitHub remote but no CI workflow yet.

## Accepted limits

- **Run results are self-reported.** The browser sends them, so they are a record for the player and not proof of a score. There is no leaderboard for this reason.
- **Anyone who can reach the service can make an account,** and every account sees the shared laydowns, runs and figure sets. Local programs are outside this threat model.
- **The session cookie is not `Secure`,** because the game is served over plain http on localhost. It must gain `Secure` before the game is served over a network.
- **Lockout works per account,** so anyone who knows a username can keep it locked by failing on purpose. There is no limit by address, which would mean nothing on one machine.
- **Sign-up says when a username is taken,** which tells anyone with access that the account exists. A locked account answers `429` where an unknown name answers `401`, which says the same.
- **Anyone with access can make the 500 accounts allowed,** and so stop new sign-ups. Existing accounts still work.
- **Sessions are not capped per account.** Only someone with the password can add one, and expired ones are cleared each time a session starts.
- **Cookies ignore ports,** so another web app on `localhost` sends `sg_session` with its own requests to this one. JSON-only writes and no CORS still stop it from writing or reading anything.
- **A lost password and recovery code cannot be recovered.** There is no email and no administrator. Only that account's packs are lost; shared saves are not.
- **Deleting an account needs its password,** and takes its sessions and packs with it. Laydowns and runs it saved stay, as saves are shared.
- **Signing out keeps the game in the page,** so the next person to sign in finds the laydown as it was, which matches shared saves. The last account's deployed pack and tray are cleared. The browser keeps the deployed pack's id with its owner's username, so a reload restores it for that person only.
- **No limits on laydowns, runs or figure sets.** Someone with access could fill the disk, which is acceptable for local use.
- **The database is not encrypted.** Beyond password and code hashes, it holds what players type: names, ranks and organisations on profiles, and names on saves.
- **Kept runs sit in browser storage** until the server returns, readable by anything running on the same origin.
- **A run can occasionally be saved twice,** if the page closes or the connection drops after the server stored it but before its answer arrived, or if two tabs retry together. The player can delete the extra row. The saver prefers a duplicate to a lost run.
- **The OpenStreetMap demo layer contacts an outside server.** It is off by default and uses a fixed area. Turning it on sends tile requests, with this site's origin as the referrer, to `tile.openstreetmap.org`, which the Content Security Policy now allows for images only. Do not reuse it for a real site, as the requests reveal the area being viewed.
- **What a build would download is worked out in the browser.** `GET /packs/downloads` only says which 100 km squares of OS data are on this machine, and the browser compares them with the chosen spot, so looking at a spot sends the backend nothing. The spot only leaves the browser when **Build this map** is pressed, in a POST body.
- **Building an Estonian map contacts Estonian services and AWS.** The whole-country files from `geoportaal.maaruum.ee`, and the settlement names from the agency's file store at `s3.pilw.io`, say nothing about the area, and are only fetched once. The map tiles from `tiles.maaamet.ee` and the satellite picture from AWS do reveal the area. The browser never contacts these hosts: only the builder does, so the Content Security Policy is unchanged. The agency publishes no checksums, so a download is checked by its size and by opening it, and the addresses and file names are fixed in the code.
- **The start screen's Leaflet map contacts OpenStreetMap as soon as it opens,** which reveals the area being viewed. It opens on the world, so its first requests say nothing about a site. Choose **No live map** in the buttons above it before looking at a sensitive site: the choice is remembered in this browser, and the map then shows only the offline pictures from map packs.
- **Satellite and Hybrid on the start map contact EOX,** at `tiles.maps.eox.at` in Austria, only once chosen, which reveals the area being viewed. The page's no-referrer policy applies. The Content Security Policy allows this host for images only. No key or account is used.
- **Real maps add outside contact, only when asked.** Live OpenStreetMap is off by default, and turning it on sends tile requests to `tile.openstreetmap.org`, which the Content Security Policy now allows for images only. Building a pack sends requests to OS, the Environment Agency and AWS. The satellite step also lets PROJ fetch the OS datum-shift grid (OSTN15) from `cdn.proj.org`, so the picture fits the national grid to the metre rather than to a few metres; PROJ fetches only the parts of the grid it needs, so this too hints at the area. Each reveals the area of interest, so use a pack built beforehand, and no live layer, for a sensitive site.
- **The live map has no preview picture,** so opening the map switcher sends nothing to OpenStreetMap. Only choosing the live map does.
- **The laptop's location stays in the browser** unless the player deploys there. It is never put in a URL. Deploying there stores the site's grid reference in the unencrypted database and in kept runs, as with any real site.
- **Map packs are untrusted files.** The browser checks the header, section bounds, that the grid sizes match the header before anything is unpacked, declared sizes during decompression (features at most 32 MB), the fingerprint, every height, and every building, line, road and name before use. A picture is left out unless its own header gives a size of at most 8192 pixels square, so the browser never decodes a vast one. The map builder caps each Terrain 50 zip member at 100 MB, and refuses an OS download that has no checksum. Names from a pack are only drawn on a canvas. Packs stay out of git.
- **The map builder runs as a separate process,** with a list of arguments and no shell, one at a time, from validated numbers. The server only serves plain `.sgmap` names from its own folder.
- **`Cross-Origin-Resource-Policy` and the rest of the headers rely on a modern browser.**

Real drone figures in `frontend/src/sim/config/real-drones.js` are limited to published flight performance, size, price and reported warhead mass, each with its source. Nothing about building, modifying or arming a drone belongs in the repository. Where no source gave a munition mass for a commercial drone, the game's figure is a labelled assumption used only to scale damage.

## Before hosting

A hosted version needs a new security review before deployment, and at least:

- Ownership checks on laydowns, runs and figure sets, which are shared today, or a deliberate decision to share them.
- Rate limits by address as well as by account, and per-user quotas on every record.
- HTTPS, `Secure` cookies, and a real host allowlist from configuration.
- An account recovery route other than the code.
- A move off SQLite, if many users write at once.
- Server-side checks on run results if scores are ever to mean anything.
- Automated dependency scanning.

Treat this list as a starting point, not as complete.
