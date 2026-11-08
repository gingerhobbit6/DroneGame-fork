"""What the API does, through real HTTP handling and a real SQLite file."""

import copy

import pytest
from conftest import FIGURES, PASSWORD, SPEC, figure_set, laydown, run, sign_up

API = "/api/v1"


def test_health(client):
    assert client.get(f"{API}/health").json() == {"status": "ok"}


def test_the_api_matches_the_documented_table(client):
    paths = client.get(f"{API}/openapi.json").json()["paths"]
    found = {path: sorted(m.upper() for m in ops) for path, ops in paths.items()}
    assert found == {
        f"{API}/health": ["GET"],
        f"{API}/auth/register": ["POST"],
        f"{API}/auth/sign-in": ["POST"],
        f"{API}/auth/sign-out": ["POST"],
        f"{API}/auth/reset": ["POST"],
        f"{API}/auth/me": ["GET", "PUT"],
        f"{API}/auth/password": ["POST"],
        f"{API}/auth/recovery-code": ["POST"],
        f"{API}/auth/delete-account": ["POST"],
        f"{API}/units": ["GET", "POST"],
        f"{API}/units/{{unit_id}}": ["DELETE", "GET", "PUT"],
        f"{API}/laydowns": ["GET", "POST"],
        f"{API}/laydowns/{{laydown_id}}": ["DELETE", "GET", "PUT"],
        f"{API}/runs": ["GET", "POST"],
        f"{API}/runs/{{run_id}}": ["DELETE", "GET"],
        f"{API}/figure-sets": ["GET", "POST"],
        f"{API}/figure-sets/{{figure_set_id}}": ["DELETE", "GET"],
        f"{API}/packs": ["GET"],
        f"{API}/packs/build": ["GET", "POST"],
        f"{API}/packs/downloads": ["GET"],
        f"{API}/packs/{{name}}": ["GET"],
    }


