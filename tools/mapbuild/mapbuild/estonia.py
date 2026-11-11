"""Estonia, from the Land and Spatial Development Board. Heights and features are whole-country files, fetched once, so getting them
says nothing about where a pack is. Only the base map tiles and the satellite picture ask for one area."""

import os
import re
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass

import numpy as np
import rasterio
import shapely
from rasterio.features import rasterize
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.windows import from_bounds
from shapely.geometry import mapping

from . import copernicus, features, geonames
from .estonia_files import AGENT, BUILDINGS, CRS, HEIGHTS, LAND, PLACES, SURFACE, TRANSPORT, UTILITIES, WATER, _retrying, ensure  # noqa: F401 - ensure is part of this module's face
from .grid import CELL, Window
from .source_limits import check_raster_blocks, read_capped, read_shapefile, safe_archive_members

FIRST_NORTH = 6_000_000  # Great Britain's northings stop at 1,300 km, so a position says which grid it is on
LICENCE = "https://geoportaal.maaruum.ee/opendata-licence"
OWNER = "Republic of Estonia Land and Spatial Development Board"


SURFACE_M = 5
SURFACE_PER_CELL = CELL // SURFACE_M
HEIGHTS_M = 10
HEIGHTS_PER_CELL = CELL // HEIGHTS_M
MIN_BUILDING_PIXELS = 2  # of the 16 in a cell, before a footprint makes the cell solid
BAND_CELLS = 500  # rows of cells reduced at a time

FOREST = 10  # type "Mets" in ETAK: the other woody types are bushes and lone trees, too low to count as woodland
MIN_LINE_KV = 35  # the local lines below this hang on poles, not the pylons OS maps show
ROAD_CLASS = {10: "Primary", 20: "A Road", 30: "B Road", 40: "B Road", 50: "Local", 60: "Minor", 70: "Restricted", 80: "Restricted"}
# Settlement types, sized as OS sizes its names: cities and towns large, and small towns, city districts, boroughs and villages medium
NAME_SIZE = {"4": "Large", "5": "Large", "3": "Medium", "6": "Medium", "7": "Medium", "8": "Medium"}
TYPE_WORD = re.compile(r" (linn|alev|alevik|küla|linnaosa)(?= /|$)")  # official names end in their type, as in "Tapa linn", which a map leaves off

# The basic map, as pre-made tiles: the agency asks for these rather than its live map service, and for an unhurried pace.
TILE = "https://tiles.maaamet.ee/tm/tms/1.0.0/epk_v/10/{x}/{y}.png&ASUTUS=SITEGUARD&KESKKOND=LIVE&IS=MAPBUILD"
TILE_ORIGIN = (40500, 5993000)  # the south west corner of the tile grid, with rows counting north
TILE_M, TILE_PX = 1000, 256
PIECE_TILES = 10
TILE_PAUSE_S = 0.25
MAX_SHEET_BYTES = 8_000_000  # a square km of 5 m pixels is about 0.2 MB, so anything far bigger is not what it claims to be
MAX_TILE_BYTES = 2_000_000


def _need(data_root: str, name: str) -> str:
    path = os.path.join(data_root, name)
    if not os.path.exists(path):
        raise SystemExit(f"{name} is not in {data_root}. Download it first.")
    return path


def bands(rows: int, per_cell: int, band_cells: int = BAND_CELLS) -> list[slice]:
    """Slices of fine rows, whole cells deep, so the copies a reduction makes exist for one band at a time rather than the whole window."""
    step = band_cells * per_cell
    return [slice(r, r + step) for r in range(0, rows, step)]


def cells(fine: np.ndarray, per_cell: int) -> np.ndarray:
    """A block of fine pixels to rows and columns of cells, with each cell's pixels on the last axis."""
    rows, columns = fine.shape[0] // per_cell, fine.shape[1] // per_cell
    return fine.reshape(rows, per_cell, columns, per_cell).transpose(0, 2, 1, 3).reshape(rows, columns, per_cell * per_cell)


def cell_mean(fine: np.ndarray, per_cell: int) -> np.ndarray:
    blocks = cells(fine, per_cell)
    good = np.isfinite(blocks).sum(axis=2)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(good > 0, np.nan_to_num(blocks).sum(axis=2) / good, np.nan).astype("float32")


