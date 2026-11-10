"""What the account and deployment pack endpoints accept and return. Like schemas.py, this is a trust boundary: unknown fields are
refused, and nothing here is ever echoed back in an error."""

from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, ValidationInfo, field_validator

from app.schemas import (
    MAX_PEOPLE_PER_GROUP,
    MAX_UNIT_SETTINGS,
    Callsign,
    FigureKey,
    Name,
    PatrolVehicle,
    Protection,
    SettingArcs,
    SettingBands,
    SettingChoice,
    SettingNumber,
    Strict,
    SystemId,
    _no_control_characters,
)

MIN_PASSWORD = 10  # length is what makes a password strong, so there are no rules about character classes
MAX_PASSWORD = 128  # long enough for any passphrase, short enough that hashing cannot be used to tie up the server
MAX_UNIT_LINES = 40
MAX_UNIT_COUNT = 50

Username = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$")]
Password = Annotated[str, StringConstraints(min_length=MIN_PASSWORD, max_length=MAX_PASSWORD)]
AnyPassword = Annotated[str, StringConstraints(min_length=1, max_length=MAX_PASSWORD)]  # signing in checks it, so old rules never lock anyone out
RecoveryCode = Annotated[str, StringConstraints(min_length=1, max_length=64)]
ProfileText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60), AfterValidator(_no_control_characters)]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60), AfterValidator(_no_control_characters)]
Echelon = Literal["fireteam", "section", "platoon", "troop", "company", "squadron", "battery", "battalion"]
UnitVehicle = PatrolVehicle  # a pack brings the same vehicles as a patrol
LineCount = Annotated[int, Field(ge=1, le=MAX_UNIT_COUNT)]


def _not_the_username(password: str, info: ValidationInfo) -> str:
    if password.lower() == str(info.data.get("username", "")).lower():
        raise ValueError("must not be the username")
    return password


class Register(Strict):
    username: Username
    display_name: DisplayName
    password: Password

    not_the_username = field_validator("password")(_not_the_username)


class SignIn(Strict):
    username: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)]
    password: AnyPassword
    remember: bool = False


class Reset(Strict):
    username: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)]
    recovery_code: RecoveryCode
    new_password: Password

    not_the_username = field_validator("new_password")(_not_the_username)


class ChangePassword(Strict):
    current_password: AnyPassword
    new_password: Password


class ConfirmPassword(Strict):
    password: AnyPassword


class ProfileIn(Strict):
    display_name: DisplayName
    rank: ProfileText = ""
    organisation: ProfileText = ""


class Profile(BaseModel):
    id: int
    username: str
    display_name: str
    rank: str
    organisation: str
    created_at: str
    last_sign_in: str | None


class Registered(BaseModel):
    user: Profile
    recovery_code: str  # shown once: only its hash is kept


class NewRecoveryCode(BaseModel):
    recovery_code: str


class SystemLine(Strict):
    id: SystemId
    count: LineCount
    # What each one is placed with. Shape and coarse bounds only, as for a placed system: the game clamps them to the class's limits.
    settings: dict[FigureKey, SettingNumber | SettingChoice | SettingArcs | SettingBands] | None = Field(default=None, max_length=MAX_UNIT_SETTINGS, exclude_if=lambda v: v is None)


class VehicleLine(Strict):
    id: UnitVehicle
    count: LineCount


class PeopleLine(Strict):
    count: Annotated[int, Field(ge=1, le=MAX_PEOPLE_PER_GROUP)]
    protection: Protection


def _unique_ids(lines: list) -> list:
    if len({line.id for line in lines}) != len(lines):
        raise ValueError("list each one once, with a count")
    return lines


class UnitAssets(Strict):
    systems: Annotated[list[SystemLine], Field(max_length=MAX_UNIT_LINES), AfterValidator(_unique_ids)] = []
    vehicles: Annotated[list[VehicleLine], Field(max_length=3), AfterValidator(_unique_ids)] = []
    people: list[PeopleLine] = Field(default=[], max_length=20)  # each line is one group, placed together


class UnitIn(Strict):
    name: Name
    echelon: Echelon
    callsign: Callsign | None = None
    assets: UnitAssets


class UnitSummary(BaseModel):
    id: int
    name: str
    echelon: str
    callsign: str | None
    created_at: str
    updated_at: str


class UnitOut(UnitSummary):
    assets: UnitAssets
