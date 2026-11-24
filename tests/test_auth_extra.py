import asyncio
import importlib.util
from pathlib import Path


def _load_auth_extra():
    path = Path(__file__).resolve().parents[1] / "runners" / "auth_extra.py"
    spec = importlib.util.spec_from_file_location("comfytv_auth_extra_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ae = _load_auth_extra()


class Hidden:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def test_extra_from_hidden_keeps_nonempty_strings_only():
    h = Hidden(
        auth_token_comfy_org="  jwt  ",
        api_key_comfy_org="",
        comfy_usage_source="comfyui-frontend",
        unique_id="12",
    )
    assert ae.extra_from_hidden(h) == {
        "auth_token_comfy_org": "jwt",
        "comfy_usage_source": "comfyui-frontend",
    }
    assert ae.extra_from_hidden(None) == {}
    assert ae.extra_from_hidden(object()) == {}


def test_nested_extra_data_includes_client_id_and_auth():
    token = ae._CURRENT_AUTH.set({"auth_token_comfy_org": "jwt"})
    try:
        extra = ae.nested_extra_data("client-1")
        assert extra["client_id"] == "client-1"
        assert extra["auth_token_comfy_org"] == "jwt"
    finally:
        ae._CURRENT_AUTH.reset(token)


def test_passthrough_exposes_hidden_auth_during_execute():
    class Dummy:
        hidden = Hidden(auth_token_comfy_org="tok", api_key_comfy_org="key")
        seen = {}

        @classmethod
        async def execute(cls):
            Dummy.seen = ae.current_auth_extra()
            return "ok"

    ae.install_auth_passthrough(Dummy)
    assert asyncio.run(Dummy.execute()) == "ok"
    assert Dummy.seen == {
        "auth_token_comfy_org": "tok",
        "api_key_comfy_org": "key",
    }
    assert ae.current_auth_extra() == {}
    ae.install_auth_passthrough(Dummy)


def _fresh_credentials():
    ae.forget_credentials()
    ae.reset_share_cache()


def test_credentials_from_a_prompt_are_lent_to_later_runs():
    _fresh_credentials()
    ae.remember_credentials({"auth_token_comfy_org": " jwt ", "ignored": "x"})
    assert ae.cached_credentials() == {"auth_token_comfy_org": "jwt"}

    token = ae._CURRENT_AUTH.set({})
    try:
        # A queue/agent run arrives with nothing of its own.
        extra = ae.nested_extra_data("client-1")
        assert extra["auth_token_comfy_org"] == "jwt"
        assert extra["client_id"] == "client-1"
    finally:
        ae._CURRENT_AUTH.reset(token)
    _fresh_credentials()


def test_explicit_credentials_win_over_the_cached_pair():
    _fresh_credentials()
    ae.remember_credentials({
        "auth_token_comfy_org": "cached",
        "api_key_comfy_org": "cached-key",
    })
    token = ae._CURRENT_AUTH.set({"auth_token_comfy_org": "own"})
    try:
        extra = ae.auth_for_run()
        assert extra["auth_token_comfy_org"] == "own"
        assert extra["api_key_comfy_org"] == "cached-key"
    finally:
        ae._CURRENT_AUTH.reset(token)
        _fresh_credentials()


def test_cached_pair_is_ignored_when_sharing_is_off(monkeypatch):
    _fresh_credentials()
    ae.remember_credentials({"auth_token_comfy_org": "jwt"})
    monkeypatch.setattr(ae, "share_enabled", lambda: False)
    assert ae.borrowed_credentials() == {}
    assert "auth_token_comfy_org" not in ae.nested_extra_data()
    _fresh_credentials()


def test_usage_source_is_never_borrowed():
    _fresh_credentials()
    ae.remember_credentials({"comfy_usage_source": "comfyui-frontend"})
    assert ae.cached_credentials() == {}
    _fresh_credentials()


def test_share_defaults_on_when_settings_are_unavailable(monkeypatch):
    ae.reset_share_cache()
    # Standalone module load has no package to reach storage through.
    assert ae.share_enabled() is True
    _fresh_credentials()
