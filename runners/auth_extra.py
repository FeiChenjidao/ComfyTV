"""Pass Comfy.org login from the outer stage prompt into nested / remote API nodes.

ComfyUI puts ``auth_token_comfy_org`` / ``api_key_comfy_org`` on the queued
prompt's ``extra_data``. Nested LocalComfyUI runs and remote ``/prompt`` POSTs
used to drop that, so bound API nodes 401 and the frontend pops its own
login dialog even when the user is already signed in.

Those credentials only ever live in the browser, so a run that arrives from a
queue client that cannot send them -- the ``comfy`` CLI, a script, an agent
calling ``/prompt`` -- has none, and every API node inside the stage 401s.
The newest pair seen on any prompt is therefore kept in memory and lent to runs
that arrive without one. ``share-comfy-auth`` turns that off; nothing is
written to disk and the cache is dropped when the process exits.
"""
from __future__ import annotations

import contextvars
import functools
import inspect
import logging
import time
from typing import Any

_log = logging.getLogger(__name__)

_CURRENT_AUTH: contextvars.ContextVar[dict[str, str]] = contextvars.ContextVar(
    "comfytv_auth_extra", default={},
)

_AUTH_ATTRS = (
    ("auth_token_comfy_org", "auth_token_comfy_org"),
    ("api_key_comfy_org", "api_key_comfy_org"),
    ("comfy_usage_source", "comfy_usage_source"),
)

# Credentials are the only keys borrowed from another run: ``comfy_usage_source``
# describes who *submitted* the prompt, so replaying it would misreport usage.
_BORROWED_KEYS = ("auth_token_comfy_org", "api_key_comfy_org")

_SHARE_SETTING = "share-comfy-auth"
_SHARE_CACHE_TTL_S = 5.0

_LAST_CREDENTIALS: dict[str, str] = {}
_share_cache: dict[str, Any] = {"at": None, "value": True}


def remember_credentials(extra: Any) -> None:
    """Keep the newest Comfy.org credentials seen on any prompt."""
    if not isinstance(extra, dict):
        return
    for key in _BORROWED_KEYS:
        value = extra.get(key)
        if isinstance(value, str) and value.strip():
            _LAST_CREDENTIALS[key] = value.strip()


def cached_credentials() -> dict[str, str]:
    return dict(_LAST_CREDENTIALS)


def forget_credentials() -> None:
    """Drop the cached pair (privacy toggle, tests)."""
    _LAST_CREDENTIALS.clear()


def share_enabled() -> bool:
    """Whether runs without credentials may borrow the cached Comfy.org login."""
    now = time.monotonic()
    cached_at = _share_cache.get("at")
    if cached_at is not None and now - float(cached_at) < _SHARE_CACHE_TTL_S:
        return bool(_share_cache["value"])
    value = True
    try:
        from .. import storage
        value = bool(storage.get_setting(_SHARE_SETTING))
    except Exception:
        # Settings unavailable (early import, tests, a broken DB): keep the
        # documented default rather than silently disabling the feature.
        value = True
    _share_cache.update(at=now, value=value)
    return value


def reset_share_cache() -> None:
    _share_cache.update(at=None, value=True)


def borrowed_credentials() -> dict[str, str]:
    if not share_enabled():
        return {}
    credentials = cached_credentials()
    if credentials:
        _log.debug("[ComfyTV/auth] lending cached Comfy.org credentials (%s)",
                   ", ".join(sorted(credentials)))
    return credentials


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
    remember_credentials(extra)
    return extra


def current_auth_extra() -> dict[str, str]:
    return dict(_CURRENT_AUTH.get() or {})


def auth_for_run() -> dict[str, str]:
    """Credentials for the current run: explicit ones first, cached as fallback."""
    extra = current_auth_extra()
    for key, value in borrowed_credentials().items():
        extra.setdefault(key, value)
    return extra


def nested_extra_data(client_id: Any = None) -> dict[str, Any]:
    extra: dict[str, Any] = dict(auth_for_run())
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
