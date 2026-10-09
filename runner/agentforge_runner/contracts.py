"""Pydantic models for the shared contracts (SPEC §S): trace.v1, profile.v1, case.v1.

They mirror `schemas/*.json` (a test validates documents against both). Unknown fields are allowed, exactly like
the JSON Schemas, because targets add agent-specific expectations (e.g. ReturnPilot's `reply_contains_any`).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

AgentId = Literal["datapilot", "returnpilot", "toy"]
TraceStatus = Literal["success", "failure", "error", "blocked", "needs_human", "budget_exceeded"]
SpanKind = Literal["node", "llm", "tool", "guard", "retrieval", "human", "sandbox"]
Category = Literal[
    "direct_injection",
    "indirect_injection",
    "data_exfiltration",
    "system_prompt_extraction",
    "excessive_agency",
    "unsafe_sql",
    "tool_arg_injection",
    "unbounded_consumption",
    "misinformation",
    "off_policy_content",
]

CASE_ID_PATTERN = r"^[a-z0-9][a-z0-9._-]*(@[0-9]+)?$"


class _Open(BaseModel):
    model_config = ConfigDict(extra="allow")


class Span(_Open):
    span_id: str
    parent_id: str | None = None
    kind: SpanKind
    name: str
    started_at: str | None = None
    duration_ms: float | None = None
    provider: str | None = None
    model: str | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    status: Literal["ok", "error", "blocked"] | None = None
    error: Any = None
    input_redacted: Any = None
    output_redacted: Any = None
    attributes: dict[str, Any] | None = None


class Metrics(_Open):
    llm_calls: float | None = None
    tool_calls: float | None = None
    tokens_in: float | None = None
    tokens_out: float | None = None
    latency_ms: float | None = None
    list_price_cost_usd: float | None = None


class Trace(_Open):
    contract_version: Literal["trace.v1"]
    trace_id: str
    agent: AgentId
    agent_version: str | None = None
    profile_version: str | None = None
    mode: Literal["live", "eval"]
    case_id: str | None = None
    started_at: str
    ended_at: str | None = None
    status: TraceStatus
    input: Any = None
    final_output: Any = None
    end_state: Any = None
    spans: list[Span]
    metrics: Metrics
    feedback: dict[str, Any] | None = None


class FewShot(_Open):
    input: Any
    output: Any


class Profile(_Open):
    contract_version: Literal["profile.v1"]
    agent: AgentId
    version: int = Field(ge=1)
    parent_version: int | None = None
    created_by: Literal["human", "optimizer"] | None = None
    notes: str | None = None
    prompts: dict[str, str]
    tool_descriptions: dict[str, str] = Field(default_factory=dict)
    few_shots: list[FewShot] = Field(default_factory=list, max_length=8)
    routing: dict[str, Any] = Field(default_factory=dict)
    params: dict[str, Any] = Field(default_factory=dict)
    locked: list[str]


class Setup(_Open):
    persona: str | None = None
    seed_overrides: dict[str, Any] | None = None
    reviewer_policy: Literal["none", "approve", "reject"] | None = None
    checkpoint_policy: str | None = None
    fault: str | None = None
    fake_script: dict[str, Any] | None = None


class Expect(_Open):
    result_match: Literal["execution", "exact", "none"] | None = None
    gold_sql: str | None = None
    tools_called_in_order: list[str] | None = None
    tools_forbidden: list[str] | None = None
    end_state: dict[str, Any] | None = None
    must_not: list[str] | None = None
    rubric: list[str] | None = None
    max_steps: int | None = Field(default=None, ge=1)


class Case(_Open):
    contract_version: Literal["case.v1"]
    case_id: str = Field(pattern=CASE_ID_PATTERN, max_length=120)
    agent: AgentId
    suite: Literal["benchmark", "scenario", "regression", "redteam"]
    split: Literal["train", "val", "test"]
    title: str | None = None
    input: dict[str, Any]
    setup: Setup | None = None
    expect: Expect
    tags: list[str] | None = None
    category: Category | None = None
    owasp: str | None = None
    family: str | None = None
    severity: Literal["low", "medium", "high"] | None = None
    success_if: dict[str, Any] | None = None


def validate_trace(doc: dict[str, Any]) -> Trace:
    return Trace.model_validate(doc)


def validate_profile(doc: dict[str, Any]) -> Profile:
    return Profile.model_validate(doc)


def validate_case(doc: dict[str, Any]) -> Case:
    return Case.model_validate(doc)
