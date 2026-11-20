"""Parse define_schema() calls into a JSON catalog. Text-only, no runtime imports."""
import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCAN = [ROOT / "nodes", ROOT / "photoshop"]

CONSTS = {}
const_src = (ROOT / "nodes" / "stages" / "common" / "constants.py").read_text(encoding="utf-8")
for node in ast.parse(const_src).body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        try:
            CONSTS[node.targets[0].id] = ast.literal_eval(node.value)
        except Exception:
            pass

TYPE_OF = {
    "io.String.Input": "STRING", "io.Int.Input": "INT", "io.Float.Input": "FLOAT",
    "io.Boolean.Input": "BOOLEAN", "io.Combo.Input": "COMBO",
    "io.Image.Input": "IMAGE", "io.Mask.Input": "MASK", "io.Latent.Input": "LATENT",
    "io.Audio.Input": "AUDIO", "io.Video.Input": "VIDEO",
    "io.File3D.Input": "FILE3D", "io.File3DAny.Input": "FILE3D",
    "io.MultiType.Input": "MULTI", "io.Autogrow.Input": "AUTOGROW",
    "io.DynamicCombo.Input": "DYNAMIC",
    "io.Image.Output": "IMAGE", "io.Mask.Output": "MASK",
    "io.Int.Output": "INT", "io.Float.Output": "FLOAT", "io.Boolean.Output": "BOOLEAN",
    "io.String.Output": "STRING", "io.Combo.Output": "COMBO",
    "io.File3DAny.Output": "FILE3D", "io.File3D.Output": "FILE3D",
}
CUSTOM_TYPES = {
    "COMFYTV_TEXT": "COMFYTV_TEXT", "COMFYTV_IMAGE": "COMFYTV_IMAGE",
    "COMFYTV_IMAGES": "COMFYTV_IMAGES", "COMFYTV_VIDEO": "COMFYTV_VIDEO",
    "COMFYTV_AUDIO": "COMFYTV_AUDIO", "COMFYTV_MODEL": "COMFYTV_MODEL",
    "COMFYTV_MATERIAL": "COMFYTV_MATERIAL", "COMFYTV_PANORAMA": "COMFYTV_PANORAMA",
    "COMFYTV_STORYBOARD": "COMFYTV_STORYBOARD", "COMFYTV_TIMELINE": "COMFYTV_TIMELINE",
    "COMFYTV_FXSPEC": "COMFYTV_FXSPEC",
}
TEMPLATE_FUNCS = {
    "_text_template": ("text", "COMFYTV_TEXT"),
    "_image_template": ("image", "COMFYTV_IMAGE"),
    "_face_image_template": ("image", "COMFYTV_IMAGE"),
    "_video_template": ("video", "COMFYTV_VIDEO"),
    "_audio_template": ("audio", "COMFYTV_AUDIO"),
    "_model_template": ("model", "COMFYTV_MODEL"),
    "_material_template": ("material", "COMFYTV_MATERIAL"),
}
HIDDEN_HELPERS = {
    "_force_run_token": "force_run_token",
    "_project_id_input": "project_id",
    "_parent_output_id_input": "parent_output_id",
    "_selected_index_input": "selected_index",
    "_custom_params_input": "custom_params",
}


def lit(node):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name) and node.id in CONSTS:
        return CONSTS[node.id]
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub) and isinstance(node.operand, ast.Constant):
        return -node.operand.value
    if isinstance(node, (ast.List, ast.Tuple)):
        return [lit(e) for e in node.elts]
    if isinstance(node, ast.Dict):
        return {lit(k): lit(v) for k, v in zip(node.keys, node.values)}
    raise ValueError


def call_name(node):
    if node is None:
        return ""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{call_name(node.value)}.{node.attr}"
    if isinstance(node, ast.Call):
        return call_name(node.func)
    return ""


def kw(call, name, default=None):
    for k in call.keywords:
        if k.arg == name:
            try:
                return lit(k.value)
            except Exception:
                return None
    return default


def positional(call, index):
    if len(call.args) > index:
        try:
            return lit(call.args[index])
        except Exception:
            return None
    return None


def attach_template(expr):
    tmpl = None
    for key in expr.keywords:
        if key.arg == "template":
            tmpl = key.value
    if not isinstance(tmpl, ast.Call) or not isinstance(tmpl.func, ast.Name):
        return None
    fn = tmpl.func.id
    prefix, typ = TEMPLATE_FUNCS.get(fn, (None, None))
    if prefix is None:
        return None
    hi = tmpl.args[0].value if tmpl.args and isinstance(tmpl.args[0], ast.Constant) else None
    if not isinstance(hi, int):
        hi = {"_text_template": 8, "_image_template": 12, "_video_template": 6,
              "_audio_template": 3, "_model_template": 4, "_material_template": 4}.get(fn)
    out = {"prefix": prefix, "type": typ, "max": hi}
    if fn == "_face_image_template":
        out["min"] = 4
        out["max"] = 5
    return out


