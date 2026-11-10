"""Listing and serving map packs, and starting a build: only plain names, only one at a time, and never a shell."""

import json
import shutil
import struct
import threading

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from conftest import sign_up
from app.services.packs import BuildBusy, BuildRateLimited, BuildStorageLimited, PackBuilder, PackLibrary, read_summary

API = "/api/v1/packs"
HEADER = {"gridsSha256": "a" * 64, "name": "Test", "east": 422000, "north": 166000, "half": 15000, "tier": "lidar", "lidarHalf": 7000}


def pack_bytes(header=None) -> bytes:
    head = json.dumps(header or HEADER).encode()
    return b"SGMAP\x01" + struct.pack("<I", len(head)) + head + b"BODY"


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setenv("SITE_GUARD_MAPS", str(tmp_path))
    (tmp_path / "packs").mkdir()
    return tmp_path


@pytest.fixture
def client(root, tmp_path):
    with TestClient(create_app(tmp_path / "test.db", game=tmp_path / "no-game"), base_url="http://localhost") as c:
        sign_up(c)
        yield c


def test_lists_readable_packs_and_leaves_out_the_rest(client, root):
    (root / "packs" / "good.sgmap").write_bytes(pack_bytes())
    (root / "packs" / "junk.sgmap").write_bytes(b"not a pack")
    (root / "packs" / "bad_json.sgmap").write_bytes(b"SGMAP\x01" + struct.pack("<I", 3) + b"{{{")
    (root / "packs" / "huge.sgmap").write_bytes(b"SGMAP\x01" + struct.pack("<I", 1 << 30))
    (root / "packs" / "other.txt").write_bytes(pack_bytes())
    rows = client.get(API).json()
    assert [r["file"] for r in rows] == ["good.sgmap"]
    assert rows[0]["hash"] == "a" * 64 and rows[0]["east"] == 422000 and rows[0]["lidarHalf"] == 7000


def test_an_empty_or_missing_folder_is_an_empty_list(client, root):
    assert client.get(API).json() == []
    (root / "packs").rmdir()
    assert client.get(API).json() == []


def test_serves_a_pack_with_security_headers(client, root):
    (root / "packs" / "good.sgmap").write_bytes(pack_bytes())
    reply = client.get(f"{API}/good.sgmap")
    assert reply.status_code == 200 and reply.content == pack_bytes()
    assert reply.headers["content-type"] == "application/octet-stream"
    assert "img-src 'self' data: https://tile.openstreetmap.org https://tiles.maps.eox.at" in reply.headers["content-security-policy"]
    assert "connect-src 'self'" in reply.headers["content-security-policy"]


@pytest.mark.parametrize("name", ["missing.sgmap", "..%2F..%2Ftest.db", "..%5Csecret.sgmap", "good.txt", "a b.sgmap", ".sgmap"])
def test_nothing_else_can_be_fetched(client, root, name):
    (root / "secret.sgmap").write_bytes(b"secret")
    assert client.get(f"{API}/{name}").status_code in (404, 405)


class FakeProcess:
    def __init__(self, lines, code, release=None):
        self.stdout, self.code, self.release = lines, code, release

    def wait(self):
        if self.release:
            self.release.wait(5)
        return self.code


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


def test_a_build_runs_with_fixed_arguments_and_no_shell(root):
    builder, calls = builder_with(root, FakeProcess(["working\n", "done\n"], 0))
    builder.start(422000, 166000, True)
    command, options = calls[0]
    assert isinstance(command, list) and "shell" not in options
    assert "422000,166000" in command and "--fetch" in command
    assert command[command.index("--lidar-km") + 1] == "54" and command[command.index("--size") + 1] == "70"
    assert command[command.index("--out") + 1].endswith("area_422_166.sgmap")
    assert wait_finished(builder) == {"running": False, "ok": True, "message": "Finished"}


def test_lidar_can_be_left_out_and_a_failure_is_reported(root):
    builder, calls = builder_with(root, FakeProcess(["no such square\n"], 1))
    builder.start(1, 2, False)
    assert calls[0][0][calls[0][0].index("--lidar-km") + 1] == "0"
    assert wait_finished(builder) == {"running": False, "ok": False, "message": "no such square"}


def test_only_one_build_at_a_time(root):
    release = threading.Event()
    builder, _ = builder_with(root, FakeProcess([], 0, release))
    builder.start(1, 2, True)
    with pytest.raises(BuildBusy):
        builder.start(1, 2, True)
    release.set()
    wait_finished(builder)


def test_a_missing_builder_is_reported(root):
    builder, _ = builder_with(root, FileNotFoundError())
    assert builder.start(1, 2, True) == {"running": False, "ok": False, "message": "The map builder could not start. It needs uv installed."}


def test_a_map_folder_that_cannot_be_made_ends_the_build_so_another_can_start(root):
    builder, calls = builder_with(root, FakeProcess([], 0))
    shutil.rmtree(builder.library.folder, ignore_errors=True)
    builder.library.folder.write_text("in the way", encoding="utf-8")  # a file where the folder should be
    assert builder.start(1, 2, True) == {"running": False, "ok": False, "message": "The map folder could not be made."}
    assert builder.start(1, 2, True)["ok"] is False and not calls  # not busy, and nothing ran


