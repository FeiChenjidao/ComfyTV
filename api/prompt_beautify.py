"""Lightweight prompt beautify — reuses Bot Local / ComfyUI LLM backends, no MCP."""
from __future__ import annotations

import asyncio
import logging
import re

import aiohttp
from aiohttp import web

from ..bot import comfyui_llm_engine as engine
from ..bot.local_llm import LocalLlmProvider
from ._common import routes

_log = logging.getLogger(__name__)

_MAX_INPUT_CHARS = 8_000
_MAX_TOKENS = 1_024
_TEMPERATURE = 0.4
_LOCAL_TIMEOUT_S = 120

_SYSTEM_PROMPT = (
    "You are a prompt engineer for image / video generation.\n"
    "Rewrite the user's draft into a single vivid, production-ready prompt.\n"
    "Rules:\n"
    "- Output ONLY the improved prompt — no quotes, labels, explanations, "
    "or markdown fences.\n"
    "- Preserve the user's intent, subject, and any @mentions or technical "
    "tokens exactly as written.\n"
    "- Expand sparse drafts with lighting, composition, style, and quality "
    "cues when helpful; do not invent a different subject.\n"
    "- Keep the output language as requested: {language}."
)

_LANG_LABEL = {
    "zh": "Chinese (简体中文)",
    "en": "English",
}


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
    for label, runner in (
        ("comfyui-llm", _via_comfyui),
        ("local-llm", _via_local),
    ):
        try:
            result = await runner(prompt, language)
        except Exception as e:
            _log.warning("[ComfyTV/beautify] %s failed: %s", label, e)
            errors.append(f"{label}: {e}")
            continue
        if result is not None:
            return web.json_response(result)

    detail = "; ".join(errors) if errors else (
        "no LLM available — put a Qwen3/Gemma checkpoint in "
        "models/text_encoders, or set a Local LLM endpoint under "
        "Settings → Agent & MCP"
    )
    return web.json_response({"error": detail}, status=503)
