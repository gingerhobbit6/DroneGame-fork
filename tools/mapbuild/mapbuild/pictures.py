"""The pictures in a pack: the OS map, cut from its 10 km tiles, and a cloud-free satellite composite."""

import json
import os
import re
import urllib.parse
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
from .source_limits import check_raster_blocks, read_capped, safe_archive_members, safe_member

warnings.filterwarnings("ignore", category=NotGeoreferencedWarning)
SEARCH = "https://earth-search.aws.element84.com/v1/search"
SCENE_HOST = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/"
SATELLITE_M = 10
BRITISH_CRS = 27700
MAX_SCENES = 5
MAX_SCENE_ATTEMPTS = 20
MAX_SEARCH_BYTES = 5_000_000
MAX_SOURCE_PIXELS = 250_000_000
MAX_MAP_PIXELS = 32_000_000
MAX_OS_TIFF_BYTES = 256_000_000
MIN_SCENES = 2


def os_map(data_root: str, window: Window, say) -> list[dict]:
    pictures = []
    archives = {}
    for square in window.squares():
        found = glob(os.path.join(data_root, f"vmd_{square.lower()}", "*.zip"))
        if not found:
            raise SystemExit(f"OS VectorMap District for square {square} is not in {data_root}. Download it first.")
        with zipfile.ZipFile(found[0]) as z:
            members = {m.group(1).lower(): member for member in safe_archive_members(z)
                       if (m := re.search(r"([A-Za-z]{2}\d\d)[^/]*\.tif$", member.filename))}
            archives[square.lower()] = (found[0], members)
    for e in range(window.west // 10_000 * 10_000, window.right, 10_000):
        for n in range(window.south // 10_000 * 10_000, window.top, 10_000):
            letters = square_letters(e, n).lower()
            path, members = archives[letters]
            info = members.get(f"{letters}{e // 10_000 % 10}{n // 10_000 % 10}")
            if not info:
                continue
            member = info.filename
            if not safe_member(member) or info.file_size > MAX_OS_TIFF_BYTES:
                raise SystemExit("OS map archive has an unsafe or oversized tile")
            west, south, right, top = max(e, window.west), max(n, window.south), min(e + 10_000, window.right), min(n + 10_000, window.top)
            with rasterio.open(f"/vsizip/{{{path}}}/{member}", driver="GTiff") as tif:
                t = tif.transform
                if (tif.count != 1 or tif.dtypes[0] != "uint8" or tif.crs is None or tif.crs.to_epsg() != BRITISH_CRS
                        or tif.width > 20_000 or tif.height > 20_000 or tif.width * tif.height > MAX_SOURCE_PIXELS
                        or not 0.5 <= t.a <= 50 or not -50 <= t.e <= -0.5 or abs(t.b) > 1e-9 or abs(t.d) > 1e-9):
                    raise SystemExit("OS map tile has unexpected raster metadata")
                span = from_bounds(west, south, right, top, t).round_offsets().round_lengths()
                if span.width <= 0 or span.height <= 0 or span.width * span.height > MAX_MAP_PIXELS:
                    raise SystemExit("OS map tile has too many pixels")
                check_raster_blocks(tif)
                part = tif.read(1, window=span)
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
            result = json.loads(read_capped(reply, MAX_SEARCH_BYTES, "satellite scene search"))
            items = result["features"]
            if not isinstance(items, list) or len(items) > 50:
                raise SystemExit("satellite scene search returned too many entries")
            for item in items:
                found[item["id"]] = item
    return sorted(found.values(), key=lambda i: i["properties"]["eo:cloud_cover"])


def composite(layers: list[np.ndarray], rows: int = 500) -> np.ndarray:
    """The median of each pixel across scenes, which removes leftover cloud. A value of 0 means no data.
    Taken a strip of `rows` at a time, as the median of a whole 70 km stack needs many times its size in memory."""
    picture = np.empty(layers[0].shape, "uint8")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        for top in range(0, picture.shape[1], rows):
            cube = np.stack([layer[:, top:top + rows] for layer in layers]).astype("float32")
            cube[cube == 0] = np.nan
            picture[:, top:top + rows] = np.nan_to_num(np.nanmedian(cube, axis=0), nan=0).clip(0, 255).astype("uint8")
    return picture


def satellite(window: Window, years: list[int], say, crs: int = BRITISH_CRS) -> tuple[list[dict], int | None]:
    """Returns the picture, and the year to credit. If too few scenes are clear, the pack simply has no satellite layer."""
    # PROJ_NETWORK lets PROJ fetch the OSTN15 datum-shift grid from cdn.proj.org, for an exact fit to the national grid (see docs/SECURITY_NOTES.md)
    os.environ.update(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2", PROJ_NETWORK="ON")
    size = 2 * window.half // SATELLITE_M
    if size <= 0 or size > 8000:
        raise SystemExit("satellite picture has an unexpected size")
    transform = from_origin(window.west, window.top, SATELLITE_M, SATELLITE_M)
    layers, latest = [], None
    for attempted, item in enumerate(scenes_for(window, years, crs)):
        if attempted >= MAX_SCENE_ATTEMPTS:
            break
        href = item["assets"]["visual"]["href"]
        url = urllib.parse.urlsplit(href)
        if (not href.startswith(SCENE_HOST) or url.scheme != "https" or url.netloc != urllib.parse.urlsplit(SCENE_HOST).netloc
                or not url.path.lower().endswith(".tif")):
            raise SystemExit(f"unexpected host for a scene: {href}")
        with rasterio.open(href, driver="GTiff") as source:
            if (source.count < 3 or any(dtype != "uint8" for dtype in source.dtypes[:3]) or source.crs is None
                    or source.width * source.height > MAX_SOURCE_PIXELS):
                raise SystemExit("satellite scene has unexpected raster metadata")
            check_raster_blocks(source)
            with WarpedVRT(source, crs=f"EPSG:{crs}", transform=transform, width=size, height=size, resampling=Resampling.bilinear, nodata=0) as vrt:
                data = vrt.read([1, 2, 3])
        filled = data.sum(axis=0) > 0
        if filled.mean() < 0.25:
            continue
        layers.append(data)
        latest = max(latest or 0, int(item["properties"]["datetime"][:4]))
        say(f"satellite: {item['id']}, covers {filled.mean():.0%}")
        if len(layers) >= MAX_SCENES:
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
