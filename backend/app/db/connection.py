"""Opening the database and bringing it up to date with numbered SQL files, tracked with PRAGMA user_version."""

import re
import sqlite3
from pathlib import Path

MIGRATIONS = Path(__file__).parent / "migrations"
_NUMBERED = re.compile(r"^(\d{4})_.+\.sql$")


class DatabaseTooNew(RuntimeError):
    """The file was written by a newer version of the game, so this one must not touch it."""


def connect(path: Path) -> sqlite3.Connection:
    # FastAPI may open and use a request's connection on different threads, but only one at a time
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")  # off by default in SQLite, and a deleted account must take its sessions and packs with it
    return conn


def _numbered_files(folder: Path) -> list[tuple[int, Path]]:
    found = [(int(m.group(1)), f) for f in folder.iterdir() if (m := _NUMBERED.match(f.name))]
    return sorted(found)


def migrate(conn: sqlite3.Connection, folder: Path = MIGRATIONS) -> int:
    """Apply every migration newer than the database. Each one either applies fully or not at all. Returns the version."""
    files = _numbered_files(folder)
    latest = files[-1][0] if files else 0
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version > latest:
        raise DatabaseTooNew(f"Database is at version {version}, but this game only knows up to {latest}")
    for number, file in files:
        if number <= version:
            continue
        try:
            conn.executescript(f"BEGIN;\n{file.read_text(encoding='utf-8')}\nPRAGMA user_version = {number};\nCOMMIT;")
        except sqlite3.Error:
            conn.rollback()
            raise
        version = number
    return version


def open_database(path: Path) -> None:
    """Create the file and its folder if needed, and migrate it. Called once, at startup."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    try:
        migrate(conn)
    finally:
        conn.close()
