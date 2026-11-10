import io

import numpy as np
import pytest

from mapbuild import terrain
from mapbuild.grid import Window


def test_a_hung_lidar_request_is_asked_again_soon(monkeypatch):
    asked = []

    def opened(_url, timeout):
        asked.append(timeout)
        if len(asked) < 3:
            raise TimeoutError("The read operation timed out")
        return io.BytesIO(b"answer")

    monkeypatch.setattr(terrain.urllib.request, "urlopen", opened)
    monkeypatch.setattr(terrain, "read_square", lambda data, _east, _north: data)
    monkeypatch.setattr(terrain.time, "sleep", lambda _s: None)
    assert terrain.fetch_square(terrain.SERVICES["dtm"], 1000, 1000) == b"answer"
    assert asked == [terrain.ANSWER_S] * 3


def test_a_lidar_outage_stops_the_build(monkeypatch):
    def hung(_url, timeout):
        raise TimeoutError("The read operation timed out")

    monkeypatch.setattr(terrain.urllib.request, "urlopen", hung)
    monkeypatch.setattr(terrain, "GIVE_UP_S", 0)
    with pytest.raises(SystemExit, match="gave up fetching lidar at 1000,1000"):
        terrain.fetch_square(terrain.SERVICES["dtm"], 1000, 1000)


def test_lidar_squares_fetched_together_land_in_their_places(monkeypatch):
    monkeypatch.setattr(terrain, "fetch_square", lambda _service, east, north: np.full((1000, 1000), east / 1000 + north / 100, "float32"))
    window = Window(10000, 20000, 2000)
    grids = terrain.lidar(window, 1000, np.array([], dtype=object), lambda _text: None)
    ground = grids["ground"]  # rows run north to south from 22000 N, columns east from 8000 E, every 20 m
    assert ground[125, 75] == 9 + 190  # inside the south west square, 9000 E 19000 N
    assert ground[75, 125] == 10 + 200  # inside the north east square
    assert ground[75, 100] == 9 + 200  # the edge shared by the two northern squares belongs to the western one, fetched first
    assert np.isnan(ground[0, 0])  # outside the lidar's reach
