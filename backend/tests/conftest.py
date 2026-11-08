import copy

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import accounts

PASSWORD = "correct horse battery"

SPEC = {
    "structures": [
        {"id": "radar", "x": 30.0, "z": 0.0, "uplink": "cellular", "cellBand": "B8", "jam": None},
        {"id": "jammer", "x": -25.5, "z": 12.0, "uplink": "starlink", "cellBand": "n78", "jam": ["control24", "gnss"]},
    ],
    "fusionUplinks": ["starlink", "cellular"],
    "fusionCell": "B8",
}
FIGURES = {"structures": {"radar": {"published": 3000.0}}, "drones": {}, "comms": {}, "world": {"rangeScale": 2.0}, "waves": {}, "adapt": {}}


def laydown(**over):
    return {"name": "Ring of radars", "world": "1", "spec": copy.deepcopy(SPEC), "game_version": "0.1.0", **over}


def run(**over):
    return {
        "scenario_seed": "7", "world": "1", "spec": copy.deepcopy(SPEC), "figures": copy.deepcopy(FIGURES),
        "commands": [{"step": 0, "name": "startWave", "args": []}, {"step": 40, "name": "toggleJamBand", "args": [{"node": "abc"}, "gnss", True]}],
        "game_version": "0.1.0", "digest": "e3c0c9db", "waves_completed": 6, "kills": 71, "leaks": 3, "health": 10.0,
        "budget_left": 8902451.0, "capex": 2607549.0, "consumables": 3490000.0, "enemy_cost": 1305600.0, **over,
    }


def figure_set(**over):
    return {"name": "Long range radars", "figures": copy.deepcopy(FIGURES), "game_version": "0.1.0", **over}


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "data" / "test.db"


@pytest.fixture(autouse=True)
def quick_hashing(monkeypatch):
    # the real cost makes each hash take ~50 ms; tests only need the same code path
    monkeypatch.setitem(accounts.SCRYPT, "n", 2**8)


def sign_up(c, username="operator", password=PASSWORD, display_name="Test Operator"):
    return c.post("/api/v1/auth/register", json={"username": username, "display_name": display_name, "password": password})


@pytest.fixture
def anon(db_path):
    """A browser that has not signed in."""
    with TestClient(create_app(db_path, game=db_path.parent / "no-game"), base_url="http://localhost") as c:
        yield c


@pytest.fixture
def client(anon):
    """A browser signed in to a new account, which is what every page of the game is once past the login screen."""
    assert sign_up(anon).status_code == 201
    return anon