class TestLaydowns:
    def test_create_read_list(self, client):
        made = client.post(f"{API}/laydowns", json=laydown())
        assert made.status_code == 201
        body = made.json()
        assert body["id"] == 1 and body["name"] == "Ring of radars" and body["spec"] == SPEC
        assert body["created_at"] == body["updated_at"]
        assert client.get(f"{API}/laydowns/1").json() == body
        listed = client.get(f"{API}/laydowns").json()
        assert len(listed) == 1 and "spec" not in listed[0] and listed[0]["name"] == "Ring of radars"

    def test_replace_keeps_created_and_moves_updated(self, client):
        first = client.post(f"{API}/laydowns", json=laydown()).json()
        new_spec = {**SPEC, "structures": SPEC["structures"][:1]}
        second = client.put(f"{API}/laydowns/1", json=laydown(name="Smaller", spec=new_spec)).json()
        assert second["name"] == "Smaller" and second["spec"] == new_spec
        assert second["created_at"] == first["created_at"] and second["updated_at"] >= first["updated_at"]

    def test_newest_first(self, client):
        for name in ["a", "b", "c"]:
            client.post(f"{API}/laydowns", json=laydown(name=name))
        client.put(f"{API}/laydowns/1", json=laydown(name="a2"))
        assert [x["name"] for x in client.get(f"{API}/laydowns").json()] == ["a2", "c", "b"]

    def test_delete(self, client):
        client.post(f"{API}/laydowns", json=laydown())
        assert client.delete(f"{API}/laydowns/1").status_code == 204
        assert client.get(f"{API}/laydowns/1").status_code == 404
        assert client.delete(f"{API}/laydowns/1").status_code == 404

    def test_missing(self, client):
        assert client.get(f"{API}/laydowns/99").json() == {"detail": "Not found"}
        assert client.put(f"{API}/laydowns/99", json=laydown()).status_code == 404

    def test_an_empty_laydown_is_allowed(self, client):
        empty = {"structures": [], "fusionUplinks": [], "fusionCell": "B8"}
        assert client.post(f"{API}/laydowns", json=laydown(spec=empty)).status_code == 201

    def test_a_zone_is_kept_with_the_laydown(self, client):
        zone = [[0, 0], [50, 0], [50, 50]]
        made = client.post(f"{API}/laydowns", json=laydown(spec={**SPEC, "zone": zone}))
        assert made.status_code == 201
        assert client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["zone"] == zone

    def test_an_attack_mix_is_kept_with_the_laydown(self, client):
        attack = ["geran2", "lancet3", "orlan10"]
        made = client.post(f"{API}/laydowns", json=laydown(spec={**SPEC, "attack": attack}))
        assert made.status_code == 201
        assert client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["attack"] == attack

    def test_a_laydown_with_no_attack_mix_comes_back_as_it_was_sent(self, client):
        made = client.post(f"{API}/laydowns", json=laydown()).json()
        assert "attack" not in client.get(f"{API}/laydowns/{made['id']}").json()["spec"]

    @pytest.mark.parametrize("attack", [[], ["Geran2"], ["a" * 40], ["fpv"] * 65, ["<script>"], [1], "fpv"])
    def test_a_bad_attack_mix_is_refused(self, client, attack):
        assert client.post(f"{API}/laydowns", json=laydown(spec={**SPEC, "attack": attack})).status_code == 422

    def test_a_laydown_with_no_zone_comes_back_as_it_was_sent(self, client):
        made = client.post(f"{API}/laydowns", json=laydown()).json()
        assert "zone" not in client.get(f"{API}/laydowns/{made['id']}").json()["spec"]
        assert "patrol" not in client.get(f"{API}/laydowns/{made['id']}").json()["spec"]

    def test_a_patrol_route_is_kept_with_the_laydown(self, client):
        route = [[10, 10], [30, 10]]
        made = client.post(f"{API}/laydowns", json=laydown(spec={**SPEC, "patrol": route}))
        assert made.status_code == 201
        assert client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["patrol"] == route

    def test_a_system_parked_on_a_vehicle_is_kept_with_the_laydown(self, client):
        parked = {"id": "jammer", "x": 5.0, "z": 5.0, "uplink": None, "cellBand": "B8", "jam": None, "vehicle": "mule"}
        made = client.post(f"{API}/laydowns", json=laydown(spec={**SPEC, "structures": [parked]}))
        assert made.status_code == 201
        assert client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["structures"] == [parked]
        tank = laydown(spec={**SPEC, "structures": [{**parked, "vehicle": "tank"}]})
        assert client.post(f"{API}/laydowns", json=tank).status_code == 422

    def test_a_patrol_column_is_kept_with_the_laydown(self, client):
        column = [{"vehicle": "hilux", "system": "gun_hmg", "gap": 40}, {"vehicle": "mule", "system": "jammer_s", "gap": -25.5}]
        made = client.post(f"{API}/laydowns", json=laydown(spec={**SPEC, "patrol": [[10, 10], [30, 10]], "patrolColumn": column}))
        assert made.status_code == 201
        assert client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["patrolColumn"] == column

    @pytest.mark.parametrize("column", [
        [],
        [{"vehicle": "tank", "system": "gun_hmg", "gap": 0}],
        [{"vehicle": "hilux", "system": "nuke", "gap": 0}],
        [{"vehicle": "hilux", "system": "gun_hmg", "gap": 201}],
        [{"vehicle": "hilux", "system": "gun_hmg", "gap": 0, "crew": 3}],
        [{"vehicle": "hilux", "system": "gun_hmg", "gap": 0}] * 7,
    ])
    def test_a_bad_patrol_column_is_refused(self, client, column):
        assert client.post(f"{API}/laydowns", json=laydown(spec={**SPEC, "patrol": [[10, 10], [30, 10]], "patrolColumn": column})).status_code == 422

    def test_a_patrol_plan_and_side_offsets_are_kept(self, client):
        column = [{"vehicle": "hilux", "system": "gun_hmg", "gap": 40, "side": -20}]
        plan = {"width": 250, "formation": "wedge"}
        made = client.post(f"{API}/laydowns", json=laydown(spec={**SPEC, "patrol": [[10, 10], [30, 10]], "patrolColumn": column, "patrolPlan": plan}))
        assert made.status_code == 201
        spec = client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]
        assert (spec["patrolColumn"], spec["patrolPlan"]) == (column, plan)

    @pytest.mark.parametrize("plan", [{"width": 10, "formation": "file"}, {"width": 2000, "formation": "file"}, {"width": 200, "formation": "blob"}, {"width": 200}, {"width": 200, "formation": "file", "speed": 9}])
    def test_a_bad_patrol_plan_is_refused(self, client, plan):
        assert client.post(f"{API}/laydowns", json=laydown(spec={**SPEC, "patrol": [[10, 10], [30, 10]], "patrolPlan": plan})).status_code == 422

    def test_a_vehicle_too_far_to_the_side_is_refused(self, client):
        column = [{"vehicle": "hilux", "system": "gun_hmg", "gap": 0, "side": 101}]
        assert client.post(f"{API}/laydowns", json=laydown(spec={**SPEC, "patrol": [[10, 10], [30, 10]], "patrolColumn": column})).status_code == 422

    @pytest.mark.parametrize("route", [[[0, 0]], [[i, i] for i in range(33)], [[0, 0], [351, 0]], [[0, 0], ["a", 0]], "here"])
    def test_a_bad_patrol_route_is_refused(self, client, route):
        assert client.post(f"{API}/laydowns", json=laydown(spec={**SPEC, "patrol": route})).status_code == 422

    @pytest.mark.parametrize(
        "zone",
        [
            [[0, 0], [1, 1]],  # too few to enclose anything
            [[i, i] for i in range(33)],  # too many
            [[0, 0], [1, 1], [351, 0]],  # outside the world
            [[0, 0], [1, 1], [2]],  # not a point
            [[0, 0], [1, 1], [2, 2, 2]],  # not a point
            [[0, 0], [1, 1], ["a", 0]],  # not numbers
            "here",
        ],
    )
    def test_a_bad_zone_is_refused(self, client, zone):
        assert client.post(f"{API}/laydowns", json=laydown(spec={**SPEC, "zone": zone})).status_code == 422


