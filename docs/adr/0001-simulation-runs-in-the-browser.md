# ADR 0001: The simulation runs in the browser

Status: accepted, 2026-11-04.

## Context

When moving to React and FastAPI, the simulation could stay in JavaScript in the browser, or be rewritten in Python on the server and streamed over WebSocket.

## Decision

Keep it in the browser. FastAPI stores and serves saved data and takes no part in live play.

## Reasons

- **Cost.** A server simulation meant rewriting about 2,000 lines of working code. The reference runs that prove the restructure is safe would not carry across directly, because Python and JavaScript random numbers differ.
- **Little gain for one player.** They would see the same game, with network lag on every action and a state-streaming layer to build.
- **Replay and scrubbing get harder.** Snapshots, stepping to the next packet and the live dock tabs read simulation state directly.
- **Hosting costs would grow with players,** since each game takes a sizeable share of a CPU core.

Python speed was not the deciding factor. A quick benchmark of line-of-sight checks at 3x speed took 5-15% of a core with 6 sensors and 10 drones, and 20-62% with 10 sensors and 25 drones. That was only one part of a step, but it showed a Python version would be tight, not impossible.

## Consequences

- Run results come from the browser, so they are not proof of a score.
- The game works offline and with the backend stopped.
- Node, not Python, runs the simulation for tests and balance work.

## When to revisit

Choose the server if the game needs multiplayer or a shared live picture, real [SAPIENT](../SAPIENT.md) nodes or hardware connected, or tamper-proof scores. `sim/` has no DOM or rendering and exposes commands, state and events, so that boundary is the part that would move.
