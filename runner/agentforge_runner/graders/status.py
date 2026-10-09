"""`status` grader: the trace status must be allowed for the case; `error` / `budget_exceeded` always fail."""

from __future__ import annotations

from agentforge_runner.graders.base import GradeContext, GraderResult

ALWAYS_FAIL = {"error", "budget_exceeded"}


def grade(ctx: GradeContext) -> GraderResult:
    if ctx.trace is None:
        return GraderResult("status", False, 0.0, {"status": None, "error": ctx.error or "no trace"})
    status = str(ctx.trace.get("status"))
    allowed = ctx.expect.get("status_in")
    ok = status not in ALWAYS_FAIL and (not allowed or status in allowed)
    details = {"status": status}
    if allowed:
        details["allowed"] = list(allowed)
    if ctx.error:
        details["error"] = ctx.error
    return GraderResult("status", ok, 1.0 if ok else 0.0, details)
