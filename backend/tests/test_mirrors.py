"""Values the save server copies from the map builder and the game. They are separate programs that can't import each other, so
these tests read the other programs' source and fail if a copy drifts."""

import ast
import re
from pathlib import Path

from app.services import packs

ROOT = Path(__file__).resolve().parents[2]
BUILDER, GAME = ROOT / "tools" / "mapbuild" / "mapbuild", ROOT / "frontend" / "src" / "sim"


def constants(path: Path, *names: str) -> dict:
    """Top-level constants of a Python file, read without importing it: the builder's own dependencies aren't installed here."""
    found = {}
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        target = node.targets[0] if isinstance(node, ast.Assign) else None
        here = [t.id for t in target.elts] if isinstance(target, ast.Tuple) else [target.id] if isinstance(target, ast.Name) else []
        if set(here) & set(names):
            value = eval(compile(ast.Expression(node.value), str(path), "eval"), {"__builtins__": {}})  # literals only, from this repository
            found.update(zip(here, value) if isinstance(target, ast.Tuple) else [(here[0], value)])
    assert set(names) <= set(found), f"{path.name} no longer defines {set(names) - set(found)}"
    return found


def number(path: Path, pattern: str) -> int:
    match = re.search(pattern, path.read_text(encoding="utf-8"))
    assert match, f"{path.name} no longer matches {pattern}"
    return int(match.group(1))


def test_the_estonian_files_are_the_ones_the_builder_fetches():
    files = constants(BUILDER / "estonia_files.py", "HEIGHTS", "SURFACE", "BUILDINGS", "LAND", "TRANSPORT", "WATER", "UTILITIES", "PLACES")
    assert (packs.ESTONIA_HEIGHTS, packs.ESTONIA_SURFACE) == (files.pop("HEIGHTS"), files.pop("SURFACE"))
    assert sorted(packs.ESTONIA_FEATURES) == sorted(files.values())


def test_pack_and_world_sizes_match_the_builder_and_the_game():
    assert packs.WORLD_KM == constants(BUILDER / "__main__.py", "WORLD_KM")["WORLD_KM"] == 2 * number(GAME / "config" / "world.js", r"radius: (\d+)") // 1000
    assert packs.PACK_KM == number(BUILDER / "__main__.py", r'"--size", type=int, default=(\d+)') == 2 * number(GAME / "world-pack.js", r"BUILT_HALF = (\d+)") // 1000


def test_every_program_tells_the_two_grids_apart_at_the_same_northing():
    first = constants(BUILDER / "estonia.py", "FIRST_NORTH")["FIRST_NORTH"]
    assert first == number(GAME / "grids.js", r"FIRST_ESTONIAN_NORTH = (\d+)")
    # the server's British grid lies below that line and its Estonian one above, so the builder picks the grid the server meant
    assert packs.on_a_grid(400_000, 500_000) and not packs.in_estonia(400_000, 500_000) and 500_000 < first
    assert packs.in_estonia(500_000, 6_500_000) and 6_500_000 >= first
    assert not any(packs.on_a_grid(east, north) for east in range(0, 800_000, 10_000) for north in (first - 1, first))
