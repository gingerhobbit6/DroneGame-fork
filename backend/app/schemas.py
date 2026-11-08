"""What the API accepts and returns. This is the trust boundary: everything is checked here, and unknown fields are refused."""

import re
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, JsonValue, StringConstraints

# Names the game uses. A test compares these with the frontend's config, so they cannot drift apart.
SystemId = Literal[
    "radar", "radar_s", "radar_a400", "radar_a800", "radar_giraffe", "radar_l", "rf", "rf_s", "rf_elysion", "rf_airfence", "rf_l", "camera", "camera_s", "camera_l", "acoustic", "acoustic_s", "acoustic_l",
    "jammer", "jammer_s", "jammer_l", "jammer_auds", "jammer_neo", "jammer_jupiter", "jammer_sf", "jammer_mk4", "jammer_skywiper", "jammer_kvertus", "jammer_dgmk3", "jammer_dgtac", "interceptor", "interceptor_s", "interceptor_l", "interceptor_p1",
    "missile", "missile_s", "missile_l", "missile_rr", "missile_hvm", "missile_paladin", "missile_skysabre", "gun_hmg", "gun_s", "gun_50", "gun_l", "gun_skyranger", "gun_gepard",
    "laser", "laser_s", "laser_l", "laser_rfdew",
]
Uplink = Literal["starlink", "cellular"]
CellBand = Literal["B8", "B3", "n78"]
JamBand = Literal["control900", "control24", "video58", "gnss"]
# A drone type the waves may send. The game keeps only the ids it knows, so this checks the shape alone.
DroneTypeId = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,31}$")]
MAX_ATTACK_TYPES = 64
Protection = Literal["open", "building", "bunker"]
PatrolVehicle = Literal["patria", "hilux", "mule"]  # PATROL_VEHICLES in frontend/src/sim/config/patrol.js
MAX_ESCORTS = 6
MAX_ESCORT_GAP = 200  # metres along the route, ahead of the people or (negative) behind

WORLD_LIMIT = 1350  # scene units: the ground reaches 27 km from the site (WORLD.radius), at 20 m a unit
MAX_SYSTEMS = 200
MAX_COMMANDS = 20_000
MAX_UNIT_SETTINGS = 16
MAX_FIGURES_PER_ITEM = 40
MAX_ZONE_POINTS = 32
MAX_PEOPLE_GROUPS = 50
MAX_PEOPLE_PER_GROUP = 500

_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")


def _no_control_characters(text: str) -> str:
    if _CONTROL_CHARACTERS.search(text):
        raise ValueError("must not contain control characters")
    return text


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100), AfterValidator(_no_control_characters)]
Seed = Annotated[str, StringConstraints(min_length=1, max_length=64), AfterValidator(_no_control_characters)]
GameVersion = Annotated[str, StringConstraints(pattern=r"^[0-9A-Za-z.+-]{1,32}$")]
Coordinate = Annotated[float, Field(ge=-WORLD_LIMIT, le=WORLD_LIMIT)]
Count = Annotated[int, Field(ge=0, le=1_000_000_000)]
Money = Annotated[float, Field(ge=-1e10, le=1e10)]


FigureKey = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_]{1,32}$")]
Figure = Annotated[float, Field(ge=0, le=1e12)]
SettingChoice = Annotated[str, StringConstraints(pattern=r"^[a-z]{1,16}$")]
SettingNumber = Annotated[float, Field(ge=-150, le=1e12)]  # a radar beam's low edge sits below the horizon, and a receiver's sensitivity is in dBm
Bearing = Annotated[int, Field(ge=0, lt=360)]
SettingArcs = Annotated[list[Annotated[list[Bearing], Field(min_length=2, max_length=2)]], Field(max_length=3)]  # blanking arcs, [from, to]
SettingBands = Annotated[list[JamBand], Field(min_length=1, max_length=4)]  # the bands a jammer is fitted for
UnitName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40), AfterValidator(_no_control_characters)]
Callsign = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9 -]{0,11}$")]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class PlacedSystem(Strict):
    id: SystemId
    x: Coordinate
    z: Coordinate
    uplink: Uplink | None
    cellBand: CellBand
    jam: list[JamBand] | None = Field(max_length=4)
    on: Literal[True] | None = Field(default=None, exclude_if=lambda v: v is None)  # a jammer switched on by hand
    # Shape and coarse bounds only: class limits belong to the game, which clamps to them when it loads a laydown.
    settings: dict[FigureKey, SettingNumber | SettingChoice | SettingArcs | SettingBands] | None = Field(default=None, max_length=MAX_UNIT_SETTINGS, exclude_if=lambda v: v is None)
    name: UnitName | None = Field(default=None, exclude_if=lambda v: v is None)
    callsign: Callsign | None = Field(default=None, exclude_if=lambda v: v is None)
    vehicle: PatrolVehicle | None = Field(default=None, exclude_if=lambda v: v is None)  # parked on one from a deployment pack


