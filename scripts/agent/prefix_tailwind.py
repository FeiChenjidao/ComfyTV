import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "src", "agent")
PREFIX = "ctv:"

EXCLUDED_PREFIXES = ("agent-", "docked-", "la-", "pi-", "comfy-", "ctv:", "cla:")
EXCLUDED_TOKENS = {
    "pi", "muted-textonly", "destructive-textonly", "overlay-white", "brand-ghost",
    "brand-solid", "brand-ghost-accent", "icon-sm", "icon-lg", "brand-icon",
    "select-none", "touch-none", "github-dark", "auto-limit", "asset-3d-viewer",
    "vue-i18n", "reka-ui", "tw-animate-css",
}
BARE_UTILITIES = {
    "flex", "grid", "hidden", "block", "inline", "relative", "absolute", "fixed",
    "sticky", "static", "truncate", "italic", "underline", "uppercase", "capitalize",
    "lowercase", "border", "rounded", "shadow", "transition", "sr-only", "invisible",
    "visible", "contents", "isolate", "grow", "shrink", "highlight", "resize",
    "container", "antialiased", "outline", "ring", "blur", "filter", "transform", "group", "peer",
    "animate-in", "animate-out", "collapse", "table", "cursor-pointer", "select-none",
    "touch-none", "overflow-hidden", "overflow-auto",
}
BARE_UTILITIES -= {"select-none", "touch-none"}
BARE_UTILITIES |= {"select-none", "touch-none"}
EXCLUDED_TOKENS -= {"select-none", "touch-none"}

TOKEN_RE = re.compile(r"^!?-?[a-z0-9\[\]&_:/.%#()>,*+~=\-]+!?$")


def class_like(token: str) -> bool:
    if not token or token.startswith(EXCLUDED_PREFIXES) or token in EXCLUDED_TOKENS:
        return False
    if token.startswith(("/", "#", "@", "$")):
        return False
    if not TOKEN_RE.match(token):
        return False
    if ATTRIBUTE_NAME.fullmatch(token):
        return False
    if token.startswith("[") and "]:" not in token:
        return False
    outside = re.sub(r"\[[^\]]*\]", "", token)
    if "//" in outside or token.endswith(":"):
        return False
    if "/" in outside:
        head, tail = outside.rsplit("/", 1)
        named_group = head.startswith(("group", "peer")) or head.split(":")[-1].startswith(("group", "peer"))
        line_height = head.split(":")[-1].startswith(("text-", "font-"))
        if not (named_group or line_height or re.fullmatch(r"\d+(\.\d+)?", tail or "")):
            return False
    if re.search(r"(?<!\d)\.|\.(?!\d)", outside):
        return False
    if token in BARE_UTILITIES:
        return True
    return "-" in outside or ":" in outside or token.startswith("[")


def prefix_token(token: str) -> str:
    if not class_like(token):
        return token
    if token.startswith("!"):
        return "!" + PREFIX + token[1:]
    return PREFIX + token


ATTRIBUTE_NAME = re.compile(r"(data|aria)-[a-z0-9-]+")
DEFINITIVE_PREFIXES = (
    "icon-", "bg-", "text-", "border-", "rounded", "font-", "shadow", "ring", "animate-",
    "transition", "pointer-events-", "cursor-", "whitespace-", "break-", "overflow-", "object-",
    "items-", "justify-", "gap-", "grid-", "flex-", "size-", "truncate", "sr-only", "uppercase",
    "opacity-", "leading-", "tracking-", "space-", "divide-", "place-", "self-", "shrink-", "grow-",
    "basis-", "fill-", "stroke-", "backdrop-", "will-change-", "select-", "touch-", "outline-",
    "underline", "line-clamp-", "min-", "max-", "w-", "h-", "p-", "m-", "px-", "py-", "mx-", "my-",
    "pt-", "pb-", "pl-", "pr-", "mt-", "mb-", "ml-", "mr-", "z-", "aspect-", "col-", "row-",
    "order-", "inline-", "translate-", "scale-", "rotate-", "origin-", "decoration-", "wrap-",
    "scroll-", "box-", "field-sizing-", "antialiased", "hover:", "focus", "group-", "peer-",
    "data-[", "aria-", "not-", "disabled:", "sm:", "md:", "lg:",
)
DEFINITIVE_SUFFIX = re.compile(r"-(\d|px$|full$|auto$|none$|xs$|sm$|md$|lg$|xl$|2xl$|3xl$|screen$)")