def test_the_build_route_checks_its_input_and_refuses_a_second_build(client):
    class Busy:
        def start(self, *_):
            raise BuildBusy

        def status(self):
            return {"running": True, "ok": None, "message": "x"}

    for body in ({"east": -1, "north": 1, "lidar": True}, {"east": 1, "north": 9_999_999, "lidar": True}, {"east": 1, "north": 1}, {"east": "1;rm", "north": 1, "lidar": True}, {"east": 1, "north": 1, "lidar": True, "extra": 1}):
        assert client.post(f"{API}/build", json=body).status_code == 422
    assert client.get(f"{API}/build").json()["running"] is False
    client.app.state.pack_builder = Busy()
    assert client.post(f"{API}/build", json={"east": 1, "north": 1, "lidar": True}).status_code == 409
    assert client.get(f"{API}/build").json()["running"] is True


def test_build_route_reports_rate_and_storage_limits(client):
    class Limited:
        def __init__(self, error):
            self.error = error

        def start(self, *_):
            raise self.error

    client.app.state.pack_builder = Limited(BuildRateLimited(45))
    rate = client.post(f"{API}/build", json={"east": 422000, "north": 166000, "lidar": False})
    assert rate.status_code == 429 and rate.headers["retry-after"] == "45"
    client.app.state.pack_builder = Limited(BuildStorageLimited("The map build stopped at the map storage limit."))
    storage = client.post(f"{API}/build", json={"east": 422000, "north": 166000, "lidar": False})
    assert storage.status_code == 409 and "storage limit" in storage.json()["detail"]


def test_a_cross_site_form_cannot_start_a_build(client):
    assert client.post(f"{API}/build", content="east=1", headers={"content-type": "application/x-www-form-urlencoded"}).status_code == 415


def test_summary_tolerates_a_missing_file(tmp_path):
    assert read_summary(tmp_path / "gone.sgmap") is None


def test_lists_only_finished_os_downloads(client, root):
    nothing = {"heights": False, "surface": False, "features": False}
    assert client.get(f"{API}/downloads").json() == {"terrain50": False, "squares": [], "estonia": nothing}
    for folder, name in [("terrain50", "t.zip"), ("openmap_su", "o.zip"), ("vmd_su", "v.zip"), ("openmap_tq", "o.zip"), ("openmap_so", "o.zip"), ("vmd_so", "v.zip.part"), ("openmap_1x", "o.zip"), ("vmd_1x", "v.zip")]:
        (root / "os" / folder).mkdir(parents=True)
        (root / "os" / folder / name).write_bytes(b"x")
    # TQ has no picture download, SO's is unfinished, and 1X is not a square
    assert client.get(f"{API}/downloads").json() == {"terrain50": True, "squares": ["SU"], "estonia": nothing}
    (root / "estonia").mkdir()
    (root / "estonia" / "DTM_10m_eesti.tif").write_bytes(b"x")
    (root / "estonia" / "DTM_10m_eesti.tif.part").write_bytes(b"x")
    (root / "estonia" / "ndsm_5m_2020-2023_kogu_Eesti.zip.part").write_bytes(b"x")
    for theme in ("ehitised", "kolvikud", "transport", "veekogud"):
        (root / "estonia" / f"ETAK_Eesti_SHP_{theme}.zip").write_bytes(b"x")
    assert client.get(f"{API}/downloads").json()["estonia"] == {"heights": True, "surface": False, "features": False}  # one theme is missing
    (root / "estonia" / "ETAK_Eesti_SHP_tehnovorgud.zip").write_bytes(b"x")
    assert client.get(f"{API}/downloads").json()["estonia"]["features"] is False  # the settlement names are missing
    (root / "estonia" / "asustusyksus_shp.zip").write_bytes(b"x")
    assert client.get(f"{API}/downloads").json()["estonia"]["features"] is True


def test_an_estonian_build_uses_its_own_folder_and_lidar_across_the_whole_pack(root):
    calls = []

    class Process:
        stdout = iter([])

        def wait(self):
            return 0

    jobs = PackBuilder(PackLibrary(root), run=lambda command, **_: calls.append(command) or Process())
    jobs.start(611700, 6570700, True)
    command = calls[0]
    assert command[command.index("--data") + 1] == str(root / "estonia")
    assert command[command.index("--lidar-km") + 1] == "70"
    assert command[command.index("--centre") + 1] == "611700,6570700"


@pytest.mark.parametrize("east,north,code", [
    (611700, 6570700, 202), (422000, 166000, 202),  # Tapa and Savernake
    (800000, 6570700, 422), (611700, 7000000, 422), (611700, 2000000, 422), (700000, 166000, 422),  # off both grids, or between them
])
def test_a_build_must_be_on_a_grid(client, root, monkeypatch, east, north, code):
    monkeypatch.setattr(PackBuilder, "start", lambda self, *a: {"running": True, "ok": None, "message": "Starting"})
    assert client.post(f"{API}/build", json={"east": east, "north": north, "lidar": False}).status_code == code
