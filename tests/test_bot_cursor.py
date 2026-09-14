from __future__ import annotations

import base64
import json

from ComfyTV.bot.cursor_cli import (
    CursorCliProvider,
    _CursorStreamParser,
    parse_cursor_logged_in,
    parse_cursor_models,
    write_cursor_config,
)
from ComfyTV.bot.providers import TurnRequest


def _line(obj) -> str:
    return json.dumps(obj)


class TestCursorParser:
    def test_init_sets_session(self):
        p = _CursorStreamParser()
        assert p.parse_line(_line({
            "type": "system", "subtype": "init",
            "session_id": "sid-1",
        })) == []
        assert p.session_id == "sid-1"

    def test_stream_partial_deltas_only(self):
        p = _CursorStreamParser()
        first = p.parse_line(_line({
            "type": "assistant",
            "timestamp_ms": 1,
            "message": {"content": [{"type": "text", "text": "hel"}]},
        }))
        second = p.parse_line(_line({
            "type": "assistant",
            "timestamp_ms": 2,
            "message": {"content": [{"type": "text", "text": "lo"}]},
        }))
        flush = p.parse_line(_line({
            "type": "assistant",
            "timestamp_ms": 3,
            "model_call_id": "mc-1",
            "message": {"content": [{"type": "text", "text": "hello"}]},
        }))
        final = p.parse_line(_line({
            "type": "assistant",
            "message": {"content": [{"type": "text", "text": "hello"}]},
        }))
        assert [(e.t, e.text) for e in first] == [("delta", "hel")]
        assert [(e.t, e.text) for e in second] == [("delta", "lo")]
        assert flush == []
        assert final == []

    def test_complete_assistant_without_partial_flag(self):
        p = _CursorStreamParser()
        events = p.parse_line(_line({
            "type": "assistant",
            "message": {"content": [{"type": "text", "text": "hello"}]},
        }))
        assert [(e.t, e.text) for e in events] == [("delta", "hello")]

    def test_tool_use_emitted_once(self):
        p = _CursorStreamParser()
        payload = {
            "type": "tool_call", "subtype": "started",
            "call_id": "t1",
            "tool_call": {"function": {
                "name": "mcp__comfytv__get_canvas",
                "arguments": "{\"node\":1}",
            }},
        }
        first = p.parse_line(_line(payload))
        again = p.parse_line(_line(payload))
        assert [(e.t, e.name, e.input) for e in first] == [
            ("tool_use", "mcp__comfytv__get_canvas", {"node": 1})]
        assert again == []
        assert first[0].id == "t1"

    def test_builtin_read_tool_and_result(self):
        p = _CursorStreamParser()
        started = p.parse_line(_line({
            "type": "tool_call", "subtype": "started", "call_id": "r1",
            "tool_call": {"readToolCall": {"args": {"path": "a.png"}}},
        }))
        done = p.parse_line(_line({
            "type": "tool_call", "subtype": "completed", "call_id": "r1",
            "tool_call": {"readToolCall": {
                "args": {"path": "a.png"},
                "result": {"success": {
                    "content": "pixels", "totalLines": 1,
                }},
            }},
        }))
        assert [(e.t, e.name, e.input) for e in started] == [
            ("tool_use", "Read", {"path": "a.png"})]
        assert [(e.t, e.name, e.text, e.is_error) for e in done] == [
            ("tool_result", "Read", "pixels", False)]

    def test_tool_failure_surfaces_message(self):
        p = _CursorStreamParser()
        events = p.parse_line(_line({
            "type": "tool_call", "subtype": "completed", "call_id": "t9",
            "tool_call": {"function": {
                "name": "srv",
                "result": {"error": {"message": "boom"}},
            }},
        }))
        assert [(e.t, e.text, e.is_error) for e in events] == [
            ("tool_result", "boom", True)]
        assert events[0].id == "t9"

    def test_result_error_and_session(self):
        p = _CursorStreamParser()
        p.parse_line(_line({
            "type": "result", "subtype": "success", "is_error": True,
            "result": "boom", "session_id": "sid-9",
        }))
        assert p.result_seen
        assert p.result_error == "boom"
        assert p.session_id == "sid-9"

    def test_success_result_keeps_session(self):
        p = _CursorStreamParser()
        p.parse_line(_line({
            "type": "result", "subtype": "success", "is_error": False,
            "result": "done", "session_id": "sid-2",
        }))
        assert p.result_seen
        assert not p.result_error
        assert p.session_id == "sid-2"

    def test_garbage_lines_ignored(self):
        p = _CursorStreamParser()
        assert p.parse_line("not json") == []
        assert p.parse_line("") == []
        assert p.parse_line("[]") == []


