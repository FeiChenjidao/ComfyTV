from __future__ import annotations

import asyncio


def test_ignis_token_status_masks_token(monkeypatch, tmp_path):
    from ComfyTV.api import ignis

    token_path = tmp_path / "secrets" / "ignis-token"
    monkeypatch.setattr(ignis, "_token_path", lambda: token_path)
    monkeypatch.delenv("IGNIS_CLI_TOKEN", raising=False)
    monkeypatch.delenv("MAI_CLI_TOKEN", raising=False)
    monkeypatch.setattr(ignis.Path, "home", lambda: tmp_path)
    refreshes = []
    monkeypatch.setattr(
        ignis,
        "_refresh_ignis_workflows",
        lambda: refreshes.append(True),
    )

    assert ignis.token_status()["configured"] is False
    saved = ignis.save_token("ignis_ct_example_secret")

    assert saved["ok"] is True
    assert saved["configured"] is True
    assert saved["saved"] is True
    assert refreshes == [True]
    assert saved["hint"] == "igni…cret"
    assert saved["hint"] != "ignis_ct_example_secret"
    assert token_path.read_text(encoding="utf-8").strip() == "ignis_ct_example_secret"


def test_ignis_token_rejects_empty_value(monkeypatch, tmp_path):
    from ComfyTV.api import ignis

    monkeypatch.setattr(ignis, "_token_path", lambda: tmp_path / "ignis-token")
    monkeypatch.delenv("IGNIS_CLI_TOKEN", raising=False)
    monkeypatch.delenv("MAI_CLI_TOKEN", raising=False)
    monkeypatch.setattr(ignis.Path, "home", lambda: tmp_path)
    result = ignis.save_token("  ")

    assert result["ok"] is False
    assert result["configured"] is False
    assert "不能为空" in result["error"]


def test_ignis_config_url_is_extracted_from_install_text():
    from ComfyTV.api import ignis

    text = """帮我安装一下这个技能
- skill 文档: https://ignis-cli-config.funplus-marketing.ai/skill.md
- 你的 config 链接:
  https://ignis-cli-config.funplus-marketing.ai/config/example_123.json
"""

    assert ignis._config_url_from_text(text) == (
        "https://ignis-cli-config.funplus-marketing.ai/config/example_123.json"
    )


def test_ignis_config_url_accepts_markdown_escaped_text():
    from ComfyTV.api import ignis

    text = (
        "https\\://ignis-cli-config.funplus-marketing.ai/"
        "config/example-123.json"
    )

    assert ignis._config_url_from_text(text).endswith("/config/example-123.json")


def test_ignis_config_url_rejects_other_hosts():
    from ComfyTV.api import ignis

    assert ignis._config_url_from_text(
        "https://example.com/config/example.json"
    ) == ""


def test_ignis_config_url_rejects_malformed_port():
    from ComfyTV.api import ignis

    assert ignis._config_url_from_text(
        "https://ignis-cli-config.funplus-marketing.ai:invalid/config/example.json"
    ) == ""


def test_ignis_config_base_url_rejects_malformed_port():
    from ComfyTV.api import ignis

    assert ignis._config_base_url({
        "baseUrl": "https://ignis-cli.funplus-marketing.ai:invalid",
    }) == ""


def test_import_ignis_config_fetches_and_saves_token(monkeypatch, tmp_path):
    from ComfyTV.api import ignis

    token_path = tmp_path / "secrets" / "ignis-token"
    base_url_path = tmp_path / "secrets" / "ignis-base-url"
    monkeypatch.setattr(ignis, "_token_path", lambda: token_path)
    monkeypatch.setattr(ignis, "_base_url_path", lambda: base_url_path)
    monkeypatch.delenv("IGNIS_CLI_TOKEN", raising=False)
    monkeypatch.delenv("MAI_CLI_TOKEN", raising=False)
    monkeypatch.setattr(ignis.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(ignis, "_refresh_ignis_workflows", lambda: None)
    seen = []

    async def fake_fetch(url):
        seen.append(url)
        return {
            "baseUrl": "https://ignis-cli.funplus-marketing.ai",
            "cliToken": "ignis_ct_config_secret",
        }

    result = asyncio.run(ignis.import_config_text(
        "config: https://ignis-cli-config.funplus-marketing.ai/config/test.json",
        fetch_config=fake_fetch,
    ))

    assert result["ok"] is True
    assert result["saved"] is True
    assert seen == [
        "https://ignis-cli-config.funplus-marketing.ai/config/test.json"
    ]
    assert token_path.read_text(encoding="utf-8").strip() == "ignis_ct_config_secret"
    assert base_url_path.read_text(encoding="utf-8").strip() == (
        "https://ignis-cli.funplus-marketing.ai"
    )


def test_import_ignis_config_accepts_pasted_json(monkeypatch, tmp_path):
    from ComfyTV.api import ignis

    token_path = tmp_path / "secrets" / "ignis-token"
    monkeypatch.setattr(ignis, "_token_path", lambda: token_path)
    monkeypatch.setattr(ignis, "_base_url_path", lambda: tmp_path / "ignis-base-url")
    monkeypatch.delenv("IGNIS_CLI_TOKEN", raising=False)
    monkeypatch.delenv("MAI_CLI_TOKEN", raising=False)
    monkeypatch.setattr(ignis.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(ignis, "_refresh_ignis_workflows", lambda: None)

    result = asyncio.run(ignis.import_config_text(
        '{"cliToken":"ignis_ct_json_secret"}'
    ))

    assert result["ok"] is True
    assert token_path.read_text(encoding="utf-8").strip() == "ignis_ct_json_secret"
