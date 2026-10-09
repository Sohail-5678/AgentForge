"""Promotion gate (SPEC §9.6): table-driven over every pass/fail combination of its six checks."""

from __future__ import annotations

import itertools

import pytest

from agentforge_runner.optimizer.gate import GateInputs, evaluate_gate

CASES = [f"t{i}" for i in range(12)]


def inputs(hard: bool, redteam: bool, quality: bool, efficiency: bool, reliability: bool, judge: bool) -> GateInputs:
    base = {c: False for c in CASES}
    cand = {c: quality for c in CASES}  # quality: 0 → 12 passes (p < 0.001); otherwise identical (gain 0)
    return GateInputs(
        baseline_test=base,
        candidate_test=cand,
        baseline_pass_k=0.5,
        candidate_pass_k=0.5 if reliability else 0.3,
        candidate_hard={"must_not": 0 if hard else 1, "canary": 0},
        redteam={
            "baseline_succeeded": 2,
            "candidate_succeeded": 2,
            "baseline_high": 1,
            "candidate_high": 1 if redteam else 2,
            "n": 20,
            "baseline_asr": 0.1,
            "candidate_asr": 0.1,
        },
        cost={"baseline_mean": 0.01, "candidate_mean": 0.007 if efficiency else 0.01},
        latency={"baseline_p95": 1000, "candidate_p95": 1000},
        judge_calibrated=True,
        judge_rates=(0.9, 0.9 if judge else 0.7),
    )


@pytest.mark.parametrize("flags", list(itertools.product([True, False], repeat=6)))
def test_every_combination(flags):
    hard, redteam, quality, efficiency, reliability, judge = flags
    report = evaluate_gate(inputs(*flags), resamples=400, power_sims=200)
    checks = {c["name"]: c["passed"] for c in report["checks"]}
    assert checks == {
        "hard_safety": hard,
        "redteam": redteam,
        "quality": quality,
        "efficiency": efficiency,
        "reliability": reliability,
        "judge": judge,
    }
    assert report["passed"] == (hard and redteam and (quality or efficiency) and reliability and judge)
    assert report["path"] == ("quality" if quality else "efficiency" if efficiency else None)
    assert report["power"]["verdict"] == ("proven" if quality else "not proven")


def test_redteam_allows_one_more_low_severity_success():
    g = inputs(True, True, True, False, True, True)
    g.redteam.update(candidate_succeeded=3)
    assert evaluate_gate(g, resamples=200, power_sims=100)["passed"] is True
    g.redteam.update(candidate_succeeded=4)
    assert evaluate_gate(g, resamples=200, power_sims=100)["passed"] is False


def test_efficiency_blocks_new_failures_in_safety_cases_and_quality_drop():
    g = inputs(True, True, False, True, True, True)
    g.baseline_test = {c: True for c in CASES}
    g.candidate_test = {**{c: True for c in CASES}, "t0": False}
    assert evaluate_gate(g, resamples=200, power_sims=100)["path"] is None  # −8 points > the 2-point tolerance
    g.candidate_test = {c: True for c in CASES}
    g.safety_case_ids = {"t1"}
    g.candidate_test["t1"] = False
    g.candidate_test["t0"] = True
    assert evaluate_gate(g, resamples=200, power_sims=100)["path"] is None


def test_uncalibrated_judge_is_excluded():
    g = inputs(True, True, True, True, True, False)
    g.judge_calibrated = False
    report = evaluate_gate(g, resamples=200, power_sims=100)
    assert report["passed"] is True and "excluded" in next(
        c["detail"] for c in report["checks"] if c["name"] == "judge"
    )
