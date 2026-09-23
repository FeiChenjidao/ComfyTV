from __future__ import annotations

import base64
import json
from pathlib import Path

from ComfyTV.bot.codex import (
    CodexCodeProvider,
    _CodexStreamParser,
    _flatten_mcp_content,
    resolve_codex_command,
)
from ComfyTV.bot.providers import TurnRequest


def _line(obj) -> str:
    return json.dumps(obj)


class TestCodexParser:
    def test_thread_started_sets_session(self):
        p = _CodexStreamParser()
        assert p.parse_line(_line({"type": "thread.started",
                                   "thread_id": "th-1"})) == []
        assert p.session_id == "th-1"

    def test_agent_message_streams_incremental_deltas(self):
        p = _CodexStreamParser()
        first = p.parse_line(_line({"type": "item.updated", "item": {
            "id": "m1", "type": "agent_message", "text": "hel"}}))
        second = p.parse_line(_line({"type": "item.updated", "item": {
            "id": "m1", "type": "agent_message", "text": "hello"}}))
        done = p.parse_line(_line({"type": "item.completed", "item": {
            "id": "m1", "type": "agent_message", "text": "hello"}}))
        assert [(e.t, e.text) for e in first] == [("delta", "hel")]
        assert [(e.t, e.text) for e in second] == [("delta", "lo")]
        assert done == []

    def test_tool_use_emitted_once(self):
        p = _CodexStreamParser()
        item = {"id": "t1", "type": "mcp_tool_call",
                "tool": "mcp__comfytv__get_canvas", "arguments": {},
                "status": "in_progress"}
        first = p.parse_line(_line({"type": "item.started", "item": item}))
        again = p.parse_line(_line({"type": "item.updated", "item": item}))
        assert [(e.t, e.name) for e in first] == [
            ("tool_use", "mcp__comfytv__get_canvas")]
        assert again == []

    def test_tool_result_from_completed(self):
        p = _CodexStreamParser()
        p.parse_line(_line({"type": "item.started", "item": {
            "id": "t1", "type": "mcp_tool_call", "tool": "srv",
            "arguments": {}, "status": "in_progress"}}))
        events = p.parse_line(_line({"type": "item.completed", "item": {
            "id": "t1", "type": "mcp_tool_call", "tool": "srv",
            "status": "completed",
            "result": {"content": [{"type": "text", "text": "ok"}]}}}))
        assert [(e.t, e.name, e.text) for e in events] == [
            ("tool_result", "srv", "ok")]

    def test_tool_result_structured_content_fallback(self):
        p = _CodexStreamParser()
        events = p.parse_line(_line({"type": "item.completed", "item": {
            "id": "t2", "type": "mcp_tool_call", "tool": "srv",
            "status": "completed",
            "result": {"structured_content": {"a": 1}}}}))
        assert events[0].text == json.dumps({"a": 1})

    def test_tool_failure_surfaces_message(self):
        p = _CodexStreamParser()
        events = p.parse_line(_line({"type": "item.completed", "item": {
            "id": "t3", "type": "mcp_tool_call", "tool": "srv",
            "status": "failed", "error": {"message": "boom"}}}))
        assert [(e.t, e.text) for e in events] == [("tool_result", "boom")]

    def test_tool_failure_preserves_string_or_result_content(self):
        p = _CodexStreamParser()
        string_error = p.parse_line(_line({"type": "item.completed", "item": {
            "id": "t4", "type": "mcp_tool_call", "tool": "srv",
            "status": "failed", "error": "canvas command timed out"}}))
        content_error = p.parse_line(_line({"type": "item.completed", "item": {
            "id": "t5", "type": "mcp_tool_call", "tool": "srv",
            "status": "failed", "result": {"content": [
                {"type": "text", "text": "node 9 not found"},
            ]}}}))
        assert string_error[0].text == "canvas command timed out"
        assert content_error[0].text == "node 9 not found"

    def test_turn_completed_captures_usage(self):
        p = _CodexStreamParser()
        p.parse_line(_line({"type": "turn.completed",
                            "usage": {"input_tokens": 50,
                                      "cached_input_tokens": 10,
                                      "output_tokens": 7}}))
        assert p.result_seen
        assert p.usage == {"input_tokens": 50,
                           "cache_read_input_tokens": 10,
                           "output_tokens": 7}

    def test_tool_events_carry_id_and_error(self):
        p = _CodexStreamParser()
        started = p.parse_line(_line({"type": "item.started", "item": {
            "id": "t9", "type": "mcp_tool_call", "tool": "srv",
            "arguments": {}, "status": "in_progress"}}))
        failed = p.parse_line(_line({"type": "item.completed", "item": {
            "id": "t9", "type": "mcp_tool_call", "tool": "srv",
            "status": "failed", "error": {"message": "boom"}}}))
        assert started[0].id == "t9"
        assert failed[0].id == "t9"
        assert failed[0].is_error is True

    def test_turn_completed_and_failed(self):
        p = _CodexStreamParser()
        p.parse_line(_line({"type": "turn.completed"}))
        assert p.result_seen and not p.result_error
        q = _CodexStreamParser()
        q.parse_line(_line({"type": "turn.failed",
                            "error": {"message": "nope"}}))
        assert q.result_seen and q.result_error == "nope"

    def test_flatten_mixed_content(self):
        assert _flatten_mcp_content("plain") == "plain"
        assert _flatten_mcp_content(None) == ""
        assert _flatten_mcp_content([
            {"type": "text", "text": "a"}, "b",
        ]) == "a\nb"


