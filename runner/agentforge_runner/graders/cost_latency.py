"""`cost_latency` grader (reported, never gating): calls, tokens, list-price cost and latency from trace.metrics."""

from __future__ import annotations

from agentforge_runner.graders.base import GradeContext, GraderResult


def grade(ctx: GradeContext) -> GraderResult:
    m = (ctx.trace or {}).get("metrics") or {}
    details = {
        "llm_calls": int(m.get("llm_calls") or 0),
        "tool_calls": int(m.get("tool_calls") or 0),
        "tokens_in": int(m.get("tokens_in") or 0),
        "tokens_out": int(m.get("tokens_out") or 0),
        "list_price_cost_usd": round(float(m.get("list_price_cost_usd") or 0.0), 6),
        "latency_ms": int(m.get("latency_ms") or 0),
    }
    return GraderResult("cost_latency", None, None, details, 0, gating=False)