def cell_high(fine: np.ndarray, per_cell: int, minimum: int = 1) -> np.ndarray:
    """The 90th percentile of each cell, as the English lidar is reduced, so a lone mast does not make a whole cell tall."""
    ordered = np.sort(cells(fine, per_cell), axis=2)  # NaN sorts last
    good = np.isfinite(ordered).sum(axis=2)
    pick = np.maximum(np.ceil(good * 0.9).astype(int) - 1, 0)
    high = np.take_along_axis(ordered, pick[:, :, None], axis=2)[:, :, 0]
    return np.where(good >= minimum, high, np.nan).astype("float32")


def ground_posts(data_root: str, window: Window) -> np.ndarray:
    """Metres at the window's posts: the mean of the 10 m pixels in each 20 m cell. NaN beyond the data, which stops at the national border."""
    with rasterio.open(_need(data_root, HEIGHTS), driver="GTiff") as tif:
        t = tif.transform
        if (tif.crs is None or tif.crs.to_epsg() != CRS or tif.count != 1 or abs(t.a - HEIGHTS_M) > 1e-6
                or abs(t.e + HEIGHTS_M) > 1e-6 or abs(t.b) > 1e-9 or abs(t.d) > 1e-9
                or t.c % HEIGHTS_M or t.f % HEIGHTS_M):
            raise SystemExit(f"{HEIGHTS} is not on a {HEIGHTS_M} m grid, so it cannot be cut into the pack's cells")
        span = from_bounds(window.west - CELL / 2, window.south - CELL / 2, window.right + CELL / 2, window.top + CELL / 2, t).round_offsets().round_lengths()
        expected = window.side * HEIGHTS_PER_CELL
        if span.width != expected or span.height != expected:
            raise SystemExit(f"{HEIGHTS} has an unexpected pixel window")
        if tif.width > 100_000 or tif.height > 100_000:
            raise SystemExit(f"{HEIGHTS} has an unexpected source size")
        check_raster_blocks(tif)
        fine = tif.read(1, window=span, boundless=True, masked=True).astype("float32").filled(np.nan)
    return np.concatenate([cell_mean(fine[b], HEIGHTS_PER_CELL) for b in bands(len(fine), HEIGHTS_PER_CELL)])