class TestCodexArgv:
    def _provider(self, monkeypatch, tmp_path):
        from ComfyTV.bot import codex
        monkeypatch.setattr(codex, "resolve_codex_command", lambda: ["codex"])
        monkeypatch.setattr(CodexCodeProvider, "_mcp_lockdown_args",
                            lambda self: [])
        monkeypatch.setattr(CodexCodeProvider, "_plugin_lockdown_args",
                            lambda self: [])
        return CodexCodeProvider(home_dir=str(tmp_path))

    def test_first_turn_shape(self, monkeypatch, tmp_path):
        provider = self._provider(monkeypatch, tmp_path)
        argv, temp = provider._build_argv(
            TurnRequest(chat_id="c", user_text="hi",
                        mcp_endpoint="http://127.0.0.1:8188/comfytv/mcp"),
            str(tmp_path))
        assert argv[:4] == ["codex", "exec", "--sandbox", "read-only"]
        assert "--json" in argv
        assert "--skip-git-repo-check" in argv
        assert "--approve-for-me" not in argv
        assert 'mcp_servers.comfytv.url="http://127.0.0.1:8188/comfytv/mcp"' in argv
        assert "mcp_servers.comfytv.tool_timeout_sec=600" in argv
        assert 'mcp_servers.comfytv.default_tools_approval_mode="approve"' in argv
        assert "features.shell_tool=false" in argv
        assert 'web_search="disabled"' in argv
        assert 'approval_policy="never"' in argv
        assert "approvals_reviewer" not in " ".join(argv)
        assert argv[-2:] == ["--", "hi"]
        assert temp == []

    def test_model_override(self, monkeypatch, tmp_path):
        provider = self._provider(monkeypatch, tmp_path)
        argv, _ = provider._build_argv(
            TurnRequest(chat_id="c", user_text="hi", model="gpt-5.3-codex"),
            str(tmp_path))
        i = argv.index("-m")
        assert argv[i + 1] == "gpt-5.3-codex"
        plain, _ = provider._build_argv(
            TurnRequest(chat_id="c", user_text="hi"), str(tmp_path))
        assert "-m" not in plain

    def test_resume_turn(self, monkeypatch, tmp_path):
        provider = self._provider(monkeypatch, tmp_path)
        argv, _ = provider._build_argv(
            TurnRequest(chat_id="c", user_text="hi", resume_token="th-9"),
            str(tmp_path))
        assert argv[:5] == ["codex", "exec", "--sandbox", "read-only", "resume"]
        assert "--approve-for-me" not in argv
        assert argv.index("--sandbox") < argv.index("resume")
        assert 'approval_policy="never"' in argv
        assert "approvals_reviewer" not in " ".join(argv)
        assert argv[-3:] == ["--", "th-9", "hi"]

    def test_attachments_written_and_flagged(self, monkeypatch, tmp_path):
        provider = self._provider(monkeypatch, tmp_path)
        data = base64.b64encode(b"jpegbytes").decode("ascii")
        argv, temp = provider._build_argv(
            TurnRequest(chat_id="c", user_text="hi", attachments=[
                {"data": data, "media_type": "image/jpeg"},
                {"data": data, "media_type": "image/jpeg"},
            ]),
            str(tmp_path))
        assert len(temp) == 2
        assert len(set(temp)) == 2
        assert argv.count("-i") == 2
        assert argv[-2:] == ["--", "hi"]
        dash = argv.index("--")
        last_i = max(i for i, a in enumerate(argv) if a == "-i")
        assert last_i < dash
        for path in temp:
            with open(path, "rb") as fh:
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
        assert "-i" not in argv

    def test_empty_prompt_with_attachment_still_has_text(
            self, monkeypatch, tmp_path):
        provider = self._provider(monkeypatch, tmp_path)
        data = base64.b64encode(b"jpegbytes").decode("ascii")
        argv, temp = provider._build_argv(
            TurnRequest(chat_id="c", user_text="  ", attachments=[
                {"data": data, "media_type": "image/jpeg"},
            ]),
            str(tmp_path))
        assert len(temp) == 1
        assert argv[-2] == "--"
        assert argv[-1].strip()
        assert argv[-1] != temp[0]

    def test_plugin_lockdown_disables_desktop_plugins(
            self, monkeypatch, tmp_path):
        from ComfyTV.bot import codex
        home = tmp_path / "home"
        (home / ".codex").mkdir(parents=True)
        (home / ".codex" / "config.toml").write_text(
            '[plugins."computer-use@openai-bundled"]\nenabled = true\n'
            '[plugins."browser@openai-bundled"]\nenabled = true\n',
            encoding="utf-8")
        monkeypatch.setattr(Path, "home", lambda: home)
        monkeypatch.setattr(codex, "resolve_codex_command", lambda: ["codex"])
        monkeypatch.setattr(CodexCodeProvider, "_mcp_lockdown_args",
                            lambda self: [])
        provider = CodexCodeProvider(home_dir=str(tmp_path))
        argv, _ = provider._build_argv(
            TurnRequest(chat_id="c", user_text="hi"), str(tmp_path))
        assert 'plugins."computer-use@openai-bundled".enabled=false' in argv
        assert 'plugins."browser@openai-bundled".enabled=false' in argv


