"""Fetch the OS open data a pack needs, once, checking each file against the checksum OS publishes."""

import hashlib
import json
import os
import re
import urllib.parse
import urllib.request

from .source_limits import enough_disk_room, read_capped

API = "https://api.os.uk/downloads/v1/products/{}/downloads"
HOST = "api.os.uk"  # the listing is untrusted input too: a file is only fetched from OS itself, over https
MAX_LISTING_BYTES = 5_000_000
MAX_OS_BYTES = 4_000_000_000


def _pick(product: str, area: str, fmt: str, sub: str | None) -> dict | None:
    with urllib.request.urlopen(API.format(product), timeout=60) as reply:
        listing = json.loads(read_capped(reply, MAX_LISTING_BYTES, "OS download listing"))
    found = [x for x in listing if x.get("area") == area and x.get("format") == fmt and x.get("subformat") == sub]
    return found[0] if found else None


def _fetch(item: dict, folder: str, say) -> None:
    name = os.path.basename(item["fileName"])
    if name != item["fileName"] or name.startswith("."):
        raise SystemExit(f"refusing an odd file name from OS: {name!r}")
    url = urllib.parse.urlsplit(str(item.get("url", "")))
    md5 = item.get("md5")
    if (url.scheme != "https" or url.hostname != HOST or not isinstance(item.get("size"), int)
            or not 0 < item["size"] <= MAX_OS_BYTES or not (isinstance(md5, str) and re.fullmatch(r"[0-9a-fA-F]{32}", md5))):
        raise SystemExit(f"refusing a download OS did not describe properly: {name}")
    os.makedirs(folder, exist_ok=True)
    target = os.path.join(folder, name)
    if os.path.exists(target) and os.path.getsize(target) == item["size"]:
        return
    say(f"downloading {name}, {item['size'] / 1e6:.0f} MB")
    digest, done = hashlib.md5(usedforsecurity=False), 0
    part = target + ".part"
    no_room = False
    with urllib.request.urlopen(item["url"], timeout=120) as reply, open(part, "wb") as out:
        while chunk := reply.read(1 << 20):
            done += len(chunk)
            if done > item["size"]:  # never more than OS said, so a bad reply cannot fill the disc
                break
            if not enough_disk_room(folder, len(chunk)):
                no_room = True
                break
            out.write(chunk)
            digest.update(chunk)
    if no_room:
        os.remove(part)
        raise SystemExit(f"not enough free space to download {name}")
    if done != item["size"] or digest.hexdigest() != md5.lower():
        os.remove(part)
        raise SystemExit(f"{name} did not download correctly")
    os.replace(part, target)


def ensure(data_root: str, squares: list[str], say) -> None:
    item = _pick("Terrain50", "GB", "ASCII Grid and GML (Grid)", None)
    if not item:
        raise SystemExit("OS no longer lists Terrain 50 in the expected format")
    _fetch(item, os.path.join(data_root, "terrain50"), say)
    for square in squares:
        openmap = _pick("OpenMapLocal", square, "ESRI® Shapefile", None)
        picture = _pick("VectorMapDistrict", square, "GeoTIFF", "Full Colour")
        if not openmap or not picture:
            raise SystemExit(f"OS has no open map data for square {square}")
        _fetch(openmap, os.path.join(data_root, f"openmap_{square.lower()}"), say)
        _fetch(picture, os.path.join(data_root, f"vmd_{square.lower()}"), say)