def surface_pixels(data_root: str, window: Window) -> np.ndarray:
    """Height above ground, from lidar, at 5 m across the window. The file holds one small GeoTIFF per square km, named by northing and easting in km."""
    west, top = window.west - CELL // 2, window.top + CELL // 2
    size = window.side * SURFACE_PER_CELL
    fine = np.full((size, size), np.nan, "float32")
    path = _need(data_root, SURFACE)
    with zipfile.ZipFile(path) as z:
        sizes = {member.filename: member.file_size for member in safe_archive_members(z)}
    for north_km in range((top - size * SURFACE_M) // 1000, top // 1000 + 1):
        for east_km in range(west // 1000, (west + size * SURFACE_M) // 1000 + 1):
            name = f"{north_km - FIRST_NORTH // 1000:03d}{east_km:03d}_ndsm_5m.tif"
            if name not in sizes:
                continue
            if sizes[name] > MAX_SHEET_BYTES:
                raise SystemExit(f"{name} is far larger than a square km of heights should be")
            with rasterio.open(f"/vsizip/{{{path}}}/{name}", driver="GTiff") as tif:  # GDAL reads the agency's Deflate64 ZIPs
                t = tif.transform
                if (tif.crs is None or tif.crs.to_epsg() != CRS or tif.count != 1 or tif.width != 1000 // SURFACE_M
                        or tif.height != 1000 // SURFACE_M or abs(t.a - SURFACE_M) > 1e-6 or abs(t.e + SURFACE_M) > 1e-6
                        or abs(t.b) > 1e-9 or abs(t.d) > 1e-9 or abs(t.c - east_km * 1000) > 0.01
                        or abs(t.f - (north_km + 1) * 1000) > 0.01):
                    raise SystemExit(f"{name} does not match its 5 m square")
                check_raster_blocks(tif)
                values = tif.read(1, masked=True).astype("float32").filled(np.nan)
                row, col = round((top - tif.bounds.top) / SURFACE_M), round((tif.bounds.left - west) / SURFACE_M)
            r0, c0 = max(row, 0), max(col, 0)
            r1, c1 = min(row + values.shape[0], size), min(col + values.shape[1], size)
            if r0 < r1 and c0 < c1:
                fine[r0:r1, c0:c1] = values[r0 - row:r1 - row, c0 - col:c1 - col]
    return fine


def lidar(data_root: str, window: Window, half: int, ground: np.ndarray, houses) -> dict[str, np.ndarray]:
    """The same results as the English lidar gives: ground, tall cover and building heights, for the part reaching `half` metres from the middle."""
    fine = surface_pixels(data_root, window)
    west, top = window.west - CELL // 2, window.top + CELL // 2
    solid = np.zeros(fine.shape, "uint8")
    if len(houses):
        rasterize(((mapping(s), 1) for s in houses), out=solid, transform=from_origin(west, top, SURFACE_M, SURFACE_M))
    parts = bands(len(fine), SURFACE_PER_CELL)
    tall = np.concatenate([cell_high(fine[b], SURFACE_PER_CELL) for b in parts])
    tops = np.concatenate([cell_high(np.where(solid[b] == 1, fine[b], np.nan), SURFACE_PER_CELL, MIN_BUILDING_PIXELS) for b in parts])
    reach = np.abs(np.arange(window.side) * CELL - window.half) <= half
    inside = reach[:, None] & reach[None, :]
    return {"ground": np.where(inside, ground, np.nan), "tall": np.where(inside, tall, np.nan), "houses": np.where(inside, tops, np.nan)}


class Etak:
    """The Estonian Topographic Database: one zip of shapefiles per theme."""

    def __init__(self, data_root: str, window: Window):
        self.root, self.window = data_root, window

    def read(self, theme: str, layer: str, fields: list[str] | None = None, where: str | None = None) -> tuple[np.ndarray, dict]:
        """A where clause needs its field among the columns read, or it quietly matches nothing."""
        w = self.window
        meta, _, geometry, data = read_shapefile(_need(self.root, theme), f"{layer}.shp", bbox=(w.west, w.south, w.right, w.top), columns=fields or [], where=where, force_2d=True)
        return shapely.from_wkb(geometry), dict(zip(meta["fields"], data))


def place_names(data_root: str, window: Window) -> tuple[np.ndarray, dict]:
    """A point and a name for each settlement in the window, in the fields OS names come in. A settlement in several pieces is named once, on its largest."""
    w = window
    meta, _, geometry, data = read_shapefile(_need(data_root, PLACES), "asustusyksus.shp", bbox=(w.west, w.south, w.right, w.top), columns=["ANIMI", "AKOOD", "TYYP"], force_2d=True)
    shapes, fields = shapely.from_wkb(geometry), dict(zip(meta["fields"], data))
    largest = {}
    for i, code in enumerate(fields["AKOOD"]):
        if code not in largest or shapes[i].area > shapes[largest[code]].area:
            largest[code] = i
    keep = np.array(sorted(largest.values()), int)
    shapes = shapes[keep]
    middle = shapely.centroid(shapes)
    middle = np.where(shapely.contains(shapes, middle), middle, shapely.point_on_surface(shapes))  # a curved village can have its middle outside it
    inside = shapely.contains_xy(shapely.box(w.west, w.south, w.right, w.top), shapely.get_x(middle), shapely.get_y(middle))
    names = np.array([TYPE_WORD.sub("", str(n)) for n in fields["ANIMI"][keep]], dtype=object)
    sizes = np.array([NAME_SIZE.get(str(t), "Small") for t in fields["TYYP"][keep]], dtype=object)
    return middle[inside], {"DISTNAME": names[inside], "CLASSIFICA": np.full(inside.sum(), "Populated Place", dtype=object), "FONTHEIGHT": sizes[inside]}


def road_rows(shapes: np.ndarray, types: np.ndarray) -> tuple[np.ndarray, dict]:
    """Split into plain lines, each with the game's name for its class, and leave out anything the game would not draw."""
    parts, index = shapely.get_parts(shapes, return_index=True)
    names = np.array([ROAD_CLASS.get(int(types[i]), "") for i in index], dtype=object)
    keep = names != ""
    return parts[keep], {"CLASSIFICA": names[keep]}


def tile_numbers(window: Window) -> tuple[range, range]:
    """Columns west to east, and rows north to south, of the tiles covering the window. Rows count north from the grid's origin."""
    x0, y0 = TILE_ORIGIN
    return range((window.west - x0) // TILE_M, (window.right - x0 - 1) // TILE_M + 1), range((window.top - y0 - 1) // TILE_M, (window.south - y0) // TILE_M - 1, -1)


def _tile(x: int, y: int) -> np.ndarray | None:
    """One tile as RGB rows, or None where the map has no tile."""
    def attempt() -> bytes:
        request = urllib.request.Request(TILE.format(x=x, y=y), headers=AGENT)
        with urllib.request.urlopen(request, timeout=60) as reply:
            return read_capped(reply, MAX_TILE_BYTES, "basic map tile")
    try:
        data = _retrying(attempt, f"map tile {x}, {y}")
    except urllib.error.HTTPError:
        return None
    with MemoryFile(data) as memory, memory.open(driver="PNG") as png:
        if png.width != TILE_PX or png.height != TILE_PX or png.count not in (1, 3, 4) or any(dtype != "uint8" for dtype in png.dtypes):
            raise SystemExit("basic map tile has unexpected pixels")
        if png.count >= 3:
            return png.read([1, 2, 3])
        colours = np.zeros((256, 3), "uint8")
        for value, colour in png.colormap(1).items():
            colours[value] = colour[:3]
        return np.moveaxis(colours[png.read(1)], 2, 0)


def base_map(window: Window, say, tile=_tile, pause: float = TILE_PAUSE_S) -> list[dict]:
    """The 1:10,000 basic map, in pieces of about 10 km. A piece can reach a little past the window, as tiles are not cut."""
    columns, rows = tile_numbers(window)
    x0, y0 = TILE_ORIGIN
    pictures, fetched = [], 0
    for r in range(0, len(rows), PIECE_TILES):
        piece_rows = rows[r:r + PIECE_TILES]
        for c in range(0, len(columns), PIECE_TILES):
            piece_columns = columns[c:c + PIECE_TILES]
            mosaic = np.full((3, len(piece_rows) * TILE_PX, len(piece_columns) * TILE_PX), 255, "uint8")
            for j, y in enumerate(piece_rows):
                for i, x in enumerate(piece_columns):
                    part = tile(x, y)
                    if part is not None:
                        mosaic[:, j * TILE_PX:(j + 1) * TILE_PX, i * TILE_PX:(i + 1) * TILE_PX] = part
                    fetched += 1
                    if fetched % 100 == 0:
                        say(f"basic map: {fetched} of {len(rows) * len(columns)} tiles")
                    time.sleep(pause)
            with MemoryFile() as memory:
                with memory.open(driver="JPEG", width=mosaic.shape[2], height=mosaic.shape[1], count=3, dtype="uint8", QUALITY=88) as jpeg:
                    jpeg.write(mosaic)
                data = memory.read()
            pictures.append({"layer": "osmap", "west": x0 + piece_columns[0] * TILE_M, "top": y0 + (piece_rows[0] + 1) * TILE_M, "width": len(piece_columns) * TILE_M,
                             "height": len(piece_rows) * TILE_M, "type": "image/jpeg", "data": data})
    say(f"basic map: {len(pictures)} pieces, {sum(len(p['data']) for p in pictures) / 1e6:.1f} MB")
    return pictures


@dataclass
class Inputs:
    """What every source hands to the rest of the build."""

    base: np.ndarray  # heights at every post, with no gaps
    no_data: np.ndarray  # posts that count as water: with no height at all, or water in Copernicus's mask past the border
    wood: np.ndarray
    houses: np.ndarray
    power: np.ndarray
    water: np.ndarray
    roads: np.ndarray
    road_fields: dict
    names: np.ndarray
    name_fields: dict
    lidar: dict[str, np.ndarray] | None
    copernicus: bool = False  # whether Copernicus heights filled any posts past the border
    past: np.ndarray | None = None  # the posts Copernicus heights filled, where the basic map may be blank
    geonames: bool = False  # whether any names past the border came from GeoNames


def beyond_border(data_root: str, window: Window, ground: np.ndarray, fetch: bool, say) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Fills the posts past the border from Copernicus heights. Returns the heights, the posts that count as water, and the posts filled."""
    no_data = ~np.isfinite(ground)
    if not no_data.any():
        return ground, no_data, no_data
    if fetch:
        copernicus.ensure(data_root, window, say)
    far, wet = copernicus.heights(data_root, window)
    use = no_data & np.isfinite(far)
    if not use.any():
        say("no Copernicus heights on this machine, so ground past the border counts as water. --fetch gets them.")
        return ground, no_data, use
    say(f"Copernicus heights fill {use.mean():.1%} of the posts, of which {(use & wet).sum() / use.sum():.0%} is water in its mask")
    return np.where(use, far, ground), (no_data & ~use) | (use & wet), use


def gather(data_root: str, window: Window, lidar_km: int, say, fetch: bool = False) -> Inputs:
    ground = ground_posts(data_root, window)
    no_data = ~np.isfinite(ground)
    say(f"heights: {window.side} x {window.side} posts, {np.nanmin(ground):.1f} to {np.nanmax(ground):.1f} m, {no_data.mean():.1%} with no data")
    if no_data.mean() > 0.9:
        raise SystemExit("There is no Estonian height data here. It stops at the national border.")
    base, no_data, past = beyond_border(data_root, window, ground, fetch, say)
    etak = Etak(data_root, window)
    wood, _ = etak.read(LAND, "E_305_puittaimestik_a", ["tyyp"], f"tyyp = {FOREST}")
    houses, _ = etak.read(BUILDINGS, "E_401_hoone_ka")
    power, _ = etak.read(UTILITIES, "E_601_elektriliin_j", ["nimipinge"], f"nimipinge >= {MIN_LINE_KV}")
    water = [etak.read(WATER, layer)[0] for layer in ("E_201_meri_a", "E_202_seisuveekogu_a", "E_203_vooluveekogu_a")]
    road_shapes, road_fields = etak.read(TRANSPORT, "E_501_tee_j", ["tyyp"])
    roads, classes = road_rows(road_shapes, road_fields["tyyp"])
    names, name_fields = place_names(data_root, window)
    say(f"ETAK: {len(houses)} buildings, {len(wood)} woods, {len(roads)} roads, {len(power)} power lines. Settlements: {len(names)}")
    if fetch and past.any():
        geonames.ensure(data_root, say)
    far_names, far_fields = geonames.place_names(data_root, window) if past.any() else ([], {})
    if len(far_names):
        say(f"GeoNames: {len(far_names)} settlements past the border")
        names, name_fields = np.concatenate([names, far_names]), {k: np.concatenate([v, far_fields[k]]) for k, v in name_fields.items()}
    power = shapely.get_parts(power)
    features.check_counts(window, power, roads, names)  # before the lidar, so a refusal does not throw that work away
    return Inputs(np.nan_to_num(base).astype("float32"), no_data, wood, houses, power, np.concatenate(water), roads, classes, names, name_fields,
                  lidar(data_root, window, lidar_km * 500, ground, houses) if lidar_km else None, bool(past.any()), past, bool(len(far_names)))


def credits(lidar_km: int, year: int, copernicus_heights: bool = False, russian_names: bool = False) -> dict[str, str]:
    """The licence asks for the owner, the title and the age of the data, and for the licence itself to travel with data given to others.
    Copernicus heights and GeoNames names need their own notices, shown whatever the base map."""
    found = {"osmap": f"Estonian basic map {year}, topographic data, and administrative and settlement units: {OWNER}. Licence: {LICENCE}"}
    found["lidar"] = f"Elevation data 2020-2023: {OWNER}" if lidar_km else f"Elevation data: {OWNER}"
    if copernicus_heights:
        found["heights"] = copernicus.CREDIT
    if russian_names:
        found["names"] = geonames.CREDIT
    return found
