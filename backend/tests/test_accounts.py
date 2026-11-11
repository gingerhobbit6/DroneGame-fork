"""Accounts: signing up, in and out, lockout, recovery codes, and every other endpoint staying behind a session."""

import re
import sqlite3
import time
from contextlib import closing
from pathlib import Path

import pytest
from conftest import PASSWORD, laydown, sign_up

from app.db.account_stores import SqliteAccountStore
from app.db.connection import connect
from app.services import accounts

API = "/api/v1/auth"
REAL_SCRYPT = dict(accounts.SCRYPT)  # read at import, before conftest lowers the cost for each test


def sign_in(c, username="operator", password=PASSWORD, **more):
    return c.post(f"{API}/sign-in", json={"username": username, "password": password, **more})


def cookie_header(response):
    return response.headers["set-cookie"].lower()


@pytest.fixture
def clock(monkeypatch):
    """Moves the accounts' clock forward without waiting."""
    now = [time.time()]
    monkeypatch.setattr(accounts.time, "time", lambda: now[0])
    return now


class TestSigningUp:
    def test_signs_in_and_shows_the_recovery_code_once(self, anon):
        made = sign_up(anon)
        assert made.status_code == 201
        body = made.json()
        assert body["user"]["username"] == "operator" and body["user"]["display_name"] == "Test Operator"
        assert body["user"]["id"] == anon.get(f"{API}/me").json()["id"]
        assert re.fullmatch(r"[A-Z2-7]{6}(-[A-Z2-7]{6}){3}", body["recovery_code"])
        header = cookie_header(made)
        assert "httponly" in header and "samesite=strict" in header and "path=/api" in header
        assert "max-age" not in header  # gone when the browser closes
        assert anon.get(f"{API}/me").json()["username"] == "operator"
        assert "recovery_code" not in anon.get(f"{API}/me").json()

    def test_a_username_is_taken_whatever_its_case(self, anon):
        sign_up(anon)
        assert sign_up(anon, username="OPERATOR").status_code == 409

    @pytest.mark.parametrize("over", [
        {"password": "short"},
        {"password": "x" * 129},
        {"username": "ab"},
        {"username": "has space"},
        {"username": "-leading"},
        {"username": "a" * 33},
        {"display_name": ""},
        {"display_name": "bad\x00name"},
        {"password": "operator1234", "username": "operator1234"},
        {"admin": True},
    ])
    def test_bad_sign_ups_are_refused(self, anon, over):
        body = {"username": "operator", "display_name": "Op", "password": PASSWORD, **over}
        assert anon.post(f"{API}/register", json=body).status_code == 422
        assert anon.get(f"{API}/me").status_code == 401

    def test_the_server_has_a_limit(self, anon, monkeypatch):
        monkeypatch.setattr(accounts, "MAX_ACCOUNTS", 1)
        sign_up(anon)
        assert sign_up(anon, username="second").status_code == 403

    def test_no_secret_is_stored_as_written(self, anon, db_path):
        code = sign_up(anon).json()["recovery_code"]
        token = anon.cookies["sg_session"]
        with closing(sqlite3.connect(db_path)) as conn:
            dump = "\n".join(conn.iterdump())
        for secret in (PASSWORD, code, code.replace("-", ""), token):
            assert secret not in dump


class TestSigningIn:
    def test_right_password_signs_in_and_wrong_ones_do_not(self, anon):
        assert sign_up(anon).json()["user"]["last_sign_in"]  # signing up signs in
        anon.post(f"{API}/sign-out", json={})
        wrong, unknown = sign_in(anon, password="wrong password"), sign_in(anon, username="nobody")
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json() == unknown.json()  # never says which part was wrong
        assert anon.get(f"{API}/me").status_code == 401
        signed = sign_in(anon, username="Operator")
        assert signed.status_code == 200 and signed.json()["last_sign_in"]
        assert anon.get(f"{API}/me").status_code == 200

    def test_remember_me_keeps_the_cookie_for_30_days(self, anon):
        sign_up(anon)
        assert f"max-age={30 * 24 * 3600}" in cookie_header(sign_in(anon, remember=True))

    def test_signing_out_ends_the_session_on_the_server(self, anon):
        sign_up(anon)
        token = anon.cookies["sg_session"]
        out = anon.post(f"{API}/sign-out", json={})
        assert out.status_code == 204 and 'sg_session=""' in out.headers["set-cookie"]
        anon.cookies.set("sg_session", token, domain="localhost.local", path="/api")
        assert anon.get(f"{API}/me").status_code == 401  # a copy of the old cookie is useless
        assert anon.post(f"{API}/sign-out", json={}).status_code == 204  # and signing out twice is harmless

    def test_five_failures_lock_the_account_for_five_minutes(self, anon, clock):
        sign_up(anon)
        anon.post(f"{API}/sign-out", json={})
        for _ in range(4):
            assert sign_in(anon, password="wrong password").status_code == 401
        locked = sign_in(anon, password="wrong password")
        assert locked.status_code == 429 and locked.headers["retry-after"] == "300"
        assert sign_in(anon).status_code == 429  # even the right password, until it passes
        clock[0] += 301
        assert sign_in(anon).status_code == 200

    def test_a_session_expires(self, anon, clock):
        sign_up(anon)
        clock[0] += accounts.SESSION_SECONDS + 1
        assert anon.get(f"{API}/me").status_code == 401

    def test_a_made_up_session_is_refused(self, anon):
        anon.cookies.set("sg_session", "made-up", domain="localhost.local", path="/api")
        assert anon.get(f"{API}/me").status_code == 401