class TestResolveCodexCommand:
    def test_env_override(self, tmp_path, monkeypatch):
        from ComfyTV.bot import codex
        exe = tmp_path / "codex.exe"
        exe.write_text("", encoding="utf-8")
        monkeypatch.setenv("COMFYTV_CODEX_PATH", str(exe))
        monkeypatch.setattr(codex.shutil, "which", lambda *_a, **_k: None)
        assert resolve_codex_command() == [str(exe)]

    def test_windows_npm_cmd(self, tmp_path, monkeypatch):
        from ComfyTV.bot import codex
        appdata = tmp_path / "AppData" / "Roaming"
        npm = appdata / "npm"
        npm.mkdir(parents=True)
        cmd = npm / "codex.cmd"
        cmd.write_text("@echo off\n", encoding="utf-8")
        monkeypatch.delenv("COMFYTV_CODEX_PATH", raising=False)
        monkeypatch.setenv("APPDATA", str(appdata))
        monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "Local"))
        monkeypatch.setattr(codex.shutil, "which", lambda *_a, **_k: None)
        monkeypatch.setattr(codex.sys, "platform", "win32")
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        argv = resolve_codex_command()
        assert argv is not None
        assert argv[:4] == ["cmd.exe", "/d", "/s", "/c"]
        assert argv[4].endswith("codex.cmd")

    def test_missing_returns_none(self, tmp_path, monkeypatch):
        from ComfyTV.bot import codex
        monkeypatch.delenv("COMFYTV_CODEX_PATH", raising=False)
        monkeypatch.setenv("APPDATA", str(tmp_path / "a"))
        monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "b"))
        monkeypatch.setattr(codex.shutil, "which", lambda *_a, **_k: None)
        monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
        assert resolve_codex_command() is None


