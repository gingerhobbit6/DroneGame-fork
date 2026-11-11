"""Limits on what the builder reads and writes, so damaged downloads or a dense area cannot run it out of memory or make a pack the game refuses."""

import io
import tempfile
import urllib.error
import urllib.request
import zipfile

import numpy as np
import pytest
import rasterio
import shapely
from rasterio.transform import from_origin

from mapbuild import download, estonia, estonia_files, features, geonames, packfile, pictures, source_limits, terrain
from mapbuild.grid import Window
from mapbuild.source_limits import read_shapefile, safe_member


def test_an_oversized_zip_member_is_refused_before_it_is_unpacked(monkeypatch):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as made:
        made.writestr("small.asc", "x" * 100)
        made.writestr("large.asc", "x" * 5000)
    monkeypatch.setattr(terrain, "MAX_MEMBER", 1000)
    with zipfile.ZipFile(buffer) as archive:
        assert terrain._read(archive, "small.asc") == b"x" * 100
        with pytest.raises(SystemExit, match="oversized"):
            terrain._read(archive, "large.asc")


def test_a_pack_with_more_features_than_the_game_reads_is_not_written(tmp_path, monkeypatch):
    empty = np.zeros((3, 3), "uint8")
    grids = packfile.Grids(np.zeros((3, 3), "float32"), empty, empty, empty)
    monkeypatch.setattr(packfile, "MAX_FEATURES", 100)
    packfile.write_pack(str(tmp_path / "small.sgmap"), {}, grids, {"buildings": []}, [])
    with pytest.raises(ValueError, match="build a smaller pack"):
        packfile.write_pack(str(tmp_path / "large.sgmap"), {}, grids, {"buildings": [[0, 0, 1, 1, 8, 0]] * 20}, [])
    assert not (tmp_path / "large.sgmap").exists()


def test_estonian_download_without_a_length_stops_at_its_file_budget(tmp_path, monkeypatch):
    class Reply:
        status, headers = 200, {"Content-Type": "application/zip"}

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self, size):
            return b"x" * size

    monkeypatch.setitem(estonia_files.MAX_FILE_BYTES, estonia.BUILDINGS, 100)
    monkeypatch.setattr(estonia_files.urllib.request, "urlopen", lambda *_a, **_k: Reply())
    with pytest.raises(SystemExit, match="larger than expected"):
        estonia_files._fetch(estonia.BUILDINGS, str(tmp_path), lambda _: None)
    assert list(tmp_path.iterdir()) == []


def test_small_bad_height_scale_is_rejected_before_a_boundless_read(tmp_path):
    path = tmp_path / estonia.HEIGHTS
    with rasterio.open(path, "w", driver="GTiff", width=1, height=1, count=1, dtype="float32", crs="EPSG:3301",
                       transform=from_origin(611000, 6571000, 1, 1)) as tif:
        tif.write(np.zeros((1, 1), "float32"), 1)
    with pytest.raises(SystemExit, match="10 m grid"):
        estonia.ground_posts(str(tmp_path), Window(611000, 6570000, 1000))


