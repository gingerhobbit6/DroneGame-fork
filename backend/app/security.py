"""Protections for a local service: a page on another site must not be able to read or change anything here, even while someone
is signed in (the session cookie is SameSite=Strict as well)."""

import os

from starlette.datastructures import MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Only this machine by default. To reach it through a proxy such as `tailscale serve`, list the extra hostname(s) in
# SITEGUARD_EXTRA_HOSTS (comma separated). The server itself stays bound to 127.0.0.1.
EXTRA_HOSTS = [h.strip() for h in os.environ.get("SITEGUARD_EXTRA_HOSTS", "").split(",") if h.strip()]
ALLOWED_HOSTS = ["localhost", "127.0.0.1", *EXTRA_HOSTS]
MAX_BODY_BYTES = 1024 * 1024
HEADERS = {
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://tile.openstreetmap.org https://tiles.maps.eox.at; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
}


class RequestGuard:
    """Refuses a write that is not JSON (a cross-site form cannot send JSON without a CORS check, and there is no CORS here) and any
    body over the limit, whatever Content-Length claims."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.lower(): v for k, v in scope["headers"]}
        if scope["method"] in {"POST", "PUT", "PATCH"} and headers.get(b"content-type", b"").split(b";")[0].strip() != b"application/json":
            await JSONResponse({"detail": "Send JSON"}, status_code=415)(scope, receive, send)
            return
        declared = headers.get(b"content-length", b"0")
        if not declared.isdigit() or int(declared) > MAX_BODY_BYTES:
            await JSONResponse({"detail": "Request too large"}, status_code=413)(scope, receive, send)
            return

        # read the body here, counting what actually arrives, so the application only ever sees a body within the limit
        body = b""
        while True:
            message = await receive()
            if message["type"] != "http.request":
                break
            body += message.get("body", b"")
            if len(body) > MAX_BODY_BYTES:
                await JSONResponse({"detail": "Request too large"}, status_code=413)(scope, receive, send)
                return
            if not message.get("more_body"):
                break

        delivered = False

        async def replay() -> Message:
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay, send)


class SecurityHeaders:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.update(HEADERS)
                if scope["path"].startswith("/api/"):
                    headers["Cache-Control"] = "no-store"  # profiles and saves must not linger in a browser cache after signing out
                elif headers.get("content-type", "").startswith("text/html"):
                    headers["Cache-Control"] = "no-cache"  # check for a new build each load; the hashed scripts it names can be kept
            await send(message)

        await self.app(scope, receive, with_headers)
