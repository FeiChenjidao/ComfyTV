import re

from ._common import *

_JSON_BLOCK = re.compile(r'\{.*\}', re.DOTALL)
_MATERIAL_KEYS = (
    'color', 'metalness', 'roughness', 'transmission',
    'opacity', 'clearcoat', 'clearcoatRoughness', 'ior',
    'emissive', 'emissiveIntensity',
    'map', 'metalnessMap', 'roughnessMap', 'normalMap', 'normalScale',
    'emissiveMap', 'alphaMap', 'aoMap', 'aoMapIntensity',
    'transmissionMap', 'clearcoatMap', 'clearcoatRoughnessMap',
)
def _extract_material_json(text: str) -> dict | None:
    m = _JSON_BLOCK.search(text or "")
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    out = {k: data[k] for k in _MATERIAL_KEYS if k in data}
    return out or None


def _map_input(name: str, tooltip: str):
    return COMFYTV_IMAGE.Input(name, optional=True, tooltip=tooltip)


class MaterialStage(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.MaterialStage",
            display_name="Material",
            category="ComfyTV/Input",
            inputs=[
                _force_run_token(),
                _project_id_input(),
                _parent_output_id_input(),
                io.Combo.Input("workflow", options=labels_for('material-estimate') or [""],
                               default=default_for('material-estimate'),
                               tooltip="VLM workflow used to estimate PBR parameters "
                                       "when an image is connected."),
                io.String.Input("material_state", default="{}",
                                socketless=True, extra_dict={"hidden": True},
                                tooltip="Internal — PBR material JSON (color/metalness/roughness/"
                                        "transmission/maps/…). Driven by the material editor."),
                io.String.Input("captured_image", default="",
                                socketless=True, extra_dict={"hidden": True},
                                tooltip="Internal — /view URL of the material-ball preview snapshot. "
                                        "Written by the node body; becomes the `image` output."),
                _map_input("map",
                           "Albedo / base-color texture. Multiplies the Color parameter."),
                _map_input("metalnessMap",
                           "Metalness texture (grayscale). Multiplies the Metalness slider."),
                _map_input("roughnessMap",
                           "Roughness texture (grayscale). Multiplies the Roughness slider."),
                _map_input("normalMap",
                           "Tangent-space normal map."),
                _map_input("emissiveMap",
                           "Emissive texture. Multiplies the Emissive color."),
                _map_input("alphaMap",
                           "Opacity / alpha texture (grayscale). Multiplies the Opacity slider."),
                _map_input("aoMap",
                           "Ambient occlusion texture."),
                _map_input("transmissionMap",
                           "Transmission texture (grayscale). Multiplies the Transmission slider."),
                _map_input("clearcoatMap",
                           "Clearcoat texture (grayscale). Multiplies the Clearcoat slider."),
                _map_input("clearcoatRoughnessMap",
                           "Clearcoat-roughness texture (grayscale). "
                           "Multiplies Clearcoat Roughness."),
                COMFYTV_IMAGE.Input(
                    "image",
                    optional=True,
                    tooltip="Optional reference photo for VLM material-parameter estimation "
                            "(does not become a texture map — use the map sockets for that).",
                ),
                _custom_params_input(),
            ],
            outputs=[
                COMFYTV_MATERIAL.Output("material"),
                COMFYTV_IMAGE.Output("image"),
            ],
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    async def execute(cls, force_run_token=0, project_id="", parent_output_id=0,
                      workflow="", material_state="{}", captured_image="",
                      map="", metalnessMap="", roughnessMap="", normalMap="",
                      emissiveMap="", alphaMap="", aoMap="",
                      transmissionMap="", clearcoatMap="", clearcoatRoughnessMap="",
                      image="", custom_params="{}"):
        payload = material_state or "{}"
        try:
            current = json.loads(payload)
        except (ValueError, TypeError):
            current = {}
        if not isinstance(current, dict):
            current = {}

        if image:
            text = await invoke_runner(
                kind='material-estimate',
                label=workflow,
                upstream={'images': [image]},
                options={},
                custom_params=custom_params,
            )
            estimated = _extract_material_json(str(text))
            if estimated is None:
                raise StageError(
                    "material estimation ran but returned no parsable JSON — "
                    f"model output started with: {str(text)[:120]!r}"
                )
            current.update(estimated)

        wired = {
            'map': map,
            'metalnessMap': metalnessMap,
            'roughnessMap': roughnessMap,
            'normalMap': normalMap,
            'emissiveMap': emissiveMap,
            'alphaMap': alphaMap,
            'aoMap': aoMap,
            'transmissionMap': transmissionMap,
            'clearcoatMap': clearcoatMap,
            'clearcoatRoughnessMap': clearcoatRoughnessMap,
        }
        for slot, url in wired.items():
            if url:
                current[slot] = url
            # When the socket is empty, keep whatever material_state already stored
            # so saved textures survive a re-run without the wire reattached.

        current["version"] = 1
        payload = json.dumps(current)
        return _stage_emit_auto(cls, project_id=project_id,
                                payload_str=payload,
                                parent_output_id=parent_output_id,
                                picked_payload=captured_image or "")
