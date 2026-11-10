"""LiDAR the Environment Agency hands over as files, for when its web service is rate-limiting this machine.

The Survey Data Catalogue (https://environment.data.gov.uk/survey) gives the LIDAR Composite DTM and the LIDAR Composite First Return
DSM at 1 m as GeoTIFF tiles on the national grid, usually 5 km square, one zip each. A small area can be downloaded there by hand; for a
large one it asks for a request through its support desk, and sends the files. Put the zips, or the .tif files from them, in
<data>/lidar_tiles, both products for the same tiles. import_tiles() reads them and keeps each 1 km square they cover in lidar_cache,
exactly as a fetched square is kept, so the build, and every later one, uses them without asking the service.

These are files from outside, so each is checked before its pixels are trusted: a plain GeoTIFF only (never a VRT, which can point
GDAL anywhere), one band, 1 m pixels on the national grid, whole kilometres, and blocks small enough to decode safely.
"""

import os
import re
import zipfile

import numpy as np
import rasterio
from rasterio.windows import Window as Cut

from .source_limits import check_raster_blocks, safe_archive_members

SQUARE_M = 1000
MAX_TILE_M = 10_000  # the catalogue's tiles are 5 km; anything far bigger is not one of them
KIND = re.compile(r"(?<![A-Za-z])(DTM|DSM)(?![A-Za-z])", re.IGNORECASE)  # "LIDAR-DTM-1m-2022-SU45ne", "su4555_FZ_DSM_1m"; "dsm" is the first return
TIF = re.compile(r"\.tiff?$", re.IGNORECASE)


def kind_of(name: str) -> str | None:
    """dtm or dsm from a file's name, or None if it names neither or both."""
    found = {m.upper() for m in KIND.findall(os.path.basename(name))}
    return found.pop().lower() if len(found) == 1 else None


def sources(folder: str) -> list[tuple[str, str]]:
    """(kind, GDAL path) for every tile in the folder: .tif files, and .tif members of zips."""
    found = []
    for name in sorted(os.listdir(folder)):
        path = os.path.join(folder, name)
        if TIF.search(name):
            found.append((kind_of(name), path))
        elif name.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(path) as archive:
                    members = [m.filename for m in safe_archive_members(archive) if TIF.search(m.filename)]
            except (zipfile.BadZipFile, OSError):
                continue
            found += [(kind_of(m) or kind_of(name), f"/vsizip/{path}/{m}") for m in members]
    return [(kind, path) for kind, path in found if kind]


def tile_bounds(tif) -> tuple[int, int, int, int] | None:
    """(west, north, width, height) in metres if this is a 1 m national grid tile in whole kilometres, else None."""
    t = tif.transform
    if tif.count != 1 or abs(t.a - 1) > 1e-6 or abs(t.e + 1) > 1e-6 or abs(t.b) > 1e-9 or abs(t.d) > 1e-9:
        return None
    if tif.crs is not None and tif.crs.to_epsg() not in (27700, None):
        return None
    west, north = round(t.c), round(t.f)
    if abs(t.c - west) > 1e-3 or abs(t.f - north) > 1e-3 or west % SQUARE_M or north % SQUARE_M:
        return None
    if not (0 < tif.width <= MAX_TILE_M and 0 < tif.height <= MAX_TILE_M) or tif.width % SQUARE_M or tif.height % SQUARE_M:
        return None
    return west, north, tif.width, tif.height


def read_cut(tif, west: int, north: int, east: int, square_north: int) -> np.ndarray:
    """One 1 km square of a tile, as float32 metres with the missing values as NaN."""
    col, row = east - west, north - (square_north + SQUARE_M)
    values = tif.read(1, window=Cut(col, row, SQUARE_M, SQUARE_M)).astype("float32")
    if tif.nodata is not None:
        values[values == np.float32(tif.nodata)] = np.nan
    values[(values < -1000) | (values > 2000)] = np.nan  # as the web service's answers: its "missing" value is not always declared
    return values


def import_tiles(folder: str, cache: str, wanted: set[tuple[int, int]], reduce, say) -> int:
    """Keeps every square in `wanted` (south-west corners) that the tiles cover and the cache lacks. Returns how many were kept.

    reduce(east, north, dtm, dsm) gives a square's 20 m results; it is the builder's own, so a tile and a fetch make the same square."""
    from .terrain import cached_square, keep_square

    tiles: dict[tuple[int, int, int, int], dict[str, str]] = {}
    refused = 0
    for kind, path in sources(folder):
        try:
            with rasterio.open(path, driver="GTiff") as tif:  # GTiff only: a VRT could read any file GDAL can reach
                check_raster_blocks(tif)
                bounds = tile_bounds(tif)
        except (rasterio.errors.RasterioIOError, SystemExit, ValueError):
            bounds = None
        if bounds is None:
            refused += 1
            continue
        tiles.setdefault(bounds, {})[kind] = path
    if refused:
        say(f"lidar tiles: {refused} file(s) in {folder} are not 1 m national grid GeoTIFF tiles, and were left out")
    kept = unpaired = 0
    for (west, north, width, height), pair in sorted(tiles.items()):
        if set(pair) != {"dtm", "dsm"}:
            unpaired += 1
            continue
        squares = [(e, n) for e in range(west, west + width, SQUARE_M) for n in range(north - height, north, SQUARE_M)
                   if (e, n) in wanted and cached_square(cache, e, n) is None]
        if not squares:
            continue
        with rasterio.open(pair["dtm"], driver="GTiff") as dtm_tif, rasterio.open(pair["dsm"], driver="GTiff") as dsm_tif:
            for east, square_north in squares:
                dtm, dsm = read_cut(dtm_tif, west, north, east, square_north), read_cut(dsm_tif, west, north, east, square_north)
                if np.isnan(dtm).all() or np.isnan(dsm).all():
                    continue  # a tile only part covered, as on the coast: the service may still have it
                keep_square(cache, east, square_north, reduce(east, square_north, dtm, dsm))
                kept += 1
    if unpaired:
        say(f"lidar tiles: {unpaired} tile(s) have only one of the DTM and the DSM, and need both")
    if tiles:
        say(f"lidar tiles: {kept} new square(s) taken from {len(tiles)} tile(s) in {folder}")
    return kept
