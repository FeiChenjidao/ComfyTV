import asyncio
import base64
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Optional

from ._cli_common import (
    PROBE_CACHE_S,
    TOOL_RESULT_CAP,
    base_spawn_env,
    cli_command_argv,
    kill_process_tree,
    normalize_usage,
    run_cli_turn,
)
from .codex import write_agent_instructions
from .providers import (
    AgentProvider,
    BotEvent,
    EmitFn,
    ProviderCaps,
    ProviderStatus,
    TurnHandle,
    TurnRequest,
    TurnResult,
)

_MEDIA_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
}

_BUILTIN_TOOL_NAMES = {
    "readToolCall": "Read",
    "writeToolCall": "Write",
    "editToolCall": "Edit",
    "deleteToolCall": "Delete",
    "shellToolCall": "Shell",
    "grepToolCall": "Grep",
    "globToolCall": "Glob",
    "webFetchToolCall": "WebFetch",
    "webSearchToolCall": "WebSearch",
}


def resolve_cursor_command() -> Optional[list[str]]:
    if sys.platform == "win32":
        for name in ("agent.exe", "cursor-agent.exe"):
            found = shutil.which(name)
            if found:
                return [found]
    for name in ("agent", "cursor-agent"):
        found = shutil.which(name)
        if found:
            argv = cli_command_argv(found)
            if argv:
                return argv
    localapp = os.environ.get("LOCALAPPDATA") or str(
        Path.home() / "AppData" / "Local")
    candidates = [
        Path.home() / ".local" / "bin" / "agent",
        Path.home() / ".local" / "bin" / "agent.exe",
        Path(localapp) / "cursor-agent" / "agent.exe",
        Path(localapp) / "cursor-agent" / "agent",
        Path.home() / ".cursor" / "bin" / "agent.exe",
        Path.home() / ".cursor" / "bin" / "agent",
        Path("/usr/local/bin/agent"),
        Path("/opt/homebrew/bin/agent"),
    ]
    for candidate in candidates:
        argv = cli_command_argv(str(candidate))
        if argv:
            return argv
    return None


def write_cursor_config(home_dir: str, mcp_endpoint: str,
                        comfy_mcp_argv: Optional[list[str]] = None) -> Path:
    cursor_dir = Path(home_dir) / ".cursor"
    cursor_dir.mkdir(parents=True, exist_ok=True)
    servers: dict = {}
    if mcp_endpoint:
        servers["comfytv"] = {"url": mcp_endpoint}
    if comfy_mcp_argv:
        servers["comfy"] = {
            "command": comfy_mcp_argv[0],
            "args": list(comfy_mcp_argv[1:]),
        }
    mcp_path = cursor_dir / "mcp.json"
    mcp_path.write_text(
        json.dumps({"mcpServers": servers}, indent=2), encoding="utf-8")

    allow = ["Read(attachments/**)", "Read(AGENTS.md)"]
    if "comfytv" in servers:
        allow.append("Mcp(comfytv:*)")
    if "comfy" in servers:
        allow.append("Mcp(comfy:*)")
    cli_path = cursor_dir / "cli.json"
    cli_path.write_text(json.dumps({
        "permissions": {
            "allow": allow,
            "deny": ["Shell(*)", "Write(**)", "WebFetch(*)"],
        },
    }, indent=2), encoding="utf-8")
    return mcp_path


def parse_cursor_models(text: str) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    if isinstance(data, list):
        out: list[str] = []
        seen: set[str] = set()
        for item in data:
            name = str(item).strip()
            if name and name not in seen:
                seen.add(name)
                out.append(name)
        return out
    if isinstance(data, dict):
        raw = data.get("models") or data.get("ids") or []
        if isinstance(raw, list):
            out: list[str] = []
            seen: set[str] = set()
            for item in raw:
                if isinstance(item, str):
                    name = item.strip()
                elif isinstance(item, dict):
                    name = str(item.get("id") or item.get("name") or "").strip()
                else:
                    name = ""
                if name and name not in seen:
                    seen.add(name)
                    out.append(name)
            return out
    models: list[str] = []
    seen = set()
    for line in text.splitlines():
        line = line.strip().lstrip("-*•").strip()
        if not line:
            continue
        lower = line.lower()
        if lower.startswith("available") or lower.startswith("model"):
            continue
        token = line.split()[0]
        if token and token not in seen:
            seen.add(token)
            models.append(token)
    return models


def parse_cursor_logged_in(data) -> Optional[bool]:
    if not isinstance(data, dict):
        return None
    for key in ("loggedIn", "logged_in", "authenticated", "isLoggedIn"):
        if key in data:
            return bool(data[key])
    auth = data.get("auth")
    if isinstance(auth, dict):
        nested = parse_cursor_logged_in(auth)
        if nested is not None:
            return nested
    if data.get("email") or data.get("username") or data.get("user"):
        return True
    return None


def _assistant_text(message) -> str:
    if not isinstance(message, dict):
        return ""
    parts: list[str] = []
    for block in message.get("content") or []:
        if isinstance(block, dict) and block.get("text"):
            parts.append(str(block["text"]))
        elif isinstance(block, str):
            parts.append(block)
    return "".join(parts)