def definitive(token: str) -> bool:
    if token.startswith("!"):
        token = token[1:]
    if ":" in token or "[" in token or "/" in token:
        return True
    if DEFINITIVE_SUFFIX.search(token):
        return True
    return token.startswith(DEFINITIVE_PREFIXES)


def prefix_class_list(text: str, cautious: bool = False) -> str:
    if cautious:
        tokens = [t for t in text.split() if class_like(t)]
        if len(tokens) == 0 or (len(tokens) == 1 and not definitive(tokens[0])):
            return text
    return re.sub(r"\S+", lambda m: prefix_token(m.group(0)), text)


def prefix_string_literals(expr: str, cautious: bool = False) -> str:
    def repl(m):
        quote, body = m.group(1), m.group(2)
        if quote == "`":
            parts = re.split(r"(\$\{[^}]*\})", body)
            body = "".join(p if p.startswith("${") else prefix_class_list(p, cautious) for p in parts)
        else:
            body = prefix_class_list(body, cautious)
        return f"{quote}{body}{quote}"
    return re.sub(r"(['\"`])((?:\\.|(?!\1).)*)\1", repl, expr)


def transform_template(template: str) -> str:
    def static_attr(m):
        return f'{m.group(1)}"{prefix_class_list(m.group(2))}"'
    template = re.sub(r'(\sclass=)"([^"]*)"', static_attr, template)
    template = re.sub(r'(\s[a-z-]*-class=)"([^"]*)"', static_attr, template)

    def bound_attr(m):
        return f'{m.group(1)}"{prefix_string_literals(m.group(2))}"'
    template = re.sub(r'(\s:(?:[a-z-]*-)?class=)"([^"]*)"', bound_attr, template)
    template = re.sub(r'(\s:[a-zA-Z-]*[cC]lass=)"([^"]*)"', bound_attr, template)
    return template


SCRIPT_TRIGGER = re.compile(r"\bcn\(|\bcva\(|icon-\[|[cC]lass\b|CLASS\b")


IMPORT_LINE = re.compile(r"^\s*(import\b|export\s+.*\bfrom\b|\} from\b)")
EMIT_ARG = re.compile(r"(\$?emits?\(\s*)(['\"])([^'\"]*)\2")


def transform_script(script: str) -> str:
    out = []
    for line in script.split("\n"):
        if IMPORT_LINE.search(line):
            out.append(line)
            continue
        protected: list[str] = []

        def shield(m):
            protected.append(m.group(0))
            return f"\x00{len(protected) - 1}\x00"

        line = EMIT_ARG.sub(shield, line)
        line = prefix_string_literals(line, cautious=not SCRIPT_TRIGGER.search(line))
        line = re.sub(r"\x00(\d+)\x00", lambda m: protected[int(m.group(1))], line)
        out.append(line)
    return "\n".join(out)


def transform_file(path: str) -> bool:
    src = open(path, encoding="utf-8").read()
    if path.endswith(".vue"):
        def tpl(m):
            return m.group(1) + transform_template(m.group(2)) + m.group(3)
        new = re.sub(r"(<template[^>]*>)([\s\S]*?)(</template>\s*$|</template>\s*<script|</template>\s*<style)",
                     tpl, src, count=1)
        def scr(m):
            return m.group(1) + transform_script(m.group(2)) + m.group(3)
        new = re.sub(r"(<script[^>]*>)([\s\S]*?)(</script>)", scr, new)
    else:
        new = transform_script(src)
    if new != src:
        open(path, "w", encoding="utf-8", newline="\n").write(new)
        return True
    return False


def main() -> None:
    targets = [os.path.join(ROOT, "native"), os.path.join(ROOT, "host", "components"),
               os.path.join(ROOT, "host", "composables", "useTooltipConfig.ts"),
               os.path.join(ROOT, "host", "platform", "assets", "utils", "mediaIconUtil.ts"),
               os.path.join(ROOT, "host", "composables", "useWaveAudioPlayer.ts")]
    if len(sys.argv) > 1:
        targets = sys.argv[1:]
    changed = 0
    for target in targets:
        paths = [target] if os.path.isfile(target) else [
            os.path.join(r, f) for r, _, fs in os.walk(target) for f in fs if f.endswith((".vue", ".ts"))]
        for p in paths:
            if transform_file(p):
                changed += 1
    print(f"prefixed {changed} files")


if __name__ == "__main__":
    main()
