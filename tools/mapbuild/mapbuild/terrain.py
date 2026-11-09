"""Heights: Terrain 50 for the whole pack, and 1 m lidar where it is asked for, reduced to 20 m results."""

import io
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from glob import glob

import numpy as np
from rasterio.features import rasterize
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from shapely import STRtree, box, intersects
from shapely.geometry import mapping

from .grid import CELL, Window, square_letters
from .source_limits import check_raster_blocks, read_capped

BASE = "https://environment.data.gov.uk/spatialdata"
SERVICES = {
    "dtm": (f"{BASE}/lidar-composite-digital-terrain-model-dtm-1m/wcs", "13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m"),
    "dsm": (f"{BASE}/lidar-composite-digital-surface-model-first-return-dsm-1m/wcs", "df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb__Lidar_Composite_Elevation_FZ_DSM_1m"),
}
SQUARE_M = 1000
MAX_WCS_BYTES = 32_000_000
POSTS_PER_SQUARE = SQUARE_M // CELL + 1
TALL_M = 5  # cover at least this tall counts as trees
MIN_BUILDING_SHARE = 0.1  # of a cell, before a footprint makes the cell solid


def parse_asc(text: str) -> tuple[dict, np.ndarray]:
    lines = text.splitlines()
    head = {}
    while lines and re.match(r"[A-Za-z]", lines[0]):
        key, value = lines.pop(0).split()
        head[key.lower()] = float(value)
    return head, np.array([line.split() for line in lines], dtype="float32")


MAX_MEMBER = 100_000_000  # bytes: a Terrain 50 tile is well under 1 MB unpacked, so a member near this is not one


def _read(archive: zipfile.ZipFile, name: str) -> bytes:
    """zipfile stops at the declared size, so checking it bounds what a damaged or crafted archive can unpack."""
    if archive.getinfo(name).file_size > MAX_MEMBER:
        raise SystemExit(f"refusing an oversized Terrain 50 member: {name}")
    return archive.read(name)