class PlacedPeople(Strict):
    x: Coordinate
    z: Coordinate
    count: Annotated[int, Field(ge=1, le=MAX_PEOPLE_PER_GROUP)]
    protection: Protection
    # soldiers are drawn in uniform; a group without it is civilians, as every group saved before it was
    role: Literal["military"] | None = Field(default=None, exclude_if=lambda role: role is None)


class Escort(Strict):
    """One vehicle in a patrol's column: what it is, the system it carries, and where it keeps along the route."""

    vehicle: PatrolVehicle
    system: SystemId
    gap: Annotated[float, Field(ge=-MAX_ESCORT_GAP, le=MAX_ESCORT_GAP)]


class LaydownSpec(Strict):
    """The shape of captureLaydown() in frontend/src/sim/laydown.js, including the area to defend, which the enemy attacks."""

    structures: list[PlacedSystem] = Field(max_length=MAX_SYSTEMS)
    fusionUplinks: list[Uplink] = Field(max_length=2)
    fusionCell: CellBand
    attack: list[DroneTypeId] | None = Field(default=None, min_length=1, max_length=MAX_ATTACK_TYPES, exclude_if=lambda attack: attack is None)
    conditions: Literal["day", "dusk", "night", "rain"] | None = Field(default=None, exclude_if=lambda conditions: conditions is None)  # light and weather
    people: list[PlacedPeople] | None = Field(default=None, max_length=MAX_PEOPLE_GROUPS, exclude_if=lambda people: people is None)
    zone: list[Annotated[list[Coordinate], Field(min_length=2, max_length=2)]] | None = Field(default=None, min_length=3, max_length=MAX_ZONE_POINTS, exclude_if=lambda zone: zone is None)
    # a patrol's looped route (see docs/PATROL_MODE.md); the game checks it again on the ground when it is restored
    patrol: list[Annotated[list[Coordinate], Field(min_length=2, max_length=2)]] | None = Field(default=None, min_length=2, max_length=MAX_ZONE_POINTS, exclude_if=lambda patrol: patrol is None)
    # the vehicles that escort it; a patrol saved before there was a choice gets the default column
    patrolColumn: list[Escort] | None = Field(default=None, min_length=1, max_length=MAX_ESCORTS, exclude_if=lambda column: column is None)


FigureGroup = Annotated[dict[FigureKey, Annotated[dict[FigureKey, Figure], Field(max_length=MAX_FIGURES_PER_ITEM)]], Field(max_length=MAX_FIGURES_PER_ITEM)]


class Figures(Strict):
    """The shape of exportFigures() in frontend/src/sim/config/figures.js: only the figures that differ from the researched ones."""

    structures: FigureGroup = {}
    drones: FigureGroup = {}
    comms: FigureGroup = {}
    people: FigureGroup = Field(default={}, exclude_if=lambda people: not people)  # left out until someone edits one, as older records have none
    patrol: FigureGroup = Field(default={}, exclude_if=lambda patrol: not patrol)
    world: Annotated[dict[FigureKey, Figure], Field(max_length=4)] = {}
    waves: Annotated[dict[FigureKey, Figure], Field(max_length=4)] = {}
    adapt: Annotated[dict[FigureKey, Figure], Field(max_length=4)] = {}


class Command(Strict):
    step: Count
    name: Annotated[str, StringConstraints(pattern=r"^[A-Za-z]{1,40}$")]
    args: list[JsonValue] = Field(max_length=8)


class LaydownIn(Strict):
    name: Name
    world: Seed
    spec: LaydownSpec
    game_version: GameVersion


class LaydownSummary(BaseModel):
    id: int
    name: str
    world: str
    game_version: str
    created_at: str
    updated_at: str


class LaydownOut(LaydownSummary):
    spec: LaydownSpec


class RunIn(Strict):
    scenario_seed: Seed
    world: Seed
    spec: LaydownSpec
    figures: Figures
    commands: list[Command] = Field(max_length=MAX_COMMANDS)
    game_version: GameVersion
    digest: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{1,16}$")]
    waves_completed: Count
    kills: Count
    leaks: Count
    health: Annotated[float, Field(ge=0, le=100)]
    budget_left: Money
    capex: Money
    consumables: Money
    enemy_cost: Money


class RunSummary(BaseModel):
    id: int
    scenario_seed: str
    world: str
    game_version: str
    digest: str
    waves_completed: int
    kills: int
    leaks: int
    health: float
    budget_left: float
    capex: float
    consumables: float
    enemy_cost: float
    finished_at: str


class RunOut(RunSummary):
    spec: LaydownSpec
    figures: Figures
    commands: list[Command]


class RunPage(BaseModel):
    items: list[RunSummary]
    total: int


class FigureSetIn(Strict):
    name: Name
    figures: Figures
    game_version: GameVersion


class FigureSetSummary(BaseModel):
    id: int
    name: str
    game_version: str
    created_at: str


class FigureSetOut(FigureSetSummary):
    figures: Figures
