"""Deployment packs, each private to the account that made it. HTTP only: the rules are in services/units.py."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from app.account_schemas import UnitIn, UnitOut, UnitSummary
from app.db.account_stores import SqliteUnitStore
from app.routes.api import Connection, RecordId
from app.routes.auth import UserId
from app.services.units import UnitService

router = APIRouter(prefix="/api/v1/units")
NO_CONTENT = status.HTTP_204_NO_CONTENT


def units(conn: Connection, user_id: UserId) -> UnitService:
    return UnitService(SqliteUnitStore(conn, user_id))


Units = Annotated[UnitService, Depends(units)]


@router.get("")
def list_units(service: Units) -> list[UnitSummary]:
    return service.list()


@router.post("", status_code=status.HTTP_201_CREATED)
def create_unit(body: UnitIn, service: Units) -> UnitOut:
    return service.create(body.model_dump())


@router.get("/{unit_id}")
def get_unit(unit_id: RecordId, service: Units) -> UnitOut:
    return service.get(unit_id)


@router.put("/{unit_id}")
def replace_unit(unit_id: RecordId, body: UnitIn, service: Units) -> UnitOut:
    return service.replace(unit_id, body.model_dump())


@router.delete("/{unit_id}", status_code=NO_CONTENT)
def delete_unit(unit_id: RecordId, service: Units) -> Response:
    service.delete(unit_id)
    return Response(status_code=NO_CONTENT)
