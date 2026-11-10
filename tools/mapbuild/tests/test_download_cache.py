"""Reuse only verified OS downloads and replace damaged cache files atomically."""

import hashlib
import io

import pytest

from mapbuild import download


def item_for(body):
    return {
        "fileName": "terrain.zip", "size": len(body),
        "md5": hashlib.md5(body, usedforsecurity=False).hexdigest().upper(),
        "url": "https://api.os.uk/downloads/v1/products/Terrain50/downloads?area=GB",
    }


def test_verified_cache_is_reused_without_a_download(tmp_path, monkeypatch):
    body = b"valid OS map data"
    target = tmp_path / "terrain.zip"
    target.write_bytes(body)

    def unexpected_download(*_args, **_kwargs):
        pytest.fail("a verified cached file must not be downloaded again")

    monkeypatch.setattr(download.urllib.request, "urlopen", unexpected_download)
    download._fetch(item_for(body), str(tmp_path), lambda _message: None)
    assert target.read_bytes() == body


def test_same_size_damaged_cache_is_downloaded_again(tmp_path, monkeypatch):
    body, damaged = b"valid OS map data", b"wrong OS map data"
    assert len(body) == len(damaged)
    target = tmp_path / "terrain.zip"
    target.write_bytes(damaged)
    requests = []

    def reply(url, **_kwargs):
        requests.append(url)
        return io.BytesIO(body)

    monkeypatch.setattr(download.urllib.request, "urlopen", reply)
    download._fetch(item_for(body), str(tmp_path), lambda _message: None)
    assert len(requests) == 1
    assert target.read_bytes() == body
    assert not (tmp_path / "terrain.zip.part").exists()


def test_bad_replacement_does_not_overwrite_the_cached_file(tmp_path, monkeypatch):
    body, damaged = b"valid OS map data", b"wrong OS map data"
    target = tmp_path / "terrain.zip"
    target.write_bytes(damaged)
    monkeypatch.setattr(download.urllib.request, "urlopen", lambda *_args, **_kwargs: io.BytesIO(damaged))
    with pytest.raises(SystemExit, match="did not download correctly"):
        download._fetch(item_for(body), str(tmp_path), lambda _message: None)
    assert target.read_bytes() == damaged
    assert not (tmp_path / "terrain.zip.part").exists()
