"""Everything the API must refuse, and what protects it from pages on other sites."""

import json
import re
from pathlib import Path

import pytest
from conftest import SPEC, figure_set, laydown, run, sign_up
from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas import MAX_COMMANDS, MAX_ESCORT_GAP, MAX_ESCORTS, MAX_PEOPLE_GROUPS, MAX_PEOPLE_PER_GROUP, MAX_SYSTEMS, CellBand, DroneTypeId, JamBand, PatrolVehicle, Protection, SystemId, Uplink
from app.security import MAX_BODY_BYTES

API = "/api/v1"
SYSTEM = SPEC["structures"][0]


def spec_with(**fields):
    return {**SPEC, "structures": [{**SYSTEM, **fields}]}


@pytest.mark.parametrize("name, body", [
    ("empty name", laydown(name="")),
    ("blank name", laydown(name="   ")),
    ("long name", laydown(name="x" * 101)),
    ("control character in name", laydown(name="a\nb")),
    ("long seed", laydown(world="x" * 65)),
    ("empty seed", laydown(world="")),
    ("control character in seed", laydown(world="a\x00b")),
    ("bad version", laydown(game_version="<script>")),
    ("unknown field", {**laydown(), "admin": True}),
    ("unknown system", laydown(spec=spec_with(id="nuke"))),
    ("unknown field in a system", laydown(spec=spec_with(owner="x"))),
    ("outside the world", laydown(spec=spec_with(x=1351))),
    ("outside the world, negative", laydown(spec=spec_with(z=-1351))),
    ("coordinate as text", laydown(spec=spec_with(x="1; DROP TABLE laydowns"))),
    ("unknown uplink", laydown(spec=spec_with(uplink="wifi"))),
    ("unknown band", laydown(spec=spec_with(cellBand="B99"))),
    ("unknown jam band", laydown(spec=spec_with(jam=["fm-radio"]))),
    ("too many systems", laydown(spec={**SPEC, "structures": [SYSTEM] * (MAX_SYSTEMS + 1)})),
    ("too many fusion uplinks", laydown(spec={**SPEC, "fusionUplinks": ["starlink"] * 3})),
    ("missing spec", {"name": "a", "world": "1", "game_version": "1"}),
    ("wrong shape", []),
])
def test_bad_laydowns_are_refused(client, name, body):
    assert client.post(f"{API}/laydowns", json=body).status_code == 422, name
    assert client.get(f"{API}/laydowns").json() == []


@pytest.mark.parametrize("name, over", [
    ("too many commands", {"commands": [{"step": 0, "name": "a", "args": []}] * (MAX_COMMANDS + 1)}),
    ("command with odd name", {"commands": [{"step": 0, "name": "a;b", "args": []}]}),
    ("negative step", {"commands": [{"step": -1, "name": "a", "args": []}]}),
    ("too many arguments", {"commands": [{"step": 0, "name": "a", "args": [1] * 9}]}),
    ("bad digest", {"digest": "not-hex"}),
    ("negative kills", {"kills": -1}),
    ("impossible health", {"health": 101}),
    ("absurd money", {"capex": 1e11}),
    ("negative figure", {"figures": {"world": {"rangeScale": -1}}}),
    ("figure as text", {"figures": {"structures": {"radar": {"cost": "free"}}}}),
    ("unknown figure group", {"figures": {"secrets": {}}}),
    ("odd figure key", {"figures": {"structures": {"../etc": {"cost": 1}}}}),
    ("too many figures", {"figures": {"structures": {"radar": {f"k{i}": 1 for i in range(41)}}}}),
])
def test_bad_runs_are_refused(client, name, over):
    assert client.post(f"{API}/runs", json=run(**over)).status_code == 422, name


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_numbers_must_be_finite(client, value):
    body = json.dumps(run()).replace('"budget_left": 8902451.0', f'"budget_left": {value}')
    assert value in body
    assert client.post(f"{API}/runs", content=body, headers={"content-type": "application/json"}).status_code == 422


def test_refusals_do_not_echo_the_input(client):
    response = client.post(f"{API}/laydowns", json=laydown(name="x" * 101, secret="s3cret-value"))
    assert response.status_code == 422
    assert "s3cret-value" not in response.text and "xxxxx" not in response.text


def test_broken_json_is_refused(client):
    assert client.post(f"{API}/laydowns", content="{not json", headers={"content-type": "application/json"}).status_code == 422


def test_hostile_text_is_stored_as_plain_data(client):
    hostile = "'); DROP TABLE laydowns; --"
    assert client.post(f"{API}/laydowns", json=laydown(name=hostile, world=hostile[:60])).status_code == 201
    assert client.get(f"{API}/laydowns/1").json()["name"] == hostile
    assert len(client.get(f"{API}/laydowns").json()) == 1
    assert client.post(f"{API}/figure-sets", json=figure_set(name="<img src=x onerror=alert(1)>")).json()["name"] == "<img src=x onerror=alert(1)>"


