"""Place names past Estonia's border, from GeoNames. Its file for the whole of Russia is downloaded once, so the download does not
point at a site, and everything in it is in Russia, so it needs no border of its own. Names are written in Latin letters, as GeoNames
gives them, to match the Estonian names and the game."""

import io
import os
import urllib.request
import zipfile

import numpy as np
import shapely
from pyproj import Transformer

from .estonia_files import AGENT, CRS, _retrying
from .grid import Window

URL = "https://download.geonames.org/export/dump/RU.zip"
FOLDER = "geonames"
MAX_BYTES = 60_000_000  # 15 MB in November 2026
CREDIT = "Place names past the border: GeoNames, geonames.org, CC BY 4.0"
# Settlements only, leaving out ones GeoNames marks as historical, abandoned, destroyed or a part of another place.
LEFT_OUT = {"PPLH", "PPLQ", "PPLW", "PPLX", "PPLCH"}
TOWN_CODES = {"PPLC", "PPLA", "PPLA2", "PPLA3"}
TOWN_PEOPLE = 2000  # a town is drawn as large as an Estonian town; anything smaller as a village


def _fetch(target: str, say) -> None:
    def attempt() -> bytes:
        request = urllib.request.Request(URL, headers=AGENT)
        with urllib.request.urlopen(request, timeout=120) as reply:
            data = reply.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise SystemExit("The GeoNames file for Russia is far larger than expected")
        with zipfile.ZipFile(io.BytesIO(data)) as whole:
            if "RU.txt" not in whole.namelist() or whole.testzip() is not None:
                raise OSError("the GeoNames file did not arrive whole")
        return data
    say("downloading place names: GeoNames RU.zip")
    data = _retrying(attempt, "GeoNames RU.zip")
    with open(target + ".part", "wb") as out:
        out.write(data)
    os.replace(target + ".part", target)


def ensure(data_root: str, say) -> str:
    folder = os.path.join(data_root, FOLDER)
    os.makedirs(folder, exist_ok=True)
    target = os.path.join(folder, "RU.zip")
    if not os.path.exists(target):
        _fetch(target, say)
    return target


def size_of(code: str, people: int) -> str:
    return "Large" if code in TOWN_CODES or people >= TOWN_PEOPLE else "Medium"


def _rows(path: str):
    with zipfile.ZipFile(path) as whole, whole.open("RU.txt") as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8"):
            yield line.rstrip("\n").split("\t")


def place_names(data_root: str, window: Window, rows=None) -> tuple[np.ndarray, dict]:
    """Russian settlements in the window, in the fields OS names come in. None are found when the file is not on this machine."""
    if rows is None:
        path = os.path.join(data_root, FOLDER, "RU.zip")
        if not os.path.exists(path):
            return np.array([], dtype=object), {}
        rows = _rows(path)
    to_grid = Transformer.from_crs(4326, CRS, always_xy=True)
    to_degrees = Transformer.from_crs(CRS, 4326, always_xy=True)
    lons, lats = to_degrees.transform([window.west, window.right, window.west, window.right], [window.south, window.south, window.top, window.top])
    west, east, south, north = min(lons) - 0.1, max(lons) + 0.1, min(lats) - 0.1, max(lats) + 0.1
    points, names, sizes = [], [], []
    for row in rows:
        if len(row) < 15 or row[6] != "P" or row[7] in LEFT_OUT:
            continue
        lat, lon = float(row[4]), float(row[5])
        if not (west <= lon <= east and south <= lat <= north):
            continue
        x, y = to_grid.transform(lon, lat)
        if not (window.west <= x <= window.right and window.south <= y <= window.top):
            continue
        name = row[1] if row[1].isascii() or not row[2] else row[2]  # the Latin name, or its plain-letter form if it has Cyrillic in it
        points.append(shapely.Point(x, y))
        names.append(name)
        sizes.append(size_of(row[7], int(row[14] or 0)))
    return np.array(points, dtype=object), {"DISTNAME": np.array(names, dtype=object), "CLASSIFICA": np.full(len(names), "Populated Place", dtype=object),
                                            "FONTHEIGHT": np.array(sizes, dtype=object)}
