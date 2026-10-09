"""Eval adapter for the toy agent — same CLI as every target (SPEC §S.4):

    python -m toy_agent.eval_adapter run --cases cases.jsonl --profile profile.json --out results.jsonl \\
        [--fake-llm] [--budget-calls N] [--concurrency 2]

Each output line: {"case_id", "trace": trace.v1, "end_state", "error"}. Every case starts from the same seeded
in-memory store; `setup.seed_overrides` ("orders.<id>.<field>") are applied to that fresh copy only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from toy_agent.agent import ToyAgent, Tracer, now

PRICES = {"gpt-oss-20b": (0.075, 0.30), "gpt-oss-120b": (0.15, 0.60)}


def _cost(model: str, tin: int, tout: int) -> float:
    for key, (pin, pout) in PRICES.items():
        if key in model:
            return (tin * pin + tout * pout) / 1_000_000
    return 0.0


def run_case(
    case: dict[str, Any], profile: dict[str, Any], *, started_at: datetime | None = None, trace_id: str | None = None
) -> dict[str, Any]:
    case_id = str(case["case_id"])
    model = os.environ.get("TOY_MODEL", "openai/gpt-oss-20b")
    start = started_at or now()
    tracer = Tracer(model=model, clock=start, run_id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{trace_id or case_id}:run")))
    agent = ToyAgent(profile, case, tracer)
    turns = (case.get("input") or {}).get("turns") or [case.get("input", {}).get("question", "")]
    texts = [t["user"] if isinstance(t, dict) else str(t) for t in turns]
    replies: list[str] = []
    blocked = False
    max_steps = int((profile.get("params") or {}).get("max_steps", 8))
    for text in texts:
        reply, was_blocked = agent.turn(text)
        replies.append(reply)
        blocked = blocked or was_blocked
        if tracer.llm_calls > max_steps * agent.k * len(texts):
            break
    tools = [s["name"] for s in tracer.spans if s["kind"] == "tool"]
    state = agent.end_state(tools)
    status = "blocked" if blocked else ("needs_human" if state["approval_status"] == "pending" else "success")
    latency = int((tracer.clock - start).total_seconds() * 1000)
    trace = {
        "contract_version": "trace.v1",
        "trace_id": trace_id or str(uuid.uuid4()),
        "agent": "toy",
        "agent_version": "toy-0.1.0",
        "profile_version": f"toy@{profile.get('version', 1)}",
        "mode": "eval",
        "case_id": case_id,
        "started_at": start.isoformat().replace("+00:00", "Z"),
        "ended_at": tracer.clock.isoformat().replace("+00:00", "Z"),
        "status": status,
        "input": {"turns": texts},
        "final_output": {"reply": replies[-1] if replies else "", "replies": replies},
        "end_state": state,
        "spans": tracer.spans,
        "metrics": {
            "llm_calls": tracer.llm_calls,
            "tool_calls": tracer.tool_calls,
            "tokens_in": tracer.tokens_in,
            "tokens_out": tracer.tokens_out,
            "latency_ms": latency,
            "list_price_cost_usd": round(_cost(model, tracer.tokens_in, tracer.tokens_out), 6),
        },
        "feedback": None,
    }
    return {"case_id": case_id, "trace": trace, "end_state": state, "error": None}


def run_cases(
    cases: list[dict[str, Any]],
    profile: dict[str, Any],
    *,
    fake_llm: bool = True,
    budget_calls: int | None = None,
    started_at: datetime | None = None,
    trace_seed: str | None = None,
) -> list[dict[str, Any]]:
    """In-process entry point used by AgentForge's LocalTarget. `trace_seed` makes trace ids reproducible."""
    del fake_llm  # the toy's model is always the deterministic policy in agent.py
    out: list[dict[str, Any]] = []
    used = 0
    clock = started_at
    for case in cases:
        cid = str(case.get("case_id"))
        if budget_calls is not None and used >= budget_calls:
            out.append(
                {
                    "case_id": cid,
                    "trace": None,
                    "end_state": None,
                    "error": f"skipped: --budget-calls {budget_calls} reached",
                }
            )
            continue
        tid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{trace_seed}:{cid}")) if trace_seed else None
        try:
            line = run_case(case, profile, started_at=clock, trace_id=tid)
        except Exception as exc:
            line = {"case_id": cid, "trace": None, "end_state": None, "error": f"{type(exc).__name__}: {exc}"[:300]}
        if line["trace"]:
            used += int(line["trace"]["metrics"]["llm_calls"])
            if clock is not None:
                clock = clock + timedelta(milliseconds=line["trace"]["metrics"]["latency_ms"] + 150)
        out.append(line)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m toy_agent.eval_adapter")
    sub = ap.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run")
    run.add_argument("--cases", required=True)
    run.add_argument("--profile", default=str(Path(__file__).parent / "profiles" / "default.json"))
    run.add_argument("--out", required=True)
    run.add_argument("--fake-llm", action="store_true")
    run.add_argument("--budget-calls", type=int, default=None)
    run.add_argument("--concurrency", type=int, default=2)
    a = ap.parse_args(argv)
    cases = [json.loads(x) for x in Path(a.cases).read_text().splitlines() if x.strip()]
    profile = json.loads(Path(a.profile).read_text())
    if set(profile.get("locked") or []) != {"approval_threshold", "guardrails", "policy", "tool_permissions"}:
        sys.exit("profile rejected: the locked list must not change")
    lines = run_cases(cases, profile, fake_llm=a.fake_llm, budget_calls=a.budget_calls)
    Path(a.out).write_text("".join(json.dumps(x) + "\n" for x in lines))
    print(f"{len(lines)} case(s) → {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
