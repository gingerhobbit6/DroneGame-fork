"""Small limits at the boundaries where downloaded map data enters native readers."""

import posixpath
import shutil
import zipfile

import numpy as np

from pyogrio.raw import read as ogr_read

MAX_SHAPE_BYTES = 768_000_000  # ETAK building/road .dbf and woodland .shp members each exceed 500 MB
MAX_SHAPE_FEATURES = 500_000
MAX_SHAPE_BUNDLE_BYTES = 1_250_000_000  # the largest observed ETAK layer is about 868 MB expanded
MAX_SHAPE_ARCHIVE_BYTES = 3_000_000_000  # kolvikud has about 2.18 GB across its national layers
MAX_SHAPE_AUX_BYTES = 32_000_000
MAX_SHAPE_AUX_TOTAL = 64_000_000  # observed .prj/.cpg/.qix and other sidecars total under 14 MB per archive
MAX_ARCHIVE_ENTRIES = 100_000
MAX_ARCHIVE_EXPANDED_BYTES = 20_000_000_000
MAX_DECODED_BLOCK_BYTES = 64 * 1024 * 1024
MIN_FREE_BYTES = 8_000_000_000
SHAPE_MAGIC = b"\x00\x00\x27\x0a"


def read_capped(reply, limit: int, description: str) -> bytes:
    """Read at most one byte past the limit, even when Content-Length is absent."""
    data = reply.read(limit + 1)
    if len(data) > limit:
        raise SystemExit(f"{description} is larger than expected")
    return data


def enough_disk_room(folder: str, next_bytes: int) -> bool:
    return shutil.disk_usage(folder).free - next_bytes >= MIN_FREE_BYTES


def check_raster_blocks(tif) -> None:
    """A tiny read window must not decompress a huge source strip or tile."""
    total = sum(rows * cols * np.dtype(dtype).itemsize for (rows, cols), dtype in zip(tif.block_shapes, tif.dtypes))
    if total <= 0 or total > MAX_DECODED_BLOCK_BYTES:
        raise SystemExit("raster blocks are larger than the builder can decode safely")


def safe_member(member: str) -> bool:
    name = member[:-1] if member.endswith("/") else member  # ordinary ZIP directory entries have one trailing slash
    return (bool(name) and not name.startswith("/") and "\\" not in name
            and posixpath.normpath(name) == name and ".." not in name.split("/"))


def safe_archive_members(archive: zipfile.ZipFile, max_expanded_bytes: int = MAX_ARCHIVE_EXPANDED_BYTES) -> list[zipfile.ZipInfo]:
    members = archive.infolist()
    names = {member.filename.casefold() for member in members}
    if (len(members) > MAX_ARCHIVE_ENTRIES or len(names) != len(members)
            or sum(member.file_size for member in members) > max_expanded_bytes
            or any(not safe_member(member.filename) for member in members)):
        raise SystemExit("refusing an unsafe map archive")
    return members


def read_shapefile(archive_path: str, member: str, **options):
    """Only hand a bounded, actual Shapefile member to GDAL's format detector.

    pyogrio has no allowed-driver argument. Checking the member before its native
    open prevents an XML VRT or another datasource renamed to .shp from choosing
    further filesystem or network references.
    """
    if not member.lower().endswith(".shp") or not safe_member(member):
        raise SystemExit("refusing an unsafe shapefile member")
    with zipfile.ZipFile(archive_path) as archive:
        members = safe_archive_members(archive, MAX_SHAPE_ARCHIVE_BYTES)
        info = archive.getinfo(member)
        stem = member[:-4].lower()
        companions = [entry for entry in members if entry.filename.lower().startswith(stem + ".")]
        auxiliary = [entry for entry in companions if not entry.filename.lower().endswith((".shp", ".shx", ".dbf"))]
        if (info.file_size > MAX_SHAPE_BYTES or any(entry.file_size > MAX_SHAPE_BYTES for entry in companions)
                or sum(entry.file_size for entry in companions) > MAX_SHAPE_BUNDLE_BYTES):
            raise SystemExit("refusing an oversized shapefile member")
        if any(entry.file_size > MAX_SHAPE_AUX_BYTES for entry in auxiliary) or sum(entry.file_size for entry in auxiliary) > MAX_SHAPE_AUX_TOTAL:
            raise SystemExit("refusing an oversized shapefile sidecar")
        with archive.open(info) as source:
            if source.read(4) != SHAPE_MAGIC:
                raise SystemExit("refusing a file that is not a Shapefile")
    result = ogr_read(f"/vsizip/{{{archive_path}}}/{member}", max_features=MAX_SHAPE_FEATURES + 1, **options)
    if len(result[2]) > MAX_SHAPE_FEATURES:
        raise SystemExit("refusing an oversized shapefile layer")
    return result
