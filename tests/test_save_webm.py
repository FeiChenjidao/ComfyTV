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
        ("vp8", True, "libvpx", "yuva420p", True),
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


def test_vp8_alpha_bitrate_scales_with_frame_size():
    from ComfyTV.runners._delivery import DELIVERY_CODECS, vp8_alpha_bit_rate

    assert vp8_alpha_bit_rate(1920, 1080, 24, 24) == 23_887_872
    assert vp8_alpha_bit_rate(16, 16, 1, 63) == 1_000_000
    assert vp8_alpha_bit_rate(7680, 4320, 60, 0) == 80_000_000
    assert all(
        'b' not in options
        for options in DELIVERY_CODECS['vp8_alpha']['quality'].values()
    )


def test_fx_chain_vp8_alpha_encodes_directly(monkeypatch):
    import ComfyTV.runners.fx_chain_exec as fx_chain_exec

    calls = []
    monkeypatch.setattr(fx_chain_exec, 'has_encoder', lambda _name: True)
    monkeypatch.setattr(
        fx_chain_exec,
        'get_video_info',
        lambda _url: {'fps': 24.0, 'width': 1920, 'height': 1080},
    )

    def fake_torch_process(view_url, _frame_fn, **kwargs):
        calls.append((view_url, kwargs))
        return '/view?filename=direct-vp8.webm&type=output'

    monkeypatch.setattr(
        fx_chain_exec, 'torch_process_video', fake_torch_process,
    )
    result = fx_chain_exec.run_fx_chain(
        '/view?filename=source.mp4&type=output',
        [{
            'domain': 'video',
            'engine': 'torch',
            'op': 'keyer',
            'params': {'mode': 'luminance', 'output': 'alpha'},
        }],
        delivery={'codec': 'vp8_alpha', 'quality': 'high'},
    )

    assert result == '/view?filename=direct-vp8.webm&type=output'
    assert len(calls) == 1
    assert calls[0][1]['alpha_vcodec'] == 'libvpx'
    assert calls[0][1]['alpha_options']['crf'] == '4'
