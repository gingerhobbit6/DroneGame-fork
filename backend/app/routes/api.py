"""HTTP only: parse the request, call a service, return the result."""

import sqlite3
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status

from app.db.connection import connect
from app.db.stores import SqliteFigureSetStore, SqliteLaydownStore, SqliteRunStore
from app.schemas import FigureSetIn, FigureSetOut, FigureSetSummary, LaydownIn, LaydownOut, LaydownSummary, RunIn, RunOut, RunPage
from app.services.records import FigureSetService, LaydownService, RunService

router = APIRouter(prefix="/api/v1")

# anything outside this cannot be a row id, and would overflow SQLite's integer type
RecordId = Annotated[int, Path(ge=1, le=2**63 - 1)]
Offset = Annotated[int, Query(ge=0, le=2**63 - 1)]


def connection(request: Request) -> Iterator[sqlite3.Connection]:
    conn = connect(request.app.state.db_path)
    try:
        yield conn
    finally:
        conn.close()


Connection = Annotated[sqlite3.Connection, Depends(connection)]


def laydowns(conn: Connection) -> LaydownService:
    return LaydownService(SqliteLaydownStore(conn))


def runs(conn: Connection) -> RunService:
    return RunService(SqliteRunStore(conn))


def figure_sets(conn: Connection) -> FigureSetService:
    return FigureSetService(SqliteFigureSetStore(conn))


Laydowns = Annotated[LaydownService, Depends(laydowns)]
Runs = Annotated[RunService, Depends(runs)]
FigureSets = Annotated[FigureSetService, Depends(figure_sets)]
NO_CONTENT = status.HTTP_204_NO_CONTENT


@router.get("/laydowns")
def list_laydowns(service: Laydowns) -> list[LaydownSummary]:
    return service.list()


@router.post("/laydowns", status_code=status.HTTP_201_CREATED)
def create_laydown(body: LaydownIn, service: Laydowns) -> LaydownOut:
    return service.create(body.model_dump())


@router.get("/laydowns/{laydown_id}")
def get_laydown(laydown_id: RecordId, service: Laydowns) -> LaydownOut:
    return service.get(laydown_id)


@router.put("/laydowns/{laydown_id}")
def replace_laydown(laydown_id: RecordId, body: LaydownIn, service: Laydowns) -> LaydownOut:
    return service.replace(laydown_id, body.model_dump())


@router.delete("/laydowns/{laydown_id}", status_code=NO_CONTENT)
def delete_laydown(laydown_id: RecordId, service: Laydowns) -> Response:
    service.delete(laydown_id)
    return Response(status_code=NO_CONTENT)


@router.get("/runs")
def list_runs(service: Runs, limit: Annotated[int, Query(ge=1, le=100)] = 25, offset: Offset = 0) -> RunPage:
    return service.list(limit, offset)


@router.post("/runs", status_code=status.HTTP_201_CREATED)
def record_run(body: RunIn, service: Runs) -> RunOut:
    return service.record(body.model_dump())


@router.get("/runs/{run_id}")
def get_run(run_id: RecordId, service: Runs) -> RunOut:
    return service.get(run_id)


@router.delete("/runs/{run_id}", status_code=NO_CONTENT)
def delete_run(run_id: RecordId, service: Runs) -> Response:
    service.delete(run_id)
    return Response(status_code=NO_CONTENT)


@router.get("/figure-sets")
def list_figure_sets(service: FigureSets) -> list[FigureSetSummary]:
    return service.list()


@router.post("/figure-sets", status_code=status.HTTP_201_CREATED)
def create_figure_set(body: FigureSetIn, service: FigureSets) -> FigureSetOut:
    return service.create(body.model_dump())


@router.get("/figure-sets/{figure_set_id}")
def get_figure_set(figure_set_id: RecordId, service: FigureSets) -> FigureSetOut:
    return service.get(figure_set_id)


@router.delete("/figure-sets/{figure_set_id}", status_code=NO_CONTENT)
def delete_figure_set(figure_set_id: RecordId, service: FigureSets) -> Response:
    service.delete(figure_set_id)
    return Response(status_code=NO_CONTENT)
