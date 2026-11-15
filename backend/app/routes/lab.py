"""HTTP only, for the laydowns and report that tools/lab writes. Read-only, and only that folder's plain file names are ever served."""

import json
import math
import os
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/v1/lab")

DEFAULT_LAB = Path(__file__).parent.parent.parent.parent / "frontend" / "lab-results"
PLAIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.json$")
MAX_FILE = 1024 * 1024
MAX_FILES = 200


def lab_dir() -> Path:
    return Path(os.environ.get("SITE_GUARD_LAB", DEFAULT_LAB))


def read_laydown(path: Path) -> dict[str, Any] | None:
    """The file's content if it is a laydown this game could open, else None."""
    try:
        if path.stat().st_size > MAX_FILE:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    spec = data.get("spec") if isinstance(data, dict) else None
    if not isinstance(spec, dict) or not isinstance(spec.get("structures"), list):
        return None
    return data


def results(meta: Any) -> dict[str, Any] | None:
    """A laydown's measured results as the Lab tab shows them: short text and finite numbers only, so one odd file cannot break the list."""
    if not isinstance(meta, dict):
        return None
    return {k[:40]: v[:200] if isinstance(v, str) else v for k, v in meta.items()
            if v is None or isinstance(v, (str, int)) or (isinstance(v, float) and math.isfinite(v))} or None


@router.get("")
def list_laydowns() -> dict[str, Any]:
    folder = lab_dir() / "laydowns"
    rows: list[dict[str, Any]] = []
    if folder.is_dir():
        for path in [p for p in sorted(folder.iterdir()) if PLAIN.fullmatch(p.name) and p.is_file()][:MAX_FILES]:
            data = read_laydown(path)
            if data is None:
                continue
            rows.append({"file": path.name, "name": str(data.get("name") or path.stem)[:100], "world": str(data.get("world") or ""),
                         "systems": len(data["spec"]["structures"]), "lab": results(data.get("lab"))})
    # the ones with a measured result come first, best first
    waves = lambda r: w if isinstance(w := (r["lab"] or {}).get("waves"), (int, float)) else 0  # noqa: E731
    rows.sort(key=lambda r: (r["lab"] is None, -waves(r), r["name"]))
    return {"laydowns": rows, "report": (lab_dir() / "report.html").is_file()}


@router.get("/laydowns/{name}")
def get_laydown(name: str) -> FileResponse:
    path = lab_dir() / "laydowns" / name
    if not PLAIN.match(name) or not path.is_file() or read_laydown(path) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return FileResponse(path, media_type="application/json")


@router.get("/report")
def get_report() -> FileResponse:
    path = lab_dir() / "report.html"
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return FileResponse(path, media_type="text/html; charset=utf-8")
