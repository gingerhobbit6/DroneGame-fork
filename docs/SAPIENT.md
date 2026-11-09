# SAPIENT

SAPIENT is a UK interface standard that lets sensors, effectors and a fusion node from different makers work together. The British Standards Institution publishes it as BSI Flex 335. The game follows **version 2.0**, using the message definitions Dstl publishes at [dstl/SAPIENT-Proto-Files](https://github.com/dstl/SAPIENT-Proto-Files) (`bsi_flex_335_v2_0`).

Everything the simulated systems tell each other travels as a SAPIENT message. There is no side channel for detections, tasks or alerts, with the two exceptions listed under [Where the game departs from the standard](#where-the-game-departs-from-the-standard).

## Where it lives

| File | What it does |
|---|---|
| `frontend/src/sim/sapient.js` | The message envelope, ULID and UUID generators, locations, the validator a middleware would apply, and the message bus |
| `frontend/src/sim/network/registration.js` | Registration, status reports, leaving the network, and lost-contact alerts |
| `frontend/src/sim/network/sensors.js` | Sensor detection reports |
| `frontend/src/sim/network/fusion.js` | Fused detection reports to the operator screen, track and kill alerts |
| `frontend/src/sim/network/tasking.js`, `cameras.js` | Tasks to effectors, jammers and cameras, and their acknowledgements |
| `frontend/src/sim/network/authority.js` | Alerts, and operator approval of engagements |
| `frontend/src/sim/comms.js` | How long each message takes over Starlink or cellular, or whether it is lost |
| `frontend/src/ui/dock/` | Nodes, Messages and Learn tabs |
| `frontend/src/ui/sapient-help.js` | Plain-English notes for each field, used by Explain and Learn |

## Nodes

Every placed system is a node with its own UUID, plus three fixed nodes: the fusion node, the C2 operator screen (GUI) and the site's perimeter sensor. Sensors and effectors register with the fusion node; the fusion node registers with the GUI.

| Systems | `node_type` |
|---|---|
| Radars | `NODE_TYPE_RADAR` |
| EO/IR cameras | `NODE_TYPE_CAMERA` |
| RF detectors | `NODE_TYPE_PASSIVE_RF` |
| Acoustic sensors | `NODE_TYPE_ACOUSTIC` |
| Perimeter sensor | `NODE_TYPE_PROXIMITY_SENSOR` |
| RF and GNSS jammers | `NODE_TYPE_JAMMER` |
| Guns, missiles, interceptor drones | `NODE_TYPE_KINETIC` |
| Lasers | `NODE_TYPE_LDEW` |
| RF directed-energy weapon | `NODE_TYPE_RFDEW` |
| Fusion node | `NODE_TYPE_FUSION_NODE` |

Each registration declares the node's modes and, for each mode, the commands it accepts:

| Node | Commands declared | Used for |
|---|---|---|
| Camera | `COMMAND_TYPE_LOOK_AT`, `COMMAND_TYPE_MODE_CHANGE` (Search, Track) | Cueing it onto a track, and sending it back to its search sweep |
| Jammer | `COMMAND_TYPE_MODE_CHANGE` (Standby, Jam) | Switching it on and off |
| Other effectors | `COMMAND_TYPE_REQUEST` (Engage) | Engaging a track; `command_parameter` carries the track's `object_id` |
| Other sensors, fusion node | none | They are never tasked |

## Message flow

| Message | From → to | When |
|---|---|---|
| Registration, RegistrationAck | node → fusion node, and back | A system is built (the fusion node: at the start of a run) |
| StatusReport | node → fusion node | Every 5 s, and at once on a change of mode or task. Sensors include light, weather and clutter as `status` entries. `SYSTEM_GOODBYE` when a system is removed |
| DetectionReport | sensor → fusion node | Each scan that finds something, in range and bearing from the sensor. Bearing-only sensors leave out range |
| DetectionReport | fusion node → GUI | Every second for each track past tentative, as a location, with `derived_detection` naming the sensor reports it was built from |
| Task, TaskAck | fusion node → node, and back | Engaging, re-tasking and stopping effectors; switching jammers; pointing cameras |
| Alert, AlertAck | fusion node → GUI, and back | New tracks, warning and critical zones, loitering, lost and restored contact, kills, engagement requests |
| Error | middleware → sender | A message that fails validation (try **Inject fault** on the Messages tab) |

Messages are timestamped in simulated time, starting at 2026-01-01T00:00:00Z, so a paused or fast-forwarded run stays consistent. IDs come from the seeded random stream, so a replayed run produces the same IDs.

## Where the game departs from the standard

These are deliberate. The Learn tab explains the first three to the player.

- **Engaging.** SAPIENT has no engage command. The fusion node sends a Task with `request: "Engage"` and the track in `command_parameter`, which effectors declare in their registration.
- **Weapon release.** SAPIENT has no message for asking permission to fire. When engagement authority requires it, the fusion node sends an Alert to the GUI, and the operator's answer comes back as an AlertAck: accepted, rejected, or cancelled if it lapses.
- **Kill confirmation.** There is no message for it. The effector completes its task, the fusion node raises an Alert, and confirms only once the sensors have lost the track.
- **Free-text values.** Classification types (Air Vehicle, UAV, Multirotor, the drone's model), behaviour (Approaching, Departing, Loitering) and capability entries are free-form in the standard. The values here are illustrative, not taken from any taxonomy.
- **Regions.** The standard requires every mode to declare a region definition, so each declares an area of interest, but no node acts on region tasks and the fusion node never sends them.
- **Two shortcuts outside the network.** The fusion node reads an effector's magazine directly rather than from its status, and a slewing jammer turns to its target without a task of its own. Both are marked `shortcut:` in `tasking.js`.
- **Height on generated ground.** On a real map, `z` is height above the WGS84 ellipsoid, as `LOCATION_DATUM_WGS84_E` says. On generated ground there is no real geodesy, so `z` is height above the station base and latitude and longitude are placed around a fixed origin.
- **Bearings.** On generated ground bearings are from true north (`RANGE_BEARING_DATUM_TRUE`). On a real map the scene is aligned to the national grid, so they are from grid north (`RANGE_BEARING_DATUM_GRID`).

## Conformance

In November 2026 a run with one of each common system type (radars, RF detectors, cameras, jammers, interceptors, a missile and lasers) was played for two waves without a browser. All 10,040 messages were then parsed strictly against the official v2.0 `.proto` files with Python `protobuf`, rejecting unknown fields, and checked against the standard's own field rules (`is_mandatory`, `is_ulid`, `is_uuid`, mandatory `oneof`s).

- Every message parsed: every field name and enum value is the standard's.
- 10,039 met every rule. The one that did not is the deliberate fault from **Inject fault**.
- Before this check every registration failed at least one rule (missing `settle_time`, task definitions and `sub_class` levels, and declared no commands), and the RF directed-energy weapon was typed as a laser. Those were fixed.

The in-game validator (`validate()` in `sapient.js`) checks the envelope, IDs and the mandatory fields of each message type, including each registration's modes. It is lighter than a full check against the `.proto` files. `frontend/tests/sapient-registration.test.js` registers every system in the catalogue and requires the validator to accept each one.

## Interoperability

The simulation runs in the browser and never opens a network connection to SAPIENT equipment.

**What works today.** **Export** on the Messages tab saves the log as newline-delimited JSON in the proto3 JSON form (`snake_case` field names, enums by name, RFC 3339 timestamps), which a protobuf library reads directly. Two limits:

- The log keeps the newest 5,000 messages, so in a long run the registrations that describe each node have already gone from an export.
- An Error's `packet` holds the offending message as base64 JSON, not as protobuf bytes.

**What a live link would need.** Real SAPIENT nodes exchange binary protobuf messages over TCP, and a browser cannot open a raw TCP connection, so a link would go through the backend:

1. The browser streams messages to the FastAPI backend over a WebSocket.
2. The backend encodes each one as binary protobuf, using classes generated from the official `.proto` files, and sends it over TCP to a SAPIENT middleware or C2 system.

Sending only (the game as a source of simulated sensors and tracks for a real operator screen) is the useful and contained case. Feeding real sensors into the game's fusion node would break seeded replays and is not planned. ADR 0001 records that real SAPIENT nodes are a reason to move work to the server.

SAPIENT itself has no authentication or encryption. A bridge should listen only on the local machine or a closed network, treat every inbound message as untrusted, and validate it against the `.proto` files before use.
