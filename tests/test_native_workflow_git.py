from __future__ import annotations

import importlib.util
import functools
import http.server
import subprocess
import sys
import threading
import types
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def restore_import_stubs():
    names = [
        "ComfyTV", "ComfyTV.api", "ComfyTV.runners", "ComfyTV.runners.workflow_db",
        "ComfyTV.runners.workflow_db.link", "ComfyTV.api._common",
        "ComfyTV.api.native_workflow_assets", "ComfyTV.api.native_workflow_git",
    ]
    previous = {name: sys.modules.get(name) for name in names}
    attributes = {name: dict(module.__dict__) for name, module in previous.items() if module is not None}
    yield
    for name, module in previous.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module
            module.__dict__.clear()
            module.__dict__.update(attributes[name])


def _load_mod():
    root = Path(__file__).resolve().parents[1]
    pkg = "ComfyTV"
    if pkg not in sys.modules:
        m = types.ModuleType(pkg)
        m.__path__ = [str(root)]
        sys.modules[pkg] = m
    for name in (
        "ComfyTV.api",
        "ComfyTV.runners",
        "ComfyTV.runners.workflow_db",
        "ComfyTV.runners.workflow_db.link",
    ):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)

    link = sys.modules["ComfyTV.runners.workflow_db.link"]
    link._native_workflows_dir = lambda *_a, **_k: None
    link._template_workflows_dir = lambda: None
    link.resolve_request_user_id = lambda *_a, **_k: "default"

    common = types.ModuleType("ComfyTV.api._common")

    class _Routes:
        def get(self, _path):
            return lambda fn: fn

        def post(self, _path):
            return lambda fn: fn

        def put(self, _path):
            return lambda fn: fn

    common.routes = _Routes()
    sys.modules["ComfyTV.api._common"] = common

    # Stub assets hook used by pull/push (avoid loading folder_paths).
    assets = types.ModuleType("ComfyTV.api.native_workflow_assets")

    class _Pack:
        added: list[str] = []
        packed_files = 0
        packed_bytes = 0
        warnings: list[str] = []

    class _Restore:
        restored = 0
        skipped = 0
        warnings: list[str] = []

    assets.restore_assets = lambda *_a, **_k: _Restore()
    assets.pack_for_workflows = lambda *_a, **_k: _Pack()
    sys.modules["ComfyTV.api.native_workflow_assets"] = assets
    api_pkg = sys.modules["ComfyTV.api"]
    api_pkg.native_workflow_assets = assets

    # Drop cached module so stubs (pack_for_workflows etc.) always rebind.
    sys.modules.pop("ComfyTV.api.native_workflow_git", None)
    path = root / "api" / "native_workflow_git.py"
    spec = importlib.util.spec_from_file_location(
        "ComfyTV.api.native_workflow_git", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["ComfyTV.api.native_workflow_git"] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(
        ["git", *args], cwd=str(cwd), check=True,
        capture_output=True, text=True,
    )


def _init_repo(tmp: Path) -> Path:
    root = tmp / "workflows"
    root.mkdir()
    _git(root, "init")
    _git(root, "config", "user.email", "test@example.com")
    _git(root, "config", "user.name", "Test")
    (root / "a.json").write_text('{"nodes":[]}', encoding="utf-8")
    _git(root, "add", "-A")
    _git(root, "commit", "-m", "init")
    return root


class TestNativeWorkflowGit:
    def test_default_root_is_dedicated_template_library(self, tmp_path, monkeypatch):
        mod = _load_mod()
        templates = tmp_path / "example_workflows"
        monkeypatch.setattr(mod, "_template_workflows_dir", lambda: templates)
        assert mod._workflows_root() == templates

    def test_archives_legacy_templates_but_preserves_local_files(self, tmp_path):
        mod = _load_mod()
        legacy = _init_repo(tmp_path)
        local = legacy / "local-only.json"
        local.write_text('{"nodes":[1]}', encoding="utf-8")

        moved = mod._archive_legacy_template_repo(legacy)

        assert moved == ["a.json"]
        assert not (legacy / "a.json").exists()
        assert (legacy / ".comfytv-template-backup" / "a.json").is_file()
        assert local.is_file()
        assert not (legacy / ".git").exists()
        assert any(legacy.glob(".git.local-backup*"))

    def test_ignores_parent_comfyui_repo(self, tmp_path):
        """Subfolder of another git repo must NOT count as workflows library."""
        mod = _load_mod()
        parent = tmp_path / "ComfyUI"
        parent.mkdir()
        _git(parent, "init")
        _git(parent, "config", "user.email", "test@example.com")
        _git(parent, "config", "user.name", "Test")
        (parent / "readme").write_text("x", encoding="utf-8")
        _git(parent, "add", "-A")
        _git(parent, "commit", "-m", "parent")
        nested = parent / "user" / "default" / "workflows"
        nested.mkdir(parents=True)
        (nested / "a.json").write_text('{"nodes":[]}', encoding="utf-8")
        st = mod.collect_status(nested, fetch_remote=False)
        assert st["is_repo"] is False

    def test_status_not_repo(self, tmp_path):
        mod = _load_mod()
        empty = tmp_path / "empty"
        empty.mkdir()
        st = mod.collect_status(empty, fetch_remote=False)
        assert st["is_repo"] is False
        assert st["ok"] is True

    def test_safe_rel_path_keeps_leading_space(self, tmp_path):
        mod = _load_mod()
        root = tmp_path / "workflows"
        root.mkdir()
        spaced = root / " PS_NanoBanana_GPTImage.json"
        spaced.write_text('{"nodes":[]}', encoding="utf-8")
        found = mod._safe_rel_path(root, " PS_NanoBanana_GPTImage.json")
        assert found == spaced.resolve()

        spaced.unlink()
        plain = root / "PS_NanoBanana_GPTImage.json"
        plain.write_text('{"nodes":[]}', encoding="utf-8")
        found = mod._safe_rel_path(root, " PS_NanoBanana_GPTImage.json")
        assert found == plain.resolve()

    def test_push_paths_rejects_duplicate_name(self, tmp_path):
        mod = _load_mod()
        root = _init_repo(tmp_path)

        remote = tmp_path / "remote.git"
        _git(tmp_path, "init", "--bare", str(remote))
        _git(root, "remote", "add", "origin", str(remote))
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(root), capture_output=True, text=True, check=True,
        ).stdout.strip()
        _git(root, "push", "-u", "origin", branch)

        # Same path already on remote → allowed as an update
        (root / "a.json").write_text('{"nodes":[1]}', encoding="utf-8")
        out_upd = mod.push_paths(["a.json"], "chore: edit a", root=root)
        assert out_upd["ok"] is True

        # New path with same basename as remote (team/a.json vs a.json) → refuse
        team = root / "team"
        team.mkdir()
        (team / "a.json").write_text('{"nodes":[]}', encoding="utf-8")
        out = mod.push_paths(["team/a.json"], "dup", root=root)
        assert out["ok"] is False
        assert "team/a.json" in (out.get("duplicates") or [])

        (root / "b.json").write_text('{"nodes":[]}', encoding="utf-8")
        out2 = mod.push_paths(["b.json"], "feat: add b", root=root)
        assert out2["ok"] is True
        assert out2.get("pushed") is True
        assert out2.get("paths") == ["b.json"]

    def test_push_imports_user_workflow_into_template_repo(self, tmp_path, monkeypatch):
        mod = _load_mod()
        templates = _init_repo(tmp_path)
        remote = tmp_path / "remote.git"
        _git(tmp_path, "init", "--bare", str(remote))
        _git(templates, "remote", "add", "origin", str(remote))
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(templates), capture_output=True, text=True, check=True,
        ).stdout.strip()
        _git(templates, "push", "-u", "origin", branch)

        user_workflows = tmp_path / "user-workflows"
        (user_workflows / "_local").mkdir(parents=True)
        source = user_workflows / "_local" / "local-new.json"
        source.write_text('{"nodes":[2]}', encoding="utf-8")
        monkeypatch.setattr(mod, "_native_workflows_dir", lambda *_a, **_k: user_workflows)

        out = mod.push_paths(["_local/local-new.json"], "feat: publish", root=templates)

        assert out["ok"] is True
        assert (templates / "local-new.json").read_text(encoding="utf-8") == '{"nodes":[2]}'

    def test_setup_repo_clones_into_existing_dir(self, tmp_path, monkeypatch):
        mod = _load_mod()
        remote = tmp_path / "remote.git"
        _git(tmp_path, "init", "--bare", str(remote))

        seed = tmp_path / "seed"
        seed.mkdir()
        _git(seed, "init")
        _git(seed, "config", "user.email", "test@example.com")
        _git(seed, "config", "user.name", "Test")
        (seed / "team.json").write_text('{"nodes":[]}', encoding="utf-8")
        _git(seed, "add", "-A")
        _git(seed, "commit", "-m", "seed")
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(seed), capture_output=True, text=True, check=True,
        ).stdout.strip()
        _git(seed, "remote", "add", "origin", str(remote))
        _git(seed, "push", "-u", "origin", branch)

        target = tmp_path / "workflows"
        target.mkdir()
        (target / "local-only.json").write_text('{"nodes":[1]}', encoding="utf-8")
        # An expired write token must not affect public clone, fetch or update.
        (target / ".comfytv-git-token").write_text("expired-write-token", encoding="utf-8")
        def forbid_write_auth(*_args):
            raise AssertionError("Read operation requested write credentials")
        monkeypatch.setattr(mod, "_authed_origin", forbid_write_auth)
        out = mod.setup_repo(str(remote), root=target)
        assert out["ok"] is True
        assert out["is_repo"] is True
        assert (target / "team.json").is_file()
        assert (target / "local-only.json").read_text(encoding="utf-8") == '{"nodes":[1]}'
        assert mod.pull_repo(root=target)["ok"] is True

    def test_public_fetch_strips_credentials_without_modifying_origin(self, tmp_path, monkeypatch):
        mod = _load_mod()
        calls = []
        def run(root, *args, **_kwargs):
            calls.append(args)
            stdout = (
                "https://x-access-token:expired-secret@github.com/example/team.git\n"
                if args == ("remote", "get-url", "origin") else ""
            )
            return subprocess.CompletedProcess(args, 0, stdout, "")
        monkeypatch.setattr(mod, "_run_git", run)
        assert mod._fetch_read_remote(tmp_path, "origin").returncode == 0
        fetch = calls[-1]
        assert "expired-secret" not in " ".join(fetch)
        assert "https://github.com/example/team.git" in fetch
        assert "http.extraHeader=" in fetch
        assert "http.https://github.com/example/team.git.extraHeader=" in fetch
        assert "+refs/heads/*:refs/remotes/origin/*" in fetch
        assert not any("set-url" in args for args in calls)

    def test_private_read_reuses_server_token_only_after_anonymous_denial(self, tmp_path, monkeypatch):
        mod = _load_mod()
        calls = []
        url = "https://github.com/example/private.git"
        def run(root, *args, **_kwargs):
            calls.append(args)
            if len(calls) == 1:
                return subprocess.CompletedProcess(args, 128, "", "Repository not found")
            return subprocess.CompletedProcess(args, 0, "", "")
        monkeypatch.setattr(mod, "_run_git", run)
        result = mod._run_read_git(tmp_path, url, "clone", url, "target", token="stored-server-token")
        assert result.returncode == 0
        assert url in calls[0] and "stored-server-token" not in " ".join(calls[0])
        assert "https://x-access-token:stored-server-token@github.com/example/private.git" in calls[1]
        assert not any("set-url" in args for args in calls)

    def test_read_does_not_retry_network_failure_with_credentials(self, tmp_path, monkeypatch):
        mod = _load_mod()
        calls = []
        def run(root, *args, **_kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args, 128, "", "Could not resolve host: github.com")
        monkeypatch.setattr(mod, "_run_git", run)
        url = "https://github.com/example/public.git"
        result = mod._run_read_git(tmp_path, url, "clone", url, "target", token="expired-token")
        assert result.returncode == 128
        assert len(calls) == 1
        assert "expired-token" not in " ".join(calls[0])

    def test_pull_stops_before_reset_when_public_fetch_fails(self, tmp_path, monkeypatch):
        mod = _load_mod()
        monkeypatch.setattr(mod, "collect_status", lambda *_a, **_kw: {
            "ok": True, "is_repo": True, "fetch_error": "Repository not found",
        })
        def forbid_reset(*_args, **_kwargs):
            raise AssertionError("Must not reset the working tree after a failed fetch")
        monkeypatch.setattr(mod, "_run_git", forbid_reset)
        result = mod.pull_repo(root=tmp_path)
        assert result["ok"] is False
        assert result["error_code"] == "read_failed"
        assert result["error"] == "Repository not found"

    def test_public_http_fetch_sends_no_stored_authorization(self, tmp_path):
        mod = _load_mod()
        seed = _init_repo(tmp_path)
        remote = tmp_path / "public.git"
        _git(tmp_path, "clone", "--bare", str(seed), str(remote))
        _git(remote, "update-server-info")
        received_auth = []

        class Handler(http.server.SimpleHTTPRequestHandler):
            def do_GET(self):
                received_auth.append(self.headers.get("Authorization"))
                if self.headers.get("Authorization"):
                    self.send_error(401)
                    return
                super().do_GET()

            def log_message(self, *_args):
                pass

        server = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), functools.partial(Handler, directory=str(tmp_path)),
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}/public.git"
            target = tmp_path / "reader"
            target.mkdir()
            _git(target, "init")
            _git(target, "remote", "add", "origin", url)
            _git(target, "config", "http.extraHeader", "Authorization: Bearer expired-global")
            _git(target, "config", f"http.{url}.extraHeader", "Authorization: Bearer expired-scoped")
            (target / ".comfytv-git-token").write_text("expired-write-token", encoding="utf-8")
            result = mod._fetch_read_remote(target, "origin")
            assert result.returncode == 0, result.stderr
            assert received_auth and all(header is None for header in received_auth)
            refs = subprocess.run(
                ["git", "for-each-ref", "--format=%(refname)", "refs/remotes/origin"],
                cwd=target, capture_output=True, text=True, check=True,
            )
            assert "refs/remotes/origin/" in refs.stdout
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_strip_auth_from_remote_url(self):
        mod = _load_mod()
        clean, tok = mod._split_auth(
            "https://x-access-token:secretPAT@github.com/org/repo.git"
        )
        assert clean == "https://github.com/org/repo.git"
        assert tok == "secretPAT"
        assert mod._strip_auth(clean) == clean

    def test_normalize_github_http_to_https(self):
        mod = _load_mod()
        assert mod._normalize_remote_url(
            "http://github.com/FeiChenjidao/comfytv-team-workflows.git"
        ) == "https://github.com/FeiChenjidao/comfytv-team-workflows.git"
        authed = mod._with_token(
            "http://github.com/FeiChenjidao/comfytv-team-workflows.git",
            "github_pat_test",
        )
        assert authed.startswith("https://x-access-token:")
        assert "http://github.com" not in authed

    def test_set_workflow_token_local_only(self, tmp_path, monkeypatch):
        mod = _load_mod()
        # Avoid seeding from the real plugin secrets/comfytv-git-token on disk.
        empty = tmp_path / "empty-plugin"
        (empty / "secrets").mkdir(parents=True)
        monkeypatch.setattr(mod, "_plugin_root", lambda: empty)
        root = tmp_path / "workflows"
        root.mkdir()
        st0 = mod.token_status(root=root)
        assert st0["configured"] is False
        out = mod.set_workflow_token("github_pat_example_secret", root=root)
        assert out["ok"] is True
        assert out["configured"] is True
        assert out["hint"].startswith("gith")
        assert "example_secret" not in out["hint"]
        assert (root / ".comfytv-git-token").read_text(encoding="utf-8").strip() == (
            "github_pat_example_secret"
        )

    def test_push_blocked_when_behind(self, tmp_path):
        mod = _load_mod()
        root = _init_repo(tmp_path)
        remote = tmp_path / "remote.git"
        _git(tmp_path, "init", "--bare", str(remote))
        _git(root, "remote", "add", "origin", str(remote))
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(root), capture_output=True, text=True, check=True,
        ).stdout.strip()
        _git(root, "push", "-u", "origin", branch)

        other = tmp_path / "other"
        _git(tmp_path, "clone", str(remote), str(other))
        _git(other, "config", "user.email", "test@example.com")
        _git(other, "config", "user.name", "Test")
        (other / "remote-only.json").write_text('{"nodes":[]}', encoding="utf-8")
        _git(other, "add", "-A")
        _git(other, "commit", "-m", "remote ahead")
        _git(other, "push")

        (root / "local-new.json").write_text('{"nodes":[]}', encoding="utf-8")
        out = mod.push_paths(["local-new.json"], "feat: local", root=root)
        assert out["ok"] is False
        assert out.get("error_code") == "need_update"

    def test_file_states_new_and_modified(self, tmp_path):
        mod = _load_mod()
        root = _init_repo(tmp_path)
        (root / "a.json").write_text('{"nodes":[1]}', encoding="utf-8")
        (root / "newbie.json").write_text('{"nodes":[]}', encoding="utf-8")
        st = mod.collect_status(root, fetch_remote=False)
        by = {f["path"]: f for f in st["files"]}
        assert by["newbie.json"]["untracked"] is True
        assert by["newbie.json"]["state"] == "new"
        assert by["a.json"]["dirty"] is True
        assert by["a.json"]["untracked"] is False
        assert by["a.json"]["state"] == "modified"
        # Local edits alone must NOT look like "Update available"
        assert by["a.json"]["remote_diff"] is False

    def test_pull_quarantines_untracked_collision(self, tmp_path):
        """Local untracked same-name JSON must not block pull (colleague case)."""
        mod = _load_mod()
        root = _init_repo(tmp_path)
        remote = tmp_path / "remote.git"
        _git(tmp_path, "init", "--bare", str(remote))
        _git(root, "remote", "add", "origin", str(remote))
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(root), capture_output=True, text=True, check=True,
        ).stdout.strip()
        _git(root, "push", "-u", "origin", branch)

        other = tmp_path / "other"
        _git(tmp_path, "clone", str(remote), str(other))
        _git(other, "config", "user.email", "test@example.com")
        _git(other, "config", "user.name", "Test")
        (other / "高清毛发工作流.json").write_text('{"nodes":["remote"]}', encoding="utf-8")
        _git(other, "add", "-A")
        _git(other, "commit", "-m", "add hair wf")
        _git(other, "push")

        # Colleague dropped a local copy without committing
        (root / "高清毛发工作流.json").write_text('{"nodes":["local"]}', encoding="utf-8")
        out = mod.pull_repo(root=root)
        assert out["ok"] is True
        assert out.get("pulled") is True
        assert "高清毛发工作流.json" in (out.get("local_backups") or [])
        assert (root / "高清毛发工作流.json").read_text(encoding="utf-8") == '{"nodes":["remote"]}'
        assert (root / "高清毛发工作流.json.local-backup").read_text(encoding="utf-8") == '{"nodes":["local"]}'

    def test_pull_force_overwrites_templates_keeps_local_only(self, tmp_path):
        """Update always hard-resets to remote; local-only workflows survive."""
        mod = _load_mod()
        root = _init_repo(tmp_path)
        remote = tmp_path / "remote.git"
        _git(tmp_path, "init", "--bare", str(remote))
        _git(root, "remote", "add", "origin", str(remote))
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(root), capture_output=True, text=True, check=True,
        ).stdout.strip()
        _git(root, "push", "-u", "origin", branch)

        # Local-only commit (ahead) + dirty template edit — must not rebase/conflict.
        (root / "mine.json").write_text('{"nodes":["mine"]}', encoding="utf-8")
        _git(root, "add", "-A")
        _git(root, "commit", "-m", "local ahead")
        (root / "a.json").write_text('{"nodes":["dirty-template"]}', encoding="utf-8")
        (root / "mine.json").write_text('{"nodes":["dirty"]}', encoding="utf-8")

        other = tmp_path / "other"
        _git(tmp_path, "clone", str(remote), str(other))
        _git(other, "config", "user.email", "test@example.com")
        _git(other, "config", "user.name", "Test")
        (other / "a.json").write_text('{"nodes":["remote-a"]}', encoding="utf-8")
        (other / "remote-new.json").write_text('{"nodes":["r"]}', encoding="utf-8")
        _git(other, "add", "-A")
        _git(other, "commit", "-m", "remote ahead")
        _git(other, "push")

        out = mod.pull_repo(root=root)
        assert out["ok"] is True, out.get("error")
        assert out.get("pulled") is True
        assert (root / "remote-new.json").is_file()
        # Template force-overwritten from remote (no stash pop restoring dirty edit)
        assert (root / "a.json").read_text(encoding="utf-8") == '{"nodes":["remote-a"]}'
        # Local-only workflow kept (including dirty working-tree bytes)
        assert (root / "mine.json").read_text(encoding="utf-8") == '{"nodes":["dirty"]}'
        assert out.get("ahead", 0) == 0

    def test_ensure_workflow_credentials_seeds_from_plugin(self, tmp_path, monkeypatch):
        mod = _load_mod()
        secrets = tmp_path / "plugin" / "secrets"
        secrets.mkdir(parents=True)
        (secrets / "comfytv-git-token").write_text("seed-token-value\n", encoding="utf-8")
        (secrets / "comfytv-git-remote").write_text(
            "https://github.com/example/team.git\n", encoding="utf-8",
        )
        monkeypatch.setattr(mod, "_plugin_root", lambda: tmp_path / "plugin")
        wf = tmp_path / "workflows"
        mod._ensure_workflow_credentials(wf)
        assert (wf / ".comfytv-git-token").read_text(encoding="utf-8").strip() == "seed-token-value"
        assert "example/team" in (wf / ".comfytv-git-remote").read_text(encoding="utf-8")
        # never overwrite existing
        (wf / ".comfytv-git-token").write_text("keep-me\n", encoding="utf-8")
        mod._ensure_workflow_credentials(wf)
        assert (wf / ".comfytv-git-token").read_text(encoding="utf-8").strip() == "keep-me"