def _function_args(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except ValueError:
            return {"raw": raw} if raw else {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _tool_name_and_args(tool_call: dict) -> tuple[str, dict]:
    if not isinstance(tool_call, dict):
        return "", {}
    fn = tool_call.get("function")
    if isinstance(fn, dict):
        return str(fn.get("name") or ""), _function_args(fn.get("arguments"))
    for key, payload in tool_call.items():
        if not isinstance(payload, dict):
            continue
        if key in _BUILTIN_TOOL_NAMES:
            args = payload.get("args")
            return _BUILTIN_TOOL_NAMES[key], args if isinstance(args, dict) else {}
        if key.endswith("ToolCall"):
            args = payload.get("args")
            name = key[: -len("ToolCall")]
            return name or key, args if isinstance(args, dict) else {}
    return "", {}


def _flatten_tool_payload(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        if value.get("content") is not None:
            content = value["content"]
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts: list[str] = []
                for block in content:
                    if isinstance(block, dict) and "text" in block:
                        parts.append(str(block.get("text") or ""))
                    elif isinstance(block, str):
                        parts.append(block)
                    else:
                        parts.append(json.dumps(block, ensure_ascii=False))
                return "\n".join(parts)
        for key in ("message", "error", "detail", "text"):
            if value.get(key):
                return str(value[key])
        return json.dumps(value, ensure_ascii=False)
    return json.dumps(value, ensure_ascii=False)


def _tool_result_text(tool_call: dict) -> tuple[str, bool]:
    payloads: list[dict] = []
    fn = tool_call.get("function")
    if isinstance(fn, dict):
        payloads.append(fn)
    payloads.extend(
        payload for payload in tool_call.values() if isinstance(payload, dict))
    for payload in payloads:
        result = payload.get("result")
        if not isinstance(result, dict):
            continue
        if "error" in result or "failure" in result:
            err = result.get("error") or result.get("failure")
            return _flatten_tool_payload(err)[:TOOL_RESULT_CAP] or "tool failed", True
        if "success" in result:
            return _flatten_tool_payload(result.get("success"))[:TOOL_RESULT_CAP], False
        text = _flatten_tool_payload(result)
        if text:
            return text[:TOOL_RESULT_CAP], bool(result.get("isError") or result.get("is_error"))
    return "", False


class _CursorStreamParser:
    def __init__(self) -> None:
        self.session_id: Optional[str] = None
        self.result_error: str = ""
        self.result_seen = False
        self.usage: Optional[dict] = None
        self._saw_stream_delta = False
        self._tool_names: dict[str, str] = {}
        self._emitted_tool_use: set[str] = set()

    def parse_line(self, line: str) -> list[BotEvent]:
        line = line.strip()
        if not line:
            return []
        try:
            data = json.loads(line)
        except ValueError:
            return []
        if not isinstance(data, dict):
            return []
        event_type = data.get("type")
        session = data.get("session_id")
        if session:
            self.session_id = str(session)
        if event_type == "system" and data.get("subtype") == "init":
            return []
        if event_type == "assistant":
            return self._parse_assistant(data)
        if event_type == "tool_call":
            return self._parse_tool_call(data)
        if event_type == "result":
            self.result_seen = True
            self.usage = normalize_usage(
                data.get("usage"), data.get("total_cost_usd")) or self.usage
            if data.get("is_error"):
                self.result_error = str(
                    data.get("result") or data.get("subtype") or "error")
            return []
        return []

    def _parse_assistant(self, data: dict) -> list[BotEvent]:
        has_ts = "timestamp_ms" in data
        has_mc = "model_call_id" in data
        if has_ts and has_mc:
            return []
        text = _assistant_text(data.get("message") or {})
        if not text:
            return []
        if has_ts and not has_mc:
            self._saw_stream_delta = True
            return [BotEvent(t="delta", text=text)]
        if self._saw_stream_delta:
            return []
        return [BotEvent(t="delta", text=text)]

    def _parse_tool_call(self, data: dict) -> list[BotEvent]:
        call_id = str(data.get("call_id") or "")
        tool_call = data.get("tool_call") or {}
        if not isinstance(tool_call, dict):
            tool_call = {}
        name, arguments = _tool_name_and_args(tool_call)
        subtype = data.get("subtype")
        if subtype == "started":
            if call_id and call_id in self._emitted_tool_use:
                return []
            if call_id:
                self._emitted_tool_use.add(call_id)
                self._tool_names[call_id] = name
            return [BotEvent(t="tool_use", name=name, input=arguments, id=call_id)]
        if subtype == "completed":
            text, is_error = _tool_result_text(tool_call)
            return [BotEvent(
                t="tool_result",
                name=name or self._tool_names.get(call_id, ""),
                text=text,
                id=call_id,
                is_error=is_error,
            )]
        return []


class CursorCliProvider(AgentProvider):
    id = "cursor-cli"
    label = "Cursor CLI"

    def __init__(self, *, home_dir: Optional[str] = None) -> None:
        self._home_dir = home_dir
        self._probe_cache: Optional[tuple[float, ProviderStatus]] = None

    def capabilities(self) -> ProviderCaps:
        return ProviderCaps(stateful=True, tools="mcp", attachments=True)

    def _resolve_home(self) -> str:
        if self._home_dir:
            os.makedirs(self._home_dir, exist_ok=True)
            home = self._home_dir
        else:
            try:
                import folder_paths
                user = folder_paths.get_user_directory()
            except Exception:
                user = os.path.expanduser("~")
            home = os.path.join(user, "comfytv", "bot-home-cursor")
            os.makedirs(home, exist_ok=True)
            self._home_dir = home
        write_agent_instructions(home)
        return home

    async def probe(self) -> ProviderStatus:
        now = time.monotonic()
        if self._probe_cache and now - self._probe_cache[0] < PROBE_CACHE_S:
            return self._probe_cache[1]
        argv = resolve_cursor_command()
        if not argv:
            status = ProviderStatus(
                available=False, detail="agent executable not found")
            self._probe_cache = (now, status)
            return status
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv, "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=base_spawn_env(),
            )
            out, err = await asyncio.wait_for(proc.communicate(), timeout=15)
            version = ((out or b"") + (err or b"")).decode(
                "utf-8", "replace").strip()
        except (OSError, asyncio.TimeoutError) as e:
            status = ProviderStatus(
                available=False, detail=f"version check failed: {e}")
            self._probe_cache = (now, status)
            return status
        status = ProviderStatus(
            available=True,
            version=version,
            logged_in=await self._detect_logged_in(argv),
        )
        self._probe_cache = (now, status)
        return status

    async def _detect_logged_in(self, argv: list[str]) -> Optional[bool]:
        if os.environ.get("CURSOR_API_KEY"):
            return True
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv, "status", "--format", "json",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=base_spawn_env(),
            )
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=15)
        except (OSError, asyncio.TimeoutError):
            return None
        text = (out or b"").decode("utf-8", "replace").strip()
        try:
            data = json.loads(text) if text else None
        except ValueError:
            data = None
        parsed = parse_cursor_logged_in(data)
        if parsed is not None:
            return parsed
        lower = text.lower()
        if "logged out" in lower or "not logged" in lower:
            return False
        if "logged in" in lower:
            return True
        return None

    async def list_models(self) -> list[str]:
        argv = resolve_cursor_command()
        if not argv:
            return []
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv, "--list-models",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=base_spawn_env(),
            )
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=20)
            return parse_cursor_models((out or b"").decode("utf-8", "replace"))
        except (OSError, asyncio.TimeoutError):
            return []

    def _write_attachment(self, home: str, data: str, media_type: str,
                          index: int) -> Optional[str]:
        try:
            raw = base64.b64decode(data)
        except Exception:
            return None
        if not raw:
            return None
        out_dir = os.path.join(home, "attachments")
        os.makedirs(out_dir, exist_ok=True)
        ext = _MEDIA_EXT.get(media_type, ".bin")
        path = os.path.join(
            out_dir, f"att-{int(time.time() * 1000)}-{index}{ext}")
        with open(path, "wb") as fh:
            fh.write(raw)
        return path

    def _build_argv(self, turn: TurnRequest, home: str) -> tuple[list[str], list[str]]:
        argv = resolve_cursor_command()
        if not argv:
            raise RuntimeError("agent executable not found")
        temp_files: list[str] = []
        prompt = turn.user_text
        paths: list[str] = []
        for i, att in enumerate(turn.attachments):
            data = att.get("data")
            if not data:
                continue
            path = self._write_attachment(
                home, data, str(att.get("media_type") or "image/jpeg"), i)
            if path:
                temp_files.append(path)
                paths.append(path)
        if paths:
            prompt = prompt + "\n\nAttached files:\n" + "\n".join(paths)
        argv = argv + [
            "-p",
            "--output-format", "stream-json",
            "--stream-partial-output",
            "--approve-mcps",
            "--trust",
            "--force",
            "--sandbox", "enabled",
            "--workspace", home,
        ]
        if turn.model:
            argv += ["--model", turn.model]
        if turn.resume_token:
            argv += ["--resume", turn.resume_token]
        argv.append(prompt)
        return argv, temp_files

    async def send(self, turn: TurnRequest, emit: EmitFn,
                   handle: TurnHandle) -> TurnResult:
        home = self._resolve_home()
        await asyncio.to_thread(
            write_cursor_config, home, turn.mcp_endpoint, turn.comfy_mcp_argv)
        argv, temp_files = self._build_argv(turn, home)
        try:
            return await run_cli_turn(
                argv,
                cwd=home,
                env=base_spawn_env(),
                emit=emit,
                handle=handle,
                parser=_CursorStreamParser(),
                exe_label="agent",
            )
        finally:
            for path in temp_files:
                try:
                    os.remove(path)
                except OSError:
                    pass

    async def stop(self, handle: TurnHandle) -> None:
        await kill_process_tree(handle)
