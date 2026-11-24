from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from ComfyTV.runners import tripo_retopology as runner
from ComfyTV.nodes.stages import retopology as stage


def test_stage_is_registered_and_runnable_without_workflow_binding():
    from ComfyTV.nodes.stages import stage_classes
    from ComfyTV.api.stages import stages_payload

    assert stage.ModelRetopologyStage in stage_classes()
    schema = stage.ModelRetopologyStage.define_schema().kw
    assert schema["is_api_node"]
    assert schema["is_output_node"]
    assert len(schema["outputs"]) == 1
    row = next(row for row in stages_payload() if row["node_id"] == "ComfyTV.ModelRetopologyStage")
    assert row["kind"] == "model"
    assert row["runnable"]
    assert row["workflow_kind"] is None


@pytest.fixture
def flow(tmp_path, monkeypatch):
    import folder_paths

    output = tmp_path / "output"
    output.mkdir()
    source = output / "source.glb"
    source.write_bytes(b"source model")
    monkeypatch.setattr(folder_paths, "get_directory_by_type", lambda kind: str(output))
    monkeypatch.setattr(folder_paths, "get_output_directory", lambda: str(output))
    imported_file = Mock()
    monkeypatch.setattr(runner, "Types", SimpleNamespace(File3D=Mock(return_value=imported_file)))

    glb = Mock()
    glb.save_to.side_effect = lambda path: Path(path).write_bytes(b"retopologized GLB")
    fbx = Mock()
    fbx.save_to.side_effect = lambda path: Path(path).write_bytes(b"quad FBX")
    importer = SimpleNamespace(hidden=None, execute=AsyncMock(return_value=("import-task",)))
    retopo = SimpleNamespace(hidden=None, execute=AsyncMock(return_value=("", "retopo-task", glb, fbx)))
    native_import = SimpleNamespace(hidden="original import hidden", PREPARE_CLASS_CLONE=Mock(return_value=importer))
    native_retopo = SimpleNamespace(hidden="original retopo hidden", PREPARE_CLASS_CLONE=Mock(return_value=retopo))
    monkeypatch.setattr(runner.nodes, "NODE_CLASS_MAPPINGS", {
        "TripoImportModelNode": native_import, "TripoRetopologyNode": native_retopo,
    })
    return SimpleNamespace(
        source=source, output=output, importer=importer, retopo=retopo, glb=glb, fbx=fbx,
        imported_file=imported_file, native_import=native_import, native_retopo=native_retopo,
        hidden=SimpleNamespace(unique_id="7", auth_token_comfy_org="test-login"),
    )


@pytest.mark.parametrize("quad,expected_bytes,suffix", [
    (False, b"retopologized GLB", ".glb"), (True, b"quad FBX", ".fbx"),
])
async def test_imports_file_and_saves_native_topology_unchanged(flow, quad, expected_bytes, suffix):
    url = await runner.retopologize_model(
        "/view?filename=source.glb&type=output", face_limit=5000, quad=quad, bake=False, hidden=flow.hidden,
    )
    saved = runner.view_url_to_path(url)
    assert saved.suffix == suffix
    assert saved.read_bytes() == expected_bytes
    runner.Types.File3D.assert_called_once_with(str(flow.source))
    flow.importer.execute.assert_awaited_once_with(model_3d=flow.imported_file)
    flow.retopo.execute.assert_awaited_once_with(model_task_id="import-task", face_limit=5000, quad=quad, bake=False)
    assert flow.importer.hidden is flow.hidden
    assert flow.retopo.hidden is flow.hidden
    assert flow.native_import.hidden == "original import hidden"
    assert flow.native_retopo.hidden == "original retopo hidden"
    (flow.glb if quad else flow.fbx).save_to.assert_not_called()


@pytest.mark.parametrize("filename", ["rodin.fbx", "meshy.obj", "local.stl"])
async def test_accepts_models_from_other_providers(flow, filename):
    (flow.output / filename).write_bytes(b"model")
    assert await runner.retopologize_model(
        f"/view?filename={filename}&type=output", face_limit=-1, quad=False, bake=True, hidden=flow.hidden,
    )
    flow.retopo.execute.assert_awaited_once_with(model_task_id="import-task", face_limit=-1, quad=False, bake=True)


