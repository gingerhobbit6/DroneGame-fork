"""The ground past Estonia's border that its basic map leaves blank. The pack carries its outline, so the game can shade that part from
its heights instead of showing an empty white or black space."""

import numpy as np
import shapely
from rasterio.features import rasterize, shapes
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from .features import to_scene
from .grid import CELL, Window

WHITE, BLACK = 245, 10  # a blank pixel is near white or near black in every channel, after JPEG has blurred it
MIN_AREA_M2 = 250_000  # smaller blank patches are gaps between labels, not land the map leaves out


def blank_posts(window: Window, pictures: list[dict]) -> np.ndarray:
    """The posts where the basic map shows nothing, sampled at each post. A post no picture reaches counts as blank."""
    blank = np.ones((window.side, window.side), bool)
    xs, ys = window.west + CELL * np.arange(window.side), window.top - CELL * np.arange(window.side)
    for p in pictures:
        if p["layer"] != "osmap":
            continue
        with MemoryFile(p["data"]) as memory, memory.open(driver="JPEG") as jpeg:
            if jpeg.count != 3 or jpeg.width * jpeg.height > 10_000_000:
                raise SystemExit("basic map picture has unexpected pixels")
            pixels = jpeg.read()
        size = p["width"] / pixels.shape[2]
        cols, rows = np.floor((xs - p["west"]) / size).astype(int), np.floor((p["top"] - ys) / size).astype(int)
        i, j = np.flatnonzero((cols >= 0) & (cols < pixels.shape[2])), np.flatnonzero((rows >= 0) & (rows < pixels.shape[1]))
        if not len(i) or not len(j):
            continue
        seen = pixels[:, rows[j][:, None], cols[i][None, :]]
        blank[np.ix_(j, i)] = (seen >= WHITE).all(axis=0) | (seen <= BLACK).all(axis=0)
    return blank


def reaching(window: Window, blank: np.ndarray, past: np.ndarray) -> np.ndarray:
    """The blank posts in patches that reach past the border. Estonian heights run a few hundred metres past it, where the map is
    already blank, so the posts Copernicus filled alone would leave a white strip along the border. Patches are labelled by turning
    them into shapes and back, as numpy has no labelling of its own."""
    transform = from_origin(window.west - CELL / 2, window.top + CELL / 2, CELL, CELL)
    parts = [shape for shape, value in shapes(blank.astype("uint8"), mask=blank, transform=transform) if value]
    if not parts:
        return blank
    labels = rasterize(((part, k + 1) for k, part in enumerate(parts)), out_shape=blank.shape, transform=transform, dtype="int32")
    keep = np.unique(labels[blank & past])
    return np.isin(labels, keep[keep > 0])


def rings(window: Window, posts: np.ndarray) -> list[list[list[float]]]:
    """The outline of the marked posts, as rings in scene metres. Holes are rings too: the game fills them even-odd."""
    if not posts.any():
        return []
    transform = from_origin(window.west - CELL / 2, window.top + CELL / 2, CELL, CELL)
    parts = [shapely.geometry.shape(shape) for shape, value in shapes(posts.astype("uint8"), mask=posts, transform=transform) if value]
    found = []
    for part in shapely.get_parts(shapely.simplify(shapely.union_all(parts), CELL)):
        if part.geom_type != "Polygon" or part.area < MIN_AREA_M2:
            continue
        for ring in [part.exterior, *(hole for hole in part.interiors if shapely.Polygon(hole).area >= MIN_AREA_M2)]:
            found.append([to_scene(window, x, y) for x, y in ring.coords])
    return found
