"""The parts of the builder that can be wrong without any network or OS data."""

import gzip
import json
import struct

import numpy as np
import pytest
import shapely

from mapbuild import download, estonia, estonia_files, features, fit, packfile, pictures, terrain
from mapbuild.grid import Window, parse_grid_ref, square_letters


@pytest.mark.parametrize("text,expected", [
    ("SU 22 66", (422000, 166000)),
    ("su2266", (422000, 166000)),
    ("NN 166 712", (216600, 771200)),  # Ben Nevis
    ("TQ 30000 80000", (530000, 180000)),
    ("TF", (500000, 300000)),
    ("HP 61 16", (461000, 1216000)),  # Shetland
    ("SV 90 10", (90000, 10000)),  # Scilly
])
def test_grid_references(text, expected):
    assert parse_grid_ref(text) == expected


@pytest.mark.parametrize("text", ["", "S1 22 66", "SU 2 66", "SU 223", "SI 22 66", "AA 10 10", "SU 123456 123456"])
def test_bad_grid_references_are_refused(text):
    with pytest.raises(ValueError):
        parse_grid_ref(text)


@pytest.mark.parametrize("east,north,letters", [(422000, 166000, "SU"), (567000, 340000, "TF"), (216600, 771200, "NN"), (461000, 1216000, "HP"), (90000, 10000, "SV")])
def test_square_letters(east, north, letters):
    assert square_letters(east, north) == letters


def test_a_window_knows_its_squares():
    assert Window(422000, 166000, 15000).squares() == ["SU"]
    assert Window(499000, 166000, 15000).squares() == ["SU", "TQ"]
    assert Window(422000, 166000, 15000).side == 1501


def test_ascii_grid_parsing():
    head, values = terrain.parse_asc("ncols 2\nnrows 2\nxllcorner 100\nyllcorner 200\ncellsize 50\n1.5 2\n3 4\n")
    assert head["xllcorner"] == 100
    assert values.tolist() == [[1.5, 2], [3, 4]]


def square_values(value):
    return np.full((terrain.SQUARE_M, terrain.SQUARE_M), value, "float32")


def test_reducing_a_square_uses_the_90th_percentile_and_keeps_gaps_as_nan():
    dtm, dsm = square_values(100), square_values(100)
    dsm[0:20, 0:400] = 118  # a wood along the north edge
    dtm[500:520, 500:520] = np.nan
    houses = np.zeros((terrain.SQUARE_M, terrain.SQUARE_M), bool)
    houses[300:320, 300:320] = True
    dsm[300:320, 300:320] = 108
    out = terrain.reduce_square(dtm, dsm, houses)
    assert out["ground"].shape == (51, 51)
    assert out["ground"][1, 1] == 100
    assert out["tall"][0, 5] == pytest.approx(18)
    assert out["tall"][40, 40] == 0
    assert np.isnan(out["ground"][25 + 1 - 1, 25]) or np.isfinite(out["ground"][25, 25])
    assert out["houses"][15, 15] == pytest.approx(8)
    assert np.isnan(out["houses"][40, 40])


def test_combining_lidar_any_tall_cover_is_trees_and_terrain_50_fills_the_rest():
    window = Window(0, 0, 40)  # 5 x 5 posts
    t50 = np.full((5, 5), 50.04, "float32")
    cover = np.zeros((5, 5), "uint8")
    cover[0, 0] = 1  # OS woodland, outside the lidar: keeps its assumed height
    cover[1, 1] = 1  # OS woodland, lidar says nothing is there
    cover[3, 3] = 4
    lidar = {k: np.full((5, 5), np.nan, "float32") for k in ("ground", "tall", "houses")}
    lidar["ground"][1:, 1:] = 60.06
    lidar["tall"][1:, 1:] = 0
    lidar["tall"][2, 2] = 12.4  # a hedge outside any OS woodland
    lidar["tall"][3, 3] = 30  # a ship, or anything else on water
    lidar["tall"][2, 3] = 9
    lidar["houses"][2, 3] = 9
    ground, canopy, bldg, final = terrain.combine(window, t50, lidar, cover, cover == 1, cover == 2)
    assert ground[0, 0] == pytest.approx(50.0)
    assert ground[1, 1] == pytest.approx(60.1)
    assert canopy[0, 0] == 16 and final[0, 0] == 1
    assert canopy[1, 1] == 0 and final[1, 1] == 0
    assert canopy[2, 2] == 12 and final[2, 2] == 1
    assert canopy[3, 3] == 0 and final[3, 3] == 4
    assert bldg[2, 3] == 9 and canopy[2, 3] == 0 and final[2, 3] == 2


def test_a_corrupt_grid_cannot_be_written(tmp_path):
    ground = np.zeros((3, 3), "float32")
    ground[1, 1] = np.nan
    empty = np.zeros((3, 3), "uint8")
    with pytest.raises(ValueError, match="finite"):
        packfile.write_pack(str(tmp_path / "x.sgmap"), {}, packfile.Grids(ground, empty, empty, empty), {}, [])
    with pytest.raises(ValueError, match="square"):
        packfile.check(packfile.Grids(np.zeros((2, 2), "float32"), np.zeros((2, 2), "uint8"), np.zeros((2, 2), "uint8"), np.zeros((2, 2), "uint8")))


