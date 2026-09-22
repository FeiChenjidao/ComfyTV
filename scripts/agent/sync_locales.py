import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
FRONTEND = sys.argv[1] if len(sys.argv) > 1 else r"G:\ComfyUI_frontend"
AGENT = os.path.join(REPO, "src", "agent")
OUT = os.path.join(AGENT, "locales")

SCAN = ["native", "host", "shell", "mount.ts"]
FULL_NAMESPACES = {"agent"}
KEEP_LOCAL = {"agentBar"}
EXTRA_KEYS = [
    "errorCatalog.promptErrors.agent_api_failed.desc",
    "errorCatalog.promptErrors.agent_api_failed.title",
]
OVERRIDES = {
    "agent.title": {"en": "ComfyTV Bot", "zh": "ComfyTV Bot"},
    "agent.placeholder": {
        "en": "Describe ideas, drag in media assets and files, or\nmention nodes",
        "zh": "描述想法，拖入媒体资源和文件，或\n提及节点",
    },
    "agent.addFromAssets": {"en": "From the asset library", "zh": "从资产库选择"},
    "agent.attachFiles": {"en": "Upload to the asset library", "zh": "上传到资产库"},
    "agent.suggestedPrompts": {
        "en": [
            "Add an image node with Z-Image Turbo, a neon cat at night, 16:9, and run it",
            "Use the picked image as reference for a 5-second image-to-video and QC the first frame",
            "Look at my canvas and tell me why the video node failed",
            "Trim this song into sections and build an audio-driven MV section by section",
            "I just linked a new workflow — bind seed, width and height for me",
        ],
        "zh": [
            "加一个 Z-Image Turbo 的图片节点，夜里的霓虹猫，16:9，跑起来",
            "用选中的图做参考出一段 5 秒图生视频，质检一下首帧",
            "看看我的画布，告诉我视频节点为什么失败了",
            "把这首歌按段落切开，逐段做一支音频驱动的 MV",
            "我刚 link 了个新工作流，帮我把 seed、宽、高绑上",
        ],
    },
}
KEY_RE = re.compile(r"""(?<![A-Za-z0-9_$.])(?:\$t|t|te)\(\s*['"]([A-Za-z0-9_.]+)['"]""")


def get(d, path):
    for part in path.split("."):
        if not isinstance(d, dict) or part not in d:
            return None
        d = d[part]
    return d


def put(d, path, value):
    parts = path.split(".")
    for part in parts[:-1]:
        d = d.setdefault(part, {})
    d[parts[-1]] = value


def used_keys():
    keys = set(EXTRA_KEYS)
    for target in SCAN:
        p = os.path.join(AGENT, target)
        files = [p] if os.path.isfile(p) else [
            os.path.join(r, f) for r, _, fs in os.walk(p) for f in fs if f.endswith((".ts", ".vue"))]
        for f in files:
            keys.update(KEY_RE.findall(open(f, encoding="utf-8").read()))
    return keys


def build(locale, keys):
    src = json.load(open(os.path.join(FRONTEND, "src", "locales", locale, "main.json"), encoding="utf-8"))
    out = {}
    for ns in sorted(FULL_NAMESPACES):
        if ns in src:
            out[ns] = src[ns]
    for key in sorted(keys):
        if key.split(".")[0] in FULL_NAMESPACES:
            continue
        value = get(src, key)
        if value is not None:
            put(out, key, value)
    for key, values in OVERRIDES.items():
        put(out, key, values[locale])
    existing_path = os.path.join(OUT, f"{locale}.json")
    if os.path.isfile(existing_path):
        existing = json.load(open(existing_path, encoding="utf-8"))
        for ns in KEEP_LOCAL:
            if ns in existing:
                out[ns] = existing[ns]
    os.makedirs(OUT, exist_ok=True)
    with open(existing_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return out


if __name__ == "__main__":
    keys = used_keys()
    for locale in ("en", "zh"):
        out = build(locale, keys)
        print(locale, {k: (len(v) if isinstance(v, dict) else 1) for k, v in out.items()})
