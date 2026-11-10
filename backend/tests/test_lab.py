"""The lab's laydowns and report: signed-in only, read-only, plain file names only."""

import json

import pytest
from conftest import SPEC

API = "/api/v1/lab"


def write(folder, name, **over):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(json.dumps({"name": name, "world": "1", "game_version": "0.1.0", "spec": SPEC, **over}))


@pytest.fixture
def lab(tmp_path, monkeypatch):
    monkeypatch.setenv("SITE_GUARD_LAB", str(tmp_path / "lab"))
    return tmp_path / "lab"


def test_needs_a_signed_in_player(anon, lab):
    write(lab / "laydowns", "a.json")
    for path in ("", "/laydowns/a.json", "/report"):
        assert anon.get(API + path).status_code == 401


def test_lists_laydowns_best_first_and_skips_what_is_not_one(client, lab):
    laydowns = lab / "laydowns"
    write(laydowns, "plain.json")
    write(laydowns, "weak.json", lab={"waves": 12.5, "sites": 3})
    write(laydowns, "strong.json", lab={"waves": 27, "sites": 7})
    (laydowns / "broken.json").write_text("{not json")
    write(laydowns, "notalaydown.json", spec={"structures": "x"})
    (laydowns / "notes.txt").write_text("hello")
    body = client.get(API).json()
    assert [r["file"] for r in body["laydowns"]] == ["strong.json", "weak.json", "plain.json"]
    assert body["laydowns"][0]["systems"] == len(SPEC["structures"])
    assert body["laydowns"][2]["lab"] is None
    assert body["report"] is False


def test_empty_when_the_lab_has_not_run(client, lab):
    assert client.get(API).json() == {"laydowns": [], "report": False}


def test_serves_a_laydown_by_plain_name_only(client, lab):
    write(lab / "laydowns", "a.json")
    (lab / "secret.json").write_text(json.dumps({"spec": SPEC}))
    assert client.get(f"{API}/laydowns/a.json").json()["spec"] == SPEC
    assert client.get(f"{API}/laydowns/missing.json").status_code == 404
    for name in ("..%2Fsecret.json", "%2e%2e%2fsecret.json", ".hidden.json", "a.txt"):
        assert client.get(f"{API}/laydowns/{name}").status_code == 404, name


def test_the_report_alone_may_run_its_own_script(client, lab):
    assert client.get(f"{API}/report").status_code == 404
    lab.mkdir(parents=True)
    (lab / "report.html").write_text("<!doctype html><title>r</title><script>1</script>")
    assert client.get(API).json()["report"] is True
    res = client.get(f"{API}/report")
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/html")
    csp = res.headers["content-security-policy"]
    assert "script-src 'unsafe-inline'" in csp and "default-src 'none'" in csp and "connect-src" not in csp
    # every other response keeps the strict policy
    assert "unsafe-inline" not in client.get(API).headers["content-security-policy"]


def test_a_laydown_file_that_is_too_big_is_ignored(client, lab, monkeypatch):
    write(lab / "laydowns", "a.json")
    monkeypatch.setattr("app.routes.lab.MAX_FILE", 10)
    assert client.get(API).json()["laydowns"] == []
