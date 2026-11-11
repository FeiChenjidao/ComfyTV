"""Image generation must stay text-to-image capable.

Reference media bindings used to be `required: true` in the image presets, which
made `_Resolver.resolve` raise as soon as nothing was wired — the generation
stage could only run image-to-image. These tests pin the two relaxations that
keep text-to-image working: the run-time config and the UI usage report.
"""

from __future__ import annotations


def _usage(bindings, **kw):
    from ComfyTV.api.stages import _compute_input_usage
    return _compute_input_usage(bindings, **kw)


IMAGE_BINDINGS = [
    {"from": "upstream_image:annotated[0]", "required": True},
    {"from": "upstream_image:annotated[1]"},
    {"from": "main_prompt"},
    {"from": "option:batch_size", "default": "1", "cast": "int"},
]


class TestUsageReport:
    def test_image_bindings_stay_required_by_default(self):
        usage = _usage(IMAGE_BINDINGS)
        assert usage["requires"]["image"] is True
        assert usage["required_slots"]["image"] == [0]

    def test_media_optional_drops_the_image_requirement(self):
        usage = _usage(IMAGE_BINDINGS, media_optional=True)
        assert usage["requires"]["image"] is False
        assert usage["required_slots"]["image"] == []

    def test_media_optional_keeps_wiring_capacity(self):
        usage = _usage(IMAGE_BINDINGS, media_optional=True)
        assert usage["uses"]["image"] is True
        assert usage["max_inputs"]["image"] == 2

    def test_media_optional_does_not_touch_text_requirements(self):
        usage = _usage(
            [{"from": "upstream_text:value[0]", "required": True}],
            media_optional=True,
        )
        assert usage["requires"]["text"] is True


class TestInvokeConfig:
    def test_image_kind_drops_required_on_media_bindings(self):
        from ComfyTV.runners.workflow_db.config import _relax_media_required

        inputs = _relax_media_required("image", {
            "277": {"image": {"from": "upstream_image:annotated[0]", "required": True}},
            "280": {"prompt": {"from": "main_prompt"}},
        })
        assert "required" not in inputs["277"]["image"]
        assert inputs["280"]["prompt"] == {"from": "main_prompt"}

    def test_edit_kinds_keep_their_required_media(self):
        from ComfyTV.runners.workflow_db.config import _relax_media_required

        for kind in ("image-edit", "inpaint", "outpaint", "upscale", "cutout"):
            inputs = _relax_media_required(kind, {
                "1": {"image": {"from": "upstream_image:annotated[0]", "required": True}},
            })
            assert inputs["1"]["image"]["required"] is True, kind

    def test_non_media_requirements_survive(self):
        from ComfyTV.runners.workflow_db.config import _relax_media_required

        inputs = _relax_media_required("image", {
            "1": {"text": {"from": "upstream_text:value[0]", "required": True}},
        })
        assert inputs["1"]["text"]["required"] is True

    def test_resolver_no_longer_raises_for_an_unwired_image(self):
        from ComfyTV.runners._workflow_resolve import _Resolver
        from ComfyTV.runners.base import RunnerContext
        from ComfyTV.runners.workflow_db.config import _relax_media_required

        ctx = RunnerContext(kind="image", main_prompt="a cat")
        config = {
            "inputs": _relax_media_required("image", {
                "277": {"image": {"from": "upstream_image:annotated[0]", "required": True}},
            }),
        }
        resolver = _Resolver(config, ctx)
        # KEEP_ORIGINAL is the sentinel that lets the workflow's own value stand.
        from ComfyTV.runners._workflow_resolve import KEEP_ORIGINAL

        assert resolver.resolve("node 277 image", config["inputs"]["277"]["image"]) is KEEP_ORIGINAL


class TestShippedPresets:
    def test_image_presets_do_not_require_an_input_image(self):
        import json
        from pathlib import Path

        root = Path(__file__).resolve().parents[1] / "workflows" / "image"
        presets = sorted(root.glob("*_preset.json"))
        assert presets, "expected shipped image presets"
        for path in presets:
            data = json.loads(path.read_text(encoding="utf-8"))
            for node_id, fields in (data.get("inputs") or {}).items():
                for input_name, spec in (fields or {}).items():
                    assert spec.get("required") is not True, f"{path.name}: {node_id}.{input_name}"
