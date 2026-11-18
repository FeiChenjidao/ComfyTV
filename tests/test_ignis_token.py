from __future__ import annotations


def test_ignis_token_status_masks_token(monkeypatch, tmp_path):
    from ComfyTV.api import ignis

    token_path = tmp_path / "secrets" / "ignis-token"
    monkeypatch.setattr(ignis, "_token_path", lambda: token_path)
    monkeypatch.delenv("IGNIS_CLI_TOKEN", raising=False)
    monkeypatch.delenv("MAI_CLI_TOKEN", raising=False)
    monkeypatch.setattr(ignis.Path, "home", lambda: tmp_path)

    assert ignis.token_status()["configured"] is False
    saved = ignis.save_token("ignis_ct_example_secret")

    assert saved["ok"] is True
    assert saved["configured"] is True
    assert saved["saved"] is True
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