def test_sql_only_ever_uses_bound_parameters():
    source = (Path(__file__).parent.parent / "app" / "db" / "stores.py").read_text(encoding="utf-8")
    f_strings = re.findall(r'execute\(\s*f"([^"]*)"', source)
    assert f_strings == ["SELECT {_RUN_SUMMARY} FROM runs ORDER BY finished_at DESC, id DESC LIMIT ? OFFSET ?"]  # a fixed column list
    assert ".format(" not in source and " % " not in source


@pytest.mark.parametrize("path", ["laydowns/abc", "laydowns/0", "laydowns/-1", "runs/1.5", "runs/99999999999999999999", "figure-sets/1;DROP"])
def test_bad_ids_are_refused(client, path):
    assert client.get(f"{API}/{path}").status_code == 422


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}, {"limit": "all"}, {"offset": 10 ** 30}])
def test_bad_paging_is_refused(client, params):
    assert client.get(f"{API}/runs", params=params).status_code == 422


class TestHosts:
    @pytest.mark.parametrize("host", ["evil.example", "localhost.evil.example", "192.168.1.5", "[::1]"])
    def test_a_rebound_name_is_refused(self, client, host):
        assert client.get(f"{API}/health", headers={"host": host}).status_code == 400

    @pytest.mark.parametrize("host", ["localhost", "localhost:8000", "127.0.0.1:8000"])
    def test_local_names_are_allowed(self, client, host):
        assert client.get(f"{API}/health", headers={"host": host}).status_code == 200


