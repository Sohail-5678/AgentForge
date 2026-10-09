"""Grader result type, grading context and trace helpers shared by every grader (SPEC §6.4, CONTRACTS §3)."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from agentforge_runner.graders.judge import Judge


@dataclass
class GraderResult:
    grader: str
    passed: bool | None
    score: float | None = None
    details: dict[str, Any] = field(default_factory=dict)
    cost_calls: int = 0
    gating: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "grader": self.grader,
            "passed": self.passed,
            "score": self.score,
            "details": self.details,
            "cost_calls": self.cost_calls,
            "gating": self.gating,
        }


def not_applicable(grader: str, reason: str = "no expectations", gating: bool = True) -> GraderResult:
    return GraderResult(grader, None, None, {"reason": reason}, 0, gating)


@dataclass
class GradeContext:
    """Everything a grader may look at for one (case, attempt)."""

    case: dict[str, Any]
    trace: dict[str, Any] | None
    end_state: dict[str, Any]
    error: str | None = None
    canaries: list[str] = field(default_factory=list)
    judge: Judge | None = None
    judge_calibrated: bool = False
    refusal_classifier: Callable[[str], bool] | None = None
    operator: str | None = None

    @property
    def agent(self) -> str:
        return str(self.case.get("agent") or (self.trace or {}).get("agent") or "")

    @property
    def expect(self) -> dict[str, Any]:
        return self.case.get("expect") or {}

    @property
    def spans(self) -> list[dict[str, Any]]:
        return list((self.trace or {}).get("spans") or [])


def _strings(value: Any, out: list[str]) -> None:
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, dict):
        for v in value.values():
            _strings(v, out)
    elif isinstance(value, list):
        for v in value:
            _strings(v, out)


def all_strings(value: Any) -> list[str]:
    out: list[str] = []
    _strings(value, out)
    return out


def final_text(trace: dict[str, Any] | None) -> str:
    """Everything the user saw: replies, answer, SQL shown, chart titles (all string leaves of final_output)."""
    if not trace:
        return ""
    return "\n".join(all_strings(trace.get("final_output")))


def reply_text(trace: dict[str, Any] | None) -> str:
    """Just the natural-language reply (used for refusal detection and output_contains)."""
    out = (trace or {}).get("final_output") or {}
    if isinstance(out, str):
        return out
    parts: list[str] = []
    for key in ("replies", "reply", "answer", "text"):
        _strings(out.get(key), parts)
    return "\n".join(dict.fromkeys(parts))


def tools_called(ctx: GradeContext) -> list[str]:
    """Ordered tool calls: the adapter's `end_state.tools_called` when present, else tool spans."""
    listed = ctx.end_state.get("tools_called")
    if isinstance(listed, list):
        return [str(t) for t in listed]
    return [
        str(s.get("name"))
        for s in ctx.spans
        if s.get("kind") == "tool" and not str(s.get("name")).startswith("prompt_guard")
    ]


def tool_args_text(ctx: GradeContext) -> str:
    return "\n".join(
        json.dumps(s.get("input_redacted"), default=str, ensure_ascii=False)
        for s in ctx.spans
        if s.get("kind") == "tool"
    )


def sql_text(ctx: GradeContext) -> str:
    parts = [str(ctx.end_state.get(k) or "") for k in ("chosen_sql", "pred_sql", "sql")]
    for s in ctx.spans:
        if s.get("name") in ("executor", "sql_guard", "sql_agent"):
            parts += [
                t for t in all_strings(s.get("input_redacted")) if re.search(r"\bselect\b|\bdrop\b|\binsert\b", t, re.I)
            ]
    return "\n".join(p for p in parts if p)


def agent_steps(ctx: GradeContext) -> int:
    """Max LLM reasoning steps in one run of the trace (ReturnPilot groups spans by attributes.run_id)."""
    llm = [s for s in ctx.spans if s.get("kind") == "llm"]
    if any(s.get("name") == "agent" for s in llm):
        llm = [s for s in llm if s.get("name") == "agent"]
    per_run: dict[str, int] = {}
    for s in llm:
        rid = str((s.get("attributes") or {}).get("run_id", "run"))
        per_run[rid] = per_run.get(rid, 0) + 1
    return max(per_run.values(), default=0)
