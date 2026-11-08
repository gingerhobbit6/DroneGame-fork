"""Deployment packs: the units an account builds from real systems, vehicles and people. The store only ever sees its owner's."""

from collections.abc import Callable
from typing import Any

from app.db.account_stores import SqliteUnitStore
from app.services.records import NotFound, utc_now

MAX_UNITS = 50


class TooMany(Exception):
    """This account already has as many packs as it may."""


class UnitService:
    def __init__(self, store: SqliteUnitStore, clock: Callable[[], str] = utc_now) -> None:
        self.store, self.clock = store, clock

    def list(self) -> list[dict[str, Any]]:
        return self.store.list()

    def get(self, unit_id: int) -> dict[str, Any]:
        found = self.store.get(unit_id)
        if found is None:
            raise NotFound
        return found

    def create(self, data: dict[str, Any]) -> dict[str, Any]:
        if self.store.count() >= MAX_UNITS:
            raise TooMany
        return self.get(self.store.add(data, self.clock()))

    def replace(self, unit_id: int, data: dict[str, Any]) -> dict[str, Any]:
        if not self.store.replace(unit_id, data, self.clock()):
            raise NotFound
        return self.get(unit_id)

    def delete(self, unit_id: int) -> None:
        if not self.store.delete(unit_id):
            raise NotFound
