"""The application: stores saved laydowns, run history and tuning, and serves the built game. It takes no part in live play."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.db.connection import open_database
from app.routes.api import router
from app.routes.auth import router as auth_router
from app.routes.auth import signed_in
from app.routes.lab import router as lab_router
from app.routes.packs import router as packs_router
from app.routes.units import router as units_router
from app.security import ALLOWED_HOSTS, RequestGuard, SecurityHeaders
from app.services.accounts import Full, Locked, SameAsUsername, SignInFailed, Taken
from app.services.packs import PackBuilder, PackLibrary
from app.services.records import NotFound
from app.services.units import TooMany

BACKEND = Path(__file__).parent.parent
DEFAULT_DB = BACKEND / "data" / "siteguard.db"
DEFAULT_GAME = BACKEND.parent / "frontend" / "dist"


def create_app(db_path: Path | None = None, game: Path = DEFAULT_GAME) -> FastAPI:
    path = db_path or Path(os.environ.get("SITE_GUARD_DB", DEFAULT_DB))

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        open_database(path)
        running_builder = app.state.pack_builder
        try:
            yield
        finally:
            running_builder.stop()

    # Interactive docs are off because they load scripts from a CDN, and this works offline. The schema is at /api/v1/openapi.json.
    app = FastAPI(title="Bombadil", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url="/api/v1/openapi.json")
    app.state.db_path = path
    app.state.packs = PackLibrary()
    app.state.pack_builder = PackBuilder(app.state.packs)
    # everything but health and signing in needs a session; saves stay shared between accounts, packs are each account's own
    app.include_router(auth_router)
    app.include_router(router, dependencies=[Depends(signed_in)])
    app.include_router(packs_router, dependencies=[Depends(signed_in)])
    app.include_router(lab_router, dependencies=[Depends(signed_in)])
    app.include_router(units_router)

    @app.exception_handler(NotFound)
    async def not_found(_: Request, __: NotFound) -> JSONResponse:
        return JSONResponse({"detail": "Not found"}, status_code=404)

    refusals = {
        SignInFailed: (401, "Wrong username, password or recovery code"),
        Taken: (409, "That username is taken"),
        SameAsUsername: (422, "The new password must not be the username"),
        Full: (403, "This server has as many accounts as it allows"),
        TooMany: (409, "You have as many deployment packs as you may keep. Delete one first."),
    }
    for kind, (code, detail) in refusals.items():
        app.add_exception_handler(kind, lambda _, __, code=code, detail=detail: JSONResponse({"detail": detail}, status_code=code))

    @app.exception_handler(Locked)
    async def locked(_: Request, exc: Locked) -> JSONResponse:
        minutes = -(-exc.seconds // 60)
        return JSONResponse({"detail": f"Too many failed attempts. Try again in {minutes} minute{'s' if minutes > 1 else ''}."}, status_code=429, headers={"Retry-After": str(exc.seconds)})

    @app.exception_handler(RequestValidationError)
    async def invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
        # says what is wrong and where, without echoing the input back
        return JSONResponse({"detail": [{"loc": e["loc"], "msg": e["msg"]} for e in exc.errors()]}, status_code=422)

    # Only the built game is served, never the project folder, so the database and source stay out of reach.
    if game.is_dir():
        app.mount("/", StaticFiles(directory=game, html=True))
    else:
        @app.get("/", include_in_schema=False)
        async def not_built() -> JSONResponse:
            return JSONResponse({"detail": "The game has not been built yet. Run: npm --prefix frontend run build"}, status_code=503)

    app.add_middleware(RequestGuard)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)  # stops DNS rebinding
    app.add_middleware(SecurityHeaders)  # outermost, so refusals get the headers too
    return app


app = create_app()
