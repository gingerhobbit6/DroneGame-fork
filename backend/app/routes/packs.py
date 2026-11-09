"""HTTP only, for real-world map packs. The pack files themselves are served as they are, and checked in the browser."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from pydantic import Field, model_validator

from app.schemas import Strict
from app.routes.auth import UserId
from app.services.packs import BuildBusy, BuildRateLimited, BuildStorageLimited, PackBuilder, PackLibrary, on_a_grid

router = APIRouter(prefix="/api/v1/packs")


class BuildRequest(Strict):
    east: Annotated[int, Field(ge=0, lt=1_000_000)]
    north: Annotated[int, Field(ge=0, lt=10_000_000)]
    lidar: bool

    @model_validator(mode="after")
    def is_on_a_grid(self) -> "BuildRequest":
        if not on_a_grid(self.east, self.north):
            raise ValueError("That position is outside the maps this can build.")
        return self


def library(request: Request) -> PackLibrary:
    return request.app.state.packs


def builder(request: Request) -> PackBuilder:
    return request.app.state.pack_builder


Library = Annotated[PackLibrary, Depends(library)]
Builder = Annotated[PackBuilder, Depends(builder)]


@router.get("")
def list_packs(packs: Library) -> list[dict[str, Any]]:
    return packs.list()


@router.get("/downloads")
def downloads(packs: Library) -> dict[str, Any]:
    return packs.downloads()


@router.get("/build")
def build_status(jobs: Builder) -> dict[str, Any]:
    return jobs.status()


@router.post("/build", status_code=status.HTTP_202_ACCEPTED)
def build_pack(body: BuildRequest, jobs: Builder, user_id: UserId) -> dict[str, Any]:
    try:
        return jobs.start(body.east, body.north, body.lidar, user_id)
    except BuildBusy:
        raise HTTPException(status.HTTP_409_CONFLICT, "A map is already being built.") from None
    except BuildRateLimited as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "The map build daily limit has been reached.", headers={"Retry-After": str(exc.retry_after)}) from None
    except BuildStorageLimited as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None


@router.get("/{name}")
def get_pack(name: str, packs: Library) -> FileResponse:
    path = packs.path_of(name)
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return FileResponse(path, media_type="application/octet-stream")
