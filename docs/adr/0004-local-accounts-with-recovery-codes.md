# ADR 0004: Local accounts, cookie sessions and recovery codes

Status: accepted, 2026-11-07.

## Context

Alex asked for a login page with sign-in, sign-up and forgotten passwords, a profile for each person, and deployment packs that belong to a profile. The game runs on one machine, over plain http on localhost, and works offline. There is no mail server and no identity provider.

## Decision

Keep accounts in the game's own SQLite database. Hash passwords with the standard library's `hashlib.scrypt`. Keep a session as a random token in an `HttpOnly`, `SameSite=Strict` cookie, storing only its SHA-256. Reset a forgotten password with a recovery code shown once at sign-up, hashed like a password. Signing in is required before the game opens. Only deployment packs belong to an account; laydowns, runs and figure sets stay shared.

## Reasons

- **Works offline.** A recovery code needs no email, no SMS and no outside service. Alex chose it.
- **No new dependency.** scrypt, `secrets` and `hmac` are in the standard library, and FastAPI already sets cookies.
- **A cookie suits a browser game on one origin.** `HttpOnly` keeps the token from scripts, and `SameSite=Strict` with the existing JSON-only writes stops cross-site requests.
- **Shared saves keep what exists working.** Alex chose to keep laydowns and runs shared, so no existing save needs an owner.

| Alternative | Why not |
|---|---|
| Email reset links | Needs a mail server and an address for everyone, and breaks offline. |
| Security questions | Weak, and the answers are often public. |
| An administrator resets passwords | Needs an administrator role and a way to choose one, for a game one person usually runs. |
| No password, just pick a profile | Alex asked for a real login page. |
| Bearer tokens in browser storage | Readable by any script on the page, and no simpler than a cookie here. |
| bcrypt or argon2 packages | A new dependency, for no gain over scrypt at this scale. |

## Consequences

- The game now needs the backend running to get past the login page.
- Losing both the password and the recovery code loses that account's packs. Shared saves are not affected.
- The cookie is not `Secure`, because the game is served over http. Serving it over a network needs HTTPS and `Secure` first. See `docs/SECURITY_NOTES.md`.
- Every unit query includes the account's id, so another account's pack is a `404`.

## When to revisit

If the game is hosted for many users: HTTPS and `Secure` cookies, ownership for laydowns and runs, rate limits by address, and a recovery route other than the code.
