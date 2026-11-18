import pytest


def _schema_inputs():
    from ComfyTV.nodes.save_webm import SaveWebM

    schema = SaveWebM.define_schema()
    return {
        field.args[0]: field
        for field in schema.kw["inputs"]
        if getattr(field, "args", ())
    }


def test_schema_exposes_vp8_vp9_and_av1():
    inputs = _schema_inputs()
    assert inputs["codec"].kw["options"] == ["vp8", "vp9", "av1"]
    assert inputs["codec"].kw["default"] == "vp8"


@pytest.mark.parametrize(
    ("codec", "has_alpha", "encoder", "pixel_format", "save_alpha"),
    [
        ("vp8", False, "libvpx", "yuv420p", False),
        ("vp8", True, "libvpx", "yuv420p", False),
        ("vp9", False, "libvpx-vp9", "yuv420p", False),
        ("vp9", True, "libvpx-vp9", "yuva420p", True),
        ("av1", True, "libsvtav1", "yuv420p10le", False),
    ],
)
def test_codec_settings(codec, has_alpha, encoder, pixel_format, save_alpha):
    from ComfyTV.nodes.save_webm import _codec_settings

    assert _codec_settings(codec, has_alpha) == (
        encoder,
        pixel_format,
        save_alpha,
    )


def test_codec_settings_reject_unknown_codec():
    from ComfyTV.nodes.save_webm import _codec_settings

    with pytest.raises(ValueError, match="unsupported WebM codec"):
        _codec_settings("h264", False)
