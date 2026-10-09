"""Gate runs (SPEC §4.5, §9.6): baseline and candidate on TEST × pass^k plus the red-team core, then the gate."""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any

import numpy as np

from agentforge_runner.execute import RunOutput, execute
from agentforge_runner.graders.judge import Judge
from agentforge_runner.graders.registry import GradedResult
from agentforge_runner.optimizer.gate import GateInputs, evaluate_gate
from agentforge_runner.stats.passk import pass_k
from agentforge_runner.targets.base import Target

SAFETY_TAGS = {"safety", "must_not", "injection", "privacy", "approval"}


@dataclass
class GateRun:
    test: RunOutput
    redteam: RunOutput

    @property
    def results(self) -> list[GradedResult]:
        return self.test.results + self.redteam.results


@dataclass
class GateOutcome:
    report: dict[str, Any]
    baseline: GateRun
    candidate: GateRun


def safety_case_ids(cases: list[dict[str, Any]]) -> set[str]:
    return {c["case_id"] for c in cases if SAFETY_TAGS & set(c.get("tags") or [])}


def _gate_run(
    target: Target,
    profile: dict[str, Any],
    test_cases: list[dict[str, Any]],
    redteam_cases: list[dict[str, Any]],
    *,
    k: int,
    fake_llm: bool,
    judge: Judge | None,
    calibrated: bool,
    rng: random.Random,
    on_attempt: Any = None,
) -> GateRun:
    test = execute(
        target,
        test_cases,
        profile,
        attempts=k,
        fake_llm=fake_llm,
        judge=judge,
        judge_calibrated=calibrated,
        rng=rng,
        on_attempt=on_attempt,
    )
    rt = execute(
        target,
        redteam_cases,
        profile,
        attempts=1,
        fake_llm=fake_llm,
        judge=judge,
        judge_calibrated=calibrated,
        rng=rng,
        on_attempt=on_attempt,
    )
    return GateRun(test, rt)


def _first(results: list[GradedResult]) -> dict[str, bool]:
    return {r.case_id: r.passed for r in results if r.attempt == 1}


def _passk(results: list[GradedResult], k: int) -> float | None:
    by: dict[str, list[bool]] = {}
    for r in sorted(results, key=lambda x: (x.case_id, x.attempt)):
        by.setdefault(r.case_id, []).append(r.passed)
    pk = pass_k(by, k)
    return None if pk is None else pk["rate"]


def _rt_stats(results: list[GradedResult], cases: dict[str, dict[str, Any]]) -> tuple[int, int, float]:
    succ = [r for r in results if r.attack_succeeded]
    high = sum(1 for r in succ if cases[r.case_id].get("severity") == "high")
    return len(succ), high, (len(succ) / len(results) if results else 0.0)


def _hard(results: list[GradedResult]) -> dict[str, int]:
    out = {"must_not": 0, "canary": 0}
    for r in results:
        for name in out:
            g = r.grader(name)
            if g is not None and g.passed is False:
                out[name] += 1
    return out


def _judge_rate(results: list[GradedResult]) -> float | None:
    vals = [
        g.score
        for r in results
        if r.attempt == 1
        for g in r.graders
        if g.grader == "rubric_judge" and g.score is not None
    ]
    return float(np.mean(vals)) if vals else None


def gate_inputs(
    base: GateRun,
    cand: GateRun,
    test_cases: list[dict[str, Any]],
    redteam_cases: list[dict[str, Any]],
    *,
    k: int,
    calibrated: bool,
    test_attempts: int,
) -> GateInputs:
    rt_cases = {c["case_id"]: c for c in redteam_cases}
    bs, bh, ba = _rt_stats(base.redteam.results, rt_cases)
    cs, ch, ca = _rt_stats(cand.redteam.results, rt_cases)
    bj, cj = _judge_rate(base.test.results), _judge_rate(cand.test.results)
    return GateInputs(
        baseline_test=_first(base.test.results),
        candidate_test=_first(cand.test.results),
        baseline_pass_k=_passk(base.test.results, k),
        candidate_pass_k=_passk(cand.test.results, k),
        candidate_hard=_hard(cand.results),
        redteam={
            "baseline_asr": round(ba, 4),
            "candidate_asr": round(ca, 4),
            "baseline_succeeded": bs,
            "candidate_succeeded": cs,
            "baseline_high": bh,
            "candidate_high": ch,
            "n": len(redteam_cases),
        },
        cost={
            "baseline_mean": round(float(np.mean([r.cost_usd for r in base.test.results])), 6)
            if base.test.results
            else 0.0,
            "candidate_mean": round(float(np.mean([r.cost_usd for r in cand.test.results])), 6)
            if cand.test.results
            else 0.0,
        },
        latency={
            "baseline_p95": float(np.percentile([r.latency_ms for r in base.test.results], 95))
            if base.test.results
            else 0.0,
            "candidate_p95": float(np.percentile([r.latency_ms for r in cand.test.results], 95))
            if cand.test.results
            else 0.0,
        },
        safety_case_ids=safety_case_ids(test_cases),
        judge_calibrated=calibrated,
        judge_rates=(bj, cj) if calibrated and bj is not None and cj is not None else None,
        test_attempts=test_attempts,
        k=k,
    )


def run_gate(
    target: Target,
    *,
    baseline_profile: dict[str, Any],
    candidate_profile: dict[str, Any],
    test_cases: list[dict[str, Any]],
    redteam_cases: list[dict[str, Any]],
    k: int = 2,
    fake_llm: bool = False,
    judge: Judge | None = None,
    calibrated: bool = False,
    test_attempts: int = 1,
    rng: random.Random | None = None,
    on_attempt: Any = None,
) -> GateOutcome:
    rng = rng or random.Random(0)
    base = _gate_run(
        target,
        baseline_profile,
        test_cases,
        redteam_cases,
        k=k,
        fake_llm=fake_llm,
        judge=judge,
        calibrated=calibrated,
        rng=rng,
        on_attempt=on_attempt,
    )
    cand = _gate_run(
        target,
        candidate_profile,
        test_cases,
        redteam_cases,
        k=k,
        fake_llm=fake_llm,
        judge=judge,
        calibrated=calibrated,
        rng=rng,
        on_attempt=on_attempt,
    )
    inputs = gate_inputs(base, cand, test_cases, redteam_cases, k=k, calibrated=calibrated, test_attempts=test_attempts)
    return GateOutcome(evaluate_gate(inputs), base, cand)
