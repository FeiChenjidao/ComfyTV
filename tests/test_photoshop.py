from __future__ import annotations

import base64
import asyncio
from io import BytesIO
import json

import pytest
from PIL import Image

from ComfyTV.api.photoshop import _crop_to_selection, _decode_png, _is_loopback, photoshop_layer


def _png(width: int = 2, height: int = 3) -> bytes:
    out = BytesIO()
    Image.new("RGBA", (width, height), (0, 0, 0, 0)).save(out, format="PNG")
    return out.getvalue()


def test_decode_png_reads_dimensions():
    data = _png()
    decoded, width, height = _decode_png(base64.b64encode(data).decode("ascii"))
    assert decoded == data
    assert (width, height) == (2, 3)


@pytest.mark.parametrize("value", ["", "not-base64", base64.b64encode(b"jpeg").decode("ascii")])
def test_decode_png_rejects_invalid_payload(value):
    with pytest.raises(ValueError):
        _decode_png(value)


def test_photoshop_bridge_is_loopback_only():
    assert _is_loopback("127.0.0.1")
    assert _is_loopback("::1")
    assert _is_loopback("::ffff:127.0.0.1")
    assert not _is_loopback("192.168.1.5")


def test_crop_to_selection_preserves_layer_offset():
    source = BytesIO()
    Image.new("RGBA", (4, 3), (255, 0, 0, 255)).save(source, format="PNG")
    data, width, height = _crop_to_selection(
        source.getvalue(),
        {"left": 10, "top": 20, "right": 14, "bottom": 23},
        {"left": 8, "top": 19, "right": 12, "bottom": 22},
    )
    with Image.open(BytesIO(data)) as image:
        assert (width, height) == (4, 3)
        assert image.getpixel((0, 0))[3] == 0
        assert image.getpixel((2, 1)) == (255, 0, 0, 255)


class _Request:
    def __init__(self, body, remote="127.0.0.1"):
        self._body = body
        self.remote = remote
        self.content_length = len(json.dumps(body))

    async def json(self):
        return self._body


def test_layer_route_stores_and_broadcasts(monkeypatch, tmp_path):
    import folder_paths
    from server import PromptServer

    sent = []
    monkeypatch.setattr(folder_paths, "get_input_directory", lambda: str(tmp_path))
    monkeypatch.setattr(PromptServer.instance, "send_sync", lambda event, payload: sent.append((event, payload)))
    request = _Request({
        "image_base64": base64.b64encode(_png()).decode("ascii"),
        "document": "Concept.psd",
        "layer": "Character",
    })

    response = asyncio.run(photoshop_layer(request))
    payload = json.loads(response.text)
    stored = tmp_path / "comfytv" / "photoshop" / payload["name"]
    assert response.status == 200
    assert stored.read_bytes() == _png()
    assert sent[0][0] == "comfytv-photoshop-layer"
    assert sent[0][1]["layer"] == "Character"


def test_layer_route_rejects_non_loopback():
    response = asyncio.run(photoshop_layer(_Request({}, remote="192.168.1.5")))
    assert response.status == 403
