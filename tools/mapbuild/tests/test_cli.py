"""Refuse invalid pack dimensions before fitting a map or fetching its sources."""

import pytest

from mapbuild import __main__ as cli


@pytest.mark.parametrize("width", [-2, -54])
def test_negative_lidar_width_is_refused_before_building(width, tmp_path, monkeypatch, capsys):
    def unexpected_work(*_args, **_kwargs):
        pytest.fail("invalid dimensions must be refused before fitting or downloading")

    monkeypatch.setattr(cli.fit, "geo_fit", unexpected_work)
    monkeypatch.setattr(cli.download, "ensure", unexpected_work)
    with pytest.raises(SystemExit) as error:
        cli.main([
            "--centre", "422000,166000", "--name", "Test map",
            "--data", str(tmp_path), "--out", str(tmp_path / "map.sgmap"),
            "--fetch", "--lidar-km", str(width),
        ])
    assert error.value.code == 2
    assert "non-negative" in capsys.readouterr().err
