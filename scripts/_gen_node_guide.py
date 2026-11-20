"""Render a node-card PNG per ComfyTV node and a Chinese usage guide."""
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from _node_usage_zh import USAGE

ROOT = Path(__file__).resolve().parents[1]
CATALOG = Path(os.environ["CATALOG"])
IMG_DIR = ROOT / "docs" / "images" / "nodes"
FONT_PATH = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
MONO_PATH = r"C:\Windows\Fonts\consola.ttf"
OUT_MD = ROOT / "docs" / "node-guide.zh.md"

TYPE_COLOR = {
    "COMFYTV_TEXT": "#A78BFA", "COMFYTV_IMAGE": "#4ADE80", "COMFYTV_IMAGES": "#60A5FA",
    "COMFYTV_VIDEO": "#F472B6", "COMFYTV_AUDIO": "#FBBF24", "COMFYTV_MODEL": "#22D3EE",
    "COMFYTV_MATERIAL": "#FB923C", "COMFYTV_PANORAMA": "#2DD4BF",
    "COMFYTV_STORYBOARD": "#E879F9", "COMFYTV_TIMELINE": "#818CF8",
    "COMFYTV_FXSPEC": "#94A3B8", "IMAGE": "#4ADE80", "MASK": "#94A3B8",
    "STRING": "#A78BFA", "INT": "#93C5FD", "FLOAT": "#93C5FD", "BOOLEAN": "#FBBF24",
    "COMBO": "#C4B5FD", "FILE3D": "#22D3EE", "MULTI": "#E5E7EB", "AUTOGROW": "#E5E7EB",
}
TYPE_SHORT = {
    "COMFYTV_TEXT": "TEXT", "COMFYTV_IMAGE": "IMG", "COMFYTV_IMAGES": "IMGS",
    "COMFYTV_VIDEO": "VID", "COMFYTV_AUDIO": "AUD", "COMFYTV_MODEL": "3D",
    "COMFYTV_MATERIAL": "MAT", "COMFYTV_PANORAMA": "PANO",
    "COMFYTV_STORYBOARD": "BOARD", "COMFYTV_TIMELINE": "TIME",
    "COMFYTV_FXSPEC": "FX", "IMAGE": "IMAGE", "MASK": "MASK", "STRING": "STR",
    "INT": "INT", "FLOAT": "NUM", "BOOLEAN": "BOOL", "COMBO": "LIST",
    "FILE3D": "3D", "MULTI": "ANY", "AUTOGROW": "LIST",
}
INTERNAL = {"force_run_token", "project_id", "parent_output_id", "schema_version",
            "custom_params", "captured_image", "selected_index", "pool", "append_results"}

