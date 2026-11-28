import folder_paths
import pytest
from PIL import Image

from ComfyTV.nodes.alpha_merge import AlphaMerge
from ComfyTV.nodes.stages.common import emit
from ComfyTV.runners._media_paths import path_to_view_url, view_url_to_path


@pytest.fixture
def image_dirs(tmp_path, monkeypatch):
    inputs = tmp_path / "input"
    outputs = tmp_path / "output"
    inputs.mkdir()
    directories = {"input": str(inputs), "output": str(outputs)}
    monkeypatch.setattr(folder_paths, "get_directory_by_type", directories.get)
    monkeypatch.setattr(folder_paths, "get_output_directory", lambda: str(outputs))
    monkeypatch.setattr(emit, "_persist", lambda **kwargs: None)
    return inputs


def test_alpha_merge_copies_embedded_alpha_and_base_color(image_dirs):
    base = image_dirs / "base.png"
    texture = image_dirs / "texture.png"
    Image.new("RGB", (3, 1), (19, 43, 69)).save(base)
    alpha_texture = Image.new("RGBA", (3, 1))
    alpha_texture.putdata([(255, 255, 255, 0), (255, 0, 0, 128), (0, 0, 0, 255)])
    alpha_texture.save(texture)

    result = AlphaMerge.execute(path_to_view_url(base, "input"), path_to_view_url(texture, "input"))

    with Image.open(view_url_to_path(result.values[0])) as merged:
        assert merged.mode == "RGBA"
        assert [merged.getpixel((x, 0)) for x in range(3)] == [
            (19, 43, 69, 0), (19, 43, 69, 128), (19, 43, 69, 255),
        ]
    assert result.ui["images"][0]["url"] == result.values[0]


def test_alpha_merge_requires_alpha_texture_with_transparency_data(image_dirs):
    image = image_dirs / "rgb.png"
    Image.new("RGB", (2, 2)).save(image)
    url = path_to_view_url(image, "input")

    with pytest.raises(ValueError, match="has no alpha channel"):
        AlphaMerge.execute(url, url)
