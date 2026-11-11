"""Map packs on this machine: listing them, and building a new one with the separate builder, one at a time."""

import json
import math
import os
import re
import shutil
import signal
import stat
import struct
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

MAGIC = b"SGMAP"
MAX_HEADER = 1 << 20
FILE_NAME = re.compile(r"^[A-Za-z0-9_-]{1,64}\.sgmap$")
BUILDER = Path(__file__).resolve().parents[3] / "tools" / "mapbuild"
# The national files the builder fetches for Estonia, into their own folder (tools/mapbuild/mapbuild/estonia_files.py).
ESTONIA_HEIGHTS, ESTONIA_SURFACE = "DTM_10m_eesti.tif", "ndsm_5m_2020-2023_kogu_Eesti.zip"
# Kilometres across: a pack, as BUILT_HALF in frontend/src/sim/world-pack.js, and a world, as WORLD.radius in frontend/src/sim/config/world.js
PACK_KM, WORLD_KM = 70, 54
ESTONIA_FEATURES = (*(f"ETAK_Eesti_SHP_{theme}.zip" for theme in ("ehitised", "kolvikud", "transport", "veekogud", "tehnovorgud")), "asustusyksus_shp.zip")
# All accounts share one map store and one builder. Bound repeated launches globally as well as per account.
BUILD_WINDOW_SECONDS = 24 * 3600
MAX_BUILDS_PER_DAY = 12
MAX_USER_BUILDS_PER_DAY = 8
# A national download already asks for 8 GB free; retain that reserve and stop the shared store at 40 GB.
MAX_MAP_BYTES = 40_000_000_000
MIN_FREE_BYTES = 8_000_000_000
# A hung provider or native decoder must eventually release the one-at-a-time builder slot.
MAX_BUILD_SECONDS = 4 * 3600
RESOURCE_CHECK_SECONDS = 1


def in_estonia(east: int, north: int) -> bool:
    return 360_000 <= east < 750_000 and 6_365_000 <= north < 6_640_000


def on_a_grid(east: int, north: int) -> bool:
    return in_estonia(east, north) or (0 <= east < 700_000 and 0 <= north < 1_300_000)


def maps_root() -> Path:
    return Path(os.environ.get("SITE_GUARD_MAPS") or Path.home() / "site-guard-maps")


def read_summary(path: Path) -> dict[str, Any] | None:
    """What the list shows, from a pack's header. A file that isn't a readable pack is left out."""
    try:
        with path.open("rb") as file:
            start = file.read(10)
            if start[:5] != MAGIC or len(start) != 10:
                return None
            length = struct.unpack("<I", start[6:10])[0]
            if length > MAX_HEADER:
                return None
            header = json.loads(file.read(length))
        return {
            "file": path.name, "hash": str(header["gridsSha256"]), "name": str(header["name"])[:80], "east": int(header["east"]), "north": int(header["north"]),
            "half": int(header["half"]), "tier": str(header["tier"]), "lidarHalf": int(header.get("lidarHalf", 0)),
        }
    except (OSError, ValueError, KeyError, TypeError, OverflowError, RecursionError):  # the last two: a number like 1e999, and deep nesting
        return None


class PackLibrary:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or maps_root()

    @property
    def folder(self) -> Path:
        return self.root / "packs"

    def list(self) -> list[dict[str, Any]]:
        if not self.folder.is_dir():
            return []
        found = (read_summary(p) for p in sorted(self.folder.iterdir()) if FILE_NAME.match(p.name))
        return [s for s in found if s]

    def path_of(self, name: str) -> Path | None:
        """Only a plain name in the folder, so a request can never reach anything else."""
        if not FILE_NAME.match(name):
            return None
        path = self.folder / name
        return path if path.is_file() else None

    def downloads(self) -> dict[str, Any]:
        """Which OS downloads are already here. A square counts only with both its products, as a build needs both."""
        folder = self.root / "os"

        def has(name: str) -> bool:
            return (folder / name).is_dir() and any((folder / name).glob("*.zip"))  # a download still going is a .part file

        found = (p.name[-2:] for p in folder.glob("openmap_??")) if folder.is_dir() else ()
        estonia = self.root / "estonia"
        return {
            "terrain50": has("terrain50"),
            "squares": sorted(s.upper() for s in found if s.isalpha() and has(f"openmap_{s}") and has(f"vmd_{s}")),
            "estonia": {
                "heights": (estonia / ESTONIA_HEIGHTS).is_file(),
                "surface": (estonia / ESTONIA_SURFACE).is_file(),
                "features": all((estonia / name).is_file() for name in ESTONIA_FEATURES),
            },
        }


class BuildBusy(Exception):
    """A map is already being built."""


class BuildRateLimited(Exception):
    """Too many builds have started in the current rolling day."""

    def __init__(self, retry_after: int) -> None:
        self.retry_after = retry_after


class BuildStorageLimited(Exception):
    """Starting another build would cross the local map storage safety budget."""


def _stored_bytes(root: Path) -> int:
    """Count map data, refusing links that would make the size or volume check incomplete."""
    total = 0
    for folder, dirs, files in os.walk(root):
        if any((Path(folder) / name).is_symlink() or (Path(folder) / name).is_junction() for name in dirs):
            raise ValueError("Linked directories are not supported in the map store.")
        for name in files:
            try:
                info = (Path(folder) / name).lstat()
            except FileNotFoundError:  # a completed .part file can be renamed while this walks the store
                continue
            if stat.S_ISLNK(info.st_mode):
                raise ValueError("Linked files are not supported in the map store.")
            total += info.st_size
            if total >= MAX_MAP_BYTES:
                return total
    return total


