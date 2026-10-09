"""Run an eval adapter that is already importable (the bundled toy agent; local development of a target).

In-process when the module exposes `run_cases(cases, profile, *, fake_llm, budget_calls)` (fast: tests and the demo
call it thousands of times); otherwise through the same CLI as a real target, with the current interpreter.
"""

from __future__ import annotations

import importlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from agentforge_runner.targets.base import AdapterResult, read_results, write_jsonl
from agentforge_runner.targets.subprocess_adapter import build_command, build_env

TOY_MODULE = "toy_agent.eval_adapter"


class LocalTarget:
    def __init__(self, agent: str, adapter_module: str, *, in_process: bool = True, workdir: Path | None = None):
        self.agent = agent
        self.module = adapter_module
        self.in_process = in_process
        self.workdir = workdir
        # Optional keyword arguments for `run_cases` (the demo passes a clock and a trace-id seed for reproducibility).
        self.run_kwargs: dict[str, Any] = {}

    def run(
        self,
        cases: list[dict[str, Any]],
        profile: dict[str, Any],
        *,
        fake_llm: bool = False,
        budget_calls: int | None = None,
        concurrency: int = 2,
    ) -> list[AdapterResult]:
        if self.in_process:
            mod = importlib.import_module(self.module)
            if hasattr(mod, "run_cases"):
                lines = mod.run_cases(cases, profile, fake_llm=fake_llm, budget_calls=budget_calls, **self.run_kwargs)
                return [AdapterResult.from_line(line) for line in lines]
        with tempfile.TemporaryDirectory(prefix="af-local-") as tmp:
            t = Path(tmp)
            write_jsonl(t / "cases.jsonl", cases)
            (t / "profile.json").write_text(json.dumps(profile), encoding="utf-8")
            cmd = build_command(
                sys.executable,
                self.module,
                cases=t / "cases.jsonl",
                profile=t / "profile.json",
                out=t / "results.jsonl",
                fake_llm=fake_llm,
                budget_calls=budget_calls,
                concurrency=concurrency,
            )
            env = build_env(self.agent)
            env["PYTHONPATH"] = str(self.workdir) if self.workdir else ""
            subprocess.run(cmd, cwd=self.workdir, env=env, capture_output=True, text=True, check=False, timeout=3600)
            return read_results(t / "results.jsonl", cases)


def toy_target(in_process: bool = True) -> LocalTarget:
    return LocalTarget("toy", TOY_MODULE, in_process=in_process, workdir=toy_workdir())


def toy_workdir() -> Path:
    """Directory that contains the `toy_agent` package (works for editable and wheel installs)."""
    import toy_agent

    return Path(toy_agent.__file__).resolve().parent.parent
