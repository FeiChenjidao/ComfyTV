import json


def test_canvas_stage_schema():
    from ComfyTV.nodes.stages import stage_classes
    from ComfyTV.nodes.stages.layer_editor import CanvasStage

    schema = CanvasStage.define_schema()
    assert schema.kw["node_id"] == "ComfyTV.CanvasStage"
    names = [item.args[0] for item in schema.kw["inputs"] if item.args]
    assert "image" in names
    assert "layer_state" in names
    assert "captured_image" in names
    assert "captured_images" in names
    assert len(schema.kw["outputs"]) == 2
    assert CanvasStage in stage_classes()


def test_canvas_stage_outputs_composite_and_layer_batch(reset_db):
    from ComfyTV.nodes.stages.layer_editor import CanvasStage

    image = "/view?filename=canvas.png&subfolder=comfytv%2Flayer-editor&type=input"
    batch = '{"images":[{"index":1,"label":"Layer 1","image_url":"/view?f=layer.png"}]}'
    out = CanvasStage.execute(
        project_id="default",
        captured_image=image,
        captured_images=batch,
        layer_state='{"version":2}',
        width=800,
        height=600,
    )
    assert out.values[0] == image
    assert json.loads(out.values[1]) == json.loads(batch)
