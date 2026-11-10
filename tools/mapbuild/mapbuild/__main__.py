"""Build a map pack: uv run --directory tools/mapbuild python -m mapbuild --centre "SU 22 66" --name "Savernake" --data <folder> --out <file>"""

import argparse
import os
import re
import sys
import time
from datetime import date

import numpy as np

from . import beyond, download, estonia, features, fit, packfile, pictures, terrain
from .estonia import Inputs
from .grid import Window, parse_grid_ref

WORLD_KM = 54  # a world is this wide (WORLD.radius in frontend/src/sim/config/world.js), so a pack must be wider

SOURCES = {
    "osmap": "Contains OS data © Crown copyright and database right",
    "lidar": "Contains Environment Agency information © Environment Agency and/or database right",
}


def british(data_root: str, window: Window, lidar_km: int, say, fetch_lidar: bool = True) -> Inputs:
    t50, no_tile = terrain.terrain50(data_root, window)
    say(f"Terrain 50: {window.side} x {window.side} posts, {t50.min():.1f} to {t50.max():.1f} m, {no_tile.mean():.1%} with no tile")
    source = features.OpenMap(data_root, window)
    wood, _ = source.read("Woodland")
    houses, _ = source.read("Building")
    power, _ = source.read("ElectricityTransmissionLine")
    surface, _ = source.read("SurfaceWater_Area")
    tidal, _ = source.read("TidalWater")
    roads, road_fields = source.read("Road", ["CLASSIFICA"])
    names, name_fields = source.read("NamedPlace", ["DISTNAME", "CLASSIFICA", "FONTHEIGHT"])
    say(f"OpenMap Local: {len(houses)} buildings, {len(wood)} woods, {len(roads)} roads, {len(names)} names")
    grids = terrain.lidar(window, lidar_km * 500, houses, say, os.path.join(data_root, "lidar_cache"), fetch_lidar) if lidar_km else None
    return Inputs(t50, no_tile, wood, houses, power, np.concatenate([surface, tidal]), roads, road_fields, names, name_fields, grids)


def size_problem(size: int, lidar_km: int) -> str | None:
    """Why these widths cannot be built, or None. A pack as wide as a world is the least the game takes: the site cannot then be moved."""
    if size % 2 or lidar_km % 2 or not WORLD_KM <= size <= 80 or not 0 <= lidar_km <= size:
        return f"--size must be even, from {WORLD_KM} to 80, and --lidar-km must be even, non-negative and no bigger than --size"
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mapbuild", description="Build a Site Guard map pack from open data.")
    parser.add_argument("--centre", required=True, help='the middle of the pack, as a grid reference such as "SU 22 66", or as easting,northing on the British or Estonian grid')
    parser.add_argument("--name", required=True, help="the name shown in the game")
    parser.add_argument("--data", required=True, help="the folder of downloads: terrain50, openmap_su, vmd_su and so on, or the national files for Estonia")
    parser.add_argument("--out", required=True, help="the .sgmap file to write")
    parser.add_argument("--size", type=int, default=70, help="the width of the pack in km (default 70: a 54 km world, with 8 km of room to move it each way). 54 is the least: exactly one world, with the site fixed at the middle")
    parser.add_argument("--lidar-km", type=int, default=54, help="the width of the middle part with lidar heights, in km. 0 for none. In Great Britain, England only.")
    parser.add_argument("--fetch", action="store_true", help="download any files that are missing from --data")
    parser.add_argument("--no-satellite", action="store_true", help="leave out the satellite picture")
    parser.add_argument("--saved-lidar-only", action="store_true", help="in Great Britain, use only the lidar squares an earlier build kept, and fetch none: the rest gets Terrain 50 heights")
    args = parser.parse_args(argv)
    if size_problem(args.size, args.lidar_km):
        parser.error(size_problem(args.size, args.lidar_km))

    began = time.time()
    say = lambda text: print(f"[{time.time() - began:5.0f}s] {text}", flush=True)
    east, north = map(int, args.centre.split(",")) if re.fullmatch(r"\d{1,6},\d{1,7}", args.centre) else parse_grid_ref(args.centre)
    window = Window(east // 1000 * 1000, north // 1000 * 1000, args.size * 500)
    estonian = north >= estonia.FIRST_NORTH
    crs = estonia.CRS if estonian else pictures.BRITISH_CRS
    position = fit.geo_fit(window, crs)  # first, so a refusal does not waste an hour of downloads
    if args.fetch:
        if estonian:
            estonia.ensure(args.data, bool(args.lidar_km), say)
        else:
            download.ensure(args.data, window.squares(), say)

    source = estonia.gather(args.data, window, args.lidar_km, say, args.fetch) if estonian else british(args.data, window, args.lidar_km, say, not args.saved_lidar_only)
    cover = features.cover_grid(window, source.wood, source.houses, source.power, source.water, source.no_data)
    ground, canopy, bldg, cover = terrain.combine(window, source.base, source.lidar, cover, cover == 1, cover == 2)
    grids = packfile.Grids(ground, canopy, bldg, cover)
    packfile.check(grids)

    feature_lists = features.feature_lists(window, source.houses, source.power, source.roads, source.road_fields, source.names, source.name_fields, bldg)
    if len(feature_lists["buildings"]) < len(source.houses):
        say(f"buildings: the {len(feature_lists['buildings'])} nearest the middle are drawn; line of sight has all {len(source.houses)}")
    map_pictures = estonia.base_map(window, say) if estonian else pictures.os_map(args.data, window, say)
    if estonian and source.past.any():  # the basic map is blank past the border, so the game shades that ground from its heights
        feature_lists["beyond"] = beyond.rings(window, beyond.reaching(window, beyond.blank_posts(window, map_pictures), source.past))
        say(f"past the border: {len(feature_lists['beyond'])} outlines to shade from heights")
    this_year = date.today().year
    sat_pictures, sat_year = ([], None) if args.no_satellite else pictures.satellite(window, [this_year - 1, this_year - 2], say, crs)

    if estonian:
        credits = estonia.credits(args.lidar_km, this_year, source.copernicus, source.geonames)
    else:
        credits = {"osmap": f"{SOURCES['osmap']} {this_year}"}
        if args.lidar_km:
            credits["lidar"] = f"{SOURCES['lidar']} {this_year}"
    if sat_year:
        credits["satellite"] = f"Contains modified Copernicus Sentinel data {sat_year}"
    header = {
        "name": args.name[:80], "east": window.east, "north": window.north, "half": window.half, "cell": 20, "N": window.side,
        "tier": "lidar" if args.lidar_km else "terrain50", "lidarHalf": args.lidar_km * 500, "built": date.today().isoformat(), "credits": credits,
        **position,
    }
    written = packfile.write_pack(args.out, header, grids, feature_lists, map_pictures + sat_pictures, say)
    say(f"wrote {args.out}: {os.path.getsize(args.out) / 1e6:.1f} MB, hash {written['gridsSha256'][:16]}, fit error {written['fitErrorM']} m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
