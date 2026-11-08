"""The pictures in a pack: the OS map, cut from its 10 km tiles, and a cloud-free satellite composite."""

import json
import os
import re
import urllib.request
import warnings
import zipfile
from glob import glob

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.errors import NotGeoreferencedWarning
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.windows import from_bounds

from .grid import Window, square_letters

warnings.filterwarnings("ignore", category=NotGeoreferencedWarning)
SEARCH = "https://earth-search.aws.element84.com/v1/search"
SCENE_HOST = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/"
SATELLITE_M = 10
BRITISH_CRS = 27700
MAX_SCENES = 5
MIN_SCENES = 2


def os_map(data_root: str, window: Window, say) -> list[dict]:
    pictures = []
    archives = {}
    for square in window.squares():
        found = glob(os.path.join(data_root, f"vmd_{square.lower()}", "*.zip"))
        if not found:
            raise SystemExit(f"OS VectorMap District for square {square} is not in {data_root}. Download it first.")
        with zipfile.ZipFile(found[0]) as z:
            archives[square.lower()] = (found[0], {m.group(1).lower(): n for n in z.namelist() if (m := re.search(r"([A-Za-z]{2}\d\d)[^/]*\.tif$", n))})
    for e in range(window.west // 10_000 * 10_000, window.right, 10_000):
        for n in range(window.south // 10_000 * 10_000, window.top, 10_000):
            letters = square_letters(e, n).lower()
            path, members = archives[letters]
            member = members.get(f"{letters}{e // 10_000 % 10}{n // 10_000 % 10}")
            if not member:
                continue
            west, south, right, top = max(e, window.west), max(n, window.south), min(e + 10_000, window.right), min(n + 10_000, window.top)
            with rasterio.open(f"/vsizip/{path}/{member}") as tif:
                part = tif.read(1, window=from_bounds(west, south, right, top, tif.transform).round_offsets().round_lengths())
                with MemoryFile() as memory:
                    with memory.open(driver="PNG", width=part.shape[1], height=part.shape[0], count=1, dtype="uint8") as png:
                        png.write(part, 1)
                        png.write_colormap(1, tif.colormap(1))
                    data = memory.read()
            pictures.append({"layer": "osmap", "west": west, "top": top, "width": right - west, "height": top - south, "type": "image/png", "data": data})
    say(f"OS map: {len(pictures)} pieces, {sum(len(p['data']) for p in pictures) / 1e6:.1f} MB")
    return pictures


def scenes_for(window: Window, years: list[int], crs: int = BRITISH_CRS) -> list[dict]:
    to_wgs = Transformer.from_crs(crs, 4326, always_xy=True)
    west, south = to_wgs.transform(window.west, window.south)
    east, north = to_wgs.transform(window.right, window.top)
    found = {}
    for year in years:
        body = json.dumps({"collections": ["sentinel-2-l2a"], "bbox": [west, south, east, north], "datetime": f"{year}-05-01T00:00:00Z/{year}-09-30T23:59:59Z",
                           "query": {"eo:cloud_cover": {"lt": 10}}, "limit": 50}).encode()
        request = urllib.request.Request(SEARCH, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=60) as reply:
            for item in json.load(reply)["features"]:
                found[item["id"]] = item
    return sorted(found.values(), key=lambda i: i["properties"]["eo:cloud_cover"])


def composite(layers: list[np.ndarray]) -> np.ndarray:
    """The median of each pixel across scenes, which removes leftover cloud. A value of 0 means no data."""
    cube = np.stack(layers).astype("float32")
    cube[cube == 0] = np.nan
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nan_to_num(np.nanmedian(cube, axis=0), nan=0).clip(0, 255).astype("uint8")


def satellite(window: Window, years: list[int], say, crs: int = BRITISH_CRS) -> tuple[list[dict], int | None]:
    """Returns the picture, and the year to credit. If too few scenes are clear, the pack simply has no satellite layer."""
    # PROJ_NETWORK lets PROJ fetch the OSTN15 datum-shift grid from cdn.proj.org, for an exact fit to the national grid (see docs/SECURITY_NOTES.md)
    os.environ.update(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2", PROJ_NETWORK="ON")
    size = 2 * window.half // SATELLITE_M
    transform = from_origin(window.west, window.top, SATELLITE_M, SATELLITE_M)
    layers, latest = [], None
    seen = None
    for item in scenes_for(window, years, crs):
        href = item["assets"]["visual"]["href"]
        if not href.startswith(SCENE_HOST):
            raise SystemExit(f"unexpected host for a scene: {href}")
        with rasterio.open(href) as source, WarpedVRT(source, crs=f"EPSG:{crs}", transform=transform, width=size, height=size, resampling=Resampling.bilinear, nodata=0) as vrt:
            data = vrt.read()
        filled = data.sum(axis=0) > 0
        if filled.mean() < 0.25:
            continue
        layers.append(data)
        seen = filled.astype("int16") if seen is None else seen + filled
        latest = max(latest or 0, int(item["properties"]["datetime"][:4]))
        say(f"satellite: {item['id']}, covers {filled.mean():.0%}")
        if len(layers) >= MAX_SCENES and seen.min() >= MIN_SCENES + 1:
            break
    if len(layers) < MIN_SCENES:
        say("satellite: too few clear scenes, so this pack has no satellite layer")
        return [], None
    picture = composite(layers)
    with MemoryFile() as memory:
        with memory.open(driver="JPEG", width=size, height=size, count=3, dtype="uint8", QUALITY=88) as jpeg:
            jpeg.write(picture)
        data = memory.read()
    say(f"satellite: {len(layers)} scenes, {len(data) / 1e6:.1f} MB")
    return [{"layer": "satellite", "west": window.west, "top": window.top, "width": 2 * window.half, "height": 2 * window.half, "type": "image/jpeg", "data": data}], latest
