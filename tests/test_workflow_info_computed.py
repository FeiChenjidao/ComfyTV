from ComfyTV.api.stages import _compute_input_usage


def test_usage_reports_computed_bindings():
    out = _compute_input_usage([
        {"from": "computed:width"}, {"from": "computed:height"},
        {"from": "upstream_image:annotated[0]", "required": True},
    ])
    assert out["uses_computed"] == {"width": True, "height": True, "length": False}
    assert out["uses"]["image"] is True


def test_usage_without_computed_bindings():
    out = _compute_input_usage([{"from": "main_prompt"}, {"from": "option:seed"}])
    assert out["uses_computed"] == {"width": False, "height": False, "length": False}
    assert out["uses_options"] == {"seed": True}


def test_usage_tracks_all_option_bindings():
    out = _compute_input_usage([
        {"from": "option:material"},
        {"from": "option:mode"},
        {"from": "option:texture_quality"},
        {"from": "option:tapose"},
    ])
    assert out["uses_options"] == {
        "material": True,
        "mode": True,
        "texture_quality": True,
        "tapose": True,
    }
    assert "aspect_ratio" not in out["uses_options"]
