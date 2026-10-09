"""Execute one run: plant canaries, call the target for every attempt within budget, grade every result."""

from __future__ import annotations

import random
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from agentforge_runner.graders.judge import Judge
from agentforge_runner.graders.registry import GradedResult, grade_case
from agentforge_runner.redteam import canaries as canary_mod
from agentforge_runner.targets.base import AdapterResult, Target

PLANT_CASE_CATEGORIES = {"data_exfiltration"}


@dataclass
class RunOutput:
    results: list[GradedResult]
    canaries: list[str]
    calls_used: int
    budget_calls: int | None
    stopped_early: bool
    profile_used: dict[str, Any]
    raw: list[AdapterResult] = field(default_factory=list)

    def budget(self) -> dict[str, Any]:
        return {"calls_used": self.calls_used, "budget_calls": self.budget_calls, "stopped_early": self.stopped_early}


def prepare_canaries(
    cases: list[dict[str, Any]], profile: dict[str, Any], tokens: list[str] | None, rng: random.Random | None
) -> tuple[list[dict[str, Any]], dict[str, Any], list[str]]:
    """Red-team runs get a fresh system-prompt canary (and DataPilot secret tables for exfiltration seeds)."""
    if not any(c.get("suite") == "redteam" for c in cases):
        return cases, profile, list(tokens or [])
    toks = list(tokens or []) or [canary_mod.new_token(rng)]
    planted_profile = canary_mod.plant_in_profile(profile, toks[0])
    planted_cases = [
        canary_mod.plant_in_case(c, toks[0])
        if c.get("suite") == "redteam" and c.get("category") in PLANT_CASE_CATEGORIES and c.get("agent") == "datapilot"
        else c
        for c in cases
    ]
    return planted_cases, planted_profile, toks


def execute(
    target: Target,
    cases: list[dict[str, Any]],
    profile: dict[str, Any],
    *,
    attempts: int = 1,
    budget_calls: int | None = None,
    fake_llm: bool = False,
    canaries: list[str] | None = None,
    judge: Judge | None = None,
    judge_calibrated: bool = False,
    rng: random.Random | None = None,
    on_attempt: Callable[[int], None] | None = None,
) -> RunOutput:
    run_cases, run_profile, tokens = prepare_canaries(cases, profile, canaries, rng)
    by_id = {c["case_id"]: c for c in cases}
    graded: list[GradedResult] = []
    raw_all: list[AdapterResult] = []
    used = 0
    stopped = False
    for attempt in range(1, attempts + 1):
        if on_attempt:
            on_attempt(attempt)
        remaining = None if budget_calls is None else max(0, budget_calls - used)
        if remaining == 0:
            stopped = True
            break
        raw = target.run(run_cases, run_profile, fake_llm=fake_llm, budget_calls=remaining)
        for case, res in zip(run_cases, raw, strict=True):
            used += res.llm_calls
            if res.trace is None and res.error and ("budget" in res.error):
                stopped = True
            original = by_id[case["case_id"]]
            operator = (original.get("mutation") or {}).get("operator")
            graded.append(
                grade_case(
                    original,
                    res,
                    attempt=attempt,
                    canaries=tokens,
                    judge_=judge,
                    judge_calibrated=judge_calibrated,
                    operator=operator,
                )
            )
        raw_all += raw
    return RunOutput(graded, tokens, used, budget_calls, stopped, run_profile, raw_all)


def feedback_text(case: dict[str, Any], r: GradedResult, limit: int = 600) -> str:
    """Condensed trace + grader details as text, the optimizer's reflection input (SPEC §9.2)."""
    trace = r.trace or {}
    turns = (trace.get("input") or {}).get("turns") or [(case.get("input") or {}).get("question", "")]
    tools = [s.get("name") for s in trace.get("spans") or [] if s.get("kind") == "tool"]
    out = trace.get("final_output") or {}
    reply = out.get("reply") or out.get("answer") or "" if isinstance(out, dict) else str(out)
    problems = []
    for g in r.graders:
        if not g.gating or g.passed is not False:
            continue
        d = g.details
        if g.grader == "trajectory":
            for c in d.get("checks", []):
                if not c.get("passed"):
                    if c["check"] == "tools_called_in_order":
                        got = " → ".join(d.get("actual", [])) or "no tools"
                        problems.append(f"trajectory: expected {' → '.join(c['expected'])}; got {got}")
                    else:
                        problems.append(f"trajectory: {c['check']} failed")
        elif g.grader == "end_state":
            for c in d.get("checks", []):
                if not c["passed"]:
                    problems.append(f"end_state.{c['key']}: expected {c['expected']!r}, got {c['actual']!r}")
        else:
            problems.append(f"{g.grader}: failed")
    said = " / ".join(str(t.get("user", t)) if isinstance(t, dict) else str(t) for t in turns)
    used = " → ".join(map(str, tools)) or "none"
    text = f"case {r.case_id}: user said {said!r}; tools: {used}; reply: {str(reply)[:160]!r}; " + "; ".join(problems)
    return text[:limit]
