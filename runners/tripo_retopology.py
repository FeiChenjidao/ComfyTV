"""Adapt a ComfyTV model file to the native Tripo post-processing nodes."""
import nodes
from comfy_api.latest import Types

from ._media_paths import fresh_output_path, path_to_view_url, view_url_to_path


def _tripo_node(node_id: str, hidden):
    node = nodes.NODE_CLASS_MAPPINGS.get(node_id)
    if node is None:
        raise RuntimeError(f"{node_id} is unavailable. Update ComfyUI to use Tripo retopology.")
    clone = node.PREPARE_CLASS_CLONE(None)
    clone.hidden = hidden
    return clone


async def retopologize_model(model: str, *, face_limit: int, quad: bool, bake: bool, hidden) -> str:
    source = view_url_to_path(model)
    if source is None or not source.is_file():
        raise ValueError("Connect a saved 3D model to the model input.")
    if source.suffix.lower() not in (".glb", ".fbx", ".obj", ".stl"):
        raise ValueError("Tripo retopology accepts GLB, FBX, OBJ or STL. Export other formats as GLB first.")
    # Resolve both dependencies before importing a file into the paid API flow.
    importer = _tripo_node("TripoImportModelNode", hidden)
    retopology = _tripo_node("TripoRetopologyNode", hidden)
    if face_limit != -1 and not 500 <= face_limit <= (10000 if quad else 20000):
        raise ValueError("Target faces must be -1 (automatic), 500–20,000 triangles, or 500–10,000 quads.")

    imported = await importer.execute(model_3d=Types.File3D(str(source)))
    result = await retopology.execute(
        model_task_id=imported[0], face_limit=face_limit, quad=quad, bake=bake,
    )
    file = result[3] if quad else result[2]
    if file is None:
        raise RuntimeError("Tripo returned no retopologized model.")
    # Save the provider's file unchanged: converting quad FBX to GLB would triangulate it.
    destination = fresh_output_path(".fbx" if quad else ".glb", "comfytv/retopology")
    file.save_to(str(destination))
    return path_to_view_url(destination)
