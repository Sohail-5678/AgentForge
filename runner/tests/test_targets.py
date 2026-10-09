"""Subprocess adapter: key mapping, isolation of AgentForge secrets, command line, result parsing (no network)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from agentforge_runner.targets.base import read_results
from agentforge_runner.targets.local_adapter import LocalTarget, toy_workdir
from agentforge_runner.targets.subprocess_adapter import SubprocessTarget, TargetSpec, build_command, build_env

ENV = {
    "PATH": "/usr/bin",
    "HOME": "/home/runner",
    "DP_GEMINI_API_KEY": "dp-key",
    "RP_GEMINI_API_KEY": "rp-key",
    "GROQ_API_KEY": "groq-key",
    "AF_RUNNER_KEY": "runner",
    "AF_GEMINI_API_KEY": "af-key",
    "EVAL_DATABASE_URL": "postgresql://x",
}


def test_key_mapping_per_agent():
    dp = build_env("datapilot", ENV)
    rp = build_env("returnpilot", ENV)
    assert dp["GEMINI_API_KEY"] == "dp-key" and rp["GEMINI_API_KEY"] == "rp-key"
    assert rp["EVAL_DATABASE_URL"] == "postgresql://x" and "EVAL_DATABASE_URL" not in dp
    for env in (dp, rp):
        assert env["NO_EXTERNAL_SIDE_EFFECTS"] == "1" and env["GROQ_API_KEY"] == "groq-key"
        assert "AF_RUNNER_KEY" not in env and "AF_GEMINI_API_KEY" not in env and "DP_GEMINI_API_KEY" not in env


def test_command_line():
    cmd = build_command(
        "py",
        "datapilot.eval_adapter",
        cases=Path("c.jsonl"),
        profile=Path("p.json"),
        out=Path("o.jsonl"),
        fake_llm=True,
        budget_calls=150,
        concurrency=2,
    )
    assert cmd == [
        "py",
        "-m",
        "datapilot.eval_adapter",
        "run",
        "--cases",
        "c.jsonl",
        "--profile",
        "p.json",
        "--out",
        "o.jsonl",
        "--budget-calls",
        "150",
        "--concurrency",
        "2",
        "--fake-llm",
    ]


def test_read_results_marks_missing_cases(tmp_path):
    out = tmp_path / "results.jsonl"
    out.write_text(json.dumps({"case_id": "a", "trace": None, "end_state": {}, "error": "boom"}) + "\nnot json\n")
    res = read_results(out, [{"case_id": "a"}, {"case_id": "b"}])
    assert res[0].error == "boom" and res[1].error == "adapter produced no result"


def test_subprocess_target_with_fake_runner(tmp_path):
    calls: list[list[str]] = []

    def runner(cmd, cwd=None, env=None, **kw):
        calls.append(list(cmd))
        if "--out" in cmd:
            out = Path(cmd[cmd.index("--out") + 1])
            cases = [json.loads(x) for x in Path(cmd[cmd.index("--cases") + 1]).read_text().splitlines()]
            out.write_text(
                "".join(
                    json.dumps({"case_id": c["case_id"], "trace": None, "end_state": {"ok": 1}, "error": None}) + "\n"
                    for c in cases
                )
            )
            assert env["NO_EXTERNAL_SIDE_EFFECTS"] == "1"
        return subprocess.CompletedProcess(cmd, 0, "", "")

    spec = TargetSpec("datapilot", "owner/repo", "abc123", "backend", "datapilot.eval_adapter")
    t = SubprocessTarget(spec, tmp_path, runner=runner)
    res = t.run([{"case_id": "x"}, {"case_id": "y"}], {"agent": "datapilot"}, fake_llm=True, budget_calls=10)
    assert [r.end_state for r in res] == [{"ok": 1}, {"ok": 1}]
    assert calls[0][:2] == ["git", "init"] and any(c[:2] == ["uv", "venv"] for c in calls)
    assert any(c[:3] == ["uv", "sync", "--frozen"] for c in calls)


def test_toy_adapter_cli_subprocess(tmp_path, toy_cases):
    """The toy agent's eval adapter CLI (SPEC §S.4) run as a separate process."""
    target = LocalTarget("toy", "toy_agent.eval_adapter", in_process=False, workdir=toy_workdir())
    res = target.run(
        toy_cases[:3], json.loads((toy_workdir() / "toy_agent/profiles/hardened.json").read_text()), fake_llm=True
    )
    assert len(res) == 3 and all(r.trace and r.trace["contract_version"] == "trace.v1" for r in res)
    assert sys.executable
