"""Rate, storage and process-budget tests for authenticated map builds."""

import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import packs
from app.services.packs import BuildBusy, BuildRateLimited, BuildStorageLimited, PackBuilder, PackLibrary


@pytest.fixture
def root(tmp_path):
    (tmp_path / "packs").mkdir()
    return tmp_path


class FakeProcess:
    def __init__(self, lines, code, release=None):
        self.stdout, self.code, self.release = lines, code, release

    def wait(self):
        if self.release:
            self.release.wait(5)
        return self.code


class HangingProcess:
    def __init__(self):
        self.done, self.killed = threading.Event(), threading.Event()
        self.stdout = self

    def __iter__(self):
        return self

    def __next__(self):
        self.done.wait(2)
        raise StopIteration

    def wait(self):
        self.done.wait(2)
        return -9 if self.killed.is_set() else 0

    def kill(self):
        self.killed.set()
        self.done.set()


def builder_with(root, process):
    calls = []

    def run(command, **options):
        calls.append((command, options))
        if isinstance(process, Exception):
            raise process
        return process

    return PackBuilder(PackLibrary(root), run), calls


def wait_finished(builder):
    for thread in threading.enumerate():
        if thread is not threading.current_thread() and thread.daemon and thread.name.startswith("Thread"):
            thread.join(1)
    return builder.status()


def test_repeated_builds_across_accounts_have_a_shared_daily_limit(root, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(packs.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(packs, "MAX_BUILDS_PER_DAY", 2)
    builder, calls = builder_with(root, FakeProcess([], 0))
    for user_id in (1, 2):
        builder.start(422000, 166000, False, user_id=user_id)
        wait_finished(builder)
    with pytest.raises(BuildRateLimited) as refused:
        builder.start(422000, 166000, False, user_id=3)
    assert refused.value.retry_after == packs.BUILD_WINDOW_SECONDS
    assert len(calls) == 2
    now[0] += packs.BUILD_WINDOW_SECONDS
    builder.start(422000, 166000, False, user_id=3)
    assert len(calls) == 3
    wait_finished(builder)


def test_one_account_has_its_own_limit_without_blocking_another(root, monkeypatch):
    monkeypatch.setattr(packs, "MAX_USER_BUILDS_PER_DAY", 2)
    builder, calls = builder_with(root, FakeProcess([], 0))
    for _ in range(2):
        builder.start(422000, 166000, False, user_id=1)
        wait_finished(builder)
    with pytest.raises(BuildRateLimited):
        builder.start(422000, 166000, False, user_id=1)
    builder.start(422000, 166000, False, user_id=2)
    wait_finished(builder)
    assert len(calls) == 3


def test_retry_after_waits_for_both_global_and_account_windows(root, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(packs.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(packs, "MAX_BUILDS_PER_DAY", 3)
    monkeypatch.setattr(packs, "MAX_USER_BUILDS_PER_DAY", 2)
    builder, _ = builder_with(root, FakeProcess([], 0))
    for moment, user_id in ((1000.0, 2), (1010.0, 1), (1020.0, 1)):
        now[0] = moment
        builder.start(422000, 166000, False, user_id=user_id)
        wait_finished(builder)
    with pytest.raises(BuildRateLimited) as refused:
        builder.start(422000, 166000, False, user_id=1)
    assert refused.value.retry_after == packs.BUILD_WINDOW_SECONDS - 10


def test_build_is_refused_if_map_storage_or_disk_reserve_is_exhausted(root, monkeypatch):
    builder, calls = builder_with(root, FakeProcess([], 0))
    monkeypatch.setattr(packs, "MAX_MAP_BYTES", 8)
    (root / "os").mkdir()
    (root / "os" / "cached.zip").write_bytes(b"12345678")
    with pytest.raises(BuildStorageLimited):
        builder.start(422000, 166000, False)
    assert not calls
    (root / "os" / "cached.zip").unlink()
    monkeypatch.setattr(packs.shutil, "disk_usage", lambda _: SimpleNamespace(free=packs.MIN_FREE_BYTES - 1))
    with pytest.raises(BuildStorageLimited):
        builder.start(422000, 166000, False)
    assert not calls


def test_renamed_part_file_does_not_look_like_a_storage_failure(root, monkeypatch):
    (root / "packs" / "finished.part").write_bytes(b"x")
    actual = Path.lstat

    def during_rename(path):
        if path.name == "finished.part":
            raise FileNotFoundError
        return actual(path)

    monkeypatch.setattr(Path, "lstat", during_rename)
    assert packs._storage_problem(root) is None


def test_linked_map_directory_is_refused_before_a_build(root, monkeypatch):
    (root / "os").mkdir()
    actual = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda path: path.name == "os" or actual(path))
    builder, calls = builder_with(root, FakeProcess([], 0))
    with pytest.raises(BuildStorageLimited, match="Linked directories"):
        builder.start(422000, 166000, False)
    assert not calls


def test_running_builder_is_stopped_when_its_time_budget_expires(root, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(packs.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(packs, "RESOURCE_CHECK_SECONDS", 0.01)

    process = HangingProcess()
    builder, _ = builder_with(root, process)
    builder.start(422000, 166000, False)
    now[0] += packs.MAX_BUILD_SECONDS + 1
    assert process.killed.wait(2)
    assert wait_finished(builder)["ok"] is False
    assert "time limit" in builder.status()["message"]


def test_running_builder_is_stopped_when_storage_exceeds_budget(root, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(packs.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(packs, "RESOURCE_CHECK_SECONDS", 0.01)
    monkeypatch.setattr(packs, "MAX_MAP_BYTES", 8)

    process = HangingProcess()
    builder, _ = builder_with(root, process)
    builder.start(422000, 166000, False)
    (root / "packs" / "new.sgmap").write_bytes(b"12345678")
    assert process.killed.wait(2)
    assert wait_finished(builder)["ok"] is False
    assert "storage limit" in builder.status()["message"]


def test_running_builder_is_stopped_when_free_disk_falls_below_reserve(root, monkeypatch):
    free = [packs.MIN_FREE_BYTES + 1]
    monkeypatch.setattr(packs.shutil, "disk_usage", lambda _: SimpleNamespace(free=free[0]))
    monkeypatch.setattr(packs, "RESOURCE_CHECK_SECONDS", 0.01)
    process = HangingProcess()
    builder, _ = builder_with(root, process)
    builder.start(422000, 166000, False)
    free[0] = packs.MIN_FREE_BYTES - 1
    assert process.killed.wait(2)
    assert wait_finished(builder)["ok"] is False
    assert "disk reserve" in builder.status()["message"]


def test_broken_builder_output_releases_the_build_slot(root):
    class Broken:
        def __init__(self):
            self.killed = False
            self.stdout = self

        def __iter__(self):
            raise OSError("broken pipe")

        def kill(self):
            self.killed = True

    process = Broken()
    builder, _ = builder_with(root, process)
    builder.start(422000, 166000, False)
    assert wait_finished(builder) == {"running": False, "ok": False, "message": "The map builder output could not be read."}
    assert process.killed


def test_app_shutdown_stops_an_active_builder(root):
    process = HangingProcess()
    app = create_app(root / "test.db", game=root / "no-game")
    jobs, _ = builder_with(root, process)
    app.state.pack_builder = jobs
    with TestClient(app):
        jobs.start(422000, 166000, False)
    assert process.killed.is_set()
    assert jobs.status() == {"running": False, "ok": False, "message": "The map build stopped because the server is closing."}
    with pytest.raises(BuildBusy):
        jobs.start(422000, 166000, False)
