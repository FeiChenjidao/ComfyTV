"""Regression coverage for the integrated quick black-to-alpha utility."""
import subprocess
from fractions import Fraction
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("scipy")
pytest.importorskip("torch")
from PIL import Image

from ComfyTV.nodes import fast_black as black


def test_registered_with_standalone_workflow_id(monkeypatch):
    from ComfyTV.nodes.stages import stage_classes

    assert black.VideoBlackToAlphaVP8 in stage_classes()
    # The repository's lightweight IO stub omits String.Output.
    monkeypatch.setattr(black.io.String, "Output", black.io.String.Input, raising=False)
    schema = black.VideoBlackToAlphaVP8.define_schema()
    assert schema.kw["node_id"] == "VideoBlackToAlphaVP8"


def test_cleaning_starts_at_outside_and_preserves_enclosed_dark_region():
    rgb = np.zeros((48, 48, 3), dtype=np.uint8)
    rgb[4:44, 4:44] = [90, 35, 60]
    rgb[14:34, 14:34] = [240, 120, 180]
    rgb[20:28, 20:28] = [60, 30, 45]
    mask = np.zeros((48, 48), dtype=np.float32)
    mask[4:8, 4:8] = 1
    base = black.process_rgba(rgb, 6, 0, 0, protection_mask=mask)
    narrow = black.process_rgba(rgb, 6, 2, 0, protection_mask=mask)
    wide = black.process_rgba(rgb, 6, 12, 0, protection_mask=mask)

    assert narrow[24, 4, 3] == 0
    assert narrow[24, 13, 3] > 0  # Inner edge must not disappear first.
    assert wide[24, 13, 3] == 0
    assert np.array_equal(wide[20:28, 20:28], base[20:28, 20:28])
    assert np.array_equal(wide[4:8, 4:8], base[4:8, 4:8])
    assert np.all(wide[:, :, 3] <= narrow[:, :, 3])


def test_recolor_respects_white_mask_and_keeps_alpha():
    rgb = np.array([[[30, 30, 30], [100, 10, 70], [240, 180, 210]]]*2, dtype=np.uint8)
    mask = np.array([[1, 1, 1], [0, 0, 0]], dtype=np.float32)
    base = black.process_rgba(rgb, 6, 0, 0, protection_mask=mask)
    colored = black.process_rgba(rgb, 6, 0, 0, recolor_enabled=True,
                                 replacement_color="#dba4c1", recolor_all_black=True,
                                 protection_mask=mask)
    assert np.array_equal(colored[:, :, 3], base[:, :, 3])
    assert np.array_equal(colored[0], base[0])
    assert list(colored[1, 0, :3]) == [219, 164, 193]
    assert list(colored[1, 1, :3]) == [219, 164, 193]
    assert np.array_equal(colored[:, 2], base[:, 2])


def test_black_white_mask_and_inverse_alpha(tmp_path):
    values = np.array([[0, 128], [255, 0]], dtype=np.uint8)
    opaque = tmp_path / "mask.png"
    Image.fromarray(values).save(opaque)
    assert np.array_equal(black.mask_image_values(opaque), values)
    image = Image.new("RGBA", (2, 2), "white")
    image.putalpha(Image.fromarray(values))
    transparent = tmp_path / "alpha.png"
    image.save(transparent)
    assert np.array_equal(black.mask_image_values(transparent), 255-values)
    resized = black.normalize_protection_mask(values[None].astype(float)/255, 4, 4)
    assert resized.shape == (4, 4)
    assert 0 <= resized.min() <= resized.max() <= 1


def test_media_paths_cannot_escape_comfyui_directories(tmp_path, monkeypatch):
    monkeypatch.setattr(black.folder_paths, "get_directory_by_type", lambda _: str(tmp_path))
    for url in ("/view?filename=../escape.png&type=input", "https://example.org/a.png"):
        with pytest.raises(ValueError):
            black.media_path(url)


def test_ffmpeg_environment_and_platform_probe(tmp_path, monkeypatch):
    ffmpeg = tmp_path / ("ffmpeg.exe" if black.os.name == "nt" else "ffmpeg")
    ffprobe = tmp_path / ("ffprobe.exe" if black.os.name == "nt" else "ffprobe")
    ffmpeg.touch()
    ffprobe.touch()
    monkeypatch.setenv("COMFYTV_FFMPEG", str(ffmpeg))
    monkeypatch.delenv("COMFYTV_FFPROBE", raising=False)
    assert black.find_ffmpeg("") == str(ffmpeg)
    assert black.find_ffprobe(str(ffmpeg)) == str(ffprobe)


def test_processed_video_keeps_exact_rgba_and_is_cancellable(tmp_path, monkeypatch):
    try:
        ffmpeg = black.find_ffmpeg("")
        black.find_ffprobe(ffmpeg)
    except FileNotFoundError:
        pytest.skip("FFmpeg and FFprobe are required for the encoder integration check")
    monkeypatch.setattr(black.comfy.model_management, "throw_exception_if_processing_interrupted", lambda: None)
    rgb = np.zeros((32, 32, 3), dtype=np.uint8)
    rgb[8:24, 8:24] = [220, 90, 150]
    source = tmp_path / "source.png"
    Image.fromarray(rgb).save(source)
    mask = np.zeros((32, 32), dtype=np.float32)
    mask[1:4, 1:4] = 1
    output = tmp_path / "processed.nut"
    black.build_processed_video(ffmpeg, source, output, Fraction(24), 6, 3, 2,
                                True, protection_mask=mask)
    raw = subprocess.check_output([ffmpeg, "-v", "error", "-i", str(output),
                                   "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"])
    assert np.array_equal(np.frombuffer(raw, dtype=np.uint8).reshape(32, 32, 4),
                          black.process_rgba(rgb, 6, 3, 2, protection_mask=mask))

    def interrupt():
        raise InterruptedError("cancelled")

    monkeypatch.setattr(black.comfy.model_management, "throw_exception_if_processing_interrupted", interrupt)
    with pytest.raises(InterruptedError):
        black.build_processed_video(ffmpeg, source, tmp_path/"cancelled.nut", Fraction(24), 6, 0, 0, True)
