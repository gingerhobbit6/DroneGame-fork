"""Run the game: uv run python -m app. Bound to this machine only: sign-in runs over plain http, with no TLS."""

import socket
import sys

import uvicorn

from app.security import BIND_HOSTS

PORT = 8200
# This machine only, unless SITEGUARD_HOST names other addresses of this machine (for example its Tailscale address). Several can be
# given, separated by commas, such as "127.0.0.1,100.64.0.5", to serve this machine and the tailnet at once.
# Never every address (0.0.0.0): that would open it to every network the machine is on, and sign-in runs over plain http.
EVERYWHERE = {"0.0.0.0", "::", "*", ""}


def listening_sockets(hosts: list[str], port: int) -> list[socket.socket]:
    made = []
    for host in hosts:
        sock = socket.socket(socket.AF_INET6 if ":" in host else socket.AF_INET, socket.SOCK_STREAM)
        sock.bind((host, port))
        made.append(sock)
    return made


if __name__ == "__main__":
    if EVERYWHERE & set(BIND_HOSTS):
        sys.exit("SITEGUARD_HOST must name addresses of this machine, not every address (0.0.0.0).")
    try:
        sockets = listening_sockets(BIND_HOSTS, PORT)
    except OSError as problem:
        sys.exit(f"Could not listen on {', '.join(BIND_HOSTS)} port {PORT}: {problem}. Is the address this machine's, and is another copy already running?")
    for host in BIND_HOSTS:
        print(f"Bombadil: open http://{'localhost' if host == '127.0.0.1' else host}:{PORT}")
    try:
        uvicorn.Server(uvicorn.Config("app.main:app")).run(sockets=sockets)
    except KeyboardInterrupt:
        pass  # Ctrl+C is how the server is stopped: it has already shut down cleanly, so there is nothing to report
