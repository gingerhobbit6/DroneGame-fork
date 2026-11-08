"""The ground past Estonia's border: Copernicus heights, GeoNames names and the outline the game shades, checked on small made-up inputs."""

import os

import numpy as np
import pytest
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from mapbuild import beyond, copernicus, estonia, geonames
from mapbuild.grid import Window

NARVA = Window(738000, 6590000, 2000)  # about 59.39 N, 28.19 E


def write_tile(path, values):
    """A whole 1 degree tile, 59 to 60 N and 28 to 29 E, in latitude and longitude."""
    side = values.shape[0]
    with rasterio.open(path, "w", driver="GTiff", width=side, height=side, count=1, dtype=values.dtype, crs="EPSG:4326",
                       transform=from_origin(28, 60, 1 / side, 1 / side)) as tif:
        tif.write(values, 1)


def test_the_tiles_round_narva_are_named_as_in_the_bucket():
    assert copernicus.tiles(NARVA) == ["Copernicus_DSM_COG_10_N59_00_E028_00_DEM"]
    assert copernicus.tiles(Window(738000, 6590000, 22000)) == ["Copernicus_DSM_COG_10_N59_00_E027_00_DEM", "Copernicus_DSM_COG_10_N59_00_E028_00_DEM"]


def test_posts_past_the_border_get_copernicus_heights_and_its_water(tmp_path):
    folder = tmp_path / copernicus.FOLDER
    folder.mkdir()
    side = 1000
    write_tile(folder / "Copernicus_DSM_COG_10_N59_00_E028_00_DEM.tif", np.full((side, side), 42.0, "float32"))
    wet = np.zeros((side, side), "uint8")
    wet[:, int(0.2 * side):] = 3  # a river east of 28.2 E
    write_tile(folder / "Copernicus_DSM_COG_10_N59_00_E028_00_WBM.tif", wet)

    ground = np.full((NARVA.side, NARVA.side), 30.0, "float32")
    ground[:, NARVA.side // 2:] = np.nan  # Estonian data stops half way across
    said = []
    base, water, filled = estonia.beyond_border(str(tmp_path), NARVA, ground, False, said.append)

    assert filled[:, NARVA.side // 2:].all() and not filled[:, : NARVA.side // 2].any() and np.isfinite(base).all()
    assert (base[:, : NARVA.side // 2] == 30).all()  # Estonian heights are kept
    assert np.allclose(base[:, NARVA.side // 2:], 42)
    assert not water[:, : NARVA.side // 2].any()
    assert water[:, -1].all() and not water[:, NARVA.side // 2].all()  # the far edge is past 28.2 E, the middle is not
    assert "Copernicus heights fill" in said[0]


def test_with_no_tiles_ground_past_the_border_stays_water(tmp_path):
    ground = np.full((NARVA.side, NARVA.side), np.nan, "float32")
    ground[:, :10] = 5
    base, water, filled = estonia.beyond_border(str(tmp_path), NARVA, ground, False, lambda _: None)
    assert not filled.any() and water[:, 10:].all() and not water[:, :10].any()
    assert not os.path.exists(tmp_path / copernicus.FOLDER)


def test_the_credit_is_only_given_when_copernicus_heights_were_used():
    assert "heights" not in estonia.credits(30, 2026)
    assert "Copernicus WorldDEM-30" in estonia.credits(30, 2026, True)["heights"]


def geonames_row(name, ascii_name, lat, lon, feature="P", code="PPL", people=0):
    row = [""] * 19
    row[1], row[2], row[4], row[5], row[6], row[7], row[14] = name, ascii_name, str(lat), str(lon), feature, code, str(people)
    return row


def test_russian_settlements_in_the_window_are_named_in_latin_letters():
    window = Window(738000, 6590000, 20000)
    rows = [
        geonames_row("Ivangorod", "Ivangorod", 59.377, 28.218, code="PPLA3", people=9000),
        geonames_row("Кузёмкино", "Kuzemkino", 59.43, 28.25),  # only the plain-letter form is Latin
        geonames_row("Old fort", "Old fort", 59.38, 28.22, code="PPLH"),  # historical
        geonames_row("A lake", "A lake", 59.38, 28.22, feature="H"),  # not a settlement
        geonames_row("Pskov", "Pskov", 57.82, 28.33, code="PPLA", people=200000),  # far outside the window
    ]
    points, fields = geonames.place_names("", window, rows)
    assert list(fields["DISTNAME"]) == ["Ivangorod", "Kuzemkino"]
    assert list(fields["FONTHEIGHT"]) == ["Large", "Medium"]
    assert set(fields["CLASSIFICA"]) == {"Populated Place"}
    assert all(window.west <= p.x <= window.right and window.south <= p.y <= window.top for p in points)


def test_with_no_geonames_file_there_are_no_russian_names(tmp_path):
    points, fields = geonames.place_names(str(tmp_path), NARVA)
    assert len(points) == 0 and fields == {}


def test_names_past_the_border_carry_their_own_credit():
    assert "names" not in estonia.credits(30, 2026)
    assert "GeoNames" in estonia.credits(30, 2026, russian_names=True)["names"]


def jpeg_piece(window, pixels):
    with MemoryFile() as memory:
        with memory.open(driver="JPEG", width=pixels.shape[2], height=pixels.shape[1], count=3, dtype="uint8", QUALITY=88) as jpeg:
            jpeg.write(pixels)
        data = memory.read()
    return {"layer": "osmap", "west": window.west - 10, "top": window.top + 10, "width": 2 * window.half + 20, "height": 2 * window.half + 20, "data": data}


def test_the_ground_the_basic_map_leaves_blank_is_outlined():
    window = Window(738000, 6590000, 2000)  # 4 km, 201 posts
    pixels = np.full((3, 400, 400), 120, "uint8")  # a map drawn in grey to the west
    pixels[:, :, 200:300] = 255  # blank white, then blank black, to the east
    pixels[:, :, 300:] = 0
    blank = beyond.blank_posts(window, [jpeg_piece(window, pixels)])
    assert blank[:, -1].all() and blank[:, 120].all() and not blank[:, 80].any()

    found = beyond.rings(window, blank)
    assert len(found) == 1
    xs = [x for x, _ in found[0]]
    assert min(xs) == pytest.approx(0, abs=40) and max(xs) == pytest.approx(window.half + 10, abs=1)  # scene metres from the middle
    assert beyond.rings(window, np.zeros_like(blank)) == []


def test_blank_specks_smaller_than_a_field_are_left_out():
    window = Window(738000, 6590000, 2000)
    posts = np.zeros((window.side, window.side), bool)
    posts[10:14, 10:14] = True  # 80 m across
    assert beyond.rings(window, posts) == []


def test_blank_ground_joined_to_the_far_side_is_shaded_and_a_lone_blank_patch_is_not():
    window = Window(738000, 6590000, 2000)
    blank = np.zeros((window.side, window.side), bool)
    blank[:, 120:] = True  # blank from the border strip eastwards
    blank[10:40, 10:40] = True  # a white patch on the Estonian side, not joined to it
    past = np.zeros_like(blank)
    past[:, 133:] = True  # Estonian heights run 13 posts past the border, as they do at Narva
    found = beyond.reaching(window, blank, past)
    assert found[:, 120:].all()  # the strip with Estonian heights is shaded too
    assert not found[10:40, 10:40].any() and not found[:, :120].any()
