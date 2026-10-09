import zipfile
from pathlib import Path

import pytest

from agentforge_runner.targets import datasets
from agentforge_runner.targets.subprocess_adapter import TargetSpec, build_env, safe_settings


def test_safe_settings_keeps_plain_config_and_drops_secrets():
    got = safe_settings(
        {
            "DAILY_BUDGET_FAST_TOKENS": 190000,
            "APP_ENV": "ci",
            "FAKE_LLM": False,
            "GROQ_API_KEY": "nope",
            "GH_TOKEN": "nope",
            "AUTH_SECRET": "nope",
            "EVAL_DATABASE_URL": "postgresql://u:p@h/db",
            "PATH": "/evil",
            "PYTHONPATH": "/evil",
            "lowercase": "x",
            "NESTED": {"a": 1},
        }
    )
    assert got == {"DAILY_BUDGET_FAST_TOKENS": "190000", "APP_ENV": "ci", "FAKE_LLM": "false"}


def test_build_env_applies_settings_but_secrets_still_come_from_key_map():
    env = build_env(
        "datapilot",
        env={"PATH": "/usr/bin", "DP_GEMINI_API_KEY": "g", "AF_RUNNER_KEY": "secret", "BIRD_DIR": "/b"},
        settings={"APP_ENV": "ci", "GEMINI_API_KEY": "spoof"},
    )
    assert env["APP_ENV"] == "ci"
    assert env["GEMINI_API_KEY"] == "g"
    assert env["BIRD_DIR"] == "/b"
    assert "AF_RUNNER_KEY" not in env


def test_target_spec_reads_settings_from_run_config():
    spec = TargetSpec.from_run_config(
        "datapilot",
        {"repo": "o/r", "adapter_module": "m", "env": {"APP_ENV": "ci", "SOME_TOKEN": "x"}},
    )
    assert dict(spec.settings) == {"APP_ENV": "ci"}


def test_needs_bird_matches_datapilot_rule():
    assert datasets.needs_bird("datapilot", [{"case_id": "x", "input": {"db_source": "bird"}}])
    assert datasets.needs_bird("datapilot", [{"case_id": "dp-bird-1", "input": {}}])
    assert datasets.needs_bird("datapilot", [{"case_id": "x", "input": {}, "tags": ["bird"]}])
    assert not datasets.needs_bird("datapilot", [{"case_id": "dp-demo-1", "input": {"db_id": "chinook"}}])
    assert not datasets.needs_bird("returnpilot", [{"case_id": "dp-bird-1", "input": {"db_source": "bird"}}])


def _archive(path: Path, extra: dict[str, bytes] | None = None) -> Path:
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("minidev/MINIDEV/mini_dev_sqlite.json", b"[]")
        zf.writestr("minidev/MINIDEV/dev_databases/chinook/chinook.sqlite", b"SQLite format 3\x00")
        zf.writestr("minidev/MINIDEV/other/ignored.txt", b"x")
        for name, data in (extra or {}).items():
            zf.writestr(name, data)
    return path


def test_ensure_bird_downloads_once_and_extracts_only_needed_files(tmp_path):
    src = _archive(tmp_path / "src.zip")
    cache, work = tmp_path / "cache", tmp_path / "work"
    out = datasets.ensure_bird(cache, work, url=src.as_uri())
    assert (out / "mini_dev_sqlite.json").is_file()
    assert (out / "dev_databases" / "chinook" / "chinook.sqlite").is_file()
    assert not (out / "other").exists()
    src.unlink()  # a second job reuses the cached archive without downloading
    out2 = datasets.ensure_bird(cache, tmp_path / "work2", url="file:///does/not/exist.zip")
    assert (out2 / "dev_databases").is_dir()


def test_ensure_bird_refuses_path_traversal(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    _archive(cache / datasets.BIRD_ZIP, {"minidev/MINIDEV/dev_databases/../../../escape.txt": b"x"})
    with pytest.raises(RuntimeError, match="outside"):
        datasets.ensure_bird(cache, tmp_path / "work")
    assert not (tmp_path / "escape.txt").exists()