class TestRuns:
    def test_record_and_read_everything_back(self, client):
        body = client.post(f"{API}/runs", json=run()).json()
        assert body["id"] == 1 and body["finished_at"]
        saved = client.get(f"{API}/runs/1").json()
        assert saved["spec"] == SPEC
        assert saved["figures"] == FIGURES
        assert saved["commands"][1] == {"step": 40, "name": "toggleJamBand", "args": [{"node": "abc"}, "gnss", True]}
        assert saved["digest"] == "e3c0c9db"

    def test_a_run_is_a_copy_so_editing_a_laydown_never_rewrites_history(self, client):
        client.post(f"{API}/laydowns", json=laydown())
        client.post(f"{API}/runs", json=run())
        client.put(f"{API}/laydowns/1", json=laydown(spec={"structures": [], "fusionUplinks": [], "fusionCell": "B8"}))
        client.delete(f"{API}/laydowns/1")
        assert client.get(f"{API}/runs/1").json()["spec"] == SPEC

    def test_runs_cannot_be_edited(self, client):
        client.post(f"{API}/runs", json=run())
        assert client.put(f"{API}/runs/1", json=run()).status_code == 405

    def test_paging(self, client):
        for i in range(5):
            client.post(f"{API}/runs", json=run(kills=i))
        page = client.get(f"{API}/runs", params={"limit": 2, "offset": 1}).json()
        assert page["total"] == 5
        assert [r["kills"] for r in page["items"]] == [3, 2]
        assert "commands" not in page["items"][0] and "spec" not in page["items"][0]
        assert len(client.get(f"{API}/runs").json()["items"]) == 5

    def test_delete_and_missing(self, client):
        client.post(f"{API}/runs", json=run())
        assert client.delete(f"{API}/runs/1").status_code == 204
        assert client.get(f"{API}/runs/1").status_code == 404
        assert client.delete(f"{API}/runs/1").status_code == 404


class TestFigureSets:
    def test_create_read_list_delete(self, client):
        assert client.post(f"{API}/figure-sets", json=figure_set()).status_code == 201
        assert client.get(f"{API}/figure-sets/1").json()["figures"] == FIGURES
        listed = client.get(f"{API}/figure-sets").json()
        assert [x["name"] for x in listed] == ["Long range radars"] and "figures" not in listed[0]
        assert client.delete(f"{API}/figure-sets/1").status_code == 204
        assert client.get(f"{API}/figure-sets/1").status_code == 404
        assert client.delete(f"{API}/figure-sets/1").status_code == 404

    def test_empty_figures_are_valid(self, client):
        assert client.post(f"{API}/figure-sets", json=figure_set(figures={})).status_code == 201


def test_saved_data_survives_a_restart(db_path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(db_path), base_url="http://localhost") as c:
        sign_up(c)
        c.post(f"{API}/laydowns", json=laydown())
    with TestClient(create_app(db_path), base_url="http://localhost") as c:
        assert c.post(f"{API}/auth/sign-in", json={"username": "operator", "password": PASSWORD}).status_code == 200
        assert c.get(f"{API}/laydowns/1").json()["name"] == "Ring of radars"


def _system(**more):
    return {"id": "radar", "x": 10, "z": 0, "uplink": None, "cellBand": "B8", "jam": None, **more}


def _laydown_with(**more):
    spec = copy.deepcopy(SPEC)
    spec["structures"] = [_system(**more)]
    return laydown(spec=spec)


