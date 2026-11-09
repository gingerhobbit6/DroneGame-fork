"""Credential changes must win over requests that verified an older snapshot."""

import threading
from contextlib import closing

import pytest

from conftest import PASSWORD, sign_up

from app.db.account_stores import SqliteAccountStore
from app.db.connection import connect
from app.services import accounts


API = "/api/v1/auth"


def _race(db_path, monkeypatch, delayed, change):
    ready, release = threading.Event(), threading.Event()
    real_check = accounts.check_secret

    def pause_after_valid_hash(secret, stored):
        valid = real_check(secret, stored)
        if valid and threading.current_thread().name == "delayed-account-request":
            ready.set()
            if not release.wait(10):
                raise TimeoutError("the delayed request was not released")
        return valid

    monkeypatch.setattr(accounts, "check_secret", pause_after_valid_hash)
    result = {}
    with closing(connect(db_path)) as conn:
        service = accounts.AccountService(SqliteAccountStore(conn))

        def run():
            try:
                result["value"] = delayed(service)
            except BaseException as exc:
                result["error"] = exc

        thread = threading.Thread(target=run, name="delayed-account-request")
        thread.start()
        try:
            assert ready.wait(10), "the delayed request did not verify its credential"
            change()
        finally:
            release.set()
            thread.join(10)
        assert not thread.is_alive(), "the delayed request did not finish"
    return result


def test_old_password_cannot_start_a_session_after_password_change(anon, db_path, monkeypatch):
    assert sign_up(anon).status_code == 201

    def change():
        assert anon.post(f"{API}/password", json={"current_password": PASSWORD, "new_password": "new owner passphrase"}).status_code == 204

    result = _race(db_path, monkeypatch, lambda service: service.sign_in("operator", PASSWORD, True), change)
    assert isinstance(result.get("error"), accounts.SignInFailed)
    assert anon.get(f"{API}/me").status_code == 200  # the owner's session was kept


def test_old_password_cannot_start_a_session_after_recovery_reset(anon, db_path, monkeypatch):
    code = sign_up(anon).json()["recovery_code"]

    def change():
        assert anon.post(f"{API}/reset", json={"username": "operator", "recovery_code": code, "new_password": "new owner passphrase"}).status_code == 200

    result = _race(db_path, monkeypatch, lambda service: service.sign_in("operator", PASSWORD, True), change)
    assert isinstance(result.get("error"), accounts.SignInFailed)
    assert anon.get(f"{API}/me").status_code == 401  # reset revoked all sessions


@pytest.mark.parametrize("operation", ["sign-in", "reset"])
def test_a_correct_credential_reports_a_lock_added_while_hashing(anon, db_path, monkeypatch, operation):
    code = sign_up(anon).json()["recovery_code"]

    def lock_account():
        statuses = [
            anon.post(f"{API}/sign-in", json={"username": "operator", "password": "incorrect passphrase"}).status_code
            for _ in range(4)  # the paused valid attempt has already counted as one
        ]
        assert statuses == [401, 401, 401, 429]

    delayed = (
        (lambda service: service.sign_in("operator", PASSWORD, False))
        if operation == "sign-in" else
        (lambda service: service.reset("operator", code, "new owner passphrase"))
    )
    result = _race(db_path, monkeypatch, delayed, lock_account)
    assert isinstance(result.get("error"), accounts.Locked)
    assert result["error"].seconds > 0


def test_one_recovery_code_cannot_complete_two_resets(anon, db_path, monkeypatch):
    code = sign_up(anon).json()["recovery_code"]
    owner = {}

    def change():
        reply = anon.post(f"{API}/reset", json={"username": "operator", "recovery_code": code, "new_password": "new owner passphrase"})
        assert reply.status_code == 200
        owner["code"] = reply.json()["recovery_code"]

    result = _race(db_path, monkeypatch, lambda service: service.reset("operator", code, "late attacker passphrase"), change)
    assert isinstance(result.get("error"), accounts.SignInFailed)
    assert anon.post(f"{API}/reset", json={"username": "operator", "recovery_code": owner["code"], "new_password": "next owner passphrase"}).status_code == 200


def test_replaced_recovery_code_cannot_complete_a_pending_reset(anon, db_path, monkeypatch):
    code = sign_up(anon).json()["recovery_code"]
    owner = {}

    def change():
        reply = anon.post(f"{API}/recovery-code", json={"password": PASSWORD})
        assert reply.status_code == 200
        owner["code"] = reply.json()["recovery_code"]

    result = _race(db_path, monkeypatch, lambda service: service.reset("operator", code, "late attacker passphrase"), change)
    assert isinstance(result.get("error"), accounts.SignInFailed)
    assert anon.post(f"{API}/reset", json={"username": "operator", "recovery_code": owner["code"], "new_password": "new owner passphrase"}).status_code == 200


def test_old_password_cannot_delete_an_account_after_recovery_reset(anon, db_path, monkeypatch):
    code = sign_up(anon).json()["recovery_code"]
    with closing(connect(db_path)) as conn:
        old_id = conn.execute("SELECT id FROM users WHERE username = 'operator'").fetchone()[0]

    def change():
        assert anon.post(f"{API}/reset", json={"username": "operator", "recovery_code": code, "new_password": "new owner passphrase"}).status_code == 200

    result = _race(db_path, monkeypatch, lambda service: service.delete_account(old_id, PASSWORD), change)
    assert isinstance(result.get("error"), accounts.SignInFailed)
    with closing(connect(db_path)) as conn:
        assert conn.execute("SELECT id FROM users WHERE id = ?", (old_id,)).fetchone() is not None


@pytest.mark.parametrize("successor_name", ["successor", "operator"])
def test_deleted_account_id_and_old_sign_in_cannot_target_its_successor(anon, db_path, monkeypatch, successor_name):
    assert sign_up(anon).status_code == 201
    with closing(connect(db_path)) as conn:
        old_id = conn.execute("SELECT id FROM users WHERE username = 'operator'").fetchone()[0]
    successor = {}

    def change():
        assert anon.post(f"{API}/delete-account", json={"password": PASSWORD}).status_code == 204
        assert sign_up(anon, username=successor_name, password="successor passphrase").status_code == 201
        with closing(connect(db_path)) as conn:
            successor["id"] = conn.execute("SELECT id FROM users WHERE username = ?", (successor_name,)).fetchone()[0]

    result = _race(db_path, monkeypatch, lambda service: service.sign_in("operator", PASSWORD, False), change)
    assert successor["id"] != old_id
    assert isinstance(result.get("error"), accounts.SignInFailed)
