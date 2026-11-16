import asyncio
import base64
from io import BytesIO

import pytest
from PIL import Image

torch = pytest.importorskip("torch")

from ComfyTV.photoshop import nodes as photoshop_nodes
from ComfyTV.photoshop.nodes import SendPromptToPhotoshop, _layered_payload


def test_layered_payload_preserves_geometry_order_and_alpha():
    background = torch.zeros((1, 2, 3, 3), dtype=torch.float32)
    foreground = torch.ones((1, 2, 2, 3), dtype=torch.float32)
    mask = torch.tensor([[[0.0, 1.0], [0.5, 0.0]]], dtype=torch.float32)
    payload = _layered_payload({
        "canvas": (1200, 900),
        "layers": [
            {"image": foreground, "mask": mask, "name": "subject", "x": 15, "y": 25, "z_index": 3},
            {"image": background, "name": "background", "x": 0, "y": 0, "z_index": 0},
        ],
    })

    assert payload["canvas"] == {"width": 1200, "height": 900}
    assert [item["name"] for item in payload["layers"]] == ["background", "subject"]
    subject = payload["layers"][1]
    assert (subject["x"], subject["y"], subject["width"], subject["height"], subject["zIndex"]) == (15, 25, 2, 2, 3)
    with Image.open(BytesIO(base64.b64decode(subject["base64"]))) as image:
        assert image.mode == "RGBA"
        assert list(image.getchannel("A").getdata()) == [255, 0, 127, 255]


def test_prompt_output_node_routes_text_with_job_id(monkeypatch):
    sent = []

    async def fake_send(text, job_id):
        sent.append((text, job_id))

    monkeypatch.setattr(photoshop_nodes, "send_prompt_result", fake_send)
    asyncio.run(SendPromptToPhotoshop.execute(
        "enhanced prompt",
        prompt={"1": {"inputs": {"job_id": "prompt-job"}}},
    ))
    assert sent == [("enhanced prompt", "prompt-job")]
