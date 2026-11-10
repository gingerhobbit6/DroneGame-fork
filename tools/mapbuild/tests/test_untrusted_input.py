"""Limits on what the builder reads and writes, so damaged downloads or a dense area cannot run it out of memory or make a pack the game refuses."""

import gzip
import io
import json
import zipfile

import numpy as np
import pytest

from mapbuild import packfile, terrain


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


def grids3():
    empty = np.zeros((3, 3), "uint8")
    return packfile.Grids(np.zeros((3, 3), "float32"), empty, empty, empty)


def features_in(path):
    data = path.read_bytes()
    length = int.from_bytes(data[6:10], "little")
    header = json.loads(data[10:10 + length])
    section = next(s for s in header["sections"] if s["name"] == "features")
    start = 10 + length + section["offset"]
    return json.loads(gzip.decompress(data[start:start + section["length"]]))


def test_a_pack_whose_roads_and_names_are_more_than_the_game_reads_is_not_written(tmp_path, monkeypatch):
    monkeypatch.setattr(packfile, "MAX_FEATURES", 100)
    packfile.write_pack(str(tmp_path / "small.sgmap"), {}, grids3(), {"buildings": []}, [])
    with pytest.raises(ValueError, match="build a smaller pack"):
        packfile.write_pack(str(tmp_path / "large.sgmap"), {}, grids3(), {"buildings": [], "roads": [["A", [[0, 0]] * 40]]}, [])
    assert not (tmp_path / "large.sgmap").exists()


def test_too_many_buildings_are_thinned_to_the_nearest_rather_than_refusing_the_pack(tmp_path, monkeypatch):
    monkeypatch.setattr(packfile, "MAX_FEATURES", 600)
    # building i stands i metres from the middle; the far ones are the ones to go
    buildings = [[float(i), 0.0, 10.0, 10.0, 8, 0.0] for i in range(100, 0, -1)]
    said = []
    path = tmp_path / "dense.sgmap"
    packfile.write_pack(str(path), {}, grids3(), {"buildings": buildings, "roads": [["A", [[0, 0], [1, 1]]]]}, [], said.append)
    written = features_in(path)
    kept = [b[0] for b in written["buildings"]]
    assert 0 < len(kept) < 100
    assert kept == sorted(kept) and kept[0] == 1.0 and set(kept) == set(float(i) for i in range(1, len(kept) + 1))  # the nearest, in order
    assert written["roads"] == [["A", [[0, 0], [1, 1]]]]  # nothing but buildings is dropped
    assert len(packfile.encode_features(written)) <= 600
    assert len(said) == 1 and f"{len(kept)} buildings nearest the middle" in said[0] and "of 100" in said[0]


def test_a_pack_that_fits_is_not_thinned_and_says_nothing(tmp_path):
    said = []
    buildings = [[float(i), 0.0, 10.0, 10.0, 8, 0.0] for i in range(50)]
    path = tmp_path / "fits.sgmap"
    packfile.write_pack(str(path), {}, grids3(), {"buildings": buildings}, [], said.append)
    assert features_in(path)["buildings"] == buildings and said == []
