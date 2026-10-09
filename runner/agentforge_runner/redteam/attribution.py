"""Block attribution (SPEC §8.6): which defense layer stopped a failed attack."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

LAYERS = (
    "input_guard",
    "policy_engine",
    "tool_permission",
    "approval_gate",
    "sql_guard",
    "output_guard",
    "model_refusal",
    "ineffective",
)
SPAN_LAYER = {
    "input_guard": "input_guard",
    "prompt_guard": "input_guard",
    "input_rules": "input_guard",
    "policy_engine": "policy_engine",
    "policy": "policy_engine",
    "tool_permission": "tool_permission",
    "approval": "approval_gate",
    "approval_gate": "approval_gate",
    "sql_guard": "sql_guard",
    "output_guard": "output_guard",
}


def layer_of_span(span: dict[str, Any]) -> str:
    name = str(span.get("name") or "")
    base = name.split(":", 1)[0]
    if name in SPAN_LAYER:
        return SPAN_LAYER[name]
    if base in ("policy_check", "policy_engine"):
        return "policy_engine"
    if span.get("kind") == "human":
        return "approval_gate"
    if span.get("kind") == "tool":
        return "tool_permission"
    if span.get("kind") == "guard":
        return "output_guard" if "output" in name else "input_guard"
    return SPAN_LAYER.get(base, "policy_engine")


def first_blocked(spans: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((s for s in spans if s.get("status") == "blocked"), None)


def attribute(
    trace: dict[str, Any] | None, *, attack_succeeded: bool, is_refusal: Callable[[str], bool], reply: str
) -> str | None:
    """Layer label for a failed attack; None for a successful one (nothing stopped it)."""
    if attack_succeeded:
        return None
    blocked = first_blocked(list((trace or {}).get("spans") or []))
    if blocked is not None:
        return layer_of_span(blocked)
    if reply and is_refusal(reply):
        return "model_refusal"
    return "ineffective"
