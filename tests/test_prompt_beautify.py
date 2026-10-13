from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path
from types import SimpleNamespace


def _load_mod():
    """Load prompt_beautify without importing ComfyTV.api package (heavy deps)."""
    root = Path(__file__).resolve().parents[1]
    pkg = "ComfyTV"
    if pkg not in sys.modules:
        m = types.ModuleType(pkg)
        m.__path__ = [str(root)]
        sys.modules[pkg] = m
    for name in (
        "ComfyTV.api",
        "ComfyTV.bot",
        "ComfyTV.bot.local_llm",
        "ComfyTV.bot.comfyui_llm_engine",
        "ComfyTV.bot.providers",
        "ComfyTV.storage",
    ):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)

    engine = sys.modules["ComfyTV.bot.comfyui_llm_engine"]
    engine.list_model_files = lambda: []
    engine.generate_chat = lambda *a, **k: {"content": ""}

    local = sys.modules["ComfyTV.bot.local_llm"]

    class _Local:
        def _base_url(self):
            return ""

        async def list_models(self):
            return []

        async def probe(self):
            return SimpleNamespace(available=False, detail="unset")

        def _api_headers(self):
            return {}

        async def _request_json(self, *a, **k):
            return {}

        @staticmethod
        def _extract_text(content):
            return str(content or "")

    local.LocalLlmProvider = _Local

    providers = sys.modules["ComfyTV.bot.providers"]

    class BotEvent:
        def __init__(self, t, text=""):
            self.t = t
            self.text = text

    class TurnHandle:
        def __init__(self):
            self.process = None
            self.stop_requested = False

    class TurnRequest:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    class TurnResult:
        def __init__(self, error="", aborted=False):
            self.error = error
            self.aborted = aborted

    providers.BotEvent = BotEvent
    providers.TurnHandle = TurnHandle
    providers.TurnRequest = TurnRequest
    providers.TurnResult = TurnResult
    providers.get_provider = lambda _id: None

    storage = sys.modules["ComfyTV.storage"]
    storage.get_setting = lambda _key, default=None: default

    common = types.ModuleType("ComfyTV.api._common")

    class _Routes:
        def post(self, _path):
            def deco(fn):
                return fn
            return deco

    common.routes = _Routes()
    sys.modules["ComfyTV.api._common"] = common

    path = root / "api" / "prompt_beautify.py"
    # Force reload so patched stubs apply.
    sys.modules.pop("ComfyTV.api.prompt_beautify", None)
    spec = importlib.util.spec_from_file_location(
        "ComfyTV.api.prompt_beautify", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["ComfyTV.api.prompt_beautify"] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _run(coro):
    return asyncio.run(coro)


def _req(payload: dict):
    async def _json():
        return payload
    return SimpleNamespace(json=_json)


class TestCleanPrompt:
    def test_strips_fences_and_label(self):
        mod = _load_mod()
        assert mod._clean_prompt("```\nPrompt: fluffy cat\n```") == "fluffy cat"
        assert mod._clean_prompt('"soft light"') == "soft light"
        assert mod._clean_prompt("「一只猫」") == "一只猫"
        assert mod._clean_prompt("提示词：一只猫") == "一只猫"


class TestPromptBeautifyRoute:
    def test_rejects_empty_prompt(self):
        mod = _load_mod()
        resp = _run(mod.prompt_beautify(_req({"prompt": "  "})))
        assert resp.status == 400
        assert "required" in json.loads(resp.text)["error"]

    def test_comfyui_path(self, monkeypatch):
        mod = _load_mod()
        monkeypatch.setattr(mod.engine, "list_model_files",
                            lambda: ["qwen3.safetensors"])

        def fake_generate(model, messages, tools, **kwargs):
            assert model == "qwen3.safetensors"
            assert messages[0]["role"] == "system"
            assert "Chinese" in messages[0]["content"]
            assert messages[1]["content"] == "a cat"
            assert kwargs.get("thinking") is False
            return {"content": "```\nPrompt: fluffy orange cat, soft light\n```"}

        monkeypatch.setattr(mod.engine, "generate_chat", fake_generate)

        async def boom_local(*_a, **_k):
            raise AssertionError("local should not run")

        async def boom_cli(*_a, **_k):
            raise AssertionError("cli should not run")

        monkeypatch.setattr(mod, "_via_local", boom_local)
        monkeypatch.setattr(mod, "_via_cli_agent", boom_cli)

        resp = _run(mod.prompt_beautify(_req({"prompt": "a cat", "language": "zh"})))
        assert resp.status == 200
        payload = json.loads(resp.text)
        assert payload["provider"] == "comfyui-llm"
        assert payload["prompt"] == "fluffy orange cat, soft light"

    def test_prefers_codex_when_selected(self, monkeypatch):
        mod = _load_mod()
        monkeypatch.setattr(mod, "_setting",
                            lambda key, default="": "codex" if key == "bot-provider" else default)
        monkeypatch.setattr(mod.engine, "list_model_files", lambda: [])

        async def fake_cli(prompt, language, provider_id):
            assert provider_id == "codex"
            assert prompt == "dog"
            assert language == "zh"
            return {
                "prompt": "一只忠诚的狗，金色阳光",
                "provider": "codex",
                "model": "gpt-5.3-codex",
            }

        monkeypatch.setattr(mod, "_via_cli_agent", fake_cli)

        async def no_local(*_a, **_k):
            return None

        monkeypatch.setattr(mod, "_via_local", no_local)

        resp = _run(mod.prompt_beautify(_req({"prompt": "dog", "language": "zh"})))
        assert resp.status == 200
        payload = json.loads(resp.text)
        assert payload["provider"] == "codex"
        assert "狗" in payload["prompt"]

    def test_falls_back_to_codex(self, monkeypatch):
        mod = _load_mod()
        monkeypatch.setattr(mod.engine, "list_model_files", lambda: [])

        async def no_local(*_a, **_k):
            return None

        async def fake_cli(prompt, language, provider_id):
            if provider_id != "codex":
                return None
            return {
                "prompt": "a loyal dog in golden hour light",
                "provider": "codex",
                "model": "codex",
            }

        monkeypatch.setattr(mod, "_via_local", no_local)
        monkeypatch.setattr(mod, "_via_cli_agent", fake_cli)

        resp = _run(mod.prompt_beautify(_req({"prompt": "dog", "language": "en"})))
        assert resp.status == 200
        payload = json.loads(resp.text)
        assert payload["provider"] == "codex"

    def test_503_when_no_llm(self, monkeypatch):
        mod = _load_mod()
        monkeypatch.setattr(mod.engine, "list_model_files", lambda: [])

        async def none_out(*_a, **_k):
            return None

        monkeypatch.setattr(mod, "_via_local", none_out)
        monkeypatch.setattr(mod, "_via_cli_agent", none_out)

        resp = _run(mod.prompt_beautify(_req({"prompt": "hello"})))
        assert resp.status == 503
        body = json.loads(resp.text)
        assert body["code"] == "no_llm"
        assert "Codex" in body["error"] or "no LLM" in body["error"]
