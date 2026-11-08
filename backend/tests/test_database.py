"""Migrations, and the rule that a failed one leaves the data alone."""

import sqlite3

import pytest

from app.db.connection import MIGRATIONS, DatabaseTooNew, connect, migrate, open_database
from app.db.stores import SqliteFigureSetStore, SqliteLaydownStore, SqliteRunStore
from app.services.records import FigureSetService, LaydownService, NotFound, RunService

version = lambda conn: conn.execute("PRAGMA user_version").fetchone()[0]  # noqa: E731
tables = lambda conn: {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}  # noqa: E731


@pytest.fixture
def conn():
    c = connect(":memory:")
    yield c
    c.close()


def write(folder, name, sql):
    (folder / name).write_text(sql, encoding="utf-8")


def test_from_empty_builds_every_table(conn):
    assert migrate(conn) == 2
    assert version(conn) == 2
    assert {"laydowns", "runs", "figure_sets", "users", "sessions", "units"} <= tables(conn)


def test_running_again_changes_nothing(conn):
    migrate(conn)
    conn.execute("INSERT INTO figure_sets (name, figures, game_version, created_at) VALUES ('a', '{}', '1', 'now')")
    conn.commit()
    assert migrate(conn) == 2
    assert conn.execute("SELECT COUNT(*) FROM figure_sets").fetchone()[0] == 1


def test_from_the_previous_version_keeps_data(conn, tmp_path):
    write(tmp_path, "0001_a.sql", "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);")
    assert migrate(conn, tmp_path) == 1
    conn.execute("INSERT INTO t (v) VALUES ('kept')")
    conn.commit()
    write(tmp_path, "0002_b.sql", "ALTER TABLE t ADD COLUMN extra REAL NOT NULL DEFAULT 0;")
    assert migrate(conn, tmp_path) == 2
    assert dict(conn.execute("SELECT * FROM t").fetchone()) == {"id": 1, "v": "kept", "extra": 0}


def test_applied_in_number_order_whatever_the_names(conn, tmp_path):
    write(tmp_path, "0002_z.sql", "INSERT INTO t VALUES (2);")
    write(tmp_path, "0001_a.sql", "CREATE TABLE t (v);")
    write(tmp_path, "notes.sql", "THIS IS NOT A MIGRATION;")
    assert migrate(conn, tmp_path) == 2


def test_a_failed_migration_changes_nothing(conn, tmp_path):
    write(tmp_path, "0001_a.sql", "CREATE TABLE t (v TEXT);")
    migrate(conn, tmp_path)
    conn.execute("INSERT INTO t VALUES ('kept')")
    conn.commit()
    write(tmp_path, "0002_bad.sql", "ALTER TABLE t ADD COLUMN x; INSERT INTO t VALUES ('half'); THIS IS NOT SQL;")
    with pytest.raises(sqlite3.Error):
        migrate(conn, tmp_path)
    assert version(conn) == 1
    assert [tuple(r) for r in conn.execute("SELECT * FROM t")] == [("kept",)]
    assert "x" not in [r[1] for r in conn.execute("PRAGMA table_info(t)")]


def test_a_newer_database_is_refused_and_untouched(conn, tmp_path):
    conn.execute("PRAGMA user_version = 99")
    with pytest.raises(DatabaseTooNew, match="version 99"):
        migrate(conn)
    assert version(conn) == 99
    assert tables(conn) == set()


def test_no_migrations_at_all(conn, tmp_path):
    assert migrate(conn, tmp_path) == 0


def test_open_database_creates_the_folder(tmp_path):
    path = tmp_path / "a" / "b" / "c.db"
    open_database(path)
    open_database(path)
    conn = connect(path)
    assert version(conn) == 2
    conn.close()


def test_json_columns_refuse_invalid_json(conn):
    migrate(conn)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO laydowns (name, world, spec, game_version, created_at, updated_at) VALUES ('a', '1', '{not json', '1', 'n', 'n')")


def test_migrations_are_numbered_without_gaps():
    numbers = sorted(int(f.name[:4]) for f in MIGRATIONS.glob("*.sql"))
    assert numbers == list(range(1, len(numbers) + 1))


class FakeStore:
    """Services depend only on the store's small interface, so any object with those methods will do."""

    def __init__(self):
        self.rows = {}

    def add(self, data, now):
        rid = len(self.rows) + 1
        self.rows[rid] = {**data, "id": rid, "at": now}
        return rid

    def get(self, rid):
        return self.rows.get(rid)

    def delete(self, rid):
        return self.rows.pop(rid, None) is not None

    def replace(self, rid, data, now):
        if rid not in self.rows:
            return False
        self.rows[rid] = {**data, "id": rid, "at": now}
        return True

    def list(self, *paging):
        items = list(self.rows.values())
        return (items, len(items)) if paging else items


@pytest.mark.parametrize("service_type, create", [(LaydownService, "create"), (RunService, "record"), (FigureSetService, "create")])
def test_services_take_any_store_and_set_the_time(service_type, create):
    service = service_type(FakeStore(), clock=lambda: "the-time")
    made = getattr(service, create)({"name": "a"})
    assert made["at"] == "the-time"
    assert service.get(1)["name"] == "a"
    assert service.list(10, 0)["total"] == 1 if service_type is RunService else len(service.list()) == 1
    service.delete(1)
    with pytest.raises(NotFound):
        service.get(1)
    with pytest.raises(NotFound):
        service.delete(1)


def test_replacing_something_missing_is_not_found():
    with pytest.raises(NotFound):
        LaydownService(FakeStore()).replace(1, {})


def test_stores_cover_the_same_interface_as_the_fake():
    for store in [SqliteLaydownStore, SqliteRunStore, SqliteFigureSetStore]:
        for method in ["add", "get", "delete", "list"]:
            assert callable(getattr(store, method))
