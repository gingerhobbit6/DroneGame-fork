"""Limits on what the builder reads and writes, so damaged downloads or a dense area cannot run it out of memory or make a pack the game refuses."""

import io
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


def test_a_pack_with_more_features_than_the_game_reads_is_not_written(tmp_path, monkeypatch):
    empty = np.zeros((3, 3), "uint8")
    grids = packfile.Grids(np.zeros((3, 3), "float32"), empty, empty, empty)
    monkeypatch.setattr(packfile, "MAX_FEATURES", 100)
    packfile.write_pack(str(tmp_path / "small.sgmap"), {}, grids, {"buildings": []}, [])
    with pytest.raises(ValueError, match="build a smaller pack"):
        packfile.write_pack(str(tmp_path / "large.sgmap"), {}, grids, {"buildings": [[0, 0, 1, 1, 8, 0]] * 20}, [])
    assert not (tmp_path / "large.sgmap").exists()