CATEGORY_ORDER = [
    "ComfyTV/Project", "ComfyTV/Input", "ComfyTV/Generate", "ComfyTV/Compose",
    "ComfyTV/Image", "ComfyTV/Panorama", "ComfyTV/Video", "ComfyTV/VideoFX",
    "ComfyTV/Keying", "ComfyTV/Audio", "ComfyTV/AudioFX", "ComfyTV/Music",
    "ComfyTV/3D", "ComfyTV/3d", "ComfyTV/Bridge", "ComfyTV/Utils",
    "ComfyTV/Output", "Photoshop",
]
CATEGORY_ZH = {
    "ComfyTV/Project": "项目", "ComfyTV/Input": "输入与加载",
    "ComfyTV/Generate": "生成", "ComfyTV/Compose": "编排与挑选",
    "ComfyTV/Image": "图像编辑", "ComfyTV/Panorama": "全景",
    "ComfyTV/Video": "视频剪辑", "ComfyTV/VideoFX": "视频特效",
    "ComfyTV/Keying": "抠像与遮罩", "ComfyTV/Audio": "音频剪辑",
    "ComfyTV/AudioFX": "音频处理", "ComfyTV/Music": "音乐与乐谱",
    "ComfyTV/3D": "三维", "ComfyTV/3d": "三维文件",
    "ComfyTV/Bridge": "桥接", "ComfyTV/Utils": "工具",
    "ComfyTV/Output": "输出", "Photoshop": "Photoshop",
}
CATEGORY_BLURB = {
    "ComfyTV/Project": "先放一个项目节点，给这张画布起名。后面生成的图片、视频、音频都会归档到它下面。",
    "ComfyTV/Input": "把已有的图片、视频、音频、文字、模型和 PSD 送进画布。加载后不用点运行，下游可以直接用。",
    "ComfyTV/Generate": "从提示词出发，生成文字、图片、视频、语音、音乐、分镜或 3D 模型。这类节点都有运行按钮。",
    "ComfyTV/Compose": "从一批结果里挑一个，或把多个镜头编排成一条片子。",
    "ComfyTV/Image": "裁剪、旋转、重绘、抠图、放大、调色。多数在卡片里即时预览，需要出文件时才运行。",
    "ComfyTV/Panorama": "生成全景，再从里面截出你要对准的视角。",
    "ComfyTV/Video": "剪一段、拼一段、改分辨率、抽帧、分离音视频。",
    "ComfyTV/VideoFX": "调色、风格化、镜头、粒子和时间特效。滑杆在卡片里实时预览，FX Chain 负责一次渲染整串效果。",
    "ComfyTV/Keying": "绿幕抠像、遮罩绘制、跟踪和蒙版修边。",
    "ComfyTV/Audio": "裁剪、拼接、混音，以及从视频里拆出声音。",
    "ComfyTV/AudioFX": "均衡、压缩、混响、降噪、变调和响度统一。",
    "ComfyTV/Music": "写乐谱、编 MIDI、做节拍器和把乐谱渲染成音频。",
    "ComfyTV/3D": "摆场景、调材质、做网格布尔和烘焙贴图。",
    "ComfyTV/3d": "在一组 3D 文件里取第一个交给下游。",
    "ComfyTV/Bridge": "ComfyTV 的结果是项目里的快照，不能直接接 ComfyUI 原生节点。桥接节点负责两边互转。",
    "ComfyTV/Utils": "批量循环，以及挂载你自己的 ComfyUI 工作流。",
    "ComfyTV/Output": "把带透明通道的结果存成网页常用的视频格式。",
    "Photoshop": "和 Photoshop 面板交换画布、蒙版、提示词和分层结果。",
}


def fmt_num(v):
    if isinstance(v, float):
        t = f"{v:.3f}".rstrip("0").rstrip(".")
        return t or "0"
    if isinstance(v, int) and abs(v) > 1_000_000:
        return "不限"
    return str(v)


SPREAD_HELPERS = {"_asset_loader_inputs", "_captured_image_input", "_batch_input"}
EDITOR_STATE = {"layer_state", "canvas_state", "scene_state", "score_data",
                 "poster_state", "storyboard_data", "material_state", "timeline_data",
                 "captured_images", "captured_video"}


def visible(node):
    rows = []
    for i in node["inputs"]:
        if i.get("id") in INTERNAL or i.get("id") in EDITOR_STATE or i.get("id") in SPREAD_HELPERS:
            continue
        if not i.get("id") or str(i.get("id")).startswith("_"):
            continue
        rows.append(i)
    return rows


def color_of(item):
    typ = item.get("type")
    if typ == "AUTOGROW":
        typ = (item.get("template") or {}).get("type")
    if typ == "MULTI":
        types = item.get("types") or []
        typ = types[0] if types else typ
    return TYPE_COLOR.get(typ, "#9CA3AF")


def short_of(item):
    typ = item.get("type")
    if typ == "AUTOGROW":
        return TYPE_SHORT.get((item.get("template") or {}).get("type"), "LIST")
    if typ == "MULTI":
        types = item.get("types") or []
        return TYPE_SHORT.get(types[0], "ANY") if len(types) == 1 else "ANY"
    return TYPE_SHORT.get(typ, "")


