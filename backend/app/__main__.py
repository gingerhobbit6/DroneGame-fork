"""Run the game: uv run python -m app. Bound to this machine only, because there is no sign-in."""

import os

import uvicorn

PORT = 8200
# This machine only, unless SITEGUARD_HOST names another address of this machine (for example its Tailscale address).
# Never use 0.0.0.0: that would open it to every network the machine is on, and there is no sign-in.
HOST = os.environ.get("SITEGUARD_HOST", "127.0.0.1")

if __name__ == "__main__":
    print(f"Site Guard: open http://{'localhost' if HOST == '127.0.0.1' else HOST}:{PORT}")
    uvicorn.run("app.main:app", host=HOST, port=PORT)
