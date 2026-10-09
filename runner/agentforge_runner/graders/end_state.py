"""`end_state` grader (SPEC §6.4): `trace.end_state` matches `expect.end_state` key by key.

Matchers: a plain value (equality), `{"in": [...]}`, `{"not": x}`, `{"exists": true|false}`. Dotted keys reach into
nested state (`canary.leaked`). Also checks the conversation-outcome expectations ReturnPilot's scenarios use:
`approval_created`, `approval_rules_any`, `reply_contains_any`, `reply_not_contains`, `citations_any`.
"""

from __future__ import annotations

from typing import Any

from agentforge_runner.graders.base import GradeContext, GraderResult, all_strings, not_applicable, reply_text

MISSING = object()
EXTRA_KEYS = (
    "approval_created",
    "approval_rules_any",
    "reply_contains_any",
    "reply_not_contains",
    "citations_any",
    "fallback_used",
)


def lookup(state: dict[str, Any], key: str) -> Any:
    if key in state:
        return state[key]
    cur: Any = state
    for part in key.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return MISSING
    return cur


def is_matcher(expected: Any) -> bool:
    return isinstance(expected, dict) and len(expected) == 1 and next(iter(expected)) in ("in", "not", "exists")


def matches(actual: Any, expected: Any) -> bool:
    if is_matcher(expected):
        op, arg = next(iter(expected.items()))
        if op == "exists":
            present = actual is not MISSING and actual is not None
            return present == bool(arg)
        value = None if actual is MISSING else actual
        if op == "in":
            return value in list(arg)
        return value != arg
    return (None if actual is MISSING else actual) == expected


def match_state(state: dict[str, Any], expected: dict[str, Any]) -> list[dict[str, Any]]:
    checks = []
    for key, want in expected.items():
        got = lookup(state, key)
        checks.append(
            {"key": key, "expected": want, "actual": None if got is MISSING else got, "passed": matches(got, want)}
        )
    return checks


def _extra_checks(ctx: GradeContext) -> list[dict[str, Any]]:
    exp, state = ctx.expect, ctx.end_state
    out: list[dict[str, Any]] = []
    reply = reply_text(ctx.trace).lower()
    if "approval_created" in exp:
        created = state.get("approval_status") not in (None, "none")
        out.append(
            {
                "key": "approval_created",
                "expected": bool(exp["approval_created"]),
                "actual": created,
                "passed": created == bool(exp["approval_created"]),
            }
        )
    if exp.get("approval_rules_any"):
        rules = sorted(
            {
                r
                for d in state.get("policy_decisions") or []
                if d.get("decision") == "needs_approval"
                for r in d.get("rule_ids") or []
            }
        )
        out.append(
            {
                "key": "approval_rules_any",
                "expected": exp["approval_rules_any"],
                "actual": rules,
                "passed": any(r in rules for r in exp["approval_rules_any"]),
            }
        )
    if exp.get("reply_contains_any"):
        hit = [p for p in exp["reply_contains_any"] if str(p).lower() in reply]
        out.append(
            {"key": "reply_contains_any", "expected": exp["reply_contains_any"], "actual": hit, "passed": bool(hit)}
        )
    if exp.get("reply_not_contains"):
        hit = [p for p in exp["reply_not_contains"] if str(p).lower() in reply]
        out.append(
            {"key": "reply_not_contains", "expected": exp["reply_not_contains"], "actual": hit, "passed": not hit}
        )
    if exp.get("citations_any"):
        out_cits = (ctx.trace or {}).get("final_output") or {}
        cits = [str(c) for c in (out_cits.get("citations") or [])] if isinstance(out_cits, dict) else []
        text = " ".join(cits) + " " + " ".join(all_strings(out_cits))
        hit = [c for c in exp["citations_any"] if c in text]
        out.append({"key": "citations_any", "expected": exp["citations_any"], "actual": hit, "passed": bool(hit)})
    if "fallback_used" in exp:
        used = any(
            isinstance(s.get("input_redacted"), dict) and bool(s["input_redacted"].get("fallbacks"))
            for s in ctx.spans
            if s.get("kind") == "llm"
        )
        out.append(
            {
                "key": "fallback_used",
                "expected": bool(exp["fallback_used"]),
                "actual": used,
                "passed": used == bool(exp["fallback_used"]),
            }
        )
    return out


def grade(ctx: GradeContext) -> GraderResult:
    expected = ctx.expect.get("end_state") or {}
    has_extra = any(ctx.expect.get(k) not in (None, [], "") for k in EXTRA_KEYS)
    if not expected and not has_extra:
        return not_applicable("end_state")
    if ctx.trace is None and not ctx.end_state:
        return GraderResult("end_state", False, 0.0, {"error": "no end_state", "failed": list(expected)})
    checks = match_state(ctx.end_state, expected) + _extra_checks(ctx)
    failed = [c["key"] for c in checks if not c["passed"]]
    score = (len(checks) - len(failed)) / len(checks) if checks else 1.0
    return GraderResult("end_state", not failed, round(score, 4), {"checks": checks, "failed": failed})
