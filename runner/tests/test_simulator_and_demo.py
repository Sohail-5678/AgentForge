"""Demo honesty: the real graders reproduce every simulated outcome; the snapshot is complete and reproducible."""

from __future__ import annotations

import json
import random
from datetime import UTC, datetime

import pytest

from agentforge_runner.datasets.suites import load_suite
from agentforge_runner.demo.generate import MAX_BYTES, TABLES, build_snapshot, dumps
from agentforge_runner.demo.world import load_profile
from agentforge_runner.execute import execute
from agentforge_runner.redteam.mutators import mutate
from agentforge_runner.targets.simulated import SimulatedTarget


@pytest.mark.parametrize(
    ("agent", "suites", "profiles"),
    [
        (
            "returnpilot",
            ["returnpilot/scenario", "returnpilot/regression", "returnpilot/redteam"],
            ["returnpilot_v1", "returnpilot_v2"],
        ),
        (
            "datapilot",
            ["datapilot/benchmark", "datapilot/regression", "datapilot/redteam"],
            ["datapilot_v1", "datapilot_v2"],
        ),
    ],
)
@pytest.mark.parametrize("calibrated", [False, True])
def test_real_graders_reproduce_simulated_outcomes(agent, suites, profiles, calibrated, suites_dir, judge_factory):
    cases = [c for s in suites for c in load_suite(s, suites_dir)]
    seeds = [c for c in cases if c["suite"] == "redteam"]
    cases += [m.case for s in seeds[:12] for m in mutate(s, ["encode", "wrap"])]
    for name in profiles:
        target = SimulatedTarget(
            agent, run_seed=f"t-{name}", started_at=datetime(2026, 10, 1, tzinfo=UTC), judge_calibrated=calibrated
        )
        out = execute(
            target,
            cases,
            load_profile(name),
            attempts=2,
            judge=judge_factory(agent),
            judge_calibrated=calibrated,
            rng=random.Random(5),
            on_attempt=target.set_attempt,
        )
        for r in out.results:
            want = target.intended[(r.case_id, r.attempt)]
            assert r.passed == want.passed, (r.case_id, want, r.failed_graders())
            if want.attack_succeeded is not None:
                assert r.attack_succeeded == want.attack_succeeded and r.block_layer == want.block_layer, r.case_id


def test_snapshot_is_byte_identical_for_the_same_seed(snapshot, suites_dir):
    assert dumps(build_snapshot(7, suites_dir)) == dumps(snapshot)


def test_snapshot_shape_and_size(snapshot):
    assert snapshot["contract_version"] == "snapshot.v1" and snapshot["generator"]["seed"] == 7
    assert list(snapshot["tables"]) == list(TABLES)
    assert len(dumps(snapshot).encode()) <= MAX_BYTES
    t = snapshot["tables"]
    assert {r["id"] for r in t["agents"]} == {"datapilot", "returnpilot", "toy"}
    versions = {(p["agent_id"], p["version"]) for p in t["profiles"]}
    assert versions == {("returnpilot", v) for v in range(1, 5)} | {("datapilot", v) for v in range(1, 4)} | {
        ("toy", 1),
        ("toy", 2),
    }
    assert {p["agent_id"]: p["version"] for p in t["profiles"] if p["is_active"]} == {
        "returnpilot": 3,
        "datapilot": 3,
        "toy": 2,
    }


def test_snapshot_story(snapshot):
    t = snapshot["tables"]
    runs = t["runs"]
    sim = [r for r in runs if r["agent_id"] != "toy" and r["summary"] and "pass_rate" in r["summary"]]
    assert sim and all(r["summary"]["synthetic"] is True for r in sim)
    toy = [r for r in runs if r["agent_id"] == "toy" and r["summary"] and "pass_rate" in r["summary"]]
    assert toy and all(r["summary"]["fake_llm"] is True for r in toy)
    nightly = [r for r in runs if r["trigger"] == "nightly"]
    assert len([r for r in nightly if r["agent_id"] == "returnpilot"]) == 28
    assert {r["status"] for r in runs} >= {"done", "failed", "stalled", "running", "queued", "cancelled"}
    prs = [r for r in runs if r["trigger"] == "pr"]
    assert {r["summary"]["pr"]["status"] for r in prs} == {"success", "failure"}
    paths = {(p["agent_id"], p["path"], p["decision"]) for p in t["promotions"]}
    assert ("datapilot", "quality", "promoted") in paths and ("returnpilot", "efficiency", "promoted") in paths
    assert ("returnpilot", "rollback", "promoted") in paths
    rejected = [p for p in t["promotions"] if p["decision"] == "rejected"]
    assert rejected and rejected[0]["gate_report"]["power"]["verdict"] == "not proven"
    assert any(a["kind"] == "regression" and a["details"]["p_value"] < 0.05 for a in t["alerts"])
    cal = {c["agent_id"]: c for c in t["judge_calibration"]}
    assert cal["returnpilot"]["calibrated"] and cal["returnpilot"]["n"] >= 50 and cal["returnpilot"]["kappa"] >= 0.6
    assert not cal["datapilot"]["calibrated"]
    assert sum(r["status"] == "pending" for r in t["case_reviews"]) >= 10
    assert any(a["promoted_case_id"] for a in t["attacks"]) and any(a["succeeded_in_run"] for a in t["attacks"])
    exps = {e["agent_id"]: e for e in t["optimizer_experiments"] if e["status"] == "finished"}
    assert set(exps) == {"returnpilot", "datapilot", "toy"}
    assert any(e["status"] == "running" and e["agent_id"] == "returnpilot" for e in t["optimizer_experiments"])
    statuses = {c["status"] for c in t["optimizer_candidates"]}
    assert statuses >= {"rejected_editor", "rejected_minibatch", "evaluated", "gated", "promoted"}
    live = [x for x in t["traces"] if x["mode"] == "live"]
    assert len(live) >= 400 and {x["status"] for x in live} >= {
        "success",
        "failure",
        "blocked",
        "needs_human",
        "budget_exceeded",
    }
    assert all("secret" not in json.dumps(k).lower() for k in t["api_keys"])
