"""CLI entry points: control-plane run against a mock API, local red-team/optimize/gate/calibrate/mine."""

from __future__ import annotations

import json

import httpx
import pytest

from agentforge_runner import cli
from agentforge_runner.api_client import ControlPlane


@pytest.fixture
def mock_api(monkeypatch, toy_cases, vulnerable):
    calls: list[tuple[str, str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        calls.append((request.method, request.url.path, body))
        if request.method == "GET" and request.url.path == "/api/v1/runner/runs/run-1":
            return httpx.Response(
                200,
                json={
                    "run": {"id": "run-1"},
                    "agent": "toy",
                    "profile": vulnerable,
                    "cases": toy_cases[:6],
                    "canaries": ["AFC-0badc0de"],
                    "budget_calls": 500,
                    "attempts": 1,
                    "fake_llm": True,
                    "target": {
                        "repo": "x/agentforge",
                        "ref": "main",
                        "workdir": "runner/examples/toy_agent",
                        "adapter_module": "toy_agent.eval_adapter",
                        "install": "-",
                    },
                },
            )
        if request.url.path == "/api/v1/runner/runs":
            return httpx.Response(200, json={"run_id": f"r-{body['agent']}"})
        return httpx.Response(200, json={"ok": True})

    cp = ControlPlane("http://cp.local", "k", transport=httpx.MockTransport(handler), backoff_s=0)
    monkeypatch.setattr(ControlPlane, "from_env", classmethod(lambda cls: cp))
    monkeypatch.setenv("GITHUB_RUN_ID", "123")
    return calls


def test_control_plane_suite_run(mock_api):
    assert cli.main(["suite", "--run-id", "run-1"]) == 0
    paths = [p for _, p, _ in mock_api]
    assert paths[0] == "/api/v1/runner/runs/run-1" and "/api/v1/runner/runs/run-1/start" in paths
    results = [b for _, p, b in mock_api if p.endswith("/results")]
    assert sum(len(b["results"]) for b in results) == 6
    first = results[0]["results"][0]
    assert {
        "case_id",
        "attempt",
        "passed",
        "status",
        "graders",
        "block_layer",
        "cost_usd",
        "latency_ms",
        "llm_calls",
        "trace",
    } <= set(first)
    finish = next(b for _, p, b in mock_api if p.endswith("/finish"))
    assert finish["summary"]["n_results"] == 6 and finish["summary"]["fake_llm"] is True
    start = next(b for _, p, b in mock_api if p.endswith("/start"))
    assert start == {"gh_run_id": 123}


def test_nightly_creates_runs(mock_api):
    assert cli.main(["nightly"]) == 0
    created = [b for m, p, b in mock_api if p == "/api/v1/runner/runs"]
    assert [b["agent"] for b in created] == ["datapilot", "returnpilot"]
    # Suite selection is the control plane's job (regression or scenario/benchmark + red-team seeds).
    assert all(b["trigger"] == "nightly" and "suites" not in b for b in created)


def test_local_redteam_with_mutations(tmp_path):
    assert (
        cli.main(
            [
                "redteam",
                "--agent",
                "toy",
                "--local",
                "--fake-llm",
                "--mutate",
                "encode,wrap,paraphrase",
                "--out",
                str(tmp_path),
            ]
        )
        == 0
    )
    summary = json.loads((tmp_path / "summary.json").read_text())
    assert summary["redteam"]["n"] > 7
    events = json.loads((tmp_path / "mutation_events.json").read_text())
    assert {e["event"] for e in events} == {"mutation_refused"}  # no LLM in fake mode → deterministic fallback


def test_local_optimize_and_gate(tmp_path, capsys):
    assert cli.main(["optimize", "--agent", "toy", "--local", "--scripted-reflection", "--out", str(tmp_path)]) == 0
    best = tmp_path / "best_profile.json"
    assert "Always call check_eligibility" in json.loads(best.read_text())["prompts"]["system"]
    code = cli.main(["gate", "--agent", "toy", "--local", "--candidate", str(best), "--out", str(tmp_path)])
    report = json.loads((tmp_path / "gate_report.json").read_text())
    assert report["checks"][0]["name"] == "hard_safety" and code == (0 if report["passed"] else 1)
    assert "gate:" in capsys.readouterr().out


def test_calibrate_and_mine(tmp_path, capsys):
    labels = tmp_path / "labels.jsonl"
    rows = [{"human_verdict": i % 3 != 0, "judge_verdict": i % 3 != 0 or i % 5 == 0} for i in range(60)]
    labels.write_text("".join(json.dumps(r) + "\n" for r in rows))
    assert cli.main(["calibrate", "--agent", "returnpilot", "--labels", str(labels)]) == 0
    assert '"calibrated": true' in capsys.readouterr().out
    traces = tmp_path / "traces.jsonl"
    t = {
        "trace_id": "00000000-0000-0000-0000-000000000001",
        "agent": "returnpilot",
        "mode": "live",
        "status": "error",
        "input": {"turns": ["Where is my refund for order #1042?"]},
        "spans": [],
        "end_state": {},
    }
    traces.write_text(json.dumps(t) + "\n")
    assert (
        cli.main(
            ["mine", "--agent", "returnpilot", "--traces", str(traces), "--fake-llm", "--out", str(tmp_path / "d.json")]
        )
        == 0
    )
    drafts = json.loads((tmp_path / "d.json").read_text())
    assert drafts[0]["draft"]["suite"] == "regression" and drafts[0]["source_trace_ids"] == [t["trace_id"]]
