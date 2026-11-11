"""Refuse a build early: invalid dimensions before fitting or fetching, and too many shapes before the slow lidar step."""

import numpy as np
import pytest
import shapely

from mapbuild import __main__ as cli
from mapbuild.grid import Window
from mapbuild.source_limits import HttpsRedirects


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


def test_the_redirect_rule_is_installed_before_anything_is_fetched(monkeypatch, capsys):
    installed = []
    monkeypatch.setattr(cli.urllib.request, "install_opener", installed.append)
    with pytest.raises(SystemExit):
        cli.main([])
    capsys.readouterr()
    assert any(isinstance(handler, HttpsRedirects) for handler in installed[0].handlers)


FAR_LINE = shapely.LineString([(1000, 2000), (1e12, 2000)])
NO_SHAPES = np.array([], dtype=object)


def no_lidar(*_args, **_kwargs):
    pytest.fail("the shape counts must be checked before the lidar step")


def test_a_british_build_checks_its_shapes_before_fetching_lidar(monkeypatch):
    class OpenMap:
        def __init__(self, *_args):
            pass

        def read(self, layer, fields=None):
            return (np.array([FAR_LINE]) if layer == "ElectricityTransmissionLine" else NO_SHAPES), {}

    monkeypatch.setattr(cli.terrain, "terrain50", lambda *_a: (np.zeros((2, 2)), np.zeros((2, 2), bool)))
    monkeypatch.setattr(cli.features, "OpenMap", OpenMap)
    monkeypatch.setattr(cli.terrain, "lidar", no_lidar)
    with pytest.raises(ValueError, match="power lines"):
        cli.british("unused", Window(1000, 2000, 100), 2, lambda _text: None)


def test_an_estonian_build_checks_its_shapes_before_reading_lidar(monkeypatch):
    class Etak:
        def __init__(self, *_args):
            pass

        def read(self, theme, layer, fields=None, where=None):
            return (np.array([FAR_LINE]) if theme == cli.estonia.UTILITIES else NO_SHAPES), {"tyyp": np.array([], int)}

    window = Window(1000, 2000, 100)
    monkeypatch.setattr(cli.estonia, "ground_posts", lambda *_a: np.zeros((window.side, window.side), "float32"))
    monkeypatch.setattr(cli.estonia, "Etak", Etak)
    monkeypatch.setattr(cli.estonia, "place_names", lambda *_a: (NO_SHAPES, {}))
    monkeypatch.setattr(cli.estonia, "lidar", no_lidar)
    with pytest.raises(ValueError, match="power lines"):
        cli.estonia.gather("unused", window, 2, lambda _text: None)
