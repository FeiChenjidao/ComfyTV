import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
FRONTEND = sys.argv[1] if len(sys.argv) > 1 else r"G:\ComfyUI_frontend"
AGENT_SRC = os.path.join(FRONTEND, "src", "workbench", "extensions", "agent")
AGENT = os.path.join(REPO, "src", "agent")
NATIVE = os.path.join(AGENT, "native")
HOST = os.path.join(AGENT, "host")

EXCLUDE_DIRS = {"crdt", "__fixtures__"}
EXCLUDE_FILES = {
    "README.md",
    "composables/useAgentDockMount.ts",
    "utils/postHogFlagSource.ts",
    "components/agent/composer/inlinePromptEditorTestSetup.ts",
}
HOST_COPIES = [
    "types/nodeId.ts",
    "utils/positionBounds.ts",
    "utils/uuid.ts",
    "utils/resultItem.ts",
    "platform/workflow/core/utils/workflowId.ts",
    "platform/assets/composables/useAssetDownload.ts",
    "platform/onboarding/coachmarkLayout.ts",
    "platform/distribution/types.ts",
    "platform/support/config.ts",
    "platform/support/feedbackDialog.ts",
    "components/graph/CanvasBanner.vue",
    "components/ui/input/Input.vue",
    "components/ui/tooltip/AccessibleTooltip.vue",
    "components/ui/button/Button.vue",
    "components/ui/button/button.variants.ts",
]
HOST_COPY_EDITS = {
    "components/ui/button/Button.vue": [
        ('class="pi pi-spin pi-spinner"', 'class="icon-[lucide--loader-circle] animate-spin"'),
    ],
}
INGEST = ["index.ts", "types.gen.ts", "zod.gen.ts"]
ICON_COPIES = ["workflow.svg", "node.svg", "image-ai-edit.svg"]


def excluded(rel: str) -> bool:
    parts = rel.split("/")
    name = parts[-1]
    if any(p in EXCLUDE_DIRS for p in parts[:-1]):
        return True
    if ".test." in name or ".stories." in name:
        return True
    return rel in EXCLUDE_FILES


def copy_tree() -> int:
    shutil.rmtree(NATIVE, ignore_errors=True)
    n = 0
    for root, _, files in os.walk(AGENT_SRC):
        for f in files:
            src = os.path.join(root, f)
            rel = os.path.relpath(src, AGENT_SRC).replace(os.sep, "/")
            if excluded(rel):
                continue
            dst = os.path.join(NATIVE, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
            n += 1
    return n


def copy_host() -> None:
    for rel in HOST_COPIES:
        src = os.path.join(FRONTEND, "src", rel)
        dst = os.path.join(HOST, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        s = open(src, encoding="utf-8").read()
        for old, new in HOST_COPY_EDITS.get(rel, []):
            assert old in s, f"{rel}: expected {old!r}"
            s = s.replace(old, new)
        open(dst, "w", encoding="utf-8", newline="\n").write(s)


def fix_records(s: str) -> str:
    out, i = [], 0
    while True:
        j = s.find("z.record(", i)
        if j < 0:
            out.append(s[i:])
            return "".join(out)
        k = j + len("z.record(")
        depth, comma, m = 0, False, k
        while m < len(s):
            c = s[m]
            if c == "(":
                depth += 1
            elif c == ")":
                if depth == 0:
                    break
                depth -= 1
            elif c == "," and depth == 0:
                comma = True
            m += 1
        out.append(s[i:k])
        if not comma:
            out.append("z.string(), ")
        i = k


def copy_ingest() -> None:
    src_dir = os.path.join(FRONTEND, "packages", "ingest-types", "src")
    dst_dir = os.path.join(HOST, "ingest-types")
    os.makedirs(dst_dir, exist_ok=True)
    for f in INGEST:
        s = open(os.path.join(src_dir, f), encoding="utf-8").read()
        if f == "zod.gen.ts":
            s = fix_records(s)
        open(os.path.join(dst_dir, f), "w", encoding="utf-8", newline="\n").write(s)


def copy_icons() -> None:
    src_dir = os.path.join(FRONTEND, "packages", "design-system", "src", "icons")
    dst_dir = os.path.join(AGENT, "icons")
    os.makedirs(dst_dir, exist_ok=True)
    for name in ICON_COPIES:
        shutil.copyfile(os.path.join(src_dir, name), os.path.join(dst_dir, name))


def relink_alias() -> int:
    n = 0
    for base in (NATIVE, HOST):
        for r, _, fs in os.walk(base):
            for f in fs:
                if not f.endswith((".ts", ".vue")):
                    continue
                p = os.path.join(r, f)
                s = open(p, encoding="utf-8").read()
                fixed = s.replace("'@/", "'@agent/")
                if fixed != s:
                    open(p, "w", encoding="utf-8", newline="\n").write(fixed)
                    n += 1
    return n


FIXUP_RE = re.compile(r"'ctv:(fixed|left-center|left-end|left-start|graph-bottom|outline)'")


def fixups() -> None:
    n = 0
    for base in (NATIVE, os.path.join(HOST, "components")):
        for r, _, fs in os.walk(base):
            for f in fs:
                if not f.endswith((".ts", ".vue")):
                    continue
                p = os.path.join(r, f)
                s = open(p, encoding="utf-8").read()
                fixed = FIXUP_RE.sub(r"'\1'", s)
                if fixed != s:
                    open(p, "w", encoding="utf-8", newline="\n").write(fixed)
                    n += 1
    print("fixups", n)


def stamp() -> str:
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=FRONTEND, text=True).strip()
    date = subprocess.check_output(["git", "log", "-1", "--format=%cs", "HEAD"], cwd=FRONTEND, text=True).strip()
    open(os.path.join(NATIVE, "UPSTREAM"), "w", encoding="utf-8", newline="\n").write(
        f"{sha} {date} src/workbench/extensions/agent (GPL-3.0, Comfy-Org/ComfyUI_frontend)\n")
    return sha[:10]


def run(script: str, *args: str) -> None:
    subprocess.check_call([sys.executable, os.path.join(HERE, script), *args])


if __name__ == "__main__":
    print("copied", copy_tree(), "native files")
    copy_host()
    copy_ingest()
    copy_icons()
    print("upstream", stamp())
    run("patch_native.py")
    print("relinked", relink_alias())
    run("prefix_tailwind.py")
    fixups()
    run("sync_locales.py", FRONTEND)
