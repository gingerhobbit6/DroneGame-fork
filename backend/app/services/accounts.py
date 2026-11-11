"""The rules for accounts: hashing, signing in, sessions, lockout and recovery codes. Nothing here knows about HTTP.

There is no email server (the game works offline), so a forgotten password is reset with the recovery code shown once at sign-up.
"""

import base64
import hashlib
import hmac
import secrets
import time
from collections.abc import Callable
from typing import Any

from app.db.account_stores import SqliteAccountStore
from app.services.records import utc_now

SCRYPT = {"n": 2**14, "r": 8, "p": 5}  # one of the settings OWASP lists; about 16 MB and 0.2 to 0.3 s a hash: slow for a guesser, fine for one sign-in
MAX_FAILURES = 5
LOCKOUT_SECONDS = 5 * 60
SESSION_SECONDS = 12 * 3600
REMEMBERED_SECONDS = 30 * 24 * 3600
MAX_ACCOUNTS = 500


class SignInFailed(Exception):
    """Wrong username or password. Which one is never said."""


class Locked(Exception):
    def __init__(self, seconds: int) -> None:
        super().__init__(f"locked for {seconds} s")
        self.seconds = seconds


class Taken(Exception):
    """That username already has an account."""


class SameAsUsername(Exception):
    """A new password may not be the username, as at sign-up."""


class Full(Exception):
    """This server holds as many accounts as it allows."""


