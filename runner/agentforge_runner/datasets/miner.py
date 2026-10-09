"""Failure mining (SPEC §5.3): pick kept live traces worth turning into regression cases."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from agentforge_runner.graders.base import all_strings

FAILURE_STATUSES = {"failure", "error", "budget_exceeded"}
LOW_CONFIDENCE = 0.5


@dataclass
class MiningItem:
    trace_id: str
    agent: str
    text: str
    reason: str
    input: dict[str, Any]


def input_text(trace: dict[str, Any]) -> str:
    inp = trace.get("input") or {}
    turns = inp.get("turns")
    if isinstance(turns, list):
        return " / ".join(t.get("user", "") if isinstance(t, dict) else str(t) for t in turns)
    return str(inp.get("question") or " ".join(all_strings(inp)))


def failure_reason(trace: dict[str, Any]) -> str | None:
    fb = trace.get("feedback") or {}
    if fb.get("thumbs") == -1:
        return "thumbs-down" + (f": {fb['comment']}" if fb.get("comment") else "")
    status = trace.get("status")
    if status in FAILURE_STATUSES:
        return f"status {status}"
    blocked = [
        s.get("name") for s in trace.get("spans") or [] if s.get("kind") == "guard" and s.get("status") == "blocked"
    ]
    if blocked:
        return f"guard hit: {blocked[0]}"
    conf = (trace.get("end_state") or {}).get("confidence")
    if isinstance(conf, int | float) and conf < LOW_CONFIDENCE:
        return f"low confidence {conf:.2f}"
    return None


def select(traces: list[dict[str, Any]], *, skip_ids: set[str] | None = None) -> list[MiningItem]:
    out = []
    for t in traces:
        if t.get("mode", "live") != "live" or t.get("trace_id") in (skip_ids or set()):
            continue
        reason = failure_reason(t)
        if reason is None:
            continue
        text = input_text(t)
        out.append(
            MiningItem(str(t["trace_id"]), str(t["agent"]), f"{text} | {reason}", reason, dict(t.get("input") or {}))
        )
    return out