class TestCrossSite:
    @pytest.mark.parametrize("content_type", ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/jsonp", None])
    def test_only_json_can_be_written(self, client, content_type):
        headers = {"content-type": content_type} if content_type else {}
        response = client.post(f"{API}/laydowns", content=json.dumps(laydown()), headers=headers)
        assert response.status_code == 415
        assert client.get(f"{API}/laydowns").json() == []

    def test_json_with_a_charset_is_fine(self, client):
        response = client.post(f"{API}/laydowns", content=json.dumps(laydown()), headers={"content-type": "application/json; charset=utf-8"})
        assert response.status_code == 201

    def test_no_cors_is_offered(self, client):
        response = client.get(f"{API}/health", headers={"origin": "https://evil.example"})
        assert "access-control-allow-origin" not in response.headers
        preflight = client.options(f"{API}/laydowns", headers={"origin": "https://evil.example", "access-control-request-method": "POST"})
        assert "access-control-allow-origin" not in preflight.headers
        assert preflight.status_code in (405, 415)


class TestSize:
    def test_a_declared_large_body_is_refused(self, client):
        body = "x" * (MAX_BODY_BYTES + 1)
        assert client.post(f"{API}/laydowns", content=body, headers={"content-type": "application/json"}).status_code == 413

    def test_a_large_body_that_hides_its_size_is_refused(self, client):
        def chunks():
            for _ in range(11):
                yield b"x" * (100 * 1024)
        response = client.post(f"{API}/laydowns", content=chunks(), headers={"content-type": "application/json"})
        assert response.status_code == 413

    def test_a_bogus_length_is_refused(self, client):
        assert client.post(f"{API}/laydowns", content=b"{}", headers={"content-type": "application/json", "content-length": "banana"}).status_code in (400, 413)

    def test_the_largest_real_run_fits(self, client):
        commands = [{"step": i, "name": "toggleJamBand", "args": [{"node": "x" * 36}, "gnss", True]} for i in range(5000)]
        assert client.post(f"{API}/runs", json=run(commands=commands)).status_code == 201


class TestHeaders:
    def test_every_response_carries_them_even_refusals(self, client):
        for response in [client.get(f"{API}/health"), client.get(f"{API}/laydowns/99"), client.get(f"{API}/health", headers={"host": "evil.example"}),
                         client.post(f"{API}/laydowns", content="x", headers={"content-type": "text/plain"})]:
            assert "default-src 'none'" in response.headers["content-security-policy"]
            assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
            assert response.headers["x-content-type-options"] == "nosniff"
            assert response.headers["referrer-policy"] == "no-referrer"

    def test_interactive_docs_are_off(self, client):
        assert client.get("/docs").status_code == 404
        assert client.get("/redoc").status_code == 404

    def test_nothing_else_is_served(self, client, db_path):
        for path in [f"/{db_path.name}", "/data/test.db", "/app/main.py", "/../pyproject.toml", "/.git/config"]:
            assert client.get(path).status_code == 404, path


class TestServingTheGame:
    @pytest.fixture
    def game(self, tmp_path):
        folder = tmp_path / "dist"
        (folder / "assets").mkdir(parents=True)
        (folder / "index.html").write_text("<!doctype html><title>Site Guard</title>", encoding="utf-8")
        (folder / "assets" / "index.js").write_text("console.log(1)", encoding="utf-8")
        (tmp_path / "secret.db").write_text("private", encoding="utf-8")
        return folder

    @pytest.fixture
    def site(self, game, tmp_path):
        with TestClient(create_app(tmp_path / "data" / "t.db", game=game), base_url="http://localhost") as c:
            sign_up(c)
            yield c

    def test_the_game_and_the_api_share_one_origin(self, site):
        page = site.get("/")
        assert page.status_code == 200 and "Site Guard" in page.text
        assert site.get("/assets/index.js").status_code == 200
        assert site.get(f"{API}/health").json() == {"status": "ok"}
        assert site.post(f"{API}/laydowns", json=laydown()).status_code == 201

    def test_the_page_gets_the_protections_too(self, site):
        headers = site.get("/").headers
        assert "script-src 'self'" in headers["content-security-policy"]
        assert "unsafe-inline" not in headers["content-security-policy"]
        assert headers["x-content-type-options"] == "nosniff"
        assert site.get("/", headers={"host": "evil.example"}).status_code == 400

    @pytest.mark.parametrize("path", ["/secret.db", "/../secret.db", "/..%2Fsecret.db", "/%2e%2e/secret.db", "/assets/../../secret.db", "/data/t.db", "/app/main.py", "/assets/"])
    def test_only_the_built_game_is_reachable(self, site, path):
        response = site.get(path)
        assert "private" not in response.text
        assert response.status_code == 404, path

    def test_writes_cannot_reach_the_files(self, site):
        assert site.post("/index.html", content="{}", headers={"content-type": "application/json"}).status_code == 405

    def test_says_how_to_build_when_it_is_not_built(self, client):
        response = client.get("/")
        assert response.status_code == 503
        assert "npm --prefix frontend run build" in response.json()["detail"]


def test_the_database_path_can_come_from_the_environment(tmp_path, monkeypatch):
    path = tmp_path / "from-env.db"
    monkeypatch.setenv("SITE_GUARD_DB", str(path))
    with TestClient(create_app(), base_url="http://localhost") as c:
        sign_up(c)
        assert c.post(f"{API}/laydowns", json=laydown()).status_code == 201
    assert path.exists()


def test_every_drone_the_waves_can_send_fits_the_shape_a_save_allows():
    """A saved attack mix is checked by shape only, so every drone id the game has must fit that shape."""
    config = Path(__file__).parent.parent.parent / "frontend" / "src" / "sim" / "config"
    drones = "".join((config / name).read_text(encoding="utf-8") for name in ("drones.js", "real-drones.js", "real-drones-extra.js"))
    ids = re.findall(r"^  (\w+): \{$", drones, re.M)
    assert len(ids) > 20
    pattern = DroneTypeId.__metadata__[0].pattern
    assert [i for i in ids if not re.fullmatch(pattern, i)] == []


def test_the_names_the_api_accepts_match_the_game():
    """The backend does not import the frontend, so check its config directly: this fails if a system or band is added on one side only."""
    config = Path(__file__).parent.parent.parent / "frontend" / "src" / "sim" / "config"
    systems = "".join((config / name).read_text(encoding="utf-8") for name in ("sensors.js", "effectors.js", "uk-systems.js", "eu-systems.js", "crew.js"))
    comms = (config / "comms.js").read_text(encoding="utf-8")
    assert set(re.findall(r"^  (\w+): \{$", systems, re.M)) == set(SystemId.__args__)
    assert set(Uplink.__args__) <= set(re.findall(r"^  (\w+): \{$", comms, re.M))
    assert set(CellBand.__args__) == set(re.findall(r"^      (\w+): \{ label: '(?:Band|n)", comms, re.M))
    assert set(JamBand.__args__) == set(re.findall(r"^    (\w+): \{ label: ", comms, re.M))
    people = (config / "people.js").read_text(encoding="utf-8")
    levels, roles = people.split("export const PEOPLE_ROLES")
    assert set(Protection.__args__) == set(re.findall(r"^  (\w+): \{ name: ", levels, re.M))
    assert {"military"} == set(re.findall(r"^  (\w+): \{ name: ", roles, re.M)) - {"civilian"}  # civilians are saved with no role
    assert f"groups: {MAX_PEOPLE_GROUPS}, perGroup: {MAX_PEOPLE_PER_GROUP}" in people
    assert f"maxSystems: {MAX_SYSTEMS} }}" in (config / "world.js").read_text(encoding="utf-8")  # the game stops placing before a save would be refused
    patrol = (config / "patrol.js").read_text(encoding="utf-8")
    vehicles = patrol.split("export const PATROL_VEHICLES")[1].split("};")[0]
    assert set(PatrolVehicle.__args__) == set(re.findall(r"^  (\w+): \{ name: ", vehicles, re.M))
    assert f"MAX_ESCORTS = {MAX_ESCORTS};" in patrol and f"MAX_ESCORT_GAP = {MAX_ESCORT_GAP};" in patrol
