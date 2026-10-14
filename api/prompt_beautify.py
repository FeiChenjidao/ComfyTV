"""Lightweight prompt beautify — Local / ComfyUI LLM, then Bot CLI (Codex etc.), no MCP."""
from __future__ import annotations

import asyncio
import logging
import re

import aiohttp
from aiohttp import web

from .. import bot as _bot  # noqa: F401 — register CLI providers
from ..bot import comfyui_llm_engine as engine
from ..bot.local_llm import LocalLlmProvider
from ..bot.providers import BotEvent, TurnHandle, TurnRequest, get_provider
from ._common import routes

_log = logging.getLogger(__name__)

_MAX_INPUT_CHARS = 8_000
_MAX_TOKENS = 512
_TEMPERATURE = 0.3
_LOCAL_TIMEOUT_S = 120

# CLI agents that can do a one-shot rewrite without MCP tools.
_CLI_BEAUTIFY_IDS = ("codex", "claude-code", "qwen-code", "cursor-cli")
_CLI_MODEL_SETTING = {
    "codex": "bot-model-codex",
    "claude-code": "bot-model-claude-code",
    "qwen-code": "bot-model-qwen-code",
}

# Tuned for modern multimodal generators (Gemini / Imagen / Flux-class):
# clear natural language beats SD1.5-style keyword stuffing.
_SYSTEM_PROMPT = (
    "Polish the user's draft into a short image/video prompt for a modern "
    "multimodal model (e.g. Gemini).\n"
    "Rules:\n"
    "- Output ONLY the polished prompt — no quotes, labels, explanations, "
    "or markdown.\n"
    "- Keep it concise: usually 1–3 natural sentences (or one short "
    "paragraph). Do not pad.\n"
    "- Prefer plain descriptive language: subject, action, setting, mood. "
    "Add at most one lighting or camera cue if it clarifies the scene.\n"
    "- Do NOT add quality spam or tag lists "
    "(no masterpiece, best quality, ultra-detailed, 8K, HDR, trending on "
    "artstation, cinematic lighting stacks, etc.).\n"
    "- Do NOT invent new subjects, characters, brands, or plot. Preserve "
    "@mentions and technical tokens exactly.\n"
    "- Output language: {language}."
)

_LANG_LABEL = {
    "zh": "Chinese (简体中文)",
    "en": "English",
}

_NO_LLM_ERROR = (
    "no LLM available — use a Bot provider (e.g. Codex), "
    "put a Qwen3/Gemma checkpoint in models/text_encoders, "
    "or set a Local LLM endpoint under Settings → Agent & MCP"
)


