"""Deployment packs: each account's own units of systems, vehicles and people, never visible to another account."""

import copy
import re
from pathlib import Path

import pytest
from conftest import sign_up
from fastapi.testclient import TestClient

from app.account_schemas import MAX_UNIT_COUNT, MAX_UNIT_LINES, Echelon, UnitVehicle
from app.main import create_app
from app.schemas import PatrolVehicle
from app.services import units

API = "/api/v1/units"
UNIT = {
    "name": "1 Troop, Air Defence",
    "echelon": "troop",
    "callsign": "Hawk 1",
    "assets": {
        "systems": [{"id": "radar_a800", "count": 2}, {"id": "jammer", "count": 4}, {"id": "missile_rr", "count": 1}],
        "vehicles": [{"id": "patria", "count": 2}, {"id": "hilux", "count": 1}],
        "people": [{"count": 8, "protection": "open"}, {"count": 4, "protection": "bunker"}],
    },
}


def unit(**over):
    return {**copy.deepcopy(UNIT), **over}


def test_create_read_list_replace_delete(client):
    made = client.post(API, json=unit())
    assert made.status_code == 201
    body = made.json()
    assert body["assets"] == UNIT["assets"] and body["callsign"] == "Hawk 1"
    assert client.get(f"{API}/{body['id']}").json() == body
    assert [u["name"] for u in client.get(API).json()] == ["1 Troop, Air Defence"]
    assert "assets" not in client.get(API).json()[0]

    changed = client.put(f"{API}/{body['id']}", json=unit(name="2 Troop", callsign=None, assets={"systems": [{"id": "laser", "count": 1}]}))
    assert changed.status_code == 200
    assert changed.json()["assets"] == {"systems": [{"id": "laser", "count": 1}], "vehicles": [], "people": []}
    assert changed.json()["created_at"] == body["created_at"]

    assert client.delete(f"{API}/{body['id']}").status_code == 204
    assert client.get(f"{API}/{body['id']}").status_code == 404
    assert client.delete(f"{API}/{body['id']}").status_code == 404
    assert client.put(f"{API}/{body['id']}", json=unit()).status_code == 404


def test_a_pack_keeps_the_settings_its_systems_are_placed_with(client):
    systems = [{"id": "radar_a800", "count": 2, "settings": {"mount": 12, "clutter": "high"}}, {"id": "jammer", "count": 1, "settings": {"fitted": ["control24", "gnss"]}}]
    made = client.post(API, json=unit(assets={"systems": systems}))
    assert made.status_code == 201
    assert client.get(f"{API}/{made.json()['id']}").json()["assets"]["systems"] == systems


@pytest.mark.parametrize("settings", [{"mount": "tall" * 10}, {"bad key!": 1}, {f"k{i}": 1 for i in range(17)}, {"mount": 1e13}])
def test_bad_pack_settings_are_refused(client, settings):
    assert client.post(API, json=unit(assets={"systems": [{"id": "radar_a800", "count": 1, "settings": settings}]})).status_code == 422


def test_an_empty_pack_is_allowed(client):
    assert client.post(API, json=unit(assets={})).status_code == 201


def test_another_account_cannot_see_or_touch_a_pack(client, db_path):
    mine = client.post(API, json=unit()).json()
    with TestClient(create_app(db_path, game=db_path.parent / "no-game"), base_url="http://localhost") as other:
        sign_up(other, username="intruder")
        assert other.get(API).json() == []
        assert other.get(f"{API}/{mine['id']}").status_code == 404  # the same answer as a pack that does not exist
        assert other.put(f"{API}/{mine['id']}", json=unit(name="taken")).status_code == 404
        assert other.delete(f"{API}/{mine['id']}").status_code == 404
    assert client.get(f"{API}/{mine['id']}").json() == mine


@pytest.mark.parametrize("over", [
    {"name": ""},
    {"name": "x" * 101},
    {"echelon": "army"},
    {"callsign": "far too long a callsign"},
    {"owner": 2},
    {"assets": {"systems": [{"id": "nuke", "count": 1}]}},
    {"assets": {"systems": [{"id": "radar", "count": 0}]}},
    {"assets": {"systems": [{"id": "radar", "count": 51}]}},
    {"assets": {"systems": [{"id": "radar", "count": 1}, {"id": "radar", "count": 2}]}},
    {"assets": {"systems": [{"id": "radar", "count": 1, "x": 3}]}},
    {"assets": {"vehicles": [{"id": "tank", "count": 1}]}},
    {"assets": {"vehicles": [{"id": "hilux", "count": 1}, {"id": "hilux", "count": 1}]}},
    {"assets": {"people": [{"count": 501, "protection": "open"}]}},
    {"assets": {"people": [{"count": 5, "protection": "castle"}]}},
    {"assets": {"people": [{"count": 1, "protection": "open"}] * 21}},
    {"assets": {"drones": []}},
])
def test_bad_packs_are_refused(client, over):
    assert client.post(API, json=unit(**over)).status_code == 422
    assert client.get(API).json() == []


def test_an_account_has_a_limit(client, monkeypatch):
    monkeypatch.setattr(units, "MAX_UNITS", 2)
    assert [client.post(API, json=unit()).status_code for _ in range(3)] == [201, 201, 409]


@pytest.mark.parametrize("path", ["0", "-1", "abc", str(2**63)])
def test_bad_ids_are_refused(client, path):
    assert client.get(f"{API}/{path}").status_code == 422


def test_the_names_a_pack_accepts_match_the_game():
    source = (Path(__file__).parent.parent.parent / "frontend" / "src" / "sim" / "config" / "units.js").read_text(encoding="utf-8")
    assert set(re.findall(r"^  (\w+): \{ name: ", source, re.M)) == set(Echelon.__args__)
    assert UnitVehicle is PatrolVehicle  # whose names test_security.py matches to the game
    assert f"lines: {MAX_UNIT_LINES}, count: {MAX_UNIT_COUNT}, peopleGroups: 20" in source
