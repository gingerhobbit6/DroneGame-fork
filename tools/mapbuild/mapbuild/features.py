"""OS OpenMap Local: what covers the ground, and the buildings, power lines, roads and names drawn on it."""

import math
import os
import re
import zipfile
from glob import glob

import numpy as np
import shapely
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely.geometry import mapping

from .grid import CELL, Window
from .source_limits import read_shapefile, safe_archive_members

PYLON_SPACING = 260  # TERRAIN.pylonSpacing in the game
CORRIDOR_M = 50
MAX_BUILDINGS = 500_000  # MAX_BUILDINGS in frontend/src/sim/world-pack.js: the game refuses a pack with more
MAX_LINE_POINTS = 30_000  # includes every line in the pack, before the game builds wire meshes
MAX_LINES = 3_000
MAX_POWER_VERTICES = 100_000
MAX_ROAD_VERTICES = 2_000_000
MAX_ROAD_POINTS = 400_000
MAX_ROADS = 150_000
MAX_NAMES = 25_000
MAX_SOURCE_OFFSET = 2_000_000  # a source feature may cross the window, but not the entire planet


def _check_shapes(window: Window, shapes, *, max_shapes: int, max_vertices: int, description: str) -> None:
    if len(shapes) > max_shapes or int(shapely.get_num_coordinates(shapes).sum()) > max_vertices:
        raise ValueError(f"{description} have too many shapes or vertices")
    if len(shapes):
        bounds = shapely.bounds(shapes)
        centre = np.array([window.east, window.north, window.east, window.north])
        if not np.isfinite(bounds).all() or np.any(np.abs(bounds - centre) > MAX_SOURCE_OFFSET):
            raise ValueError(f"{description} have coordinates outside the map's source region")


def _check_power(window: Window, power) -> None:
    _check_shapes(window, power, max_shapes=MAX_LINES, max_vertices=MAX_POWER_VERTICES, description="power lines")
    if len(power):
        lengths = shapely.length(power)
        if not np.isfinite(lengths).all() or lengths.sum() > MAX_LINE_POINTS * PYLON_SPACING:
            raise ValueError("power lines need more pylons than a map pack can hold")


class OpenMap:
    def __init__(self, data_root: str, window: Window):
        self.window = window
        self.layers = []
        for square in window.squares():
            found = glob(os.path.join(data_root, f"openmap_{square.lower()}", "*.zip"))
            if not found:
                raise SystemExit(f"OS OpenMap Local for square {square} is not in {data_root}. Download it first.")
            with zipfile.ZipFile(found[0]) as z:
                names = {match.group(1): n for n in (m.filename for m in safe_archive_members(z)) if (match := re.search(r"_([A-Za-z_]+)\.shp$", n))}
            self.layers.append((found[0], names))

    def read(self, layer: str, fields: list[str] | None = None) -> tuple[np.ndarray, dict]:
        w = self.window
        shapes, values = [], {f: [] for f in fields or []}
        for path, names in self.layers:
            if layer not in names:
                continue
            meta, _, geometry, data = read_shapefile(path, names[layer], bbox=(w.west, w.south, w.right, w.top), columns=fields or [], force_2d=True)
            shapes.append(shapely.from_wkb(geometry))
            for name, column in zip(meta["fields"], data):
                values[name].append(column)
        if not shapes:
            return np.array([], dtype=object), {f: np.array([]) for f in fields or []}
        return np.concatenate(shapes), {k: np.concatenate(v) for k, v in values.items()}


def burn(shapes, value: int, out: np.ndarray, transform) -> None:
    if len(shapes):
        rasterize(((mapping(s), value) for s in shapes), out=out, transform=transform, default_value=value)


