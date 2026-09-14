"""Pass Comfy.org login from the outer stage prompt into nested / remote API nodes.

ComfyUI puts ``auth_token_comfy_org`` / ``api_key_comfy_org`` on the queued
prompt's ``extra_data``. Nested LocalComfyUI runs and remote ``/prompt`` POSTs
used to drop that, so bound API nodes 401 and the frontend pops its own
login dialog even when the user is already signed in.
"""
from __future__ import annotations

import contextvars
import functools
import inspect
from typing import Any

_CURRENT_AUTH: contextvars.ContextVar[dict[str, str]] = contextvars.ContextVar(
    "comfytv_auth_extra", default={},
)

_AUTH_ATTRS = (
    ("auth_token_comfy_org", "auth_token_comfy_org"),
    ("api_key_comfy_org", "api_key_comfy_org"),
    ("comfy_usage_source", "comfy_usage_source"),
)


def extra_from_hidden(hidden: Any) -> dict[str, str]:
    extra: dict[str, str] = {}
    if hidden is None:
        return extra
    for attr, key in _AUTH_ATTRS:
        val = getattr(hidden, attr, None)
        if isinstance(val, str):
            text = val.strip()
            if text:
                extra[key] = text
    return extra


def current_auth_extra() -> dict[str, str]:
    return dict(_CURRENT_AUTH.get() or {})


def nested_extra_data(client_id: Any = None) -> dict[str, Any]:
    extra: dict[str, Any] = dict(current_auth_extra())
    if client_id is not None:
        extra["client_id"] = client_id
    return extra


def _push_from_hidden(hidden: Any) -> contextvars.Token:
    return _CURRENT_AUTH.set(extra_from_hidden(hidden))


def install_auth_passthrough(cls) -> None:
    if getattr(cls, "_comfytv_auth_passthrough", False):
        return
    execute = getattr(cls, "execute", None)
    inner = getattr(execute, "__func__", None)
    if inner is None:
        return

    if inspect.iscoroutinefunction(inner):
        @functools.wraps(inner)
        async def wrapped(cls_, *args, **kwargs):
            token = _push_from_hidden(getattr(cls_, "hidden", None))
            try:
                return await inner(cls_, *args, **kwargs)
            finally:
                _CURRENT_AUTH.reset(token)
    else:
        @functools.wraps(inner)
        def wrapped(cls_, *args, **kwargs):
            token = _push_from_hidden(getattr(cls_, "hidden", None))
            try:
                return inner(cls_, *args, **kwargs)
            finally:
                _CURRENT_AUTH.reset(token)

    cls.execute = classmethod(wrapped)
    cls._comfytv_auth_passthrough = True
