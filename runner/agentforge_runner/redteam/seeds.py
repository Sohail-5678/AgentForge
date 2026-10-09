"""Load red-team seeds (`suites/redteam/*.yaml`, `suites/toy/redteam.yaml`, SPEC §8.3) as case.v1 documents."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from agentforge_runner.datasets.splits import split_for
from agentforge_runner.redteam.taxonomy import owasp_for

EXPECT_KEYS = ("must_not", "tools_forbidden", "end_state", "max_steps", "rubric", "tools_called_in_order")


def seed_to_case(seed: dict[str, Any]) -> dict[str, Any]:
    agent = str(seed["agent"])
    inp = dict(seed.get("input") or {})
    if agent in ("returnpilot", "toy") and isinstance(inp.get("turns"), list):
        inp["turns"] = [t if isinstance(t, dict) else {"user": str(t)} for t in inp["turns"]]
    expect: dict[str, Any] = {"result_match": "none"}
    for key in EXPECT_KEYS:
        if key in seed:
            expect[key] = seed[key]
        elif key in (seed.get("expect") or {}):
            expect[key] = seed["expect"][key]
    family = str(seed.get("family") or seed["id"])
    category = str(seed["category"])
    case: dict[str, Any] = {
        "contract_version": "case.v1",
        "case_id": str(seed["id"]),
        "agent": agent,
        "suite": "redteam",
        "split": split_for(family),
        "title": seed.get("title") or f"{category.replace('_', ' ')}: {family}",
        "input": inp,
        "setup": dict(seed.get("setup") or {}),
        "expect": expect,
        "tags": sorted({"redteam", category, *(seed.get("tags") or [])}),
        "category": category,
        "owasp": seed.get("owasp") or owasp_for(category),
        "family": family,
        "severity": seed.get("severity", "medium"),
        "success_if": seed.get("success_if") or {},
    }
    return case


def load_file(path: Path) -> list[dict[str, Any]]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    if isinstance(data, dict):
        data = data.get("seeds") or data.get("attacks") or []
    return [seed_to_case(s) for s in data if isinstance(s, dict) and s.get("id")]


def load_seeds(suites_dir: Path, agent: str | None = None) -> list[dict[str, Any]]:
    files = sorted((suites_dir / "redteam").glob("*.y*ml")) + sorted((suites_dir / "toy").glob("redteam.y*ml"))
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for f in files:
        for case in load_file(f):
            if (agent is None or case["agent"] == agent) and case["case_id"] not in seen:
                seen.add(case["case_id"])
                out.append(case)
    return out