@pytest.mark.parametrize("model", ["", "/view?filename=missing.glb", "https://example.invalid/model.glb"])
async def test_missing_or_nonlocal_model_does_not_call_api(flow, model):
    with pytest.raises(ValueError, match="Connect a saved"):
        await runner.retopologize_model(model, face_limit=-1, quad=False, bake=True, hidden=flow.hidden)
    flow.importer.execute.assert_not_called()


async def test_rejects_path_traversal_before_uploading(flow):
    with pytest.raises(ValueError, match="escapes"):
        await runner.retopologize_model(
            "/view?filename=../private.glb&type=output", face_limit=-1, quad=False, bake=True, hidden=flow.hidden,
        )
    flow.importer.execute.assert_not_called()


async def test_unsupported_format_does_not_call_api(flow):
    (flow.output / "splat.ply").touch()
    with pytest.raises(ValueError, match="Export other formats as GLB"):
        await runner.retopologize_model(
            "/view?filename=splat.ply&type=output", face_limit=-1, quad=False, bake=True, hidden=flow.hidden,
        )
    flow.importer.execute.assert_not_called()


async def test_missing_native_node_fails_before_import(flow, monkeypatch):
    monkeypatch.delitem(runner.nodes.NODE_CLASS_MAPPINGS, "TripoRetopologyNode")
    with pytest.raises(RuntimeError, match="Update ComfyUI"):
        await runner.retopologize_model(
            "/view?filename=source.glb&type=output", face_limit=-1, quad=False, bake=True, hidden=flow.hidden,
        )
    flow.importer.execute.assert_not_called()


@pytest.mark.parametrize("face_limit,quad", [(0, False), (20001, False), (10001, True)])
async def test_native_face_limits_are_checked_before_import(flow, face_limit, quad):
    with pytest.raises(ValueError, match="Target faces"):
        await runner.retopologize_model(
            "/view?filename=source.glb&type=output", face_limit=face_limit, quad=quad, bake=True, hidden=flow.hidden,
        )
    flow.importer.execute.assert_not_called()


async def test_api_failure_does_not_save_a_source_model_as_success(flow):
    flow.retopo.execute.side_effect = RuntimeError("Tripo task failed")
    with pytest.raises(RuntimeError, match="Tripo task failed"):
        await runner.retopologize_model(
            "/view?filename=source.glb&type=output", face_limit=-1, quad=False, bake=True, hidden=flow.hidden,
        )
    flow.glb.save_to.assert_not_called()
    flow.fbx.save_to.assert_not_called()


async def test_empty_api_result_is_not_published(flow):
    flow.retopo.execute.return_value = ("", "retopo-task", None, None)
    with pytest.raises(RuntimeError, match="no retopologized model"):
        await runner.retopologize_model(
            "/view?filename=source.glb&type=output", face_limit=-1, quad=False, bake=True, hidden=flow.hidden,
        )
    flow.glb.save_to.assert_not_called()


async def test_stage_forwards_options_and_publishes_model(monkeypatch):
    execute = AsyncMock(return_value="/view?filename=retopo.fbx&type=output")
    emit = Mock(return_value="emitted")
    hidden = SimpleNamespace(unique_id="7")
    monkeypatch.setattr(stage.ModelRetopologyStage, "hidden", hidden, raising=False)
    monkeypatch.setattr(stage, "retopologize_model", execute)
    monkeypatch.setattr(stage, "_emit_progress", Mock())
    monkeypatch.setattr(stage, "_stage_emit_auto", emit)
    result = await stage.ModelRetopologyStage.execute(
        model="source", face_limit=8000, quad=True, bake=False, project_id="project", parent_output_id=12,
    )
    execute.assert_awaited_once_with("source", face_limit=8000, quad=True, bake=False, hidden=hidden)
    emit.assert_called_once_with(stage.ModelRetopologyStage, project_id="project",
                                payload_str="/view?filename=retopo.fbx&type=output", parent_output_id=12)
    assert result == "emitted"
