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
ROOM_NEEDED = 8_000_000_000  # the national files, in bytes, with a little to spare
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
        return
    os.makedirs(folder, exist_ok=True)
    part = target + ".part"
    url = FILES[name]

    def attempt() -> None:
        done = os.path.getsize(part) if os.path.exists(part) else 0
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
            say(f"downloading {name}" + (f", {total / 1e6:.0f} MB" if total else ""))
            with open(part, "ab" if done else "wb") as out:
                while (chunk := reply.read(1 << 20)) and not (total and done > total):
                    out.write(chunk)
                    done += len(chunk)
                    if done % (1 << 28) < len(chunk):
                        say(f"{name}: {done / 1e6:.0f} MB")
        if total and done > total:
            os.remove(part)
            raise SystemExit(f"{name} is longer than the agency said it would be")
        if total and done != total:
            raise OSError(f"{name} stopped short")

    _retrying(attempt, name)
    if not (_is_whole_zip(part) if name.endswith(".zip") else _is_estonian_raster(part)):
        os.remove(part)
        raise SystemExit(f"{name} did not download correctly")
    os.replace(part, target)


def _readable(address: str) -> bool:
    try:
        with rasterio.open(address) as tif:
            tif.read(1)
        return True
    except rasterio.errors.RasterioIOError:
        return False


def _is_whole_zip(path: str) -> bool:
    """Every member is read against its checksum, as a resumed download could otherwise join two different versions of a file.
    shortcut: Python cannot read the Deflate64 of the national lidar file, so a spread of its sheets is read through GDAL instead, which would miss damage between them."""
    try:
        with zipfile.ZipFile(path) as z:
            members = z.infolist()
            if not members:
                return False
            if members[0].compress_type != DEFLATE64:
                return z.testzip() is None
    except zipfile.BadZipFile:
        return False
    return all(_readable(f"/vsizip/{{{path}}}/{member.filename}") for member in members[:: max(len(members) // SHEETS_TO_CHECK, 1)])


def _is_estonian_raster(path: str) -> bool:
    try:
        with rasterio.open(path) as tif:
            if tif.crs is None or tif.crs.to_epsg() != CRS:
                return False
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