def test_pack_file_layout_and_hash(tmp_path):
    ground = np.arange(9, dtype="float32").reshape(3, 3)
    empty = np.zeros((3, 3), "uint8")
    grids = packfile.Grids(ground, empty, empty, empty)
    path = tmp_path / "x.sgmap"
    written = packfile.write_pack(str(path), {"name": "Test"}, grids, {"roads": []}, [{"layer": "osmap", "west": 1, "top": 2, "width": 3, "height": 4, "type": "image/png", "data": b"PICTURE"}])
    data = path.read_bytes()
    assert data[:5] == b"SGMAP" and data[5] == packfile.VERSION
    length = struct.unpack("<I", data[6:10])[0]
    header = json.loads(data[10:10 + length])
    assert header == written and header["gridsSha256"] == packfile.grids_hash(grids)
    body = data[10 + length:]
    sections = {s["name"]: s for s in header["sections"]}
    read = lambda s: body[s["offset"]:s["offset"] + s["length"]]
    assert gzip.decompress(read(sections["ground"])) == ground.astype("<f4").tobytes()
    assert json.loads(gzip.decompress(read(sections["features"]))) == {"roads": []}
    assert read(sections["picture0"]) == b"PICTURE" and sections["picture0"]["layer"] == "osmap"


def test_changing_a_picture_does_not_change_the_hash(tmp_path):
    empty = np.zeros((3, 3), "uint8")
    grids = packfile.Grids(np.zeros((3, 3), "float32"), empty, empty, empty)
    a = packfile.write_pack(str(tmp_path / "a.sgmap"), {}, grids, {}, [{"layer": "osmap", "data": b"A"}])
    b = packfile.write_pack(str(tmp_path / "b.sgmap"), {}, grids, {"roads": [1]}, [{"layer": "osmap", "data": b"B"}])
    assert a["gridsSha256"] == b["gridsSha256"]


def test_open_sea_with_no_terrain_tile_counts_as_water():
    window = Window(1000, 1000, 40)
    no_tile = np.zeros((5, 5), bool)
    no_tile[0] = True
    empty = np.array([], dtype=object)
    cover = features.cover_grid(window, empty, empty, empty, empty, no_tile)
    assert cover[0].tolist() == [4] * 5 and cover[1].sum() == 0


def test_cover_priorities():
    window = Window(1000, 1000, 100)
    area = shapely.box(900, 900, 1100, 1100)
    small = shapely.box(960, 960, 1040, 1040)
    corner = shapely.box(900, 1040, 960, 1100)
    empty = np.array([], dtype=object)
    cover = features.cover_grid(window, np.array([area]), np.array([small]), empty, np.array([corner]), np.zeros((window.side, window.side), bool))
    middle = window.side // 2
    assert cover[middle, middle] == 2  # built over woodland
    assert cover[1, 1] == 4  # water over woodland
    assert cover[window.side - 2, window.side - 2] == 1


def test_feature_lists_use_scene_axes():
    window = Window(1000, 2000, 100)
    house = shapely.box(1000, 2040, 1020, 2050)  # 40 to 50 m north of the middle
    line = shapely.LineString([(1000, 2000), (1000, 2600)])
    road = shapely.LineString([(990, 2000), (1010, 2000)])
    name = shapely.Point(1010, 1990)
    bldg = np.zeros((window.side, window.side), "uint8")
    bldg[3, 5] = 11
    lists = features.feature_lists(window, np.array([house]), np.array([line]), np.array([road]), {"CLASSIFICA": np.array(["A Road"])}, np.array([name]), {"DISTNAME": np.array(["Town"]), "CLASSIFICA": np.array(["Populated Place"]), "FONTHEIGHT": np.array(["Large"])}, bldg)
    x, z, w, d, h, _ = lists["buildings"][0]
    assert (x, z) == (10.0, -45.0)
    assert sorted((w, d)) == [10.0, 20.0]
    assert h == 8  # no lidar height at this cell, so the assumed one
    assert lists["lines"][0][0] == [0.0, 0.0] and lists["lines"][0][1] == [0.0, -260.0] and len(lists["lines"][0]) == 3
    assert lists["roads"][0][0] == "A Road" and lists["roads"][0][1][0] == [-10.0, 0.0]
    assert lists["names"][0] == ["Town", "Populated Place", "Large", 10.0, 10.0]


def test_a_city_keeps_the_buildings_nearest_the_middle(monkeypatch):
    monkeypatch.setattr(features, "MAX_BUILDINGS", 2)
    window = Window(1000, 2000, 100)
    houses = np.array([shapely.box(1000 + x, 2000, 1005 + x, 2005) for x in (60, -30, 10)])
    bldg = np.zeros((window.side, window.side), "uint8")
    empty = {"CLASSIFICA": np.array([])}
    lists = features.feature_lists(window, houses, np.array([]), np.array([]), empty, np.array([]), {"DISTNAME": [], "CLASSIFICA": [], "FONTHEIGHT": []}, bldg)
    assert [row[0] for row in lists["buildings"]] == [12.5, -27.5]


