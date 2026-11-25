from copy import deepcopy

from ComfyTV.runners.workflow_templates import prepare_template_graph


def schema(*names):
    return {"input": {"required": {
        name: ["INT" if name in ("seed", "asset_id", "parent_output_id", "force_run_token") else "STRING", {}]
        for name in names
    }}}


def test_template_instances_do_not_share_history_or_mutate_the_source():
    graph = {
        "id": "source", "revision": 9,
        "nodes": [{"id": 3, "type": "ComfyTV.ImageStage", "widgets_values": [99, "other-project", 42, "GPT_Image_2.5", "prompt"],
                   "properties": {"comfytv_stage_uid": "old", "comfytv_stage_uid_at": "2020-01-01", "comfytv_media": {"image": [{"src": "link", "link": 1}]}}}],
        "links": [[1, 1, 0, 3, 0, "COMFYTV_IMAGE"]],
    }
    original = deepcopy(graph)
    schemas = {"ComfyTV.ImageStage": schema("force_run_token", "project_id", "parent_output_id", "workflow", "main_prompt")}
    first = prepare_template_graph(graph, schemas, new_instance=True)
    second = prepare_template_graph(graph, schemas, new_instance=True)
    assert graph == original
    assert first["id"] != second["id"] != graph["id"]
    assert first["revision"] == 0
    n = first["nodes"][0]
    assert n["properties"]["comfytv_stage_uid"] != second["nodes"][0]["properties"]["comfytv_stage_uid"]
    assert n["properties"]["comfytv_stage_uid_at"] > "2020-01-01"
    assert n["widgets_values"] == [0, "", 0, "GPT_Image_2.6", "prompt"]
    assert n["properties"]["comfytv_media"] == original["nodes"][0]["properties"]["comfytv_media"]
    assert first["links"] == original["links"]


def test_portable_assets_do_not_keep_database_ids_and_editor_state_is_preserved():
    graph = {"nodes": [{"id": 1, "type": "ComfyTV.AssetImageLoaderStage", "widgets_values": ["default", 42, "/view?filename=a.png&type=input", 30, "12", ""],
                        "widgets_values_named": {"project_id": "default", "asset_id": 30, "category": "12"},
                        "properties": {"comfytv_stage_uid": "old", "editor": {"crop": [1, 2, 3, 4]}}}]}
    schemas = {"ComfyTV.AssetImageLoaderStage": schema("project_id", "parent_output_id", "asset_url", "asset_id", "category")}
    result = prepare_template_graph(graph, schemas)
    node = result["nodes"][0]
    assert node["widgets_values"] == ["", 0, "/view?filename=a.png&type=input", 0, "all", ""]
    assert node["widgets_values_named"] == {"project_id": "", "asset_id": 0, "category": "all"}
    assert node["properties"] == {"editor": {"crop": [1, 2, 3, 4]}}
    assert prepare_template_graph(result, schemas) == result


def test_legacy_model_parameters_are_migrated_without_losing_user_options():
    prefix_names = ["force_run_token", "project_id", "parent_output_id", "workflow", "seed"] + [f"option{i}" for i in range(20)] + ["main_prompt", "captured_image"]
    names = prefix_names + ["selected_index", "pool", "append_results", "custom_params", "negative"]
    prefix_values = [123, "default", 99, "Meshy", 42, "randomize"] + [True] * 20 + ["keep prompt", "/view?filename=capture.png&type=input"]
    graph = {"nodes": [{"type": "ComfyTV.Model3DStage", "widgets_values": prefix_values + ['{"items":[]}', "keep negative", ""]}]}
    schemas = {"ComfyTV.Model3DStage": schema(*names)}
    result = prepare_template_graph(graph, schemas)
    values = result["nodes"][0]["widgets_values"]
    assert values[:6] == [0, "", 0, "Meshy Multi", 42, "randomize"]
    assert values[26:] == ["keep prompt", "", 1, "", True, '{"items":[]}', "keep negative", ""]
    assert prepare_template_graph(result, schemas) == result


def test_psd_source_path_is_local_but_exported_layers_are_portable():
    graph = {"nodes": [{"type": "ComfyTV.PsdLayerTreeStage", "widgets_values": ["default", 0, "C:\\Downloads\\large.psd", "L196", "/view?filename=layer.png&type=input"]}]}
    schemas = {"ComfyTV.PsdLayerTreeStage": schema("project_id", "parent_output_id", "psd_file", "selected_id", "captured_image")}
    values = prepare_template_graph(graph, schemas)["nodes"][0]["widgets_values"]
    assert values[2] == ""
    assert values[3:] == ["L196", "/view?filename=layer.png&type=input"]


def test_subgraphs_are_sanitized_but_external_nodes_are_unchanged():
    external = {"type": "External.Loader", "properties": {"anything": 1}, "widgets_values": ["default", 99]}
    graph = {"nodes": [external], "definitions": {"subgraphs": [{"nodes": [{"type": "ComfyTV.VideoStage", "properties": {"comfytv_stage_uid": "old"}}]}]}}
    result = prepare_template_graph(graph, {}, new_instance=True)
    assert result["nodes"][0] == external
    assert result["definitions"]["subgraphs"][0]["nodes"][0]["properties"]["comfytv_stage_uid"] != "old"