class TestCursorConfig:
    def test_writes_isolated_mcp_and_permissions(self, tmp_path):
        path = write_cursor_config(
            str(tmp_path), "http://127.0.0.1:8188/comfytv/mcp")
        assert path == tmp_path / ".cursor" / "mcp.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["mcpServers"] == {
            "comfytv": {"url": "http://127.0.0.1:8188/comfytv/mcp"},
        }
        cli = json.loads((tmp_path / ".cursor" / "cli.json").read_text(
            encoding="utf-8"))
        allow = cli["permissions"]["allow"]
        deny = cli["permissions"]["deny"]
        assert "Mcp(comfytv:*)" in allow
        assert "Read(attachments/**)" in allow
        assert "Shell(*)" in deny
        assert "Write(**)" in deny
        assert "WebFetch(*)" in deny
        assert "Mcp(comfy:*)" not in allow

    def test_mounts_and_unmounts_comfy_mcp(self, tmp_path):
        write_cursor_config(str(tmp_path), "http://x/mcp",
                            ["comfy-mcp", "--debug"])
        data = json.loads((tmp_path / ".cursor" / "mcp.json").read_text(
            encoding="utf-8"))
        assert data["mcpServers"]["comfy"] == {
            "command": "comfy-mcp", "args": ["--debug"],
        }
        cli = json.loads((tmp_path / ".cursor" / "cli.json").read_text(
            encoding="utf-8"))
        assert "Mcp(comfy:*)" in cli["permissions"]["allow"]
        write_cursor_config(str(tmp_path), "http://x/mcp")
        data = json.loads((tmp_path / ".cursor" / "mcp.json").read_text(
            encoding="utf-8"))
        assert "comfy" not in data["mcpServers"]

    def test_does_not_touch_user_global_mcp(self, tmp_path, monkeypatch):
        from pathlib import Path
        fake_home = tmp_path / "user-home"
        (fake_home / ".cursor").mkdir(parents=True)
        global_mcp = fake_home / ".cursor" / "mcp.json"
        global_mcp.write_text('{"keep": true}', encoding="utf-8")
        monkeypatch.setattr(Path, "home", lambda: fake_home)
        write_cursor_config(str(tmp_path / "bot-home"), "http://x/mcp")
        assert json.loads(global_mcp.read_text(encoding="utf-8")) == {"keep": True}


class TestCursorArgv:
    def _provider(self, monkeypatch, tmp_path):
        from ComfyTV.bot import cursor_cli
        monkeypatch.setattr(cursor_cli, "resolve_cursor_command",
                            lambda: ["agent"])
        return CursorCliProvider(home_dir=str(tmp_path))

    def test_first_turn_shape(self, monkeypatch, tmp_path):
        provider = self._provider(monkeypatch, tmp_path)
        argv, temp = provider._build_argv(
            TurnRequest(chat_id="c", user_text="hi",
                        mcp_endpoint="http://127.0.0.1:8188/comfytv/mcp"),
            str(tmp_path))
        assert argv[0] == "agent"
        assert argv[1] == "-p"
        assert argv[-1] == "hi"
        assert "--output-format" in argv
        assert argv[argv.index("--output-format") + 1] == "stream-json"
        assert "--stream-partial-output" in argv
        assert "--approve-mcps" in argv
        assert "--trust" in argv
        assert "--force" in argv
        assert argv[argv.index("--sandbox") + 1] == "enabled"
        assert argv[argv.index("--workspace") + 1] == str(tmp_path)
        assert "--model" not in argv
        assert "--resume" not in argv
        assert temp == []

    def test_model_and_resume(self, monkeypatch, tmp_path):
        provider = self._provider(monkeypatch, tmp_path)
        argv, _ = provider._build_argv(
            TurnRequest(chat_id="c", user_text="hi", model="composer-1.5",
                        resume_token="sid-9"),
            str(tmp_path))
        assert argv[argv.index("--model") + 1] == "composer-1.5"
        assert argv[argv.index("--resume") + 1] == "sid-9"
        assert argv[-1] == "hi"

    def test_attachments_written_into_prompt(self, monkeypatch, tmp_path):
        provider = self._provider(monkeypatch, tmp_path)
        data = base64.b64encode(b"jpegbytes").decode("ascii")
        argv, temp = provider._build_argv(
            TurnRequest(chat_id="c", user_text="look", attachments=[
                {"data": data, "media_type": "image/jpeg"},
            ]),
            str(tmp_path))
        assert len(temp) == 1
        prompt = argv[-1]
        assert prompt.startswith("look")
        assert temp[0] in prompt
        assert "Attached files:" in prompt
        with open(temp[0], "rb") as fh:
            assert fh.read() == b"jpegbytes"

    def test_bad_attachment_skipped(self, monkeypatch, tmp_path):
        provider = self._provider(monkeypatch, tmp_path)
        argv, temp = provider._build_argv(
            TurnRequest(chat_id="c", user_text="hi", attachments=[
                {"data": "", "media_type": "image/jpeg"},
                {"media_type": "image/jpeg"},
            ]),
            str(tmp_path))
        assert temp == []
        assert argv[-1] == "hi"


class TestCursorHelpers:
    def test_parse_models_json_and_text(self):
        assert parse_cursor_models('["a","b","a"]') == ["a", "b"]
        assert parse_cursor_models(json.dumps({
            "models": [{"id": "x"}, {"name": "y"}, "z"],
        })) == ["x", "y", "z"]
        assert parse_cursor_models("Available models:\n- composer-1.5\n- auto") == [
            "composer-1.5", "auto"]
        assert parse_cursor_models("") == []

    def test_parse_logged_in(self):
        assert parse_cursor_logged_in({"loggedIn": True}) is True
        assert parse_cursor_logged_in({"logged_in": False}) is False
        assert parse_cursor_logged_in({"auth": {"authenticated": True}}) is True
        assert parse_cursor_logged_in({"email": "a@b.c"}) is True
        assert parse_cursor_logged_in({}) is None
        assert parse_cursor_logged_in("nope") is None


class TestCursorCaps:
    def test_capabilities(self):
        caps = CursorCliProvider(home_dir=".").capabilities()
        assert caps.stateful is True
        assert caps.attachments is True
        assert caps.tools == "mcp"

    def test_home_writes_agent_instructions(self, tmp_path):
        provider = CursorCliProvider(home_dir=str(tmp_path / "h"))
        home = provider._resolve_home()
        text = (tmp_path / "h" / "AGENTS.md").read_text(encoding="utf-8")
        assert home.endswith("h")
        assert "get_canvas" in text
        assert "MCP" in text
