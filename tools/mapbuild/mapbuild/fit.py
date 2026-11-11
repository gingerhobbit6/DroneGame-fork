"""Lat/long is worked out once, here, with full OSTN15 accuracy in Great Britain. The pack stores a small polynomial, so the browser needs no projection library."""

import numpy as np
import pyproj
from pyproj.transformer import TransformerGroup

from .grid import Window

MAX_ERROR_M = 5  # a 60 km pack reaches 0.9 to 1.6 m at its corners, measured across Britain, and the error grows with the fourth power of the size,
# so a 70 km pack reaches about 3 m. A quarter of a 20 m cell; a 30 km pack stays near 0.1 m.
SAMPLES = 61
METRES_PER_DEGREE = 111_320


def _terms(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    return np.column_stack([np.ones_like(x), x, y, x * x, x * y, y * y])


def fit_to_coefficients(east: np.ndarray, north: np.ndarray, lon: np.ndarray, lat: np.ndarray, window: Window) -> tuple[list[float], list[float], float]:
    """Quadratic fits for longitude and latitude, in tens of km from the middle. Also the worst error in metres."""
    x, y = (east - window.east) / 10_000, (north - window.north) / 10_000
    terms = _terms(x, y)
    lon_fit = np.linalg.lstsq(terms, lon, rcond=None)[0]
    lat_fit = np.linalg.lstsq(terms, lat, rcond=None)[0]
    lat_error = (terms @ lat_fit - lat) * METRES_PER_DEGREE
    lon_error = (terms @ lon_fit - lon) * METRES_PER_DEGREE * np.cos(np.radians(lat))
    return lon_fit.tolist(), lat_fit.tolist(), float(np.hypot(lat_error, lon_error).max())


def best_transformer(source: str | int, target: str | int):
    """Fetches PROJ's grid files if it needs them, and refuses to carry on with a less accurate method."""
    pyproj.network.set_network_enabled(True)
    group = TransformerGroup(source, target, always_xy=True)
    if not group.best_available:
        group.download_grids(verbose=False)
        group = TransformerGroup(source, target, always_xy=True)
    if not group.best_available:
        raise SystemExit(f"The grid files for {source} to {target} are not available, so an accurate position cannot be worked out.")
    return group.transformers[0]


def geoid_separation(window: Window, crs: int, to_wgs) -> float:
    """How far the ellipsoid is below the map's heights at the middle of the window."""
    if crs == 27700:
        to_height = best_transformer("EPSG:7405", "EPSG:4979")  # British National Grid + ODN height, to WGS 84 with ellipsoid height
        return to_height.transform(window.east, window.north, 0.0)[2]
    # shortcut: EGM2008 stands in for Estonia's own height system, as PROJ has no grid for it. Only the altitude SAPIENT reports uses this. Upgrade if PROJ gains one.
    lon, lat = to_wgs.transform(window.east, window.north)
    return best_transformer("EPSG:4326+3855", "EPSG:4979").transform(lon, lat, 0.0)[2]


def geo_fit(window: Window, crs: int = 27700) -> dict:
    to_wgs = best_transformer(crs, 4326)
    grid = np.linspace(-window.half, window.half, SAMPLES)
    east, north = np.meshgrid(window.east + grid, window.north + grid)
    east, north = east.ravel(), north.ravel()
    lon, lat = to_wgs.transform(east, north)
    lon_fit, lat_fit, error = fit_to_coefficients(east, north, np.asarray(lon), np.asarray(lat), window)
    if not np.isfinite(error) or error > MAX_ERROR_M:  # NaN compares False with everything, so it would pass the limit alone
        raise SystemExit(f"The position fit is out by {error:.2f} m, over the {MAX_ERROR_M} m limit.")
    ellipsoid = geoid_separation(window, crs, to_wgs)
    if not np.isfinite(ellipsoid):
        raise SystemExit("The geoid model did not give a height here.")
    return {"lonFit": lon_fit, "latFit": lat_fit, "fitErrorM": round(error, 3), "geoidSeparation": round(float(ellipsoid), 2)}