def socket_side(item, output=False):
    if output:
        return True
    if item.get("type") == "AUTOGROW":
        return True
    if item.get("socketless"):
        return False
    return item.get("type", "").startswith("COMFYTV_") or item.get("type") in {
        "IMAGE", "MASK", "FILE3D", "MULTI", "AUDIO", "VIDEO",
    }


def row_text(item):
    name = item.get("display") or item.get("id") or ""
    typ = item.get("type", "")
    if typ == "AUTOGROW":
        tmpl = item.get("template") or {}
        hi = tmpl.get("max")
        short = TYPE_SHORT.get(tmpl.get("type"), "")
        prefix = tmpl.get("prefix", name)
        return f"{prefix} ×0–{hi}  {short}" if hi else f"{prefix}  {short}"
    if typ == "COMBO":
        opts = item.get("options") or []
        shown = " / ".join(opts[:3])
        if item.get("options_more") or len(opts) > 3:
            shown += " …"
        return f"{name}   {shown}" if shown else name
    if typ == "BOOLEAN":
        return f"{name}   {'开' if item.get('default') else '关'}"
    if typ in ("INT", "FLOAT") and "default" in item:
        tail = fmt_num(item["default"])
        if "min" in item and "max" in item:
            lo, hi = fmt_num(item["min"]), fmt_num(item["max"])
            if hi == "不限":
                span = f"{lo} 以上"
            elif lo == "不限":
                span = f"到 {hi}"
            else:
                span = f"{lo}–{hi}"
            tail = f"{span} · {tail}"
        return f"{name}   {tail}"
    if typ == "STRING" and item.get("multiline"):
        return name
    if "default" in item and item["default"] not in ("", None):
        return f"{name}   {item['default']}"
    return str(name)


def font(size, bold=False, mono=False):
    path = MONO_PATH if mono else (FONT_BOLD if bold else FONT_PATH)
    return ImageFont.truetype(path, size)


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def rounded(draw, box, radius, fill, outline=None):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline)


def fit(draw, text, fnt, limit):
    if draw.textlength(text, font=fnt) <= limit:
        return text
    while text and draw.textlength(text + "…", font=fnt) > limit:
        text = text[:-1]
    return text + "…"


def card_image(node):
    rows = visible(node)
    inputs = [r for r in rows if not socket_side(r)]
    sockets_in = [r for r in rows if socket_side(r)]
    sockets_out = node["outputs"]
    W, pad, row_h, sock_h = 720, 26, 52, 40
    blocks = []
    for sock in sockets_in:
        blocks.append(("in", sock, sock_h))
    if sockets_in:
        blocks.append(("gap", None, 10))
    for r in inputs:
        h = 104 if r.get("type") == "STRING" and r.get("multiline") else row_h
        blocks.append(("row", r, h + 10))
    if not inputs and not sockets_in:
        blocks.append(("empty", None, row_h))
    blocks.append(("rule", None, 18))
    if sockets_out:
        for sock in sockets_out:
            blocks.append(("out", sock, sock_h))
    else:
        blocks.append(("none", None, sock_h))
    H = 64 + sum(b[2] for b in blocks) + 24
    img = Image.new("RGB", (W, H), "#14141a")
    draw = ImageDraw.Draw(img)
    rounded(draw, (8, 8, W - 9, H - 9), 26, "#1b1b20", "#2e2e36")
    title = node["display_name"] or node["class"]
    draw.text((pad, 26), fit(draw, title, font(28, bold=True), W - 80),
              fill="#ececf1", font=font(28, bold=True))
    draw.ellipse((W - 42, 30, W - 30, 42), fill="#A78BFA")
    y = 72
    title_font = font(22)
    badge_font = font(16, mono=True)
    for kind, item, h in blocks:
        if kind == "in":
            col = color_of(item)
            cy = y + sock_h // 2
            draw.ellipse((2, cy - 9, 20, cy + 9), fill=hex_rgb(col))
            label = item.get("display") or item["id"]
            draw.text((pad, cy - 12), fit(draw, str(label), title_font, 460),
                      fill="#b9b9c0", font=title_font)
            badge = short_of(item)
            draw.text((W - pad - draw.textlength(badge, font=badge_font), cy - 9),
                      badge, fill=hex_rgb(col), font=badge_font)
        elif kind == "row":
            col = color_of(item)
            box_h = h - 10
            rounded(draw, (pad, y, W - pad, y + box_h), 12, "#26262d", "#34343d")
            draw.rectangle((W - pad - 7, y, W - pad, y + box_h), fill=hex_rgb(col))
            if item.get("type") == "STRING" and item.get("multiline"):
                draw.text((pad + 18, y + 12), item["id"], fill="#8f8f98", font=font(18))
                draw.text((pad + 18, y + 50), "在卡片里书写…", fill="#6b6b74", font=title_font)
            else:
                draw.text((pad + 18, y + 12), fit(draw, row_text(item), title_font, W - pad * 2 - 50),
                          fill="#d6d6de", font=title_font)
        elif kind == "empty":
            draw.text((pad, y + 12), "控件都在卡片内的编辑器里", fill="#6b6b74", font=title_font)
        elif kind == "rule":
            draw.line((pad, y + 8, W - pad, y + 8), fill="#2e2e36", width=2)
        elif kind == "out":
            col = color_of(item)
            cy = y + sock_h // 2
            draw.ellipse((W - 20, cy - 9, W - 2, cy + 9), fill=hex_rgb(col))
            label = str(item.get("id") or item.get("display") or "out")
            draw.text((W - pad - 16 - draw.textlength(label, font=title_font), cy - 12),
                      label, fill="#d6d6de", font=title_font)
            badge = short_of(item)
            draw.text((pad, cy - 9), badge, fill=hex_rgb(col), font=badge_font)
        elif kind == "none":
            draw.text((pad, y + 8), "无输出端口", fill="#6b6b74", font=title_font)
        y += h
    return img