def test_bad_surface_dimensions_are_rejected_before_decompression(tmp_path):
    sheet = tmp_path / "sheet.tif"
    with rasterio.open(sheet, "w", driver="GTiff", width=1, height=1, count=1, dtype="float32", crs="EPSG:3301",
                       transform=from_origin(611000, 6571000, 5, 5)) as tif:
        tif.write(np.zeros((1, 1), "float32"), 1)
    with zipfile.ZipFile(tmp_path / estonia.SURFACE, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(sheet, "570611_ndsm_5m.tif")
    with pytest.raises(SystemExit, match="5 m square"):
        estonia.surface_pixels(str(tmp_path), Window(611000, 6570000, 1000))


def test_geonames_limits_expanded_member_and_single_record(tmp_path, monkeypatch):
    path = tmp_path / "RU.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("RU.txt", "a" * 50)
    monkeypatch.setattr(geonames, "MAX_EXPANDED_BYTES", 20)
    with pytest.raises(SystemExit, match="expands"):
        list(geonames._rows(str(path)))
    monkeypatch.setattr(geonames, "MAX_EXPANDED_BYTES", 100)
    monkeypatch.setattr(geonames, "MAX_RECORD_BYTES", 10)
    with pytest.raises(SystemExit, match="record"):
        list(geonames._rows(str(path)))
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("RU.txt", "one\ttwo\n")
    assert list(geonames._rows(str(path))) == [["one", "two"]]


def test_a_disguised_shapefile_never_reaches_ogr(tmp_path, monkeypatch):
    path = tmp_path / "source.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("data.shp", '<OGRVRTDataSource><OGRVRTLayer name="x"/></OGRVRTDataSource>')
    monkeypatch.setattr("mapbuild.source_limits.ogr_read", lambda *_a, **_k: pytest.fail("untrusted descriptor reached GDAL"))
    with pytest.raises(SystemExit, match="not a Shapefile"):
        read_shapefile(str(path), "data.shp")


def test_shapefile_sidecars_and_archive_member_paths_are_checked_before_ogr(tmp_path, monkeypatch):
    path = tmp_path / "source.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("data.shp", b"\x00\x00\x27\x0a")
        archive.writestr("data.prj", b"x" * 20)
        archive.writestr("unrelated.bin", b"y" * 20)
    monkeypatch.setattr("mapbuild.source_limits.MAX_SHAPE_BUNDLE_BYTES", 10)
    monkeypatch.setattr("mapbuild.source_limits.ogr_read", lambda *_a, **_k: pytest.fail("untrusted sidecar reached GDAL"))
    with pytest.raises(SystemExit, match="oversized shapefile"):
        read_shapefile(str(path), "data.shp")
    monkeypatch.setattr("mapbuild.source_limits.MAX_SHAPE_BUNDLE_BYTES", 100)
    monkeypatch.setattr("mapbuild.source_limits.MAX_SHAPE_AUX_BYTES", 10)
    with pytest.raises(SystemExit, match="oversized shapefile sidecar"):
        read_shapefile(str(path), "data.shp")
    monkeypatch.setattr("mapbuild.source_limits.MAX_SHAPE_AUX_BYTES", 100)
    monkeypatch.setattr("mapbuild.source_limits.MAX_SHAPE_ARCHIVE_BYTES", 30)
    with pytest.raises(SystemExit, match="unsafe map archive"):
        read_shapefile(str(path), "data.shp")
    assert safe_member("safe/folder/") and not safe_member("../outside.tif") and not safe_member("safe/../outside.tif")


def test_a_vrt_descriptor_cannot_choose_a_raster_source():
    vrt = b'<VRTDataset rasterXSize="1000" rasterYSize="1000"><SRS>EPSG:27700</SRS><VRTRasterBand dataType="Float32" band="1"/></VRTDataset>'
    with pytest.raises(rasterio.errors.RasterioIOError):
        terrain.read_square(vrt, 1000, 1000)


def test_wcs_and_map_tile_responses_are_bounded_without_content_length(monkeypatch):
    class Reply:
        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

        def read(self, size):
            return b"x" * size

    monkeypatch.setattr(terrain.urllib.request, "urlopen", lambda *_a, **_k: Reply())
    monkeypatch.setattr(terrain, "MAX_WCS_BYTES", 16)
    with pytest.raises(SystemExit, match="lidar answer"):
        terrain.fetch_square(terrain.SERVICES["dtm"], 1000, 1000)
    monkeypatch.setattr(estonia.urllib.request, "urlopen", lambda *_a, **_k: Reply())
    monkeypatch.setattr(estonia, "MAX_TILE_BYTES", 16)
    with pytest.raises(SystemExit, match="basic map tile"):
        estonia._tile(1, 1)


def test_oversized_os_map_tiff_is_rejected_before_native_open(tmp_path, monkeypatch):
    folder = tmp_path / "vmd_su"
    folder.mkdir()
    with zipfile.ZipFile(folder / "map.zip", "w") as archive:
        archive.writestr("su26.tif", b"not a raster")
    monkeypatch.setattr(pictures, "MAX_OS_TIFF_BYTES", 1)
    monkeypatch.setattr(pictures.rasterio, "open", lambda *_a, **_k: pytest.fail("oversized tile reached GDAL"))
    with pytest.raises(SystemExit, match="oversized tile"):
        pictures.os_map(str(tmp_path), Window(422000, 166000, 1000), lambda _: None)


def test_an_ordinary_os_map_tiff_still_produces_a_picture(tmp_path):
    folder = tmp_path / "vmd_su"
    folder.mkdir()
    tif_path = tmp_path / "source.tif"
    with rasterio.open(tif_path, "w", driver="GTiff", width=200, height=200, count=1, dtype="uint8", crs="EPSG:27700",
                       transform=from_origin(420000, 170000, 50, 50)) as tif:
        tif.write(np.full((200, 200), 1, "uint8"), 1)
        tif.write_colormap(1, {0: (255, 255, 255, 255), 1: (100, 130, 160, 255)})
    with zipfile.ZipFile(folder / "map.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(tif_path, "su26.tif")
    found = pictures.os_map(str(tmp_path), Window(422000, 166000, 1000), lambda _: None)
    assert len(found) == 1 and found[0]["type"] == "image/png" and found[0]["width"] == 2000


def test_satellite_search_limits_response_bytes_and_item_count(monkeypatch):
    class Reply(io.BytesIO):
        pass

    monkeypatch.setattr(pictures, "MAX_SEARCH_BYTES", 16)
    monkeypatch.setattr(pictures.urllib.request, "urlopen", lambda *_a, **_k: Reply(b"x" * 100))
    window = Window(422000, 166000, 1000)
    with pytest.raises(SystemExit, match="scene search"):
        pictures.scenes_for(window, [2026])
    monkeypatch.setattr(pictures, "MAX_SEARCH_BYTES", 1000)
    body = b'{"features":[' + b",".join(b"{}" for _ in range(51)) + b"]}"
    monkeypatch.setattr(pictures.urllib.request, "urlopen", lambda *_a, **_k: Reply(body))
    with pytest.raises(SystemExit, match="too many entries"):
        pictures.scenes_for(window, [2026])


def test_a_far_power_line_is_refused_before_interpolation(monkeypatch):
    window = Window(1000, 2000, 100)
    far = shapely.LineString([(1000, 2000), (1e12, 2000)])
    monkeypatch.setattr(features.np, "arange", lambda *_a: pytest.fail("huge distance allocation started"))
    with pytest.raises(ValueError, match="power lines"):
        features.feature_lists(window, [], [far], [], {}, [], {}, np.zeros((window.side, window.side), "uint8"))


def test_power_geometry_is_bounded_before_buffering(monkeypatch):
    window = Window(1000, 2000, 100)
    far = shapely.LineString([(1000, 2000), (1e12, 2000)])
    monkeypatch.setattr(features.shapely, "buffer", lambda *_a: pytest.fail("untrusted line reached buffering"))
    with pytest.raises(ValueError, match="power lines"):
        features.cover_grid(window, [], [], [far], [], np.zeros((window.side, window.side), bool))


def test_road_vertices_are_bounded_before_simplification_and_list_conversion(monkeypatch):
    window = Window(1000, 2000, 100)
    road = shapely.LineString([(1000 + 20 * i, 2000 + (20 if i % 2 else 0)) for i in range(12)])
    empty = np.zeros((window.side, window.side), "uint8")
    monkeypatch.setattr(features, "MAX_ROAD_VERTICES", 10)
    with pytest.raises(ValueError, match="roads"):
        features.feature_lists(window, [], [], [road], {"CLASSIFICA": ["Local"]}, [], {}, empty)
    monkeypatch.setattr(features, "MAX_ROAD_VERTICES", 20)
    monkeypatch.setattr(features, "MAX_ROAD_POINTS", 10)
    assert features.feature_lists(window, [], [], [road], {"CLASSIFICA": ["Local"]}, [], {}, empty)["roads"] == []  # more points than the game draws


def test_a_city_keeps_the_roads_nearest_the_middle(monkeypatch):
    monkeypatch.setattr(features, "MAX_ROADS", 2)
    window = Window(1000, 2000, 100)
    roads = [shapely.LineString([(1000 + x, 2000), (1000 + x, 2010)]) for x in (60, -30, 10)]
    empty = np.zeros((window.side, window.side), "uint8")
    rows = features.feature_lists(window, [], [], roads, {"CLASSIFICA": ["A", "B", "C"]}, [], {}, empty)["roads"]
    assert [row[0] for row in rows] == ["B", "C"]  # the nearest two, in their original order


def test_a_large_compressed_raster_block_is_rejected_before_read(monkeypatch, tmp_path):
    folder = tmp_path / "vmd_su"
    folder.mkdir()
    tif_path = tmp_path / "source.tif"
    with rasterio.open(tif_path, "w", driver="GTiff", width=200, height=200, count=1, dtype="uint8", crs="EPSG:27700",
                       transform=from_origin(420000, 170000, 50, 50)) as tif:
        tif.write(np.ones((200, 200), "uint8"), 1)
    with zipfile.ZipFile(folder / "map.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(tif_path, "su26.tif")
    monkeypatch.setattr(source_limits, "MAX_DECODED_BLOCK_BYTES", 1)
    with pytest.raises(SystemExit, match="raster blocks"):
        pictures.os_map(str(tmp_path), Window(422000, 166000, 1000), lambda _: None)


def test_satellite_scene_retention_has_a_hard_limit(monkeypatch):
    items = [{"id": str(i), "assets": {"visual": {"href": pictures.SCENE_HOST + f"{i}.tif"}},
              "properties": {"datetime": "2026-05-01", "eo:cloud_cover": 1}} for i in range(100)]
    monkeypatch.setattr(pictures, "scenes_for", lambda *_a: items)
    opened = []

    class Source:
        count, dtypes, crs, width, height, block_shapes = 3, ("uint8",) * 3, "EPSG:27700", 4, 4, ((4, 4),) * 3

        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

    class Vrt(Source):
        def read(self, bands):
            assert bands == [1, 2, 3]
            data = np.zeros((3, 4, 4), "uint8")
            data[:, 0, :] = 100  # exactly 25 percent, leaving coverage incomplete
            return data

    monkeypatch.setattr(pictures.rasterio, "open", lambda *a, **k: opened.append(a[0]) or Source())
    monkeypatch.setattr(pictures, "WarpedVRT", lambda *_a, **_k: Vrt())
    found, year = pictures.satellite(Window(1000, 1000, 20), [2026], lambda _: None)
    assert len(opened) == pictures.MAX_SCENES == 5
    assert len(found) == 1 and year == 2026
    opened.clear()

    class EmptyVrt(Vrt):
        def read(self, bands):
            return np.zeros((3, 4, 4), "uint8")

    monkeypatch.setattr(pictures, "WarpedVRT", lambda *_a, **_k: EmptyVrt())
    found, year = pictures.satellite(Window(1000, 1000, 20), [2026], lambda _: None)
    assert len(opened) == pictures.MAX_SCENE_ATTEMPTS == 20
    assert found == [] and year is None


def test_a_network_fault_leaves_out_the_satellite_picture_rather_than_stopping_the_build(monkeypatch):
    window, said = Window(1000, 1000, 20), []

    def no_network(*_a, **_k):
        raise urllib.error.URLError("no route to host")

    monkeypatch.setattr(pictures.urllib.request, "urlopen", no_network)
    assert pictures.satellite(window, [2026], said.append) == ([], None)
    item = {"id": "1", "assets": {"visual": {"href": pictures.SCENE_HOST + "1.tif"}}, "properties": {"datetime": "2026-05-01", "eo:cloud_cover": 1}}
    monkeypatch.setattr(pictures, "scenes_for", lambda *_a: [item])
    monkeypatch.setattr(pictures.rasterio, "open", lambda *_a, **_k: (_ for _ in ()).throw(rasterio.errors.RasterioIOError("HTTP response code: 503")))
    assert pictures.satellite(window, [2026], said.append) == ([], None)
    assert len(said) == 2 and all("no satellite layer" in text for text in said)


def test_a_redirect_may_change_host_but_not_leave_https():
    handler, request = source_limits.HttpsRedirects(), urllib.request.Request("https://api.os.uk/file")
    with pytest.raises(urllib.error.HTTPError, match="leaves https"):
        handler.redirect_request(request, None, 302, "Found", {}, "http://127.0.0.1/x")
    assert handler.redirect_request(request, None, 302, "Found", {}, "https://files.example/x").full_url == "https://files.example/x"


def test_pack_write_is_atomic_and_matches_picture_budget(tmp_path, monkeypatch):
    empty = np.zeros((3, 3), "uint8")
    grids = packfile.Grids(np.zeros((3, 3), "float32"), empty, empty, empty)
    path = tmp_path / "pack.sgmap"
    path.write_bytes(b"known good pack")
    collision = tmp_path / "pack.sgmap.part"
    collision.write_bytes(b"another build")
    monkeypatch.setattr(packfile.os, "replace", lambda *_a: (_ for _ in ()).throw(OSError("simulated replacement failure")))
    with pytest.raises(OSError, match="simulated"):
        packfile.write_pack(str(path), {}, grids, {}, [])
    assert path.read_bytes() == b"known good pack" and collision.read_bytes() == b"another build"
    assert list(tmp_path.glob(".pack.sgmap.*.part")) == []
    monkeypatch.setattr(packfile, "MAX_PICTURE_BYTES", 1)
    with pytest.raises(ValueError, match="pictures"):
        packfile.write_pack(str(path), {}, grids, {}, [{"data": b"ab"}])


def test_a_killed_builds_leftover_is_removed_by_the_next_write_of_that_pack(tmp_path):
    empty = np.zeros((3, 3), "uint8")
    grids = packfile.Grids(np.zeros((3, 3), "float32"), empty, empty, empty)
    with tempfile.NamedTemporaryFile(dir=tmp_path, prefix=".pack.sgmap.", suffix=".part", delete=False) as stale:  # named as write_pack names its own
        stale.write(b"left by a build killed at its limit")
    others = [tmp_path / ".other.sgmap.abcd1234.part", tmp_path / ".pack.sgmap.notes.part", tmp_path / "pack.sgmap.part", tmp_path / "notes.txt"]
    for other in others:
        other.write_bytes(b"not this pack's leftover")
    packfile.write_pack(str(tmp_path / "pack.sgmap"), {}, grids, {}, [])
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(["pack.sgmap", *(other.name for other in others)])


def test_downloads_stop_before_the_free_disk_reserve(tmp_path, monkeypatch):
    from hashlib import md5

    class Reply(io.BytesIO):
        status = 200
        headers = {"Content-Type": "application/zip"}

    monkeypatch.setattr(source_limits.shutil, "disk_usage", lambda *_a: type("Space", (), {"free": source_limits.MIN_FREE_BYTES})())
    monkeypatch.setattr(estonia_files.urllib.request, "urlopen", lambda *_a, **_k: Reply(b"small"))
    with pytest.raises(SystemExit, match="free space"):
        estonia_files._fetch(estonia.BUILDINGS, str(tmp_path), lambda _: None)
    assert not list(tmp_path.iterdir())
    item = {"fileName": "map.zip", "url": "https://api.os.uk/map.zip", "size": 5, "md5": md5(b"small", usedforsecurity=False).hexdigest()}
    monkeypatch.setattr(download.urllib.request, "urlopen", lambda *_a, **_k: Reply(b"small"))
    with pytest.raises(SystemExit, match="free space"):
        download._fetch(item, str(tmp_path), lambda _: None)
    assert not list(tmp_path.iterdir())
