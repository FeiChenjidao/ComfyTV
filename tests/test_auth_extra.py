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
