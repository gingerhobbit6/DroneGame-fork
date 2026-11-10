"""Getting Estonia's national files, once each, from the Land and Spatial Development Board. They are whole-country files, so asking for
them says nothing about where a pack is. The addresses and names are fixed here, and the agency may refuse a busy client, so everything waits politely."""

import os
import shutil
import time
import urllib.error
import urllib.request
import zipfile

import rasterio
from rasterio.windows import Window as PixelWindow

from .source_limits import MIN_FREE_BYTES, check_raster_blocks, enough_disk_room, safe_member

CRS = 3301  # L-EST97
AGENT = {"User-Agent": "site-guard-mapbuild"}
DOWNLOAD = "https://geoportaal.maaruum.ee/index.php?lang_id=2&plugin_act=otsing&andmetyyp={kind}&dl=1&f={name}&page_id={page}"
HEIGHTS, SURFACE = "DTM_10m_eesti.tif", "ndsm_5m_2020-2023_kogu_Eesti.zip"
BUILDINGS, LAND, TRANSPORT, WATER, UTILITIES = (f"ETAK_Eesti_SHP_{theme}.zip" for theme in ("ehitised", "kolvikud", "transport", "veekogud", "tehnovorgud"))
PLACES = "asustusyksus_shp.zip"  # settlements, from the agency's page of administrative and settlement units
FILES = {name: DOWNLOAD.format(kind=kind, name=name, page=page) for name, (kind, page) in {
    HEIGHTS: ("mp_korgusmudelid", 664), SURFACE: ("mk_korgusmudelid", 664), BUILDINGS: ("ETAK", 618), LAND: ("ETAK", 618), TRANSPORT: ("ETAK", 618), WATER: ("ETAK", 618), UTILITIES: ("ETAK", 618)}.items()}
FILES[PLACES] = f"https://s3.pilw.io/rp-kemit-kataster/EHAK/{PLACES}"  # kept on the agency's file store, not the portal
RETRIES = 8
MAX_WAIT_S = 300
ROOM_NEEDED = MIN_FREE_BYTES  # the national files, in bytes, with a little to spare
MAX_FILE_BYTES = {HEIGHTS: 3_000_000_000, SURFACE: 6_000_000_000, PLACES: 500_000_000,
                  **{name: 1_000_000_000 for name in (BUILDINGS, LAND, TRANSPORT, WATER, UTILITIES)}}
MAX_ZIP_ENTRIES = 100_000
MAX_ZIP_EXPANDED = 20_000_000_000
MAX_ZIP_MEMBER = 768_000_000  # national ETAK .dbf and .shp members reach about 528 MB
DEFLATE64 = 9  # the zip compression method
SHEETS_TO_CHECK = 20


def _retrying(job, what: str):
    """The agency may refuse a busy client, so wait longer each time, or for as long as it asks."""
    wait = 10
    for _ in range(RETRIES):
        try:
            return job()
        except urllib.error.HTTPError as problem:
            if problem.code == 404:
                raise
            asked = problem.headers.get("Retry-After") if problem.headers else None
            pause = min(int(asked), MAX_WAIT_S) if asked and asked.isdigit() else wait
            print(f"  waiting {pause} s to retry {what}: HTTP {problem.code}", flush=True)
            time.sleep(pause)
        except (urllib.error.URLError, OSError, TimeoutError) as problem:
            print(f"  waiting to retry {what}: {str(problem)[:100]}", flush=True)
            time.sleep(wait)
        wait = min(wait * 2, MAX_WAIT_S)
    raise SystemExit(f"gave up fetching {what}")