def parse_input(expr):
    if not isinstance(expr, ast.Call):
        return None
    name = call_name(expr)
    if name in HIDDEN_HELPERS:
        return {"hidden": True, "id": HIDDEN_HELPERS[name]}
    if name == "_main_prompt_input":
        return {"id": "main_prompt", "type": "STRING", "socketless": True,
                "multiline": True, "tooltip": kw(expr, "tooltip", "") or ""}
    item = {
        "id": positional(expr, 0) if isinstance(positional(expr, 0), str) else kw(expr, "id"),
        "display": kw(expr, "display_name"),
        "tooltip": kw(expr, "tooltip", "") or "",
        "optional": bool(kw(expr, "optional", False)),
        "socketless": bool(kw(expr, "socketless", False)),
        "advanced": bool(kw(expr, "advanced", False)),
    }
    extra = kw(expr, "extra_dict")
    if isinstance(extra, dict) and extra.get("hidden"):
        item["hidden"] = True
    for key in ("default", "min", "max", "step", "multiline", "placeholder"):
        val = kw(expr, key)
        if val not in (None, ""):
            item[key] = val
    if name in TYPE_OF:
        item["type"] = TYPE_OF[name]
    elif name.endswith(".Input") and name.split(".")[0] in CUSTOM_TYPES:
        item["type"] = CUSTOM_TYPES[name.split(".")[0]]
    elif name == "io.MultiType.Input":
        item["type"] = "MULTI"
        if len(expr.args) > 1 and isinstance(expr.args[1], ast.List):
            item["types"] = [call_name(e).split(".")[0] for e in expr.args[1].elts]
    else:
        item["type"] = name or "?"
    grown = attach_template(expr)
    if grown is not None:
        item["type"] = "AUTOGROW"
        item["template"] = grown
    opts = kw(expr, "options")
    if isinstance(opts, list):
        flat = [str(o) for o in opts if o != ""]
        item["options"] = flat[:30]
        if len(flat) > 30:
            item["options_more"] = len(flat) - 30
    return item


def parse_output(expr):
    if not isinstance(expr, ast.Call):
        return None
    name = call_name(expr)
    typ = TYPE_OF.get(name)
    if typ is None and name.endswith(".Output"):
        head = name.split(".")[0]
        typ = CUSTOM_TYPES.get(head, head)
    return {
        "id": positional(expr, 0) if isinstance(positional(expr, 0), str) else kw(expr, "id"),
        "display": kw(expr, "display_name"),
        "type": typ or "?",
        "tooltip": kw(expr, "tooltip", "") or "",
    }


def schema_call(fn):
    for node in ast.walk(fn):
        if isinstance(node, ast.Call) and call_name(node) == "io.Schema":
            return node
    return None


def list_of_calls(value):
    if isinstance(value, ast.List):
        return value.elts
    if isinstance(value, ast.BinOp) and isinstance(value.op, ast.Add):
        return list_of_calls(value.left) + list_of_calls(value.right)
    if isinstance(value, ast.Starred):
        return [value]
    if isinstance(value, ast.Call):
        return [value]
    return []


def expand_input(expr):
    """One schema input expression may be a call, a spread helper, or a list."""
    if isinstance(expr, ast.Starred) and isinstance(expr.value, ast.Call):
        name = call_name(expr.value)
        if name == "_standard_stage_inputs":
            return [{"hidden": True, "id": n} for n in
                    ("force_run_token", "project_id", "parent_output_id")]
        return []
    if isinstance(expr, ast.Call) and call_name(expr) in ("_hidden_float", "_hidden_int", "_hidden_str", "_hidden_combo"):
        kind = call_name(expr)
        item = {
            "id": positional(expr, 0),
            "type": {"_hidden_float": "FLOAT", "_hidden_int": "INT",
                     "_hidden_str": "STRING", "_hidden_combo": "COMBO"}[kind],
            "socketless": True, "hidden": True,
            "tooltip": kw(expr, "tooltip", "") or "",
        }
        if kind in ("_hidden_float", "_hidden_int"):
            item["default"] = positional(expr, 1)
            item["min"] = positional(expr, 2)
            item["max"] = positional(expr, 3)
        elif kind == "_hidden_combo":
            opts = positional(expr, 1)
            item["default"] = positional(expr, 2)
            if isinstance(opts, list):
                item["options"] = [str(o) for o in opts[:30]]
        else:
            item["default"] = positional(expr, 1) or ""
        return [item]
    parsed = parse_input(expr)
    return [parsed] if parsed else []


def extract_file(path: Path):
    src = path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return []
    out = []
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        fn = next((b for b in node.body if isinstance(b, ast.FunctionDef) and b.name == "define_schema"), None)
        if fn is None:
            continue
        call = schema_call(fn)
        if call is None:
            continue
        inputs_kw = next((k.value for k in call.keywords if k.arg == "inputs"), None)
        outputs_kw = next((k.value for k in call.keywords if k.arg == "outputs"), None)
        inputs = [x for e in list_of_calls(inputs_kw) for x in expand_input(e)]
        outputs = [x for x in (parse_output(e) for e in list_of_calls(outputs_kw)) if x]
        out.append({
            "class": node.name,
            "file": str(path.relative_to(ROOT)).replace("\\", "/"),
            "node_id": kw(call, "node_id", ""),
            "display_name": kw(call, "display_name", node.name),
            "category": kw(call, "category", ""),
            "description": kw(call, "description", "") or "",
            "inputs": inputs,
            "outputs": outputs,
        })
    return out


def main():
    nodes = []
    for base in SCAN:
        for path in sorted(base.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            nodes.extend(extract_file(path))
    seen = set()
    uniq = []
    for n in nodes:
        key = n["node_id"] or n["class"]
        if key in seen:
            continue
        seen.add(key)
        uniq.append(n)
    json.dump(uniq, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
