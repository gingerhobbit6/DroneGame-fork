"""Signing in and out, the profile, and the `signed_in` check every other endpoint sits behind. HTTP only: the rules are in
services/accounts.py.

The session is an HttpOnly, SameSite=Strict cookie, so page scripts cannot read it and other sites cannot send it. It is not marked
Secure because the game is served over plain http on localhost, where browsers would otherwise drop it."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.account_schemas import ChangePassword, ConfirmPassword, NewRecoveryCode, Profile, ProfileIn, Register, Registered, Reset, SignIn
from app.db.account_stores import SqliteAccountStore
from app.routes.api import Connection
from app.services.accounts import AccountService

router = APIRouter(prefix="/api/v1")
COOKIE = "sg_session"
NO_CONTENT = status.HTTP_204_NO_CONTENT


def accounts(conn: Connection) -> AccountService:
    return AccountService(SqliteAccountStore(conn))


Accounts = Annotated[AccountService, Depends(accounts)]


def signed_in(request: Request, service: Accounts) -> int:
    user_id = service.user_for(request.cookies.get(COOKIE))
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in first")
    return user_id


UserId = Annotated[int, Depends(signed_in)]


def _keep_session(response: Response, token: str, lasts: int, remember: bool) -> None:
    # without "remember me" it is a browser-session cookie, and the server forgets it after SESSION_SECONDS anyway
    response.set_cookie(COOKIE, token, max_age=lasts if remember else None, httponly=True, samesite="strict", path="/api")


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
def register(body: Register, response: Response, service: Accounts) -> Registered:
    user_id, code = service.register(body.username, body.display_name, body.password)
    token, lasts = service.start_session(user_id)
    _keep_session(response, token, lasts, remember=False)
    return Registered(user=service.profile(user_id), recovery_code=code)


@router.post("/auth/sign-in")
def sign_in(body: SignIn, response: Response, service: Accounts) -> Profile:
    user_id, token, lasts = service.sign_in(body.username, body.password, body.remember)
    _keep_session(response, token, lasts, body.remember)
    return service.profile(user_id)


def _signed_out() -> Response:
    response = Response(status_code=NO_CONTENT)
    response.delete_cookie(COOKIE, path="/api", httponly=True, samesite="strict")
    return response


@router.post("/auth/sign-out", status_code=NO_CONTENT)
def sign_out(request: Request, service: Accounts) -> Response:
    token = request.cookies.get(COOKIE)
    if token:
        service.sign_out(token)
    return _signed_out()


@router.post("/auth/reset")
def reset(body: Reset, service: Accounts) -> NewRecoveryCode:
    return NewRecoveryCode(recovery_code=service.reset(body.username, body.recovery_code, body.new_password))


@router.get("/auth/me")
def me(user_id: UserId, service: Accounts) -> Profile:
    return service.profile(user_id)


@router.put("/auth/me")
def update_me(body: ProfileIn, user_id: UserId, service: Accounts) -> Profile:
    return service.update_profile(user_id, body.model_dump())


@router.post("/auth/password", status_code=NO_CONTENT)
def change_password(body: ChangePassword, request: Request, user_id: UserId, service: Accounts) -> Response:
    service.change_password(user_id, body.current_password, body.new_password, request.cookies[COOKIE])
    return Response(status_code=NO_CONTENT)


@router.post("/auth/delete-account", status_code=NO_CONTENT)  # POST, so the JSON-only guard covers it as it does every write
def delete_account(body: ConfirmPassword, user_id: UserId, service: Accounts) -> Response:
    service.delete_account(user_id, body.password)
    return _signed_out()


@router.post("/auth/recovery-code")
def replace_recovery_code(body: ConfirmPassword, user_id: UserId, service: Accounts) -> NewRecoveryCode:
    return NewRecoveryCode(recovery_code=service.replace_recovery_code(user_id, body.password))
