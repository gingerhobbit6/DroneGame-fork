"""LiDAR tile files someone sent, put in lidar_tiles: a hostile one is left out and said so, and the good tiles beside it are still used.

Apart from test_untrusted_input.py only to keep that file's length down."""

import io
import struct
import zipfile

import numpy as np
import pytest
import rasterio

from mapbuild import lidar_tiles, source_limits
from test_mapbuild import write_tile

SQUARE, OTHER = (9000, 20000), (10000, 20000)  # the good pair's square, and the one a hostile file claims
HOSTILE_ZIP = "LIDAR-DTM-1m-2022-SU1020.zip"
VRT = ('<VRTDataset rasterXSize="1000" rasterYSize="1000"><SRS>EPSG:27700</SRS><GeoTransform>10000, 1, 0, 21000, 0, -1</GeoTransform>'
       '<VRTRasterBand dataType="Float32" band="1"><SimpleSource><SourceFilename relativeToVRT="0">{}</SourceFilename>'
       "<SourceBand>1</SourceBand></SimpleSource></VRTRasterBand></VRTDataset>")


def good_pair(tmp_path):
    tiles = tmp_path / "lidar_tiles"
    tiles.mkdir()
    write_tile(tiles / "su0920_DTM_1m.tif", 9000, 21000, 1000, 5.0)
    write_tile(tiles / "su0920_DSM_1m.tif", 9000, 21000, 1000, 8.0)
    return tiles


def other_tile(tmp_path):
    """A sound tile for the other square, outside the tiles folder: what a hostile file would like read as its own."""
    write_tile(tmp_path / "other.tif", 10000, 21000, 1000, 5.0)
    return tmp_path / "other.tif"


def imported(tmp_path, tiles, left_out):
    """Runs the import. It must not raise, the good pair's square must be the only file it makes, and its note must count what was left out."""
    cache, said = tmp_path / "cache", []
    cache.mkdir()
    before = set(tmp_path.rglob("*"))
    kept = lidar_tiles.import_tiles(str(tiles), str(cache), {SQUARE, OTHER}, lambda *_a: {"ground": np.zeros(1, "float32")}, said.append)
    assert kept == 1 and set(tmp_path.rglob("*")) - before == {cache / "9000_20000.npz"}
    assert any(f"{left_out} file(s)" in s and "were left out" in s for s in said)
    assert any("1 new square(s) taken from 1 tile(s)" in s for s in said)  # nothing in a refused file counted as a tile


@pytest.mark.parametrize("name", ["../su1020_DSM_1m.tif", "/su1020_DSM_1m.tif", "tiles/../../su1020_DSM_1m.tif"])
def test_a_lidar_zip_with_a_member_named_to_land_outside_it_is_left_out_whole(tmp_path, name):
    tiles = good_pair(tmp_path)
    data = other_tile(tmp_path).read_bytes()
    with zipfile.ZipFile(tiles / HOSTILE_ZIP, "w") as archive:
        archive.writestr("su1020_DTM_1m.tif", data)  # a sound tile beside the unsafe one does not save the archive
        archive.writestr(name, data)
    imported(tmp_path, tiles, left_out=1)


def test_a_lidar_zip_with_more_members_than_the_limit_is_left_out(tmp_path, monkeypatch):
    tiles = good_pair(tmp_path)
    with zipfile.ZipFile(tiles / HOSTILE_ZIP, "w") as archive:
        archive.writestr("su1020_DTM_1m.tif", other_tile(tmp_path).read_bytes())
        archive.writestr("readme.txt", "one member too many")
    monkeypatch.setattr(source_limits, "MAX_ARCHIVE_ENTRIES", 1)
    imported(tmp_path, tiles, left_out=1)


def test_a_lidar_zip_that_says_it_unpacks_to_more_than_the_limit_is_left_out(tmp_path):
    tiles = good_pair(tmp_path)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for i in range(6):
            archive.writestr(f"su102{i}_DTM_1m.tif", b"x")
    data = bytearray(buffer.getvalue())
    at = data.find(b"PK\x01\x02")
    while at >= 0:  # each member's directory entry is made to say it unpacks to 4 GB, so 24 GB in all
        data[at + 24:at + 28] = struct.pack("<L", 0xFFFFFFFE)
        at = data.find(b"PK\x01\x02", at + 4)
    (tiles / HOSTILE_ZIP).write_bytes(data)
    imported(tmp_path, tiles, left_out=1)  # the one archive, not its six members


def test_lidar_files_named_tif_or_zip_that_are_neither_are_left_out(tmp_path):
    tiles = good_pair(tmp_path)
    (tiles / "su1020_DTM_1m.tif").write_bytes(b"not a raster")
    (tiles / "LIDAR-DSM-1m-2022-SU1020.zip").write_bytes(b"not an archive")
    with zipfile.ZipFile(tiles / "LIDAR-DSM-1m-2022-SU1120.zip", "w") as archive:
        archive.writestr("su1120_DSM_1m.tif", b"not a raster")
    imported(tmp_path, tiles, left_out=3)


def test_a_vrt_named_tif_cannot_bring_in_a_tile_from_outside_the_folder(tmp_path):
    tiles = good_pair(tmp_path)
    vrt = VRT.format(other_tile(tmp_path))
    (tiles / "su1020_DTM_1m.tif").write_text(vrt)
    with zipfile.ZipFile(tiles / "LIDAR-DSM-1m-2022-SU1020.zip", "w") as archive:
        archive.writestr("su1020_DSM_1m.tif", vrt)
    with rasterio.open(tiles / "su1020_DTM_1m.tif") as unguarded:  # left to choose its reader, GDAL would follow it to the tile outside
        assert unguarded.driver == "VRT" and unguarded.width == 1000
    imported(tmp_path, tiles, left_out=2)  # had either been followed, the other square would have been kept too


def test_a_lidar_zip_with_an_awkward_name_is_still_read(tmp_path):
    tiles = tmp_path / "lidar_tiles.zip"  # a folder, and a file in it, that both look like archives to GDAL
    tiles.mkdir()
    (tmp_path / "cache").mkdir()
    write_tile(tmp_path / "dtm.tif", 9000, 21000, 1000, 5.0)
    with zipfile.ZipFile(tiles / "LIDAR.zip.zip.zip-DTM {1m}.zip", "w") as archive:
        archive.write(tmp_path / "dtm.tif", "su0920_DTM_1m.tif")
    write_tile(tiles / "su0920_DSM_1m.tif", 9000, 21000, 1000, 8.0)
    said = []
    assert lidar_tiles.import_tiles(str(tiles), str(tmp_path / "cache"), {SQUARE}, lambda *_a: {"ground": np.zeros(1, "float32")}, said.append) == 1
    assert not any("left out" in s for s in said)
