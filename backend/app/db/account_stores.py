"""SQL for accounts, sessions and deployment packs. Every value is a bound parameter, and every pack query is limited to its owner,
so one account can never read or change another's packs, even by guessing an id."""

import json
import sqlite3
from typing import Any

_PROFILE = "id, username, display_name, rank, organisation, created_at, last_sign_in"


class SqliteAccountStore:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def count(self) -> int:
        return self.conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    def by_username(self, username: str) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return dict(row) if row else None

    def by_id(self, user_id: int) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None

    def profile(self, user_id: int) -> dict[str, Any]:
        return dict(self.conn.execute(f"SELECT {_PROFILE} FROM users WHERE id = ?", (user_id,)).fetchone())

    def add(self, username: str, display_name: str, password_hash: str, recovery_hash: str, now: str) -> int | None:
        """Returns None if the username is taken, whatever its case."""
        try:
            with self.conn:
                user_id = self.conn.execute(
                    "UPDATE account_sequence SET last_id = last_id + 1 WHERE singleton = 1 RETURNING last_id"
                ).fetchone()[0]
                self.conn.execute(
                    "INSERT INTO users (id, username, display_name, password_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (user_id, username, display_name, password_hash, recovery_hash, now),
                )
        except sqlite3.IntegrityError:
            return None
        return user_id

    def update(self, user_id: int, **fields: Any) -> None:
        allowed = {"display_name", "rank", "organisation", "failed_attempts", "locked_until", "last_sign_in"}
        if not fields or not fields.keys() <= allowed:  # column names are joined into the SQL, so only these ever are
            raise ValueError("unknown column")
        with self.conn:
            self.conn.execute(f"UPDATE users SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?", (*fields.values(), user_id))

    def delete_user_if_password(self, user_id: int, expected_hash: str, now: int) -> bool:
        """Delete only the account whose password was just verified; cascades remove its sessions and packs."""
        with self.conn:
            changed = self.conn.execute(
                "DELETE FROM users WHERE id = ? AND password_hash = ? AND locked_until <= ?", (user_id, expected_hash, now)
            ).rowcount
        return changed == 1

    def count_attempt(self, user_id: int, now: int) -> int | None:
        """Counts one more try in a single statement, so tries made at the same moment cannot overwrite each other's count.
        Returns the new count, or None while the account is locked."""
        with self.conn:
            row = self.conn.execute(
                "UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ? AND locked_until <= ? RETURNING failed_attempts", (user_id, now)
            ).fetchone()
        return row[0] if row else None

    def add_session(self, token_hash: str, user_id: int, expires_at: int) -> None:
        with self.conn:
            self.conn.execute("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", (token_hash, user_id, expires_at))

    def add_session_if_password(self, token_hash: str, user_id: int, expected_hash: str, now: int, expires_at: int, signed_at: str) -> bool:
        """Commit validation and the session together, so revocation cannot pass between them."""
        with self.conn:
            changed = self.conn.execute(
                "UPDATE users SET failed_attempts = 0, locked_until = 0, last_sign_in = ? "
                "WHERE id = ? AND password_hash = ? AND locked_until <= ?",
                (signed_at, user_id, expected_hash, now),
            ).rowcount
            if changed != 1:
                return False
            self.conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            self.conn.execute(
                "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", (token_hash, user_id, expires_at)
            )
        return True

    def reset_if_recovery(self, user_id: int, expected_hash: str, password_hash: str, recovery_hash: str, now: int) -> bool:
        with self.conn:
            changed = self.conn.execute(
                "UPDATE users SET password_hash = ?, recovery_hash = ?, failed_attempts = 0, locked_until = 0 "
                "WHERE id = ? AND recovery_hash = ? AND locked_until <= ?",
                (password_hash, recovery_hash, user_id, expected_hash, now),
            ).rowcount
            if changed != 1:
                return False
            self.conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        return True

    def change_password_if_current(self, user_id: int, expected_hash: str, password_hash: str, keep: str, now: int) -> bool:
        with self.conn:
            changed = self.conn.execute(
                "UPDATE users SET password_hash = ?, failed_attempts = 0 "
                "WHERE id = ? AND password_hash = ? AND locked_until <= ? "
                "AND EXISTS (SELECT 1 FROM sessions WHERE user_id = users.id AND token_hash = ? AND expires_at > ?)",
                (password_hash, user_id, expected_hash, now, keep, now),
            ).rowcount
            if changed != 1:
                return False
            self.conn.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?", (user_id, keep))
        return True

    def replace_recovery_if_current(self, user_id: int, password_hash: str, expected_recovery: str, recovery_hash: str, now: int) -> bool:
        with self.conn:
            changed = self.conn.execute(
                "UPDATE users SET recovery_hash = ?, failed_attempts = 0 "
                "WHERE id = ? AND password_hash = ? AND recovery_hash = ? AND locked_until <= ?",
                (recovery_hash, user_id, password_hash, expected_recovery, now),
            ).rowcount
        return changed == 1

    def session_user(self, token_hash: str, now: int) -> int | None:
        row = self.conn.execute("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?", (token_hash, now)).fetchone()
        return row[0] if row else None

    def drop_session(self, token_hash: str) -> None:
        with self.conn:
            self.conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

    def drop_sessions(self, user_id: int, keep: str | None = None) -> None:
        with self.conn:
            self.conn.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?", (user_id, keep))

    def drop_expired(self, now: int) -> None:
        with self.conn:
            self.conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))


_UNIT_SUMMARY = "id, name, echelon, callsign, created_at, updated_at"


class SqliteUnitStore:
    def __init__(self, conn: sqlite3.Connection, user_id: int) -> None:
        self.conn, self.user_id = conn, user_id

    def count(self) -> int:
        return self.conn.execute("SELECT COUNT(*) FROM units WHERE user_id = ?", (self.user_id,)).fetchone()[0]

    def list(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(f"SELECT {_UNIT_SUMMARY} FROM units WHERE user_id = ? ORDER BY updated_at DESC, id DESC", (self.user_id,))
        return [dict(r) for r in rows]

    def get(self, unit_id: int) -> dict[str, Any] | None:
        row = self.conn.execute(f"SELECT {_UNIT_SUMMARY}, assets FROM units WHERE id = ? AND user_id = ?", (unit_id, self.user_id)).fetchone()
        return {**dict(row), "assets": json.loads(row["assets"])} if row else None

    def add(self, data: dict[str, Any], now: str) -> int:
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO units (user_id, name, echelon, callsign, assets, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (self.user_id, data["name"], data["echelon"], data["callsign"], json.dumps(data["assets"]), now, now),
            )
        return cur.lastrowid

    def replace(self, unit_id: int, data: dict[str, Any], now: str) -> bool:
        with self.conn:
            cur = self.conn.execute(
                "UPDATE units SET name = ?, echelon = ?, callsign = ?, assets = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                (data["name"], data["echelon"], data["callsign"], json.dumps(data["assets"]), now, unit_id, self.user_id),
            )
        return cur.rowcount > 0

    def delete(self, unit_id: int) -> bool:
        with self.conn:
            return self.conn.execute("DELETE FROM units WHERE id = ? AND user_id = ?", (unit_id, self.user_id)).rowcount > 0