def slug(node):
    name = node["class"]
    out = []
    for i, ch in enumerate(name):
        if ch.isupper() and i and (name[i - 1].islower() or (i + 1 < len(name) and name[i + 1].islower())):
            out.append("-")
        out.append(ch.lower())
    return "".join(out).replace("stage", "").strip("-") or name.lower()


def fmt_widget(item):
    if not item.get("id"):
        return ""
    name = f"`{item['id']}`"
    typ = item.get("type", "")
    bits = []
    if typ == "COMBO" and item.get("options"):
        opts = "、".join(f"`{o}`" for o in item["options"][:8])
        more = item.get("options_more", 0) + max(0, len(item["options"]) - 8)
        if more:
            opts += f" 等 {len(item['options']) + item.get('options_more', 0)} 项"
        bits.append(opts)
    if "default" in item and item["default"] not in ("", None):
        bits.append(f"默认 `{fmt_num(item['default']) if isinstance(item['default'], float) else item['default']}`")
    if "min" in item and "max" in item and item["min"] is not None:
        lo, hi = fmt_num(item["min"]), fmt_num(item["max"])
        if hi == "不限":
            bits.append(f"`{lo}` 以上")
        elif lo == "不限":
            bits.append(f"到 `{hi}`")
        else:
            bits.append(f"范围 `{lo}`–`{hi}`")
    if typ == "AUTOGROW":
        tmpl = item.get("template") or {}
        bits.append(f"可接 0–{tmpl.get('max', '?')} 路 `{tmpl.get('type', '')}`")
    if item.get("optional"):
        bits.append("可选")
    detail = "；".join(bits)
    return f"{name}（{detail}）" if detail else name