def _fetch(name: str, folder: str, say) -> None:
    """One fixed file, resumed if a download stopped part way. The agency publishes no checksums, so the size and opening it are the check."""
    target = os.path.join(folder, name)
    if os.path.exists(target):
        if os.path.getsize(target) > MAX_FILE_BYTES[name]:
            raise SystemExit(f"{name} is larger than expected")
        return
    os.makedirs(folder, exist_ok=True)
    part = target + ".part"
    url = FILES[name]

    def attempt() -> None:
        done = os.path.getsize(part) if os.path.exists(part) else 0
        if done > MAX_FILE_BYTES[name]:
            os.remove(part)
            raise SystemExit(f"{name} is larger than expected")
        request = urllib.request.Request(url, headers={**AGENT, **({"Range": f"bytes={done}-"} if done else {})})
        try:
            reply = urllib.request.urlopen(request, timeout=120)
        except urllib.error.HTTPError as problem:
            if problem.code == 416 and done:  # a last run stopped after the final byte, but before moving the file into place
                return
            raise
        with reply:
            if "html" in reply.headers.get("Content-Type", ""):
                raise SystemExit(f"the agency sent a web page instead of {name}, so its download address may have changed")
            if done and reply.status != 206:
                done = 0
            length = reply.headers.get("Content-Length")
            total = done + int(length) if length else None
            if total and total > MAX_FILE_BYTES[name]:
                if os.path.exists(part):
                    os.remove(part)
                raise SystemExit(f"{name} is larger than expected")
            say(f"downloading {name}" + (f", {total / 1e6:.0f} MB" if total else ""))
            over = None
            with open(part, "ab" if done else "wb") as out:
                while chunk := reply.read(1 << 20):
                    done += len(chunk)
                    if done > MAX_FILE_BYTES[name]:
                        over = f"{name} is larger than expected"
                        break
                    if total and done > total:
                        over = f"{name} is longer than the agency said it would be"
                        break
                    if not enough_disk_room(folder, len(chunk)):
                        over = f"not enough free space to download {name}"
                        break
                    out.write(chunk)
                    if done % (1 << 28) < len(chunk):
                        say(f"{name}: {done / 1e6:.0f} MB")
        if over:
            os.remove(part)
            raise SystemExit(over)
        if total and done != total:
            raise OSError(f"{name} stopped short")

    _retrying(attempt, name)
    if not (_is_whole_zip(part) if name.endswith(".zip") else _is_estonian_raster(part)):
        os.remove(part)
        raise SystemExit(f"{name} did not download correctly")
    os.replace(part, target)


def _readable(address: str) -> bool:
    try:
        with rasterio.open(address, driver="GTiff") as tif:
            if tif.count != 1 or tif.width > 1000 or tif.height > 1000:
                return False
            check_raster_blocks(tif)
            tif.read(1, window=PixelWindow(tif.width - 1, tif.height - 1, 1, 1))
        return True
    except rasterio.errors.RasterioIOError:
        return False


def _is_whole_zip(path: str) -> bool:
    """Every member is read against its checksum, as a resumed download could otherwise join two different versions of a file.
    shortcut: Python cannot read the Deflate64 of the national lidar file, so a spread of its sheets is read through GDAL instead, which would miss damage between them."""
    try:
        with zipfile.ZipFile(path) as z:
            members = z.infolist()
            if (not members or len(members) > MAX_ZIP_ENTRIES or len({m.filename.casefold() for m in members}) != len(members)
                    or sum(m.file_size for m in members) > MAX_ZIP_EXPANDED
                    or any(m.file_size > MAX_ZIP_MEMBER or not safe_member(m.filename) for m in members)):
                return False
            if not any(member.compress_type == DEFLATE64 for member in members):
                return z.testzip() is None
    except zipfile.BadZipFile:
        return False
    sheets = [member for member in members if member.filename.lower().endswith(".tif")]
    return bool(sheets) and all(_readable(f"/vsizip/{{{path}}}/{member.filename}") for member in sheets[:: max(len(sheets) // SHEETS_TO_CHECK, 1)])


def _is_estonian_raster(path: str) -> bool:
    try:
        with rasterio.open(path, driver="GTiff") as tif:
            t = tif.transform
            if (tif.crs is None or tif.crs.to_epsg() != CRS or tif.count != 1 or tif.width > 100_000 or tif.height > 100_000
                    or abs(t.a - 10) > 1e-6 or abs(t.e + 10) > 1e-6 or abs(t.b) > 1e-9 or abs(t.d) > 1e-9):
                return False
            check_raster_blocks(tif)
            tif.read(1, window=PixelWindow(tif.width - 1, tif.height - 1, 1, 1))  # the far end, which a short file would not have
            return True
    except rasterio.errors.RasterioIOError:
        return False


def ensure(data_root: str, lidar: bool, say) -> None:
    os.makedirs(data_root, exist_ok=True)
    missing = [name for name in FILES if not os.path.exists(os.path.join(data_root, name))]
    if missing and shutil.disk_usage(data_root).free < ROOM_NEEDED:
        raise SystemExit(f"Estonian maps need about {ROOM_NEEDED / 1e9:.0f} GB free in {data_root}.")
    for name in FILES:
        if name != SURFACE or lidar:
            _fetch(name, data_root, say)