def hash_secret(secret: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(secret.encode(), salt=salt, dklen=32, **SCRYPT)
    return f"scrypt${SCRYPT['n']}${SCRYPT['r']}${SCRYPT['p']}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def check_secret(secret: str, stored: str) -> bool:
    _, n, r, p, salt, digest = stored.split("$")
    found = hashlib.scrypt(secret.encode(), salt=base64.b64decode(salt), dklen=32, n=int(n), r=int(r), p=int(p))
    return hmac.compare_digest(found, base64.b64decode(digest))


# checked against when the username does not exist, so a missing account takes as long to refuse as a wrong password
_DUMMY = hash_secret(secrets.token_urlsafe(16))


def new_recovery_code() -> str:
    raw = base64.b32encode(secrets.token_bytes(15)).decode()  # 120 bits, 24 letters and digits
    return "-".join(raw[i:i + 6] for i in range(0, 24, 6))


def _clean_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class AccountService:
    def __init__(self, store: SqliteAccountStore, clock: Callable[[], float] | None = None, stamp: Callable[[], str] = utc_now) -> None:
        self.store, self.clock, self.stamp = store, clock or time.time, stamp

    def _now(self) -> int:
        return int(self.clock())

    def register(self, username: str, display_name: str, password: str) -> tuple[int, str]:
        """Returns the new account's id and its recovery code, which is never stored or shown again."""
        if self.store.count() >= MAX_ACCOUNTS:
            raise Full
        code = new_recovery_code()
        user_id = self.store.add(username, display_name, hash_secret(password), hash_secret(_clean_code(code)), self.stamp())
        if user_id is None:
            raise Taken
        self.store.update(user_id, last_sign_in=self.stamp())  # signing up signs in
        return user_id, code

    def _check(self, username: str, secret: str, field: str) -> dict[str, Any]:
        """A password or recovery code, counted towards the same lockout so neither can be guessed at speed. Each try is counted
        before the slow hash, so a burst of tries sent at once still locks the account after five. Callers reset the count on success."""
        user = self.store.by_username(username)
        if user is None:
            check_secret(secret, _DUMMY)
            raise SignInFailed
        now = self._now()
        if user["locked_until"] > now:
            raise Locked(user["locked_until"] - now)
        tries = self.store.count_attempt(user["id"], now)
        if tries is None:  # another try locked it meanwhile
            raise Locked(LOCKOUT_SECONDS)
        if tries <= MAX_FAILURES and check_secret(secret, user[field]):
            return user
        if tries >= MAX_FAILURES:
            self.store.update(user["id"], failed_attempts=0, locked_until=now + LOCKOUT_SECONDS)
            raise Locked(LOCKOUT_SECONDS)
        raise SignInFailed

    def _rejected_after_check(self, user: dict[str, Any], *fields: str) -> None:
        """Preserve the lockout response if only the lock changed during slow hashing."""
        current = self.store.by_id(user["id"])
        now = self._now()
        if current and all(current[field] == user[field] for field in fields) and current["locked_until"] > now:
            raise Locked(current["locked_until"] - now)
        raise SignInFailed

    def sign_in(self, username: str, password: str, remember: bool) -> tuple[int, str, int]:
        """Returns the account id, a new session token and how long it lasts in seconds."""
        user = self._check(username, password, "password_hash")
        now, lasts = self._now(), REMEMBERED_SECONDS if remember else SESSION_SECONDS
        token = secrets.token_urlsafe(32)
        if not self.store.add_session_if_password(token_hash(token), user["id"], user["password_hash"], now, now + lasts, self.stamp()):
            self._rejected_after_check(user, "password_hash")
        return user["id"], token, lasts

    def start_session(self, user_id: int, remember: bool = False) -> tuple[str, int]:
        now, lasts = self._now(), REMEMBERED_SECONDS if remember else SESSION_SECONDS
        self.store.drop_expired(now)
        token = secrets.token_urlsafe(32)
        self.store.add_session(token_hash(token), user_id, now + lasts)
        return token, lasts

    def user_for(self, token: str | None) -> int | None:
        return self.store.session_user(token_hash(token), self._now()) if token else None

    def sign_out(self, token: str) -> None:
        self.store.drop_session(token_hash(token))

    def reset(self, username: str, code: str, new_password: str) -> str:
        """Sets a new password with the recovery code, signs out everywhere, and returns the next recovery code."""
        user = self._check(username, _clean_code(code), "recovery_hash")
        fresh = new_recovery_code()
        if not self.store.reset_if_recovery(user["id"], user["recovery_hash"], hash_secret(new_password), hash_secret(_clean_code(fresh)), self._now()):
            self._rejected_after_check(user, "recovery_hash")
        return fresh

    def _confirm(self, user_id: int, password: str) -> dict[str, Any]:
        user = self.store.by_id(user_id)
        if user is None:
            raise SignInFailed
        verified = self._check(user["username"], password, "password_hash")
        if verified["id"] != user_id:
            raise SignInFailed
        return verified

    def change_password(self, user_id: int, current: str, new: str, token: str) -> None:
        """Every other session is signed out, so a stolen session cannot outlive the change."""
        user = self._confirm(user_id, current)
        if new.lower() == user["username"].lower():
            raise SameAsUsername
        if not self.store.change_password_if_current(user_id, user["password_hash"], hash_secret(new), token_hash(token), self._now()):
            self._rejected_after_check(user, "password_hash")

    def replace_recovery_code(self, user_id: int, password: str) -> str:
        user = self._confirm(user_id, password)
        code = new_recovery_code()
        if not self.store.replace_recovery_if_current(user_id, user["password_hash"], user["recovery_hash"], hash_secret(_clean_code(code)), self._now()):
            self._rejected_after_check(user, "password_hash", "recovery_hash")
        return code

    def delete_account(self, user_id: int, password: str) -> None:
        """Deletes the account with its sessions and packs, once the password is confirmed. Shared saves stay."""
        user = self._confirm(user_id, password)
        if not self.store.delete_user_if_password(user_id, user["password_hash"], self._now()):
            self._rejected_after_check(user, "password_hash")

    def profile(self, user_id: int) -> dict[str, Any]:
        return self.store.profile(user_id)

    def update_profile(self, user_id: int, data: dict[str, Any]) -> dict[str, Any]:
        self.store.update(user_id, **data)
        return self.store.profile(user_id)