def test_the_fit_is_accurate_on_a_smooth_surface():
    window = Window(400000, 200000, 15000)
    grid = np.linspace(-15000, 15000, 21)
    east, north = np.meshgrid(window.east + grid, window.north + grid)
    east, north = east.ravel(), north.ravel()
    x, y = (east - window.east) / 10000, (north - window.north) / 10000
    lon, lat = -2 + 0.14 * x + 0.001 * y * y, 51 + 0.09 * y - 0.0005 * x * x
    lon_fit, lat_fit, error = fit.fit_to_coefficients(east, north, lon, lat, window)
    assert error < 0.01
    assert lon_fit[0] == pytest.approx(-2) and lat_fit[2] == pytest.approx(0.09)


def test_the_composite_ignores_missing_data_and_outliers():
    a, b, c = (np.full((3, 1, 2), v, "uint8") for v in (100, 110, 255))  # 255 is a cloud in one scene
    b[:, 0, 0] = 0  # a scene that does not reach this pixel
    picture = pictures.composite([a, b, c])
    assert picture[0, 0, 1] == 110
    assert picture[0, 0, 0] == 177  # the median of 100 and 255: two scenes alone cannot rule a cloud out


def test_the_composite_taken_in_strips_matches_the_whole_picture():
    rng = np.random.default_rng(1)
    layers = [rng.integers(0, 256, (3, 23, 9), dtype="uint8") for _ in range(5)]
    for layer in layers:
        layer[:, rng.random((23, 9)) < 0.3] = 0  # pixels this scene does not reach
        layer[:, 0, 0] = 0  # and one no scene reaches
    cube = np.stack(layers).astype("float32")
    cube[cube == 0] = np.nan
    with pytest.warns(RuntimeWarning):
        whole = np.nan_to_num(np.nanmedian(cube, axis=0), nan=0).clip(0, 255).astype("uint8")
    picture = pictures.composite(layers, rows=5)  # 23 rows: four strips of 5 and one of 3
    assert picture.dtype == np.uint8 and np.array_equal(picture, whole)


def test_estonian_cells_average_the_ground_and_ignore_gaps():
    fine = np.array([[1, 3, 10, 10], [1, 3, 10, 10], [np.nan, np.nan, 2, np.nan], [np.nan, np.nan, np.nan, np.nan]], "float32")
    means = estonia.cell_mean(fine, 2)
    assert means[0, 0] == 2 and means[0, 1] == 10 and means[1, 1] == 2 and np.isnan(means[1, 0])


def test_estonian_cells_take_the_90th_percentile_and_can_ask_for_enough_pixels():
    fine = np.zeros((8, 8), "float32")
    fine[0:4, 0:4] = np.arange(16).reshape(4, 4)
    fine[4:8, :] = np.nan
    fine[4, 4] = 7
    high = estonia.cell_high(fine, 4)
    assert high[0, 0] == 14  # the 90th percentile of 0 to 15, so the single tallest pixel does not count
    assert np.isnan(high[1, 0]) and high[1, 1] == 7
    assert np.isnan(estonia.cell_high(fine, 4, minimum=2)[1, 1])  # one pixel is not enough to call a cell a building


def test_estonian_cells_reduced_in_bands_match_the_whole_window():
    rng = np.random.default_rng(1)
    fine = rng.uniform(0, 30, (28, 28)).astype("float32")  # 7 cells of 4 a side, so the last band of 2 cells is short
    fine[rng.random(fine.shape) < 0.3] = np.nan
    fine[0:4, 0:4] = np.nan  # a cell with no data at all
    parts = estonia.bands(len(fine), 4, band_cells=2)
    assert len(parts) == 4
    for reduce in (estonia.cell_mean, estonia.cell_high, lambda f, n: estonia.cell_high(f, n, 5)):
        whole, banded = reduce(fine, 4), np.concatenate([reduce(fine[b], 4) for b in parts])
        assert banded.dtype == np.float32 and np.array_equal(banded, whole, equal_nan=True)


def test_estonian_road_types_become_the_games_classes_and_multilines_split():
    lines = np.array([shapely.LineString([(0, 0), (1, 1)]), shapely.MultiLineString([[(0, 0), (1, 0)], [(2, 0), (3, 0)]]), shapely.LineString([(0, 0), (0, 1)])], dtype=object)
    parts, fields = estonia.road_rows(lines, np.array([10, 50, 999]))
    assert [p.geom_type for p in parts] == ["LineString"] * 3
    assert list(fields["CLASSIFICA"]) == ["Primary", "Local", "Local"]  # the unknown type is left out


def test_the_estonian_tile_grid_covers_the_window_exactly():
    columns, rows = estonia.tile_numbers(Window(611000, 6570000, 15000))
    x0, y0 = estonia.TILE_ORIGIN
    assert x0 + columns[0] * estonia.TILE_M <= 596000 and x0 + (columns[-1] + 1) * estonia.TILE_M >= 626000
    assert y0 + (rows[0] + 1) * estonia.TILE_M >= 6585000 and y0 + rows[-1] * estonia.TILE_M <= 6555000
    assert list(rows) == sorted(rows, reverse=True)  # north first, as a picture runs


