"""Run a real target agent through its eval-adapter CLI in its own virtual environment (SPEC §6.1–6.3, §S.4).

    clone repo@ref → uv venv <workdir>/.venv → install → python -m <adapter_module> run --cases … --profile …
        --out results.jsonl --budget-calls N --concurrency 2 [--fake-llm]

The target gets a minimal environment: PATH/HOME/locale, its own keys under the names it expects (e.g.
DP_GEMINI_API_KEY → GEMINI_API_KEY for DataPilot) and NO_EXTERNAL_SIDE_EFFECTS=1. AgentForge's own secrets
(AF_RUNNER_KEY, AF_GEMINI_API_KEY) never reach target code.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shlex
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agentforge_runner.targets.base import AdapterResult, read_results, write_jsonl

log = logging.getLogger(__name__)

KEY_MAP: dict[str, dict[str, str]] = {
    "datapilot": {"DP_GEMINI_API_KEY": "GEMINI_API_KEY", "GROQ_API_KEY": "GROQ_API_KEY", "BIRD_DIR": "BIRD_DIR"},
    "returnpilot": {
        "RP_GEMINI_API_KEY": "GEMINI_API_KEY",
        "GROQ_API_KEY": "GROQ_API_KEY",
        "EVAL_DATABASE_URL": "EVAL_DATABASE_URL",
    },
}
PASS_THROUGH = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "UV_CACHE_DIR", "SSL_CERT_FILE")
NEVER_FORWARD = ("AF_RUNNER_KEY", "AF_GEMINI_API_KEY", "AF_API_URL")
# Per-agent settings from the control plane (agents.config.env) are plain config, never secrets or core variables.
_ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
_ENV_BLOCKED = re.compile(
    r"(^|_)(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|DATABASE_URL|DSN)$"
    r"|^(PATH|HOME|VIRTUAL_ENV|UV_PROJECT_ENVIRONMENT|PYTHON\w*|LD_\w+|NODE_OPTIONS)$"
)


def safe_settings(settings: dict[str, Any] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in (settings or {}).items():
        if _ENV_NAME.match(str(k)) and not _ENV_BLOCKED.search(str(k)) and isinstance(v, (str, int, float, bool)):
            out[str(k)] = str(v).lower() if isinstance(v, bool) else str(v)
        else:
            log.warning("ignoring target setting %r (not a plain config variable)", k)
    return out


Runner = Callable[..., subprocess.CompletedProcess[str]]


@dataclass(frozen=True)
class TargetSpec:
    agent: str
    repo: str
    ref: str
    workdir: str
    adapter_module: str
    install: str = "uv sync --frozen"
    settings: tuple[tuple[str, str], ...] = ()

    @classmethod
    def from_run_config(cls, agent: str, target: dict[str, Any]) -> TargetSpec:
        return cls(
            agent=agent,
            repo=str(target["repo"]),
            ref=str(target.get("ref") or "main"),
            workdir=str(target.get("workdir") or "."),
            adapter_module=str(target["adapter_module"]),
            install=str(target.get("install") or "uv sync --frozen"),
            settings=tuple(sorted(safe_settings(target.get("env")).items())),
        )


def build_env(
    agent: str, env: dict[str, str] | None = None, venv: Path | None = None, settings: dict[str, str] | None = None
) -> dict[str, str]:
    src = dict(os.environ) if env is None else env
    out = {k: src[k] for k in PASS_THROUGH if k in src}
    out.update(safe_settings(settings))
    for theirs, ours in KEY_MAP.get(agent, {}).items():
        if src.get(theirs):
            out[ours] = src[theirs]
    for name in NEVER_FORWARD:
        out.pop(name, None)
    out["NO_EXTERNAL_SIDE_EFFECTS"] = "1"
    out["EVAL_MODE"] = "true"
    out["PYTHONUNBUFFERED"] = "1"
    if venv is not None:
        out["VIRTUAL_ENV"] = str(venv)
        out["UV_PROJECT_ENVIRONMENT"] = str(venv)
        out["PATH"] = f"{venv / 'bin'}{os.pathsep}{out.get('PATH', '')}"
    return out


def build_command(
    python: str,
    module: str,
    *,
    cases: Path,
    profile: Path,
    out: Path,
    fake_llm: bool,
    budget_calls: int | None,
    concurrency: int,
) -> list[str]:
    cmd = [python, "-m", module, "run", "--cases", str(cases), "--profile", str(profile), "--out", str(out)]
    if budget_calls is not None:
        cmd += ["--budget-calls", str(budget_calls)]
    cmd += ["--concurrency", str(concurrency)]
    if fake_llm:
        cmd.append("--fake-llm")
    return cmd


class SubprocessTarget:
    def __init__(self, spec: TargetSpec, work_root: Path, runner: Runner = subprocess.run, timeout_s: int = 4 * 3600):
        self.spec = spec
        self.agent = spec.agent
        self.root = work_root / "target"
        self._run = runner
        self._timeout = timeout_s
        self._prepared = False

    @property
    def workdir(self) -> Path:
        return self.root / self.spec.workdir

    @property
    def venv(self) -> Path:
        return self.workdir / ".venv"

    def _sh(self, cmd: list[str], cwd: Path, env: dict[str, str] | None = None, timeout: int = 1800) -> None:
        proc = self._run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout, check=False)
        if proc.returncode != 0:
            # Setup commands (git, uv, npm) never see case content, so their tail is safe to show; the adapter's
            # own output is never echoed because a public Actions log could leak case data.
            tail = "\n".join(((proc.stderr or "") + (proc.stdout or "")).strip().splitlines()[-25:])
            log.error("setup command failed (%s): %s\n%s", proc.returncode, " ".join(cmd[:3]), tail)
            raise RuntimeError(f"{cmd[0]} {cmd[1] if len(cmd) > 1 else ''} failed with exit code {proc.returncode}")

    def prepare(self) -> None:
        if self._prepared:
            return
        self.root.mkdir(parents=True, exist_ok=True)
        url = f"https://github.com/{self.spec.repo}.git"
        self._sh(["git", "init", "-q"], self.root)
        self._sh(["git", "fetch", "-q", "--depth", "1", url, self.spec.ref], self.root, timeout=600)
        self._sh(["git", "checkout", "-q", "--detach", "FETCH_HEAD"], self.root)
        env = build_env(self.agent, venv=self.venv, settings=dict(self.spec.settings))
        self._sh(["uv", "venv", "-q", str(self.venv)], self.workdir, env)
        self._sh(shlex.split(self.spec.install), self.workdir, env)
        self._prepared = True

    def run(
        self,
        cases: list[dict[str, Any]],
        profile: dict[str, Any],
        *,
        fake_llm: bool = False,
        budget_calls: int | None = None,
        concurrency: int = 2,
    ) -> list[AdapterResult]:
        self.prepare()
        with tempfile.TemporaryDirectory(prefix="af-run-") as tmp:
            t = Path(tmp)
            write_jsonl(t / "cases.jsonl", cases)
            (t / "profile.json").write_text(json.dumps(profile), encoding="utf-8")
            cmd = build_command(
                str(self.venv / "bin" / "python"),
                self.spec.adapter_module,
                cases=t / "cases.jsonl",
                profile=t / "profile.json",
                out=t / "results.jsonl",
                fake_llm=fake_llm,
                budget_calls=budget_calls,
                concurrency=concurrency,
            )
            proc = self._run(
                cmd,
                cwd=self.workdir,
                env=build_env(self.agent, venv=self.venv, settings=dict(self.spec.settings)),
                capture_output=True,
                text=True,
                timeout=self._timeout,
                check=False,
            )
            if proc.returncode not in (0, 1):
                log.warning("eval adapter exited with %s", proc.returncode)
            return read_results(t / "results.jsonl", cases)
