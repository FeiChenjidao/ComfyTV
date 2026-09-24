class _Executor:
    def __init__(self, messages):
        self.status_messages = messages
        self.success = False


def test_error_carries_node_and_exception_from_the_sub_prompt():
    from ComfyTV.runners._nested_exec import NestedWorkflowError, last_execution_error
    ex = _Executor([
        ("execution_start", {"prompt_id": "comfytv-1"}),
        ("execution_error", {
            "prompt_id": "comfytv-1", "node_id": "3", "node_type": "Sam3Segment",
            "exception_type": "ZeroDivisionError", "exception_message": "division by zero",
            "traceback": ["Traceback (most recent call last):\n", "  File x\n",
                          "ZeroDivisionError: division by zero\n"],
        }),
    ])
    err = NestedWorkflowError("comfytv-1", last_execution_error(ex))
    assert str(err) == ("Local workflow failed — Sam3Segment #3 raised ZeroDivisionError: "
                        "division by zero (sub_prompt_id=comfytv-1)")
    assert err.inner_traceback.endswith("ZeroDivisionError: division by zero\n")


def test_missing_model_reads_as_a_missing_model():
    from ComfyTV.runners._nested_exec import NestedWorkflowError
    err = NestedWorkflowError("comfytv-2", {
        "node_id": "12", "node_type": "UNETLoader", "exception_type": "FileNotFoundError",
        "exception_message": "Model in folder 'diffusion_models' with filename 'q.safetensors' not found.",
    })
    assert "UNETLoader #12 raised FileNotFoundError: Model in folder" in str(err)


def test_without_detail_the_old_message_survives():
    from ComfyTV.runners._nested_exec import NestedWorkflowError, last_execution_error
    assert last_execution_error(_Executor([])) is None
    assert str(NestedWorkflowError("comfytv-3", None)) == "Local workflow failed (sub_prompt_id=comfytv-3)"


def test_exec_errors_keep_the_inner_traceback():
    from ComfyTV.runners import exec_errors
    from ComfyTV.runners._nested_exec import NestedWorkflowError
    err = NestedWorkflowError("comfytv-4", {
        "node_id": "3", "node_type": "Sam3Segment", "exception_type": "ZeroDivisionError",
        "exception_message": "division by zero",
        "traceback": ["ZeroDivisionError: division by zero\n"],
    })
    exec_errors.record_exec_error(kind="split-part", label="SplitPartStage", error=err)
    entry = exec_errors.list_exec_errors(1)[0]
    assert entry["error_type"] == "NestedWorkflowError"
    assert "Sam3Segment #3" in entry["error_text"]
    assert entry["traceback_tail"].startswith("ZeroDivisionError: division by zero")
    assert "--- ComfyTV wrapper ---" in entry["traceback_tail"]


def test_local_compositor_temp_files_are_persisted(tmp_path, monkeypatch):
    import folder_paths
    from ComfyTV.runners._nested_exec import _persist_compositor_ui

    temp_dir = tmp_path / "temp"
    output_dir = tmp_path / "output"
    temp_dir.mkdir()
    output_dir.mkdir()
    (temp_dir / "preview.png").write_bytes(b"preview")
    (temp_dir / "layer.png").write_bytes(b"layer")
    monkeypatch.setattr(folder_paths, "get_temp_directory", lambda: str(temp_dir))
    monkeypatch.setattr(folder_paths, "get_output_directory", lambda: str(output_dir))

    localized = _persist_compositor_ui({
        "images": [{"filename": "preview.png", "subfolder": "", "type": "temp"}],
        "compositor_layers": [
            {"filename": "layer.png", "subfolder": "", "type": "temp"},
        ],
        "compositor_inputs": ["fingerprint"],
    })

    preview = localized["images"][0]
    layer = localized["compositor_layers"][0]
    assert preview["type"] == layer["type"] == "output"
    assert (output_dir / preview["subfolder"] / preview["filename"]).read_bytes() == b"preview"
    assert (output_dir / layer["subfolder"] / layer["filename"]).read_bytes() == b"layer"
    assert localized["compositor_inputs"] == ["fingerprint"]