def test_the_estonian_base_map_is_cut_into_pieces_placed_on_the_grid():
    def tile(x, y):
        return None if x % 2 else np.full((3, 256, 256), 100, "uint8")
    pieces = estonia.base_map(Window(611000, 6570000, 8000), lambda _: None, tile=tile, pause=0)
    columns, rows = estonia.tile_numbers(Window(611000, 6570000, 8000))
    x0, y0 = estonia.TILE_ORIGIN
    assert pieces[0]["west"] == x0 + columns[0] * estonia.TILE_M and pieces[0]["top"] == y0 + (rows[0] + 1) * estonia.TILE_M
    assert pieces[0]["type"] == "image/jpeg" and pieces[0]["layer"] == "osmap" and pieces[0]["data"][:2] == b"\xff\xd8"
    assert sum(p["width"] * p["height"] for p in pieces) == len(columns) * len(rows) * estonia.TILE_M ** 2


def test_estonian_credits_name_the_owner_and_carry_the_licence():
    found = estonia.credits(30, 2026)
    assert "Land and Spatial Development Board" in found["osmap"] and estonia.LICENCE in found["osmap"] and "settlement units" in found["osmap"]
    assert "2020-2023" in found["lidar"] and "2020-2023" not in estonia.credits(0, 2026)["lidar"]


def test_no_estonian_download_is_trusted_if_it_is_a_web_page(tmp_path, monkeypatch):
    class Reply:
        status, headers = 200, {"Content-Type": "text/html", "Content-Length": "5"}

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    monkeypatch.setattr(estonia_files.urllib.request, "urlopen", lambda *a, **k: Reply())
    with pytest.raises(SystemExit, match="web page"):
        estonia_files._fetch(estonia.BUILDINGS, str(tmp_path), lambda _: None)
    assert not (tmp_path / estonia.BUILDINGS).exists()


def test_an_estonian_download_resumes_and_a_finished_file_is_kept(tmp_path, monkeypatch):
    import io
    import zipfile
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr("a.txt", "hello")
    whole = buffer.getvalue()
    (tmp_path / f"{estonia.BUILDINGS}.part").write_bytes(whole[:10])
    asked = []

    class Reply(io.BytesIO):
        status = 206
        headers = {"Content-Type": "application/zip", "Content-Length": str(len(whole) - 10)}

    def opened(request, timeout):
        asked.append(request.get_header("Range"))
        return Reply(whole[10:])

    monkeypatch.setattr(estonia_files.urllib.request, "urlopen", opened)
    estonia_files._fetch(estonia.BUILDINGS, str(tmp_path), lambda _: None)
    assert asked == ["bytes=10-"] and (tmp_path / estonia.BUILDINGS).read_bytes() == whole
    estonia_files._fetch(estonia.BUILDINGS, str(tmp_path), lambda _: None)  # already there, so nothing is asked for
    assert len(asked) == 1


def test_lidar_is_only_fetched_for_estonia_when_asked(tmp_path, monkeypatch):
    got = []
    monkeypatch.setattr(estonia_files, "_fetch", lambda name, folder, say: got.append(name))
    estonia_files.ensure(str(tmp_path), False, lambda _: None)
    assert estonia.SURFACE not in got and estonia.HEIGHTS in got and estonia.PLACES in got
    estonia_files.ensure(str(tmp_path), True, lambda _: None)
    assert estonia.SURFACE in got


def _a_zip() -> bytes:
    import io
    import zipfile
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr("a.txt", "hello")
    return buffer.getvalue()


def test_a_complete_part_file_is_finished_rather_than_asked_for_forever(tmp_path, monkeypatch):
    (tmp_path / f"{estonia.BUILDINGS}.part").write_bytes(_a_zip())

    def opened(request, timeout):
        raise estonia_files.urllib.error.HTTPError(request.full_url, 416, "Range Not Satisfiable", {}, None)

    monkeypatch.setattr(estonia_files.urllib.request, "urlopen", opened)
    estonia_files._fetch(estonia.BUILDINGS, str(tmp_path), lambda _: None)
    assert (tmp_path / estonia.BUILDINGS).read_bytes() == _a_zip()


def test_a_download_with_no_stated_length_still_works_and_a_damaged_one_is_thrown_away(tmp_path, monkeypatch):
    import io
    whole = _a_zip()

    class Reply(io.BytesIO):
        status = 200
        headers = {"Content-Type": "application/zip"}

    monkeypatch.setattr(estonia_files.urllib.request, "urlopen", lambda request, timeout: Reply(whole))
    estonia_files._fetch(estonia.BUILDINGS, str(tmp_path), lambda _: None)
    assert (tmp_path / estonia.BUILDINGS).read_bytes() == whole
    monkeypatch.setattr(estonia_files.urllib.request, "urlopen", lambda request, timeout: Reply(b"not a zip"))
    with pytest.raises(SystemExit, match="did not download correctly"):
        estonia_files._fetch(estonia.LAND, str(tmp_path), lambda _: None)
    assert not list(tmp_path.glob(f"{estonia.LAND}*"))


