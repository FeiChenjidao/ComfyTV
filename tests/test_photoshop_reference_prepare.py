from io import BytesIO

from PIL import Image

from ComfyTV.photoshop import backend


def test_reference_prepare_limits_long_edge_without_changing_source(tmp_path):
    source = tmp_path / "large.png"
    Image.new("RGB", (4096, 1024), (32, 64, 96)).save(source)
    before = source.read_bytes()

    raw, info = backend.prepare_reference_png(str(source), 2048)

    with Image.open(BytesIO(raw)) as output:
        assert output.size == (2048, 512)
    assert info["source_width"] == 4096
    assert info["output_width"] == 2048
    assert source.read_bytes() == before