def _storage_problem(root: Path) -> str | None:
    try:
        if shutil.disk_usage(root).free < MIN_FREE_BYTES:
            return "The map build stopped at the free disk reserve."
        if _stored_bytes(root) >= MAX_MAP_BYTES:
            return "The map build stopped at the map storage limit."
    except ValueError as exc:
        return str(exc)
    except OSError:
        return "The map storage could not be checked."
    return None


class PackBuilder:
    """Runs the builder as a separate process with fixed arguments, so its mapping packages stay out of this application."""

    def __init__(self, library: PackLibrary, run=subprocess.Popen) -> None:
        self.library, self.run = library, run
        self.lock = threading.Lock()
        self.state: dict[str, Any] = {"running": False, "ok": None, "message": ""}
        self.starts: list[tuple[float, int]] = []
        self.limit_reason: str | None = None
        self.process: Any = None
        self.done: threading.Event | None = None
        self.stopping = False

    def status(self) -> dict[str, Any]:
        with self.lock:
            return dict(self.state)

    def start(self, east: int, north: int, lidar: bool, user_id: int = 0) -> dict[str, Any]:
        with self.lock:
            if self.state["running"] or self.stopping:
                raise BuildBusy
            self.state = {"running": True, "ok": None, "message": "Starting"}
            self.limit_reason = None
        name = f"area_{east // 1000}_{north // 1000}"
        estonian = in_estonia(east, north)
        lidar_km = 0 if not lidar else PACK_KM if estonian else WORLD_KM  # Estonian lidar is already on this machine by then, so the whole pack can have it
        command = [
            "uv", "run", "--quiet", "--frozen", "--directory", str(BUILDER), "python", "-m", "mapbuild",
            "--centre", f"{east},{north}", "--name", f"Area around {east // 1000}, {north // 1000}",
            "--data", str(self.library.root / ("estonia" if estonian else "os")), "--out", str(self.library.folder / f"{name}.sgmap"), "--fetch", "--size", str(PACK_KM), "--lidar-km", str(lidar_km),
        ]
        try:
            self.library.folder.mkdir(parents=True, exist_ok=True)
        except OSError:
            return self._failed("The map folder could not be made.")
        if problem := _storage_problem(self.library.root):
            self._failed(problem)
            raise BuildStorageLimited(problem)
        now = time.monotonic()
        with self.lock:
            self.starts = [(when, who) for when, who in self.starts if now - when < BUILD_WINDOW_SECONDS]
            all_starts = [when for when, _ in self.starts]
            user_starts = [when for when, who in self.starts if who == user_id]
            waits = []
            if len(all_starts) >= MAX_BUILDS_PER_DAY:
                waits.append(BUILD_WINDOW_SECONDS - (now - all_starts[0]))
            if len(user_starts) >= MAX_USER_BUILDS_PER_DAY:
                waits.append(BUILD_WINDOW_SECONDS - (now - user_starts[0]))
            if waits:
                retry = max(1, math.ceil(max(waits)))
                self.state = {"running": False, "ok": False, "message": "The map build daily limit has been reached."}
                raise BuildRateLimited(retry)
        try:
            process = self.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", **({"start_new_session": True} if os.name != "nt" else {}))
        except OSError:
            return self._failed("The map builder could not start. It needs uv installed.")
        with self.lock:
            self.starts.append((now, user_id))
            self.process = process
            self.done = done = threading.Event()
            stopping = self.stopping
        threading.Thread(target=self._watch, args=(process, done), daemon=True).start()
        threading.Thread(target=self._guard, args=(process, done, now), daemon=True).start()
        if stopping:
            self.stop()
        return self.status()

    def _failed(self, message: str) -> dict[str, Any]:
        with self.lock:
            self.state = {"running": False, "ok": False, "message": message}
        return self.status()

    def _watch(self, process, done: threading.Event) -> None:
        last = ""
        ok = False
        try:
            for line in process.stdout:
                last = line.strip()[:200] or last
                with self.lock:
                    self.state["message"] = last
            ok = process.wait() == 0
        except (OSError, ValueError):
            last = "The map builder output could not be read."
            self._terminate(process)
        finally:
            with self.lock:
                reason = self.limit_reason
                self.state = {"running": False, "ok": ok and reason is None, "message": reason or ("Finished" if ok else last or "The map could not be built.")}
                self.process = None
                self.done = None
            done.set()

    def stop(self) -> None:
        """On server shutdown, stop an active uv wrapper and its map builder child."""
        with self.lock:
            self.stopping = True
            process, done = self.process, self.done
            if process is not None and self.state["running"]:
                self.limit_reason = "The map build stopped because the server is closing."
            else:
                process = None
        if process is not None:
            self._terminate(process)
            if done is not None:
                done.wait(10)

    def _guard(self, process, done: threading.Event, started: float) -> None:
        while not done.wait(RESOURCE_CHECK_SECONDS):
            if hasattr(process, "poll") and process.poll() is not None:
                return
            reason = "The map build stopped at its time limit." if time.monotonic() - started >= MAX_BUILD_SECONDS else _storage_problem(self.library.root)
            if reason:
                with self.lock:
                    if not self.state["running"] or done.is_set():
                        return
                    self.limit_reason = reason
                self._terminate(process)
                return

    @staticmethod
    def _terminate(process) -> None:
        """Stop the uv wrapper and its builder child, not just the wrapper."""
        try:
            if os.name == "nt" and hasattr(process, "pid"):
                stopped = subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)
                if stopped.returncode:
                    process.kill()
            elif os.name != "nt" and hasattr(process, "pid"):
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except (OSError, subprocess.TimeoutExpired):
            try:
                process.kill()
            except OSError:
                pass
