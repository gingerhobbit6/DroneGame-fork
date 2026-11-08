"""Heights beyond Estonia's border, from the Copernicus DEM GLO-30 on AWS open data. Whole 1 degree tiles are fetched, so a download
says little about where a pack is. GLO-30 is a surface model, so woods and buildings there are part of its heights, and its water body
mask says where the water is."""

import hashlib
import math
import os
import urllib.request

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject

from .estonia_files import AGENT, CRS, _retrying
from .grid import CELL, Window

BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
FOLDER = "copernicus"
MAX_TILE_BYTES = 120_000_000  # a 1 degree tile is 14 to 25 MB here, so anything far bigger is not what it claims to be
CREDIT = ("Beyond the border: produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under "
          "COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge of the Copernicus programme by law or by "
          "delegation do not incur any liability for any use of the Copernicus WorldDEM-30")  # no full stop: the game adds one between credits


def tiles(window: Window) -> list[str]:
    """The tiles the window touches, by name. Estonia and its neighbours are all north and east, so only those are handled."""
    to_degrees = Transformer.from_crs(CRS, 4326, always_xy=True)
    steps = np.linspace(0, 1, 9)
    edge = [(window.west + (window.right - window.west) * a, window.south + (window.top - window.south) * b) for a in steps for b in (0, 1)]
    edge += [(window.west + (window.right - window.west) * b, window.south + (window.top - window.south) * a) for a in steps for b in (0, 1)]
    lon, lat = to_degrees.transform(*zip(*edge))
    if min(lon) < 0 or min(lat) < 0:
        raise SystemExit("Copernicus heights are only set up north and east of Greenwich")
    return [f"Copernicus_DSM_COG_10_N{y:02d}_00_E{x:03d}_00_DEM" for y in range(math.floor(min(lat)), math.floor(max(lat)) + 1)
            for x in range(math.floor(min(lon)), math.floor(max(lon)) + 1)]


def _files(tile: str) -> dict[str, str]:
    """The heights and the water mask, each by its place in the bucket."""
    return {"dem": f"{tile}/{tile}.tif", "water": f"{tile}/AUXFILES/{tile.removesuffix('_DEM')}_WBM.tif"}


def _fetch(key: str, target: str, say) -> None:
    """One file, checked against the MD5 that S3 gives as its ETag for a file sent in one piece."""
    def attempt() -> None:
        request = urllib.request.Request(f"{BUCKET}/{key}", headers=AGENT)
        with urllib.request.urlopen(request, timeout=120) as reply:
            size = int(reply.headers.get("Content-Length") or 0)
            if size > MAX_TILE_BYTES:
                raise SystemExit(f"{key} is far larger than a Copernicus tile should be")
            etag = (reply.headers.get("ETag") or "").strip('"')
            data = reply.read(MAX_TILE_BYTES + 1)
        if len(data) > MAX_TILE_BYTES or (size and len(data) != size):
            raise OSError(f"{key} did not arrive whole")
        if etag and "-" not in etag and hashlib.md5(data, usedforsecurity=False).hexdigest() != etag:
            raise OSError(f"{key} did not match its checksum")
        with open(target + ".part", "wb") as out:
            out.write(data)
    say(f"downloading Copernicus heights: {os.path.basename(key)}")
    _retrying(attempt, key)
    os.replace(target + ".part", target)


def ensure(data_root: str, window: Window, say) -> None:
    folder = os.path.join(data_root, FOLDER)
    os.makedirs(folder, exist_ok=True)
    for tile in tiles(window):
        for key in _files(tile).values():
            target = os.path.join(folder, os.path.basename(key))
            if not os.path.exists(target):
                _fetch(key, target, say)


def _onto_posts(path: str, window: Window, resampling: Resampling) -> np.ndarray:
    out = np.full((window.side, window.side), np.nan, "float32")
    with rasterio.open(path) as tif:
        if tif.crs is None or tif.crs.to_epsg() != 4326:
            raise SystemExit(f"{os.path.basename(path)} is not in latitude and longitude")
        reproject(rasterio.band(tif, 1), out, dst_transform=from_origin(window.west - CELL / 2, window.top + CELL / 2, CELL, CELL), dst_crs=CRS,
                  dst_nodata=np.nan, resampling=resampling)
    return out


def heights(data_root: str, window: Window) -> tuple[np.ndarray, np.ndarray]:
    """Heights at the window's posts, NaN where no tile is on this machine, and where the water mask shows water."""
    ground = np.full((window.side, window.side), np.nan, "float32")
    water = np.zeros((window.side, window.side), bool)
    folder = os.path.join(data_root, FOLDER)
    for tile in tiles(window):
        dem, mask = (os.path.join(folder, os.path.basename(key)) for key in _files(tile).values())
        if not (os.path.exists(dem) and os.path.exists(mask)):
            continue
        part = _onto_posts(dem, window, Resampling.bilinear)
        wet = _onto_posts(mask, window, Resampling.nearest)
        fill = np.isnan(ground) & np.isfinite(part)
        ground[fill] = part[fill]
        water |= fill & (wet > 0)  # 1 ocean, 2 lake, 3 river
    return ground, water