def cover_grid(window: Window, wood, houses, power, water, open_sea: np.ndarray) -> np.ndarray:
    """4 water, 3 power line corridor, 2 built, 1 woodland, 0 open. The same classes as generated terrain."""
    _check_power(window, power)  # before buffering and rasterising any untrusted line
    transform = from_origin(window.west - CELL / 2, window.top + CELL / 2, CELL, CELL)
    cover = np.zeros((window.side, window.side), "uint8")
    burn(wood, 1, cover, transform)
    if len(power):
        burn(shapely.buffer(power, CORRIDOR_M), 3, cover, transform)
    burn(houses, 2, cover, transform)
    burn(water, 4, cover, transform)
    cover[open_sea] = 4  # OS tidal water stops short of the open sea
    return cover


def to_scene(window: Window, x, y) -> list[float]:
    """Metres from the pack's middle: x east, z south, as the game's scene axes run."""
    return [round(float(x - window.east), 1), round(float(window.north - y), 1)]


def building_box(window: Window, envelope) -> list[float] | None:
    corners = np.array(envelope.exterior.coords)[:4]
    if len(corners) < 4:
        return None
    along, across = corners[1] - corners[0], corners[2] - corners[1]
    middle = corners.mean(axis=0)
    return [*to_scene(window, *middle), round(float(np.hypot(*along)), 1), round(float(np.hypot(*across)), 1), 8, round(float(np.arctan2(along[1], along[0])), 3)]


def feature_lists(window: Window, houses, power, roads, road_fields, names, name_fields, bldg: np.ndarray) -> dict:
    _check_power(window, power)
    _check_shapes(window, roads, max_shapes=MAX_ROADS, max_vertices=MAX_ROAD_VERTICES, description="roads")
    _check_shapes(window, names, max_shapes=MAX_NAMES, max_vertices=MAX_NAMES, description="place names")
    rows = []
    for row in map(lambda e: building_box(window, e), shapely.oriented_envelope(houses)):
        if row:
            i, j = int(round((row[0] + window.half) / CELL)), int(round((row[1] + window.half) / CELL))
            if 0 <= i < window.side and 0 <= j < window.side and bldg[j, i]:
                row[4] = int(bldg[j, i])
            rows.append(row)
    if len(rows) > MAX_BUILDINGS:  # a city has more: keep the nearest. Line of sight still has them all, from the bldg grid
        rows.sort(key=lambda r: r[0] ** 2 + r[1] ** 2)
        del rows[MAX_BUILDINGS:]
    lines = []
    line_points = 0
    for line in power:
        if line.geom_type == "LineString" and line.length > 0:
            if len(lines) >= MAX_LINES:
                raise ValueError("a map pack has too many power lines")
            length = line.length
            if not math.isfinite(length) or length > (MAX_LINE_POINTS - line_points) * PYLON_SPACING:
                raise ValueError("power lines need more pylons than a map pack can hold")
            line_points += math.ceil(length / PYLON_SPACING)
            points = shapely.line_interpolate_point(line, np.arange(0, length, PYLON_SPACING))
            lines.append([to_scene(window, p.x, p.y) for p in points])
    road_rows = []
    simple_roads = shapely.simplify(roads, 5)
    if int(shapely.get_num_coordinates(simple_roads).sum()) > MAX_ROAD_POINTS:
        raise ValueError("roads have more points than a map pack can hold")
    for shape, cls in zip(simple_roads, road_fields.get("CLASSIFICA", [])):
        if shape.geom_type == "LineString":
            road_rows.append([str(cls), [to_scene(window, x, y) for x, y in shape.coords]])
    name_rows = []
    for point, text, kind, height in zip(names, name_fields.get("DISTNAME", []), name_fields.get("CLASSIFICA", []), name_fields.get("FONTHEIGHT", [])):
        if text:
            if len(str(kind)) > 64 or len(str(height)) > 32:
                raise ValueError("place name labels are too long")
            name_rows.append([str(text)[:80], str(kind), str(height), *to_scene(window, point.x, point.y)])
    return {"buildings": rows, "lines": lines, "roads": road_rows, "names": name_rows}