def terrain50(data_root: str, window: Window) -> tuple[np.ndarray, np.ndarray]:
    """Heights at the window's posts, and which posts have no Terrain 50 tile at all, which OS only leaves out where there is no land."""
    west, top = window.west - 100, window.top + 100
    span = 2 * window.half + 200
    mosaic = np.full((span // 50 + 1, span // 50 + 1), np.nan, dtype="float32")
    with zipfile.ZipFile(glob(os.path.join(data_root, "terrain50", "*.zip"))[0]) as outer:
        members = {re.search(r"/([a-z]{2}\d\d)_", n).group(1): n for n in outer.namelist() if n.endswith(".zip")}
        for e in range(west // 10_000 * 10_000, west + span, 10_000):
            for n in range((top - span) // 10_000 * 10_000, top, 10_000):
                name = f"{square_letters(e, n).lower()}{e // 10_000 % 10}{n // 10_000 % 10}"
                if name not in members:
                    continue
                with zipfile.ZipFile(io.BytesIO(_read(outer, members[name]))) as inner:
                    asc = next(m for m in inner.namelist() if m.lower().endswith(".asc"))
                    head, values = parse_asc(_read(inner, asc).decode("ascii"))
                col0 = int(round((head["xllcorner"] - west) / 50))
                row0 = int(round((top - (head["yllcorner"] + head["cellsize"] * head["nrows"])) / 50))
                r0, r1 = max(row0, 0), min(row0 + values.shape[0], mosaic.shape[0])
                c0, c1 = max(col0, 0), min(col0 + values.shape[1], mosaic.shape[1])
                if r0 < r1 and c0 < c1:
                    mosaic[r0:r1, c0:c1] = values[r0 - row0:r1 - row0, c0 - col0:c1 - col0]
    absent = np.isnan(mosaic)
    mosaic[absent] = 0
    side = window.side
    xs = (window.west + np.arange(side) * CELL - west - 25) / 50
    ys = (top - (window.top - np.arange(side) * CELL) - 25) / 50
    x0, y0 = np.clip(np.floor(xs).astype(int), 0, mosaic.shape[1] - 2), np.clip(np.floor(ys).astype(int), 0, mosaic.shape[0] - 2)
    tx, ty = (xs - x0)[None, :], (ys - y0)[:, None]
    a, b = mosaic[np.ix_(y0, x0)], mosaic[np.ix_(y0, x0 + 1)]
    c, d = mosaic[np.ix_(y0 + 1, x0)], mosaic[np.ix_(y0 + 1, x0 + 1)]
    heights = ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty).astype("float32")
    return heights, absent[np.ix_(np.round(ys).astype(int), np.round(xs).astype(int))]


def read_square(data: bytes, east: int, north: int) -> np.ndarray:
    with MemoryFile(data) as memory, memory.open(driver="GTiff") as tif:
        t = tif.transform
        if (tif.count != 1 or tif.width != SQUARE_M or tif.height != SQUARE_M or abs(t.a - 1) > 1e-6 or abs(t.e + 1) > 1e-6
                or abs(t.b) > 1e-9 or abs(t.d) > 1e-9 or abs(t.c - east) > 1e-3 or abs(t.f - (north + SQUARE_M)) > 1e-3):
            raise ValueError(f"unexpected answer for {east},{north}")
        check_raster_blocks(tif)
        values = tif.read(1).astype("float32")
    values[(values < -1000) | (values > 2000)] = np.nan  # the service's "missing" value, which it does not always declare
    return values


def fetch_square(service: tuple[str, str], east: int, north: int) -> np.ndarray:
    url, coverage = service
    query = [("service", "WCS"), ("version", "2.0.1"), ("request", "GetCoverage"), ("CoverageId", coverage), ("format", "image/tiff"),
             ("subset", f"E({east},{east + SQUARE_M})"), ("subset", f"N({north},{north + SQUARE_M})"), ("geotiff:compression", "DEFLATE")]
    wait = 5
    for attempt in range(6):
        try:
            with urllib.request.urlopen(f"{url}?{urllib.parse.urlencode(query)}", timeout=120) as reply:
                return read_square(read_capped(reply, MAX_WCS_BYTES, "lidar answer"), east, north)  # damaged answers are fetched again
        except (OSError, ValueError, urllib.error.URLError, Exception) as problem:  # noqa: B014 - rasterio raises its own errors
            if attempt >= 2 and getattr(problem, "code", None) == 500:
                return np.full((SQUARE_M, SQUARE_M), np.nan, "float32")  # some all-sea squares always fail
            print(f"  retrying {east},{north}: {str(problem)[:100]}", file=sys.stderr)
            time.sleep(wait)
            wait *= 2
    raise SystemExit(f"gave up fetching lidar at {east},{north}")


def reduce_square(dtm: np.ndarray, dsm: np.ndarray, houses: np.ndarray) -> dict[str, np.ndarray]:
    """1 m rows and columns to the square's 51 x 51 posts. A post's cell reaches 10 m each way, so a post on the square's edge sees half a cell."""
    out = {k: np.full((POSTS_PER_SQUARE, POSTS_PER_SQUARE), np.nan, "float32") for k in ("ground", "tall", "houses")}
    for row in range(POSTS_PER_SQUARE):
        r0, r1 = max(row * CELL - CELL // 2, 0), min(row * CELL + CELL // 2, SQUARE_M)
        for col in range(POSTS_PER_SQUARE):
            c0, c1 = max(col * CELL - CELL // 2, 0), min(col * CELL + CELL // 2, SQUARE_M)
            bare, top = dtm[r0:r1, c0:c1], dsm[r0:r1, c0:c1]
            good = np.isfinite(bare)
            if not good.any():
                continue
            out["ground"][row, col] = bare[good].mean()
            gap = (top - bare)[good & np.isfinite(top)]
            if gap.size:
                out["tall"][row, col] = np.partition(gap, int(gap.size * 0.9) - 1 if gap.size > 1 else 0)[int(gap.size * 0.9) - 1 if gap.size > 1 else 0]
            inside = houses[r0:r1, c0:c1] & good & np.isfinite(top)
            if inside.sum() >= MIN_BUILDING_SHARE * bare.size:
                values = (top - bare)[inside]
                out["houses"][row, col] = np.partition(values, int(values.size * 0.9) - 1)[int(values.size * 0.9) - 1]
    return out


def lidar(window: Window, half: int, buildings, say) -> dict[str, np.ndarray]:
    """20 m results across the window's posts, for the central part reaching `half` metres from the middle. NaN elsewhere."""
    grids = {k: np.full((window.side, window.side), np.nan, "float32") for k in ("ground", "tall", "houses")}
    tree = STRtree(buildings)
    west, top = window.east - half, window.north + half
    count = 2 * half // SQUARE_M
    began, done = time.time(), 0
    with ThreadPoolExecutor(2) as pool:
        for row in range(count):
            for col in range(count):
                east, north = west + col * SQUARE_M, top - (row + 1) * SQUARE_M
                dtm, dsm = pool.map(lambda s: fetch_square(SERVICES[s], east, north), SERVICES)
                near = buildings[tree.query(box(east, north, east + SQUARE_M, north + SQUARE_M))]
                houses = np.zeros((SQUARE_M, SQUARE_M), "uint8")
                if len(near):
                    rasterize(((mapping(s), 1) for s in near), out=houses, transform=from_origin(east, north + SQUARE_M, 1, 1))
                reduced = reduce_square(dtm, dsm, houses.astype(bool))
                r0, c0 = (window.top - (north + SQUARE_M)) // CELL, (east - window.west) // CELL
                for name, values in reduced.items():
                    target = grids[name][r0:r0 + POSTS_PER_SQUARE, c0:c0 + POSTS_PER_SQUARE]
                    target[np.isnan(target)] = values[np.isnan(target)]  # the first square to reach a shared edge post keeps it
                done += 1
                if done % 20 == 0:
                    say(f"lidar {done}/{count * count} squares, {(time.time() - began) / done:.1f} s each")
    return grids


def combine(window: Window, t50: np.ndarray, lidar_grids: dict[str, np.ndarray] | None, cover: np.ndarray, assumed_wood: np.ndarray, assumed_built: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """The final grids. Lidar where it exists: any tall cover that is not a building or water is trees. Terrain 50 and assumed heights elsewhere."""
    cover = cover.copy()
    ground = t50.copy()
    canopy = np.where(assumed_wood, 16, 0).astype("uint8")
    bldg = np.where(assumed_built, 8, 0).astype("uint8")
    if lidar_grids is not None:
        has = np.isfinite(lidar_grids["ground"])
        ground[has] = lidar_grids["ground"][has]
        tall = np.nan_to_num(lidar_grids["tall"]) * has
        houses = np.nan_to_num(lidar_grids["houses"]) * has
        bldg[has] = np.clip(np.where(houses >= 2, np.round(houses), 0), 0, 255)[has]
        trees = (tall >= TALL_M) & (bldg == 0) & (cover != 4)
        canopy[has] = 0
        canopy[trees] = np.clip(np.round(tall[trees]), 0, 255)
        cover[has & (cover == 1)] = 0
        cover[trees & (cover != 3)] = 1
        cover[has & (bldg > 0) & (cover != 4)] = 2
        cover[has & (bldg == 0) & (cover == 2)] = 0
    return np.round(ground, 1).astype("float32"), canopy, bldg, cover