class TestUnitSettings:
    def test_keeps_a_units_settings_and_names(self, client):
        made = client.post(f"{API}/laydowns", json=_laydown_with(settings={"mount": 35, "threshold": "low"}, name="North mast", callsign="NORTH-1"))
        assert made.status_code == 201
        system = client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["structures"][0]
        assert system["settings"] == {"mount": 35, "threshold": "low"}
        assert (system["name"], system["callsign"]) == ("North mast", "NORTH-1")

    def test_keeps_a_radar_beam_below_the_horizon_its_arc_and_its_blanking_arcs(self, client):
        settings = {"elevLow": -10, "arc": 30, "blank": [[40, 80], [350, 10]], "clutter": "high"}
        made = client.post(f"{API}/laydowns", json=_laydown_with(settings=settings))
        assert made.status_code == 201
        assert client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["structures"][0]["settings"] == settings

    def test_keeps_a_detectors_sensitivity_library_and_direction_finding(self, client):
        settings = {"sensitivity": -106, "library": "commercial", "df": "sector", "monitored": ["control24", "video58"], "ibw": "narrow"}
        made = client.post(f"{API}/laydowns", json=_laydown_with(settings=settings))
        assert made.status_code == 201
        assert client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["structures"][0]["settings"] == settings

    def test_keeps_the_bands_a_jammer_is_fitted_for(self, client):
        settings = {"fitted": ["control24", "gnss"], "antenna": "sector", "facing": 90}
        made = client.post(f"{API}/laydowns", json=_laydown_with(settings=settings))
        assert made.status_code == 201
        assert client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["structures"][0]["settings"] == settings

    def test_keeps_a_jammers_receiver_technique_and_trigger_and_its_hand_switch(self, client):
        settings = {"receiver": "hobby", "technique": "reactive", "trigger": "manual"}
        made = client.post(f"{API}/laydowns", json=_laydown_with(settings=settings, on=True))
        assert made.status_code == 201
        system = client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["structures"][0]
        assert (system["settings"], system["on"]) == (settings, True)

    def test_keeps_the_conditions_and_refuses_unknown_ones(self, client):
        spec = copy.deepcopy(SPEC) | {"conditions": "night"}
        made = client.post(f"{API}/laydowns", json=laydown(spec=spec))
        assert made.status_code == 201
        assert client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["conditions"] == "night"
        assert client.post(f"{API}/laydowns", json=laydown(spec=spec | {"conditions": "fog"})).status_code == 422

    def test_a_laydown_saved_before_these_fields_still_loads(self, client):
        made = client.post(f"{API}/laydowns", json=_laydown_with())
        assert made.status_code == 201
        system = client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["structures"][0]
        assert not {"settings", "name", "callsign", "on"} & set(system)

    @pytest.mark.parametrize("bad", [
        {"settings": {"mount": -151}},
        {"settings": {"blank": [[0, 10]] * 4}},
        {"settings": {"blank": [[0, 360]]}},
        {"settings": {"blank": [[0, 10, 20]]}},
        {"settings": {"blank": [["north", 10]]}},
        {"settings": {"fitted": ["wifi"]}},
        {"settings": {"fitted": ["gnss"] * 5}},
        {"settings": {"mount": 1e13}},
        {"on": False},
        {"on": "yes"},
        {"settings": {"bad key": 1}},
        {"settings": {"threshold": "<script>"}},
        {"settings": {f"k{i}": 1 for i in range(17)}},
        {"name": "x" * 41},
        {"name": "two\nlines"},
        {"callsign": "<b>"},
        {"callsign": "x" * 13},
    ])
    def test_refuses_bad_settings_and_names(self, client, bad):
        assert client.post(f"{API}/laydowns", json=_laydown_with(**bad)).status_code == 422


class TestPeople:
    GROUP = {"x": 20, "z": -3.5, "count": 12, "protection": "bunker"}

    def _with(self, people):
        spec = copy.deepcopy(SPEC)
        spec["people"] = people
        return laydown(spec=spec)

    def test_keeps_a_laydowns_people(self, client):
        made = client.post(f"{API}/laydowns", json=self._with([self.GROUP]))
        assert made.status_code == 201
        assert client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["people"] == [self.GROUP]

    def test_keeps_soldiers_as_soldiers(self, client):
        soldiers = {**self.GROUP, "role": "military"}
        made = client.post(f"{API}/laydowns", json=self._with([soldiers, self.GROUP]))
        assert client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]["people"] == [soldiers, self.GROUP]

    def test_a_laydown_saved_before_people_comes_back_without_them(self, client):
        made = client.post(f"{API}/laydowns", json=laydown())
        assert "people" not in client.get(f"{API}/laydowns/{made.json()['id']}").json()["spec"]

    @pytest.mark.parametrize("change", [
        {"count": 0},
        {"count": 501},
        {"count": 1.5},
        {"protection": "tank"},
        {"role": "civilian"},
        {"role": "tank"},
        {"x": 351},
        {"extra": 1},
    ])
    def test_refuses_a_bad_group(self, client, change):
        assert client.post(f"{API}/laydowns", json=self._with([{**self.GROUP, **change}])).status_code == 422

    def test_refuses_too_many_groups(self, client):
        assert client.post(f"{API}/laydowns", json=self._with([self.GROUP] * 51)).status_code == 422
