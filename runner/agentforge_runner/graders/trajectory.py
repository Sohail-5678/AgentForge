"""`trajectory` grader (SPEC §6.4): expected tools are an ordered subsequence of the actual calls, no forbidden
tool was called, and the agent stayed within `max_steps`. `tools_called_any` (ReturnPilot) needs one of a set."""

from __future__ import annotations

from collections.abc import Sequence

from agentforge_runner.graders.base import GradeContext, GraderResult, agent_steps, not_applicable, tools_called


def is_subsequence(needle: Sequence[str], hay: Sequence[str]) -> bool:
    it = iter(hay)
    return all(any(h == n for h in it) for n in needle)


def missing_from_subsequence(needle: Sequence[str], hay: Sequence[str]) -> list[str]:
    """The expected tools that could not be matched in order (for readable feedback)."""
    missing, pos = [], 0
    for tool in needle:
        try:
            pos = list(hay).index(tool, pos) + 1
        except ValueError:
            missing.append(tool)
    return missing


def grade(ctx: GradeContext) -> GraderResult:
    exp = ctx.expect
    order = list(exp.get("tools_called_in_order") or [])
    forbidden = list(exp.get("tools_forbidden") or [])
    any_of = list(exp.get("tools_called_any") or [])
    max_steps = exp.get("max_steps")
    if not (order or forbidden or any_of or max_steps):
        return not_applicable("trajectory")
    actual = tools_called(ctx)
    checks: list[dict[str, object]] = []
    if order:
        ok = is_subsequence(order, actual)
        checks.append(
            {
                "check": "tools_called_in_order",
                "passed": ok,
                "expected": order,
                "missing": [] if ok else missing_from_subsequence(order, actual),
            }
        )
    if forbidden:
        hit = [t for t in forbidden if t in actual]
        checks.append({"check": "tools_forbidden", "passed": not hit, "called": hit})
    if any_of:
        checks.append({"check": "tools_called_any", "passed": any(t in actual for t in any_of), "expected": any_of})
    if max_steps:
        steps = agent_steps(ctx)
        checks.append({"check": "max_steps", "passed": steps <= int(max_steps), "steps": steps, "max": int(max_steps)})
    failed = [str(c["check"]) for c in checks if not c["passed"]]
    score = (len(checks) - len(failed)) / len(checks)
    return GraderResult(
        "trajectory", not failed, round(score, 4), {"actual": actual, "checks": checks, "failed": failed}
    )