def test_a_download_longer_than_promised_is_refused(tmp_path, monkeypatch):
    import io

    class Reply(io.BytesIO):
        status = 200
        headers = {"Content-Type": "application/zip", "Content-Length": "4"}

    monkeypatch.setattr(estonia_files.urllib.request, "urlopen", lambda request, timeout: Reply(b"x" * 100))
    with pytest.raises(SystemExit, match="longer than"):
        estonia_files._fetch(estonia.BUILDINGS, str(tmp_path), lambda _: None)
    assert not list(tmp_path.iterdir())


def test_estonian_maps_ask_for_room_first(tmp_path, monkeypatch):
    monkeypatch.setattr(estonia_files.shutil, "disk_usage", lambda _: type("U", (), {"free": 1})())
    with pytest.raises(SystemExit, match="GB free"):
        estonia_files.ensure(str(tmp_path), True, lambda _: None)


def _estonian_tif(path, west, top, cell, values):
    """A small GeoTIFF on the Estonian grid, as the agency's files are."""
    import rasterio
    from rasterio.transform import from_origin
    with rasterio.open(path, "w", driver="GTiff", width=values.shape[1], height=values.shape[0], count=1, dtype="float32", crs="EPSG:3301", transform=from_origin(west, top, cell, cell)) as tif:
        tif.write(values.astype("float32"), 1)


def test_estonian_lidar_sheets_land_where_their_names_say(tmp_path):
    import zipfile
    sheet = tmp_path / "sheet.tif"
    with zipfile.ZipFile(tmp_path / estonia.SURFACE, "w", zipfile.ZIP_DEFLATED) as z:
        _estonian_tif(sheet, 611000, 6571000, 5, np.full((200, 200), 12))  # the square km from E 611, N 6570
        z.write(sheet, "570611_ndsm_5m.tif")
        _estonian_tif(sheet, 610000, 6571000, 5, np.full((200, 200), 3))  # the one to its west
        z.write(sheet, "570610_ndsm_5m.tif")
    window = Window(611000, 6570000, 1000)
    fine = estonia.surface_pixels(str(tmp_path), window)
    assert fine.shape == (window.side * 4, window.side * 4)
    row, col = 10 // 5 + 1000 // 5 - 1, 10 // 5 + 1000 // 5  # the pixel just north east of the window's middle
    assert fine[row, col] == 12 and fine[row, col - 1] == 3
    assert np.isnan(fine[0, 0]) and np.isnan(fine[-1, -1])  # no sheet north or south of that row of squares


def test_an_oversized_estonian_lidar_sheet_is_refused(tmp_path, monkeypatch):
    import zipfile
    with zipfile.ZipFile(tmp_path / estonia.SURFACE, "w") as z:
        z.writestr("570611_ndsm_5m.tif", b"x" * 100)
    monkeypatch.setattr(estonia, "MAX_SHEET_BYTES", 10)
    with pytest.raises(SystemExit, match="far larger"):
        estonia.surface_pixels(str(tmp_path), Window(611000, 6570000, 1000))


def test_estonian_ground_is_averaged_into_posts_and_stops_where_the_data_stops(tmp_path):
    values = np.full((202, 202), 40.0)
    values[:, 101:] = 50.0
    _estonian_tif(tmp_path / estonia.HEIGHTS, 609990, 6571010, 10, values)  # reaches 10 m past the window, as the edge posts need
    window = Window(611000, 6570000, 1000)
    ground = estonia.ground_posts(str(tmp_path), window)
    assert ground.shape == (window.side, window.side)
    assert ground[50, 0] == 40 and ground[50, -1] == 50 and ground[50, 50] == 45  # the middle post's cell straddles the step
    _estonian_tif(tmp_path / estonia.HEIGHTS, 609990, 6571010, 10, values[:, :101])  # the data stops halfway, like a border
    ground = estonia.ground_posts(str(tmp_path), window)
    assert ground[50, 0] == 40 and np.isnan(ground[50, -1])


def test_estonian_ground_must_sit_on_the_expected_grid(tmp_path):
    _estonian_tif(tmp_path / estonia.HEIGHTS, 609993, 6571010, 10, np.zeros((10, 10)))
    with pytest.raises(SystemExit, match="10 m grid"):
        estonia.ground_posts(str(tmp_path), Window(611000, 6570000, 1000))


def test_a_zip_only_gdal_can_read_is_checked_by_reading_sheets(tmp_path, monkeypatch):
    import zipfile
    path = tmp_path / "a.zip"
    with zipfile.ZipFile(path, "w") as z:
        for i in range(3):
            z.writestr(f"{i}.tif", b"x")
    monkeypatch.setattr(estonia_files, "DEFLATE64", zipfile.ZIP_STORED)  # Python cannot write the real thing
    asked = []
    monkeypatch.setattr(estonia_files, "_readable", lambda address: asked.append(address) or True)
    assert estonia_files._is_whole_zip(str(path)) is True
    assert len(asked) == 3 and asked[0] == f"/vsizip/{{{path}}}/0.tif"
    monkeypatch.setattr(estonia_files, "_readable", lambda address: False)
    assert estonia_files._is_whole_zip(str(path)) is False