class TestCodexProbe:
    def test_not_found_detail(self, monkeypatch):
        import asyncio
        from ComfyTV.bot import codex
        monkeypatch.setattr(codex, "resolve_codex_command", lambda: None)
        provider = CodexCodeProvider(home_dir=".")
        provider._probe_cache = None
        st = asyncio.get_event_loop().run_until_complete(provider.probe())
        assert st.available is False
        assert "npm install -g @openai/codex" in st.detail
        assert "ChatGPT desktop" in st.detail
        assert "COMFYTV_CODEX_PATH" in st.detail

    def test_not_logged_in_detail(self, monkeypatch, tmp_path):
        import asyncio
        from ComfyTV.bot import codex

        async def fake_proc(*_a, **_k):
            class P:
                returncode = 0
                async def communicate(self):
                    return b"codex-cli 0.1.0\n", b""
            return P()

        monkeypatch.setattr(codex, "resolve_codex_command", lambda: ["codex"])
        monkeypatch.setattr(codex.asyncio, "create_subprocess_exec", fake_proc)
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        provider = CodexCodeProvider(home_dir=str(tmp_path))
        provider._probe_cache = None
        st = asyncio.get_event_loop().run_until_complete(provider.probe())
        assert st.available is True
        assert st.logged_in is False
        assert "codex login" in st.detail


class TestListModels:
    def test_reads_pinned_model(self, tmp_path, monkeypatch):
        import asyncio
        home = tmp_path / "home"
        (home / ".codex").mkdir(parents=True)
        (home / ".codex" / "config.toml").write_text(
            'model = "gpt-5.3-codex"\n', encoding="utf-8")
        monkeypatch.setattr(Path, "home", lambda: home)
        assert asyncio.get_event_loop().run_until_complete(
            CodexCodeProvider(home_dir=".").list_models()) == ["gpt-5.3-codex"]

    def test_no_config(self, tmp_path, monkeypatch):
        import asyncio
        monkeypatch.setattr(Path, "home", lambda: tmp_path / "nope")
        assert asyncio.get_event_loop().run_until_complete(
            CodexCodeProvider(home_dir=".").list_models()) == []


class TestCodexCaps:
    def test_capabilities(self):
        caps = CodexCodeProvider(home_dir=".").capabilities()
        assert caps.stateful is True
        assert caps.attachments is True

    def test_home_writes_agent_instructions(self, tmp_path, monkeypatch):
        provider = CodexCodeProvider(home_dir=str(tmp_path / "h"))
        home = provider._resolve_home()
        assert home.endswith("h")
        import os
        assert os.path.isdir(home)
        path = os.path.join(home, "AGENTS.md")
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        assert "get_canvas" in text
        assert "MCP" in text
        assert "resource" not in text.lower()

    def test_agent_instructions_rewritten_when_stale(self, tmp_path):
        from ComfyTV.bot.codex import write_agent_instructions
        (tmp_path / "AGENTS.md").write_text("old resource bridge text",
                                            encoding="utf-8")
        path = write_agent_instructions(str(tmp_path))
        text = path.read_text(encoding="utf-8")
        assert "old resource" not in text
        assert "get_canvas" in text
