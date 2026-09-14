"""Unit tests for workflow API-node cost extraction (no DB / sqlalchemy)."""
from __future__ import annotations

import importlib.util
from pathlib import Path

_PATH = Path(__file__).resolve().parents[1] / "runners" / "workflow_db" / "api_cost.py"
_spec = importlib.util.spec_from_file_location("comfytv_api_cost", _PATH)
assert _spec and _spec.loader
api_cost = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(api_cost)


def test_is_link():
    assert api_cost._is_link(["12", 0]) is True
    assert api_cost._is_link([12, 1]) is True
    assert api_cost._is_link("hello") is False
    assert api_cost._is_link(["only"]) is False


def test_node_io_splits_widgets_and_links():
    widgets, connected, groups = api_cost._node_io({
        "inputs": {
            "prompt": "hi",
            "duration": 5,
            "image": ["3", 0],
            "images.image0": ["4", 0],
            "images.image1": ["5", 0],
        }
    })
    assert widgets == {"prompt": "hi", "duration": 5}
    assert connected["image"] is True
    assert connected["prompt"] is False
    assert groups["images"] == 2


def test_collect_skips_when_no_api_defs(monkeypatch):
    monkeypatch.setattr(api_cost, "get_api_node_defs", lambda: {})
    assert api_cost.collect_api_cost_nodes({
        "1": {"class_type": "KlingTextToVideoNode", "inputs": {"duration": 5}},
    }) == []


def test_collect_paid_nodes(monkeypatch):
    monkeypatch.setattr(api_cost, "get_api_node_defs", lambda: {
        "KlingTextToVideoNode": {
            "class_type": "KlingTextToVideoNode",
            "display_name": "Kling Text to Video",
            "price_badge": {
                "engine": "jsonata",
                "expr": '{"type":"usd","usd":0.1}',
                "depends_on": {"widgets": [], "inputs": [], "input_groups": []},
            },
        },
    })
    nodes = api_cost.collect_api_cost_nodes({
        "1": {
            "class_type": "KlingTextToVideoNode",
            "inputs": {"duration": 5, "image": ["2", 0]},
            "_meta": {"title": "My Kling"},
        },
        "2": {"class_type": "LoadImage", "inputs": {"image": "a.png"}},
    })
    assert len(nodes) == 1
    assert nodes[0]["id"] == "1"
    assert nodes[0]["title"] == "My Kling"
    assert nodes[0]["widgets"]["duration"] == 5
    assert nodes[0]["inputs"]["image"]["connected"] is True
    assert nodes[0]["price_badge"]["expr"]


def test_schema_to_api_def_requires_api_node_flag():
    assert api_cost._schema_to_api_def("X", {"display_name": "X"}) is None
    entry = api_cost._schema_to_api_def("X", {
        "api_node": True,
        "display_name": "Paid X",
        "price_badge": {"engine": "jsonata", "expr": '{"type":"usd","usd":1}'},
    })
    assert entry["display_name"] == "Paid X"
    assert entry["price_badge"]["expr"]