OPEN = {("GET", "/api/v1/health"), *(("POST", f"{API}/{name}") for name in ("register", "sign-in", "sign-out", "reset"))}


class TestEverythingElseNeedsASession:
    def test_every_route_but_signing_in_is_refused_without_one(self, anon):
        # Every route in the schema, so a router added without the session check fails here rather than going out open.
        routes = [(method.upper(), path) for path, ops in anon.app.openapi()["paths"].items() for method in ops]
        assert OPEN <= set(routes) and len(routes) > 30
        for method, path in sorted(set(routes) - OPEN):
            reply = anon.request(method, re.sub(r"\{[^}]+\}", "1", path), json={})
            assert reply.status_code == 401, f"{method} {path} answered {reply.status_code} without a session"

    def test_writes_are_refused_without_one(self, anon):
        assert anon.post("/api/v1/laydowns", json=laydown()).status_code == 401
        assert anon.put(f"{API}/me", json={"display_name": "x"}).status_code == 401

    def test_health_stays_open(self, anon):
        assert anon.get("/api/v1/health").json() == {"status": "ok"}

    def test_answers_are_never_cached(self, client):
        assert client.get(f"{API}/me").headers["cache-control"] == "no-store"


class TestRecovery:
    def test_the_recovery_code_resets_the_password_and_is_then_replaced(self, anon):
        code = sign_up(anon).json()["recovery_code"]
        reset = anon.post(f"{API}/reset", json={"username": "operator", "recovery_code": f" {code.lower()} ", "new_password": "a brand new passphrase"})
        assert reset.status_code == 200
        fresh = reset.json()["recovery_code"]
        assert fresh != code
        assert anon.get(f"{API}/me").status_code == 401  # every session is signed out
        assert sign_in(anon).status_code == 401
        assert sign_in(anon, password="a brand new passphrase").status_code == 200
        again = {"username": "operator", "recovery_code": code, "new_password": "another passphrase"}
        assert anon.post(f"{API}/reset", json=again).status_code == 401  # each code works once
        assert anon.post(f"{API}/reset", json={**again, "recovery_code": fresh}).status_code == 200

    def test_guessing_codes_counts_towards_the_lockout(self, anon):
        sign_up(anon)
        guess = {"username": "operator", "recovery_code": "AAAAAA-AAAAAA-AAAAAA-AAAAAA", "new_password": "a brand new passphrase"}
        codes = [anon.post(f"{API}/reset", json=guess).status_code for _ in range(5)]
        assert codes == [401, 401, 401, 401, 429]
        assert anon.post(f"{API}/reset", json={**guess, "username": "nobody"}).status_code == 401

    def test_a_new_code_needs_the_password(self, client):
        assert client.post(f"{API}/recovery-code", json={"password": "wrong password"}).status_code == 401
        made = client.post(f"{API}/recovery-code", json={"password": PASSWORD})
        assert made.status_code == 200
        reset = {"username": "operator", "recovery_code": made.json()["recovery_code"], "new_password": "a brand new passphrase"}
        assert client.post(f"{API}/reset", json=reset).status_code == 200


    def test_a_new_password_is_never_the_username(self, anon):
        code = sign_up(anon, username="sergeant01").json()["recovery_code"]
        same = anon.post(f"{API}/password", json={"current_password": PASSWORD, "new_password": "SERGEANT01"})
        assert same.status_code == 422 and "username" in same.json()["detail"]
        assert anon.post(f"{API}/reset", json={"username": "sergeant01", "recovery_code": code, "new_password": "Sergeant01"}).status_code == 422
        assert sign_in(anon, username="sergeant01").status_code == 200  # the password stayed as it was


class TestProfile:
    def test_edits_the_profile(self, client):
        made = client.put(f"{API}/me", json={"display_name": " Sgt Smith ", "rank": "Sergeant", "organisation": "16 Regiment RA"})
        assert made.status_code == 200
        assert {k: made.json()[k] for k in ("display_name", "rank", "organisation")} == {"display_name": "Sgt Smith", "rank": "Sergeant", "organisation": "16 Regiment RA"}
        assert client.get(f"{API}/me").json()["rank"] == "Sergeant"

    @pytest.mark.parametrize("body", [{"display_name": ""}, {"display_name": "x", "rank": "r" * 61}, {"display_name": "x", "username": "boss"}, {"display_name": "a\nb"}])
    def test_bad_edits_are_refused(self, client, body):
        assert client.put(f"{API}/me", json=body).status_code == 422

    def test_changing_the_password_signs_out_everywhere_else(self, client, anon):
        other = sign_in(client)  # a second session for the same account, as from another browser
        other_token = other.cookies["sg_session"]
        assert client.post(f"{API}/password", json={"current_password": "wrong password", "new_password": "a brand new passphrase"}).status_code == 401
        assert client.post(f"{API}/password", json={"current_password": PASSWORD, "new_password": "a brand new passphrase"}).status_code == 204
        assert client.get(f"{API}/me").status_code == 200  # this session stays
        assert client.post(f"{API}/sign-out", json={}).status_code == 204
        client.cookies.set("sg_session", other_token, domain="localhost.local", path="/api")
        assert client.get(f"{API}/me").status_code == 401
        assert sign_in(client, password="a brand new passphrase").status_code == 200


