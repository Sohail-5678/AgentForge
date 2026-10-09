"""Integration tests on the bundled toy agent in fake-LLM mode (SPEC §13.3)."""

from __future__ import annotations

import json
import random

from agentforge_runner.cli import main
from agentforge_runner.execute import execute
from agentforge_runner.summary import build_summary
from agentforge_runner.targets.local_adapter import toy_target

SUMMARY_KEYS = {
    "suites",
    "n_cases",
    "n_results",
    "attempts",
    "passed",
    "pass_rate",
    "ci",
    "pass_k",
    "by_split",
    "by_tag",
    "by_suite",
    "graders",
    "hard_failures",
    "redteam",
    "cost",
    "latency",
    "judge",
    "flaky_cases",
    "compare",
    "budget",
    "fake_llm",
    "synthetic",
}


def test_suite_end_to_end_local(toy_cases, vulnerable, hardened, judge_factory):
    for profile, expected in ((vulnerable, 4), (hardened, 12)):
        out = execute(toy_target(), toy_cases, profile, attempts=2, fake_llm=True, judge=judge_factory("toy"))
        summary = build_summary(
            out.results, {c["case_id"]: c for c in toy_cases}, attempts=2, budget=out.budget(), fake_llm=True
        )
        assert set(summary) >= SUMMARY_KEYS
        assert summary["passed"] == expected and summary["n_results"] == 24
        assert summary["pass_k"]["k"] == 2 and summary["cost"]["mean_list_price_usd"] > 0
        assert summary["latency"]["p95_ms"] >= summary["latency"]["p50_ms"] > 0
        assert summary["hard_failures"] == {"must_not": 0, "canary": 0}
    by_id = {r.case_id: r for r in out.results}
    assert by_id["toy-refund-large-approved"].trace["end_state"]["approval_status"] == "approved"


def test_redteam_vulnerable_vs_hardened(toy_seeds, vulnerable, hardened):
    cases = {c["case_id"]: c for c in toy_seeds}
    runs = {}
    for name, profile in (("vulnerable", vulnerable), ("hardened", hardened)):
        out = execute(toy_target(), toy_seeds, profile, fake_llm=True, rng=random.Random(1))
        runs[name] = build_summary(out.results, cases, fake_llm=True)["redteam"]
        assert all(r.block_layer for r in out.results if not r.attack_succeeded)
    assert runs["vulnerable"]["by_category"]["indirect_injection"]["asr"] > 0
    assert runs["vulnerable"]["by_category"]["system_prompt_extraction"]["succeeded"] == 1  # canary leaked
    assert runs["hardened"]["asr"] == 0 and runs["hardened"]["succeeded"] == 0
    assert {"input_guard", "tool_permission"} <= set(runs["hardened"]["by_layer"])


def test_cli_local_suite_and_power(tmp_path, capsys):
    assert (
        main(
            [
                "suite",
                "--agent",
                "toy",
                "--suite",
                "toy/scenario,toy/redteam",
                "--local",
                "--fake-llm",
                "--out",
                str(tmp_path),
            ]
        )
        == 0
    )
    summary = json.loads((tmp_path / "summary.json").read_text())
    assert summary["fake_llm"] is True and summary["redteam"]["n"] == 7
    lines = (tmp_path / "results.jsonl").read_text().splitlines()
    assert len(lines) == 19 and json.loads(lines[0])["trace"]["contract_version"] == "trace.v1"
    assert main(["power", "--n", "50"]) == 0
    assert '"mde_80"' in capsys.readouterr().out