def test_a_real_sheet_can_be_read_through_a_zip_with_an_odd_name(tmp_path):
    import zipfile
    sheet = tmp_path / "sheet.tif"
    _estonian_tif(sheet, 611000, 6571000, 5, np.full((4, 4), 1))
    path = tmp_path / "a.zip.part"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(sheet, "570611_ndsm_5m.tif")
    assert estonia_files._readable(f"/vsizip/{{{path}}}/570611_ndsm_5m.tif") is True
    assert estonia_files._readable(f"/vsizip/{{{path}}}/missing.tif") is False


def test_lidar_gives_trees_and_buildings_only_inside_its_reach(tmp_path):
    import zipfile
    sheet = tmp_path / "sheet.tif"
    values = np.full((200, 200), 2.0)
    values[100:140, 100:140] = 9.0  # a 200 m block of tall cover in the south east quarter
    _estonian_tif(sheet, 611000, 6571000, 5, values)
    with zipfile.ZipFile(tmp_path / estonia.SURFACE, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(sheet, "570611_ndsm_5m.tif")
    window = Window(611500, 6570500, 8000 // 16)  # half a km each way: entirely inside the sheet
    ground = np.full((window.side, window.side), 30.0, "float32")
    house = shapely.box(611500, 6570300, 611700, 6570500)  # the same block
    full = estonia.lidar(str(tmp_path), window, 500, ground, np.array([house], dtype=object))
    middle = window.side // 2
    assert full["ground"][middle, middle] == 30 and full["tall"][1, 1] == 2
    assert full["houses"][middle + 5, middle + 5] == 9 and np.isnan(full["houses"][1, 1])
    near = estonia.lidar(str(tmp_path), window, 100, ground, np.array([], dtype=object))
    assert np.isnan(near["ground"][1, 1]) and near["ground"][middle, middle] == 30  # outside the reach, the assumed heights stand


def _etak_theme(tmp_path, theme, layer, field, values):
    """A theme zip with one small shapefile in it, laid out as the agency's are."""
    import zipfile
    from pyogrio.raw import write
    folder = tmp_path / "shapes"
    folder.mkdir(exist_ok=True)
    shapes = np.array([shapely.to_wkb(shapely.LineString([(611000 + i, 6570000), (611010 + i, 6570010)])) for i in range(len(values))], dtype=object)
    write(str(folder / f"{layer}.shp"), shapes, [np.array(values, "int32")], fields=[field], driver="ESRI Shapefile", geometry_type="LineString", crs="EPSG:3301")
    with zipfile.ZipFile(tmp_path / theme, "w", zipfile.ZIP_DEFLATED) as z:
        for part in folder.glob(f"{layer}.*"):
            z.write(part, part.name)


def test_a_filtered_etak_layer_really_is_filtered(tmp_path):
    _etak_theme(tmp_path, estonia.UTILITIES, "E_601_elektriliin_j", "nimipinge", [10, 35, 110, 330])
    etak = estonia.Etak(str(tmp_path), Window(611000, 6570000, 1000))
    shapes, fields = etak.read(estonia.UTILITIES, "E_601_elektriliin_j", ["nimipinge"], f"nimipinge >= {estonia.MIN_LINE_KV}")
    assert len(shapes) == 3 and sorted(fields["nimipinge"]) == [35, 110, 330]
    assert all(s.geom_type == "LineString" for s in shapes)
    assert len(etak.read(estonia.UTILITIES, "E_601_elektriliin_j")[0]) == 4  # no filter, and no columns asked for


def test_settlements_are_named_once_at_their_middle_without_their_type_word(tmp_path):
    import zipfile
    from pyogrio.raw import write
    square = lambda e, n, side: shapely.box(e, n, e + side, n + side)
    town = square(610600, 6569600, 800)
    bent = shapely.Polygon([(611100, 6570100), (611400, 6570100), (611400, 6570400), (611300, 6570400), (611300, 6570200), (611100, 6570200)])  # an L, with its centroid outside it
    rows = [(town, "Tapa linn", "1", "5"), (square(611450, 6570450, 20), "Tapa linn", "1", "5"), (bent, "Tahu küla / Skåtanäs", "2", "8"),
            (square(611300, 6569500, 50), "Lehtse alevik", "3", "7"), (square(611600, 6570000, 50), "Odd place", "4", "9"), (square(612600, 6570000, 900), "Far küla", "5", "8")]
    folder = tmp_path / "shapes"
    folder.mkdir()
    write(str(folder / "asustusyksus.shp"), np.array([shapely.to_wkb(r[0]) for r in rows], dtype=object), [np.array([r[i] for r in rows], dtype=object) for i in (1, 2, 3)],
          fields=["ANIMI", "AKOOD", "TYYP"], driver="ESRI Shapefile", geometry_type="Polygon", crs="EPSG:3301")
    with zipfile.ZipFile(tmp_path / estonia.PLACES, "w") as z:
        for part in folder.glob("asustusyksus.*"):
            z.write(part, part.name)
    points, fields = estonia.place_names(str(tmp_path), Window(611000, 6570000, 1000))
    found = dict(zip(fields["DISTNAME"], zip(fields["FONTHEIGHT"], points)))
    assert sorted(found) == ["Lehtse", "Odd place", "Tahu / Skåtanäs", "Tapa"]  # the far village's middle is outside the window
    assert found["Tapa"][0] == "Large" and found["Lehtse"][0] == "Medium" and found["Tahu / Skåtanäs"][0] == "Medium" and found["Odd place"][0] == "Small"
    assert (found["Tapa"][1].x, found["Tapa"][1].y) == (611000, 6570000)  # on the town, not its small detached piece
    assert bent.contains(found["Tahu / Skåtanäs"][1])
    assert set(fields["CLASSIFICA"]) == {"Populated Place"}


def test_an_etak_layer_only_gives_what_is_in_the_window(tmp_path):
    _etak_theme(tmp_path, estonia.UTILITIES, "E_601_elektriliin_j", "nimipinge", [110])
    far_away = estonia.Etak(str(tmp_path), Window(500000, 6500000, 1000))
    assert len(far_away.read(estonia.UTILITIES, "E_601_elektriliin_j")[0]) == 0


def test_an_os_download_comes_only_from_os_and_never_runs_past_its_size(tmp_path, monkeypatch):
    class Endless:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self, _):
            return b"x" * 1000  # a reply that never ends

    monkeypatch.setattr(download.urllib.request, "urlopen", lambda *a, **k: Endless())
    good = {"fileName": "t50.zip", "size": 2500, "md5": "0" * 32, "url": "https://api.os.uk/downloads/v1/products/Terrain50/downloads?area=GB"}
    for bad in ({"url": "http://api.os.uk/x"}, {"url": "https://example.com/x"}, {"size": "2500"}, {"md5": None}, {"md5": "not a checksum"}):
        with pytest.raises(SystemExit, match="did not describe"):
            download._fetch({**good, **bad}, str(tmp_path), lambda _: None)
    with pytest.raises(SystemExit, match="did not download"):
        download._fetch(good, str(tmp_path), lambda _: None)
    assert list(tmp_path.iterdir()) == []  # nothing half-written is left


def lidar_window():
    return Window(10000, 20000, 1000)  # 2 km across: four 1 km lidar squares


def flat_fetch(calls, sea=()):
    """Stands in for the Environment Agency: ground at 5 m, surface 3 m above it, and nothing at all for the squares in `sea`."""
    def fetch(service, east, north):
        calls.append((service[1][-6:], east, north))
        if (east, north) in sea:
            return np.full((terrain.SQUARE_M, terrain.SQUARE_M), np.nan, "float32")
        return np.full((terrain.SQUARE_M, terrain.SQUARE_M), 8.0 if "DSM" in service[1] else 5.0, "float32")
    return fetch


def test_british_lidar_fetches_every_square_once_and_places_it(monkeypatch):
    calls = []
    monkeypatch.setattr(terrain, "fetch_square", flat_fetch(calls))
    grids = terrain.lidar(lidar_window(), 1000, np.array([], dtype=object), lambda _: None)
    assert len(calls) == 8 and len(set(calls)) == 8  # ground and surface for each of four squares
    assert np.allclose(grids["ground"], 5) and np.allclose(grids["tall"], 3) and np.isnan(grids["houses"]).all()


def test_british_lidar_squares_are_kept_and_not_fetched_again(tmp_path, monkeypatch):
    calls, said = [], []
    monkeypatch.setattr(terrain, "fetch_square", flat_fetch(calls))
    first = terrain.lidar(lidar_window(), 1000, np.array([], dtype=object), said.append, str(tmp_path / "cache"))
    assert len(calls) == 8 and len(list((tmp_path / "cache").glob("*.npz"))) == 4 and not list((tmp_path / "cache").glob("*.part"))
    calls.clear()
    again = terrain.lidar(lidar_window(), 1000, np.array([], dtype=object), said.append, str(tmp_path / "cache"))
    assert calls == []
    for name in first:
        assert np.array_equal(first[name], again[name], equal_nan=True)


def test_a_british_lidar_square_the_service_gave_up_on_is_asked_for_again(tmp_path, monkeypatch):
    calls = []
    sea = {(9000, 20000)}
    monkeypatch.setattr(terrain, "fetch_square", flat_fetch(calls, sea))
    grids = terrain.lidar(lidar_window(), 1000, np.array([], dtype=object), lambda _: None, str(tmp_path))
    assert len(list(tmp_path.glob("*.npz"))) == 3 and np.isnan(grids["ground"][0, 0])
    calls.clear()
    terrain.lidar(lidar_window(), 1000, np.array([], dtype=object), lambda _: None, str(tmp_path))
    assert sorted(set((e, n) for _, e, n in calls)) == [(9000, 20000)]


def test_a_damaged_kept_lidar_square_is_fetched_again(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(terrain, "fetch_square", flat_fetch(calls))
    terrain.lidar(lidar_window(), 1000, np.array([], dtype=object), lambda _: None, str(tmp_path))
    (tmp_path / "9000_20000.npz").write_bytes(b"not a square")
    np.savez_compressed(tmp_path / "10000_20000.npz", ground=np.zeros((2, 2), "float32"), tall=np.zeros((2, 2), "float32"), houses=np.zeros((2, 2), "float32"))
    calls.clear()
    grids = terrain.lidar(lidar_window(), 1000, np.array([], dtype=object), lambda _: None, str(tmp_path))
    assert sorted(set((e, n) for _, e, n in calls)) == [(9000, 20000), (10000, 20000)]
    assert np.allclose(grids["ground"], 5)


def test_a_pack_may_be_as_small_as_one_world_and_no_smaller():
    from mapbuild.__main__ import WORLD_KM, size_problem

    assert size_problem(WORLD_KM, WORLD_KM) is None and size_problem(70, 54) is None and size_problem(80, 0) is None
    for size, lidar_km in [(WORLD_KM - 2, 0), (82, 0), (55, 0), (70, 53), (54, 56)]:
        assert size_problem(size, lidar_km), (size, lidar_km)


def test_saved_lidar_only_uses_the_kept_squares_and_asks_the_service_for_nothing(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(terrain, "fetch_square", flat_fetch(calls))
    terrain.lidar(lidar_window(), 1000, np.array([], dtype=object), lambda _: None, str(tmp_path))
    (tmp_path / "9000_20000.npz").unlink()  # one of the four squares was never fetched
    calls.clear()
    said = []
    grids = terrain.lidar(lidar_window(), 1000, np.array([], dtype=object), said.append, str(tmp_path), fetch=False)
    assert calls == []
    assert np.isnan(grids["ground"][0, 0]) and np.isclose(grids["ground"][-1, -1], 5)  # the missing square is left to Terrain 50
    assert any("3 of 4" in s for s in said)


def write_tile(path, west, north, size, value):
    """A 1 m GeoTIFF tile on the national grid, `size` metres square, every pixel `value`."""
    import rasterio as rio
    from rasterio.transform import from_origin as origin

    with rio.open(path, "w", driver="GTiff", width=size, height=size, count=1, dtype="float32", crs="EPSG:27700",
                  transform=origin(west, north, 1, 1), nodata=-9999, tiled=True, blockxsize=256, blockysize=256) as tif:
        tif.write(np.full((size, size), value, "float32"), 1)


def test_lidar_tiles_from_the_catalogue_fill_the_squares_and_nothing_is_fetched(tmp_path, monkeypatch):
    import zipfile as zf

    monkeypatch.setattr(terrain, "fetch_square", lambda *_a: pytest.fail("a square was fetched"))
    tiles, cache = tmp_path / "lidar_tiles", tmp_path / "cache"
    tiles.mkdir()
    write_tile(tmp_path / "su0910_DTM_1m.tif", 9000, 21000, 2000, 5.0)
    with zf.ZipFile(tiles / "LIDAR-DTM-1m-2022-SU0910.zip", "w") as archive:
        archive.write(tmp_path / "su0910_DTM_1m.tif", "su0910_DTM_1m.tif")
    write_tile(tiles / "su0910_FZ_DSM_1m.tif", 9000, 21000, 2000, 8.0)
    said = []
    grids = terrain.lidar(lidar_window(), 1000, np.array([], dtype=object), said.append, str(cache), fetch=False, tiles=str(tiles))
    assert len(list(cache.glob("*.npz"))) == 4
    assert np.allclose(grids["ground"], 5) and np.allclose(grids["tall"], 3)
    assert any("4 new square(s) taken from 1 tile(s)" in s for s in said)


def test_a_lidar_tile_without_its_pair_or_off_the_grid_is_left_out(tmp_path):
    from mapbuild import lidar_tiles

    write_tile(tmp_path / "su0910_DTM_1m.tif", 9000, 21000, 1000, 5.0)  # no DSM beside it
    write_tile(tmp_path / "su0910_DSM_1m.tif", 9500, 21000, 1000, 8.0)  # half a kilometre off the grid
    (tmp_path / "notes_DSM.tif").write_bytes(b"<VRTDataset/>")  # not a GeoTIFF
    said = []
    kept = lidar_tiles.import_tiles(str(tmp_path), str(tmp_path / "cache"), {(9000, 20000)}, lambda *_a: pytest.fail("reduced"), said.append)
    assert kept == 0
    assert any("2 file(s)" in s for s in said) and any("only one of the DTM and the DSM" in s for s in said)
    assert lidar_tiles.kind_of("LIDAR-FZ_DSM-1m-2022-SU45ne.zip") == "dsm" and lidar_tiles.kind_of("x_DTM_DSM.tif") is None


def test_a_rate_limited_lidar_request_stops_at_once(monkeypatch):
    import urllib.error

    calls = []

    def refuse(*_a, **_k):
        calls.append(1)
        raise urllib.error.HTTPError("u", 429, "Too Many Requests", {}, None)

    monkeypatch.setattr(terrain.urllib.request, "urlopen", refuse)
    with pytest.raises(SystemExit, match="refusing lidar requests"):
        terrain.fetch_square(terrain.SERVICES["dtm"], 1000, 1000)
    assert calls == [1]
