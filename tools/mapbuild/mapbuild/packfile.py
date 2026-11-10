"""The .sgmap file: "SGMAP", a format version byte, a 4-byte little-endian header length, a JSON header, then the sections it lists."""

import gzip
import hashlib
import json
import struct
from dataclasses import dataclass

import numpy as np

MAGIC = b"SGMAP"
VERSION = 1
MAX_FEATURES = 32 * 1024 * 1024  # MAX_FEATURES in frontend/src/api/pack-store.js: the game refuses a pack with more


@dataclass
class Grids:
    """North to south. ground is metres ODN, rounded to 0.1, and the rest are 8-bit."""

    ground: np.ndarray
    canopy: np.ndarray
    bldg: np.ndarray
    cover: np.ndarray

    def raw(self) -> list[tuple[str, bytes]]:
        return [
            ("ground", self.ground.astype("<f4").tobytes()),
            ("canopy", self.canopy.astype("u1").tobytes()),
            ("bldg", self.bldg.astype("u1").tobytes()),
            ("cover", self.cover.astype("u1").tobytes()),
        ]


def check(grids: Grids) -> None:
    """A NaN height compares false in the game's line of sight test, which would silently report a clear line."""
    if not np.isfinite(grids.ground).all():
        raise ValueError("ground has values that are not finite")
    if not grids.ground.shape == grids.canopy.shape == grids.bldg.shape == grids.cover.shape:
        raise ValueError("grids differ in shape")
    if grids.ground.shape[0] != grids.ground.shape[1] or grids.ground.shape[0] % 2 == 0:
        raise ValueError("grids must be square, with a post at the centre")


def grids_hash(grids: Grids) -> str:
    digest = hashlib.sha256()
    for _, data in grids.raw():
        digest.update(data)
    return digest.hexdigest()


def encode_features(features: dict) -> bytes:
    return json.dumps(features, separators=(",", ":")).encode()


def thin_buildings(features: dict, limit: int) -> dict:
    """The features, drawing fewer buildings if they would be over `limit` bytes. A dense town can have more than the game reads.

    The buildings nearest the middle are kept, as with the count cap in features.py. Line of sight is unaffected: it reads the
    building grid, which has every building. If the buildings are not what makes it too big, the features come back unchanged."""
    rows = features.get("buildings")
    total = len(encode_features(features))
    if total <= limit or not rows:
        return features
    bare = len(encode_features({**features, "buildings": []}))
    if bare > limit:
        return features
    rows = sorted(rows, key=lambda r: r[0] ** 2 + r[1] ** 2)
    keep = int((limit - bare) / ((total - bare) / len(rows)) * 0.97)  # each building costs about the same; a little to spare
    while True:
        thinned = {**features, "buildings": rows[:keep]}
        if len(encode_features(thinned)) <= limit:
            return thinned
        keep = int(keep * 0.95)


def write_pack(path: str, header: dict, grids: Grids, features: dict, pictures: list[dict], say=None) -> dict:
    """pictures: { layer, west, top, width, height (metres), type, data }. Returns the header written. `say` is told of any thinning."""
    check(grids)
    sections, blobs, offset = [], [], 0

    def add(name: str, blob: bytes, raw_length: int, **extra) -> None:
        nonlocal offset
        sections.append({"name": name, "offset": offset, "length": len(blob), "rawLength": raw_length, **extra})
        blobs.append(blob)
        offset += len(blob)

    for name, data in grids.raw():
        add(name, gzip.compress(data, 6, mtime=0), len(data))
    text = encode_features(features)
    if len(text) > MAX_FEATURES:
        thinned = thin_buildings(features, MAX_FEATURES)
        if say and thinned is not features:
            say(f"buildings: the buildings, roads and names came to {len(text) / 1e6:.0f} MB, over the {MAX_FEATURES / 1e6:.0f} MB the game reads, "
                f"so the {len(thinned['buildings'])} buildings nearest the middle are drawn, of {len(features['buildings'])}. Line of sight still has them all")
        features, text = thinned, encode_features(thinned)
    if len(text) > MAX_FEATURES:
        raise ValueError(f"the buildings, roads and names come to {len(text) / 1e6:.0f} MB, more than the game reads: build a smaller pack")
    add("features", gzip.compress(text, 6, mtime=0), len(text))
    for index, picture in enumerate(pictures):
        meta = {k: v for k, v in picture.items() if k != "data"}
        add(f"picture{index}", picture["data"], len(picture["data"]), **meta)

    final = {**header, "gridsSha256": grids_hash(grids), "sections": sections}
    head = json.dumps(final, separators=(",", ":")).encode()
    with open(path, "wb") as out:
        out.write(MAGIC + bytes([VERSION]) + struct.pack("<I", len(head)) + head)
        for blob in blobs:
            out.write(blob)
    return final