class TestDeletingAnAccount:
    def test_needs_the_password_then_takes_its_sessions_and_packs(self, client, db_path):
        client.post("/api/v1/units", json={"name": "1 Troop", "echelon": "troop", "callsign": None, "assets": {"systems": [], "vehicles": [], "people": []}})
        client.post("/api/v1/laydowns", json=laydown())
        other = sign_in(client).cookies["sg_session"]  # a second session, as from another browser
        assert client.post(f"{API}/delete-account", json={"password": "wrong password"}).status_code == 401
        assert client.get(f"{API}/me").status_code == 200

        gone = client.post(f"{API}/delete-account", json={"password": PASSWORD})
        assert gone.status_code == 204 and 'sg_session=""' in gone.headers["set-cookie"]
        with closing(connect(db_path)) as db:
            assert [db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("users", "sessions", "units", "laydowns")] == [0, 0, 0, 1]  # shared saves stay
        client.cookies.set("sg_session", other, domain="localhost.local", path="/api")
        assert client.get(f"{API}/me").status_code == 401
        assert sign_in(client).status_code == 401
        assert sign_up(client).status_code == 201  # the name is free again

    def test_refused_without_a_session(self, anon):
        assert anon.post(f"{API}/delete-account", json={"password": PASSWORD}).status_code == 401


def test_tries_made_at_the_same_moment_still_lock_the_account(db_path, anon, monkeypatch):
    """Tries sent at once used to each write back their count after the slow hash, overwriting the others' and the lock."""
    sign_up(anon)
    with closing(connect(db_path)) as conn:
        service, real, burst = accounts.AccountService(SqliteAccountStore(conn)), accounts.check_secret, []

        def slow_hash(secret, stored):  # ten more tries land while the first is still hashing
            if not burst:
                burst.append(True)
                for _ in range(10):
                    with pytest.raises((accounts.SignInFailed, accounts.Locked)):
                        service.sign_in("operator", "wrong password", False)
            return real(secret, stored)

        monkeypatch.setattr(accounts, "check_secret", slow_hash)
        with pytest.raises(accounts.SignInFailed):
            service.sign_in("operator", "wrong password", False)
        with pytest.raises(accounts.Locked):
            service.sign_in("operator", PASSWORD, False)


def test_the_hash_cost_is_one_owasp_lists():
    n, r, p = REAL_SCRYPT["n"], REAL_SCRYPT["r"], REAL_SCRYPT["p"]
    assert r >= 8 and (n >= 2**17 or (n >= 2**14 and p >= 5))


def test_a_hash_made_at_the_old_cost_still_verifies(monkeypatch):
    monkeypatch.setattr(accounts, "SCRYPT", {"n": 2**14, "r": 8, "p": 1})
    stored = accounts.hash_secret(PASSWORD)
    monkeypatch.setattr(accounts, "SCRYPT", REAL_SCRYPT)
    assert stored.startswith("scrypt$16384$8$1$")
    assert accounts.check_secret(PASSWORD, stored) and not accounts.check_secret("wrong password", stored)


def test_account_sql_only_ever_uses_bound_parameters():
    source = (Path(__file__).parent.parent / "app" / "db" / "account_stores.py").read_text(encoding="utf-8")
    assert ".format(" not in source and " % " not in source
    f_strings = re.findall(r'execute\(\s*f"([^"]*)"', source)
    assert f_strings == [  # fixed column lists, and update()'s names, which it checks against a fixed set first
        "SELECT {_PROFILE} FROM users WHERE id = ?",
        "UPDATE users SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
        "SELECT {_UNIT_SUMMARY} FROM units WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
        "SELECT {_UNIT_SUMMARY}, assets FROM units WHERE id = ? AND user_id = ?",
    ]


def test_only_known_columns_can_be_updated(db_path, anon):
    sign_up(anon)
    with closing(sqlite3.connect(db_path)) as conn:
        with pytest.raises(ValueError):
            SqliteAccountStore(conn).update(1, **{"username = 'x', display_name": "y"})
        with pytest.raises(ValueError):
            SqliteAccountStore(conn).update(1)
        for field in ("password_hash", "recovery_hash"):
            with pytest.raises(ValueError):
                SqliteAccountStore(conn).update(1, **{field: "unsafe bypass"})