def _clean_prompt(text: str) -> str:
    text = (text or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    for left, right in (('"', '"'), ("'", "'"), ("「", "」"), ("“", "”")):
        if len(text) >= 2 and text.startswith(left) and text.endswith(right):
            text = text[len(left):-len(right)].strip()
            break
    text = re.sub(
        r"^(?:improved\s+)?(?:prompt|提示词)\s*[:：]\s*",
        "",
        text,
        count=1,
        flags=re.IGNORECASE,
    ).strip()
    return text


def _messages(prompt: str, language: str) -> list[dict]:
    lang = _LANG_LABEL.get(language, _LANG_LABEL["en"])
    return [
        {"role": "system", "content": _SYSTEM_PROMPT.format(language=lang)},
        {"role": "user", "content": prompt},
    ]


def _setting(key: str, default: str = "") -> str:
    try:
        from .. import storage
        return str(storage.get_setting(key) or default).strip()
    except Exception:
        return default


def _cli_user_text(prompt: str, language: str) -> str:
    lang = _LANG_LABEL.get(language, _LANG_LABEL["en"])
    return (
        f"{_SYSTEM_PROMPT.format(language=lang)}\n\n"
        f"Draft:\n---\n{prompt}\n---"
    )


async def _via_comfyui(prompt: str, language: str) -> dict | None:
    models = engine.list_model_files()
    if not models:
        return None
    model = models[0]
    result = await asyncio.to_thread(
        engine.generate_chat,
        model,
        _messages(prompt, language),
        [],
        max_tokens=_MAX_TOKENS,
        temperature=_TEMPERATURE,
        top_p=0.95,
        thinking=False,
    )
    content = _clean_prompt(str(result.get("content") or ""))
    if not content:
        raise RuntimeError("ComfyUI LLM returned an empty prompt")
    return {"prompt": content, "provider": "comfyui-llm", "model": model}


async def _via_local(prompt: str, language: str) -> dict | None:
    provider = LocalLlmProvider()
    base = provider._base_url()
    if not base:
        return None
    models = await provider.list_models()
    if not models:
        status = await provider.probe()
        if not status.available:
            raise RuntimeError(status.detail or "Local LLM unavailable")
        raise RuntimeError("Local LLM reports no models")
    model = models[0]
    async with aiohttp.ClientSession() as session:
        data = await provider._request_json(
            session,
            "POST",
            f"{base}/chat/completions",
            headers=provider._api_headers(),
            json_body={
                "model": model,
                "messages": _messages(prompt, language),
                "temperature": _TEMPERATURE,
                "max_tokens": _MAX_TOKENS,
            },
            timeout=_LOCAL_TIMEOUT_S,
        )
    message = (data.get("choices") or [{}])[0].get("message") or {}
    content = _clean_prompt(provider._extract_text(message.get("content") or ""))
    if not content:
        raise RuntimeError("Local LLM returned an empty prompt")
    return {"prompt": content, "provider": "local-llm", "model": model}


async def _via_cli_agent(prompt: str, language: str, provider_id: str) -> dict | None:
    """One-shot rewrite through a Bot CLI provider with MCP disabled."""
    provider = get_provider(provider_id)
    if provider is None:
        return None
    status = await provider.probe()
    if not status.available:
        return None
    if status.logged_in is False:
        raise RuntimeError(status.detail or f"{provider_id} is not signed in")

    model_key = _CLI_MODEL_SETTING.get(provider_id, "")
    model = _setting(model_key) if model_key else ""

    chunks: list[str] = []

    async def emit(ev: BotEvent) -> None:
        if ev.t == "delta" and ev.text:
            chunks.append(ev.text)

    handle = TurnHandle()
    turn = TurnRequest(
        chat_id="prompt-beautify",
        user_text=_cli_user_text(prompt, language),
        mcp_endpoint="",  # no canvas tools — pure text rewrite
        model=model,
    )
    result = await provider.send(turn, emit, handle)
    if result.aborted and not chunks:
        raise RuntimeError(result.error or f"{provider_id} turn aborted")
    if result.error and not chunks:
        raise RuntimeError(result.error)
    content = _clean_prompt("".join(chunks))
    if not content:
        raise RuntimeError(f"{provider_id} returned an empty prompt")
    return {
        "prompt": content,
        "provider": provider_id,
        "model": model or status.version or provider_id,
    }


def _runner_order() -> list[tuple[str, object]]:
    """Prefer the user's selected Bot CLI, then local engines, then other CLIs."""
    preferred = _setting("bot-provider")
    runners: list[tuple[str, object]] = []
    seen: set[str] = set()

    def add(label: str, runner) -> None:
        if label in seen:
            return
        seen.add(label)
        runners.append((label, runner))

    if preferred in _CLI_BEAUTIFY_IDS:
        add(preferred, lambda p, l, pid=preferred: _via_cli_agent(p, l, pid))

    add("comfyui-llm", _via_comfyui)
    add("local-llm", _via_local)

    for pid in _CLI_BEAUTIFY_IDS:
        add(pid, lambda p, l, pid=pid: _via_cli_agent(p, l, pid))

    return runners


@routes.post("/comfytv/prompt/beautify")
async def prompt_beautify(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "request body is not valid JSON"}, status=400)

    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        return web.json_response({"error": "prompt is required"}, status=400)
    if len(prompt) > _MAX_INPUT_CHARS:
        return web.json_response(
            {"error": f"prompt exceeds {_MAX_INPUT_CHARS} characters"},
            status=400,
        )

    language = str(body.get("language") or "en").lower()
    if language not in _LANG_LABEL:
        language = "en"

    errors: list[str] = []
    for label, runner in _runner_order():
        try:
            result = await runner(prompt, language)  # type: ignore[operator]
        except Exception as e:
            _log.warning("[ComfyTV/beautify] %s failed: %s", label, e)
            errors.append(f"{label}: {e}")
            continue
        if result is not None:
            return web.json_response(result)

    detail = "; ".join(errors) if errors else _NO_LLM_ERROR
    return web.json_response({"error": detail, "code": "no_llm"}, status=503)