def section(nodes):
    lines = []
    for node in nodes:
        title = node["display_name"] or node["class"]
        nid = node["node_id"] or node["class"]
        usage = USAGE.get(node["class"], "")
        rel = f"images/nodes/{slug(node)}.png"
        lines.append(f"### {title}")
        lines.append("")
        if usage:
            lines.append(usage)
            lines.append("")
        lines.append(f"![{title} 节点]({rel})")
        lines.append("")
        rows = [r for r in visible(node) if not socket_side(r)]
        ins = [r for r in visible(node) if socket_side(r)]
        if ins:
            def sock_label(r):
                if r.get("type") == "AUTOGROW":
                    tmpl = r.get("template") or {}
                    return (f"`{r['id']}`（最多 {tmpl.get('max', '?')} 路 "
                            f"`{tmpl.get('type', '')}`）")
                return f"`{r['id']}`（`{r.get('type')}`）"
            lines.append("**接进来：** " + "、".join(sock_label(r) for r in ins))
            lines.append("")
        widgets = [fmt_widget(r) for r in rows]
        widgets = [w for w in widgets if w]
        if widgets:
            lines.append("**卡片上的控件：** " + "、".join(widgets))
            lines.append("")
        if node["outputs"]:
            lines.append("**送出去：** " + "、".join(
                f"`{o['id'] or o.get('display')}`（`{o['type']}`）" for o in node["outputs"]))
        else:
            lines.append("**送出去：** 无。")
        lines.append("")
        lines.append(f"<sub>节点 ID：`{nid}`</sub>")
        lines.append("")
    return "\n".join(lines)


def main():
    nodes = [n for n in json.loads(CATALOG.read_text(encoding="utf-8-sig"))
             if n["class"] != "_PickerStage"]
    missing = [n["class"] for n in nodes if n["class"] not in USAGE]
    if missing:
        raise SystemExit("missing usage: " + ", ".join(missing))
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    for old in IMG_DIR.glob("*.svg"):
        old.unlink()
    for node in nodes:
        card_image(node).save(IMG_DIR / f"{slug(node)}.png")
    grouped = {c: [] for c in CATEGORY_ORDER}
    for node in nodes:
        grouped.setdefault(node["category"], []).append(node)
    lines = [
        "# ComfyTV 节点使用教程",
        "",
        "这篇文档按菜单里的分类，逐个说明 ComfyTV 的节点怎么用。每个节点下面的图是它在画布上的卡片：",
        "左侧圆点是接进来的端口，右侧圆点是送出去的端口，中间是卡片上的控件。颜色对应数据类型。",
        "",
        "| 颜色 | 数据类型 |",
        "|---|---|",
        "| 紫色 | 文本 `COMFYTV_TEXT` |",
        "| 绿色 | 图片 `COMFYTV_IMAGE` |",
        "| 蓝色 | 图片组 `COMFYTV_IMAGES` |",
        "| 粉色 | 视频 `COMFYTV_VIDEO` |",
        "| 黄色 | 音频 `COMFYTV_AUDIO` |",
        "| 青色 | 3D 模型 `COMFYTV_MODEL` |",
        "",
        "先记住三件事：",
        "",
        "1. **运行只跑当前节点。** 卡片里的运行按钮不会重跑整张图，下游用的是上游已经保存的结果。",
        "2. **很多节点不用运行。** 裁剪、旋转、调色滑杆、全景视角、图层和乐谱编辑都在浏览器里即时生效。",
        "3. **要接 ComfyUI 原生节点，先过桥。** `COMFYTV_*` 是项目里的结果，原生 `IMAGE` / `VIDEO` / `AUDIO` 是运行时数据，用「桥接」分类里的节点互转。",
        "",
        f"共 {len(nodes)} 个节点。",
        "",
    ]
    for cat in CATEGORY_ORDER:
        items = grouped.get(cat) or []
        if not items:
            continue
        lines.append(f"## {CATEGORY_ZH.get(cat, cat)}")
        lines.append("")
        lines.append(CATEGORY_BLURB.get(cat, ""))
        lines.append("")
        lines.append(section(items))
    extra = [c for c in grouped if c not in CATEGORY_ORDER and grouped[c]]
    for cat in extra:
        lines.append(f"## {cat}")
        lines.append("")
        lines.append(section(grouped[cat]))
    OUT_MD.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    print(f"nodes={len(nodes)} images={len(list(IMG_DIR.glob('*.png')))} md={OUT_MD}")


if __name__ == "__main__":
    main()
