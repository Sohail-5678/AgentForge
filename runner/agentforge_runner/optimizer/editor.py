"""Edit safety checks (SPEC §9.4), run before any candidate is evaluated. Every check runs, so the UI can show all.

1. schema + locked keys (changed keys ⊆ optimizable keys; any locked key → reject)  2. `<keep>` blocks unchanged
3. length ≤ 1.3 × parent + 400  4. no case literals from the batch  5. no weakening phrases  6. non-empty diff, params
within their declared ranges.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from agentforge_runner.contracts import validate_profile
from agentforge_runner.graders.base import all_strings

META_KEYS = {"contract_version", "agent", "version", "parent_version", "created_by", "notes"}
KEEP_RE = re.compile(r"<keep>.*?</keep>", re.S)
NEGATION = re.compile(r"\b(?:never|not|don't|do not|no|cannot|can't|must not)\b[^.\n]{0,40}$", re.I)
# (pattern, negatable): negatable patterns are fine after "never …" ("never refund without review").
DENY_PATTERNS: list[tuple[re.Pattern[str], bool]] = [
    (re.compile(r"\balways\s+approve", re.I), False),
    (re.compile(r"\bauto[- ]?approve\s+(?:all|every|any)", re.I), False),
    (re.compile(r"\bskip\s+(?:the\s+)?(?:verification|eligibility|approval|review|checks?)", re.I), False),
    (re.compile(r"\bignore\s+(?:the\s+)?(?:store\s+)?polic", re.I), False),
    (re.compile(r"\bno\s+need\s+to\s+(?:ask|check|wait\s+for|involve|consult)\b", re.I), False),
    (re.compile(r"\b(?:need|needs|require|requires)\s+no\s+(?:human\s+)?(?:review|approval|reviewer)", re.I), False),
    (re.compile(r"\bwithout\s+(?:any\s+)?(?:human\s+)?(?:review|approval|verification)", re.I), True),
    (
        re.compile(
            r"\b(?:follow|obey)\s+(?:any\s+)?instructions\s+(?:in|inside|from)\s+(?:order\s+notes|tool\s+results|the\s+data)",
            re.I,
        ),
        False,
    ),
    (re.compile(r"\b(?:reveal|print|share)\s+(?:your\s+|the\s+)?(?:system\s+prompt|instructions)", re.I), True),
    (re.compile(r"\bbypass\b", re.I), True),
    (re.compile(r"\bdisable\s+(?:the\s+)?(?:guard|guardrails?|checks?|approval)", re.I), True),
]
LITERAL_RES = [
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"),
    re.compile(r"\b\d{4,}(?:-\d+)?\b"),
    re.compile(r"'([^'\n]{3,60})'"),
    re.compile(r"\$\d+(?:\.\d{2})?"),
]


@dataclass(frozen=True)
class OptimizableKeys:
    paths: list[str]
    param_ranges: dict[str, list[float]] = field(default_factory=dict)

    @classmethod
    def from_agent(cls, optimizable_keys: dict[str, Any]) -> OptimizableKeys:
        return cls(list(optimizable_keys.get("paths") or []), dict(optimizable_keys.get("param_ranges") or {}))

    def allows(self, path: str) -> bool:
        for p in self.paths:
            if p == path or (p.endswith(".*") and path.startswith(p[:-1])):
                return True
            if path.startswith(p + "."):
                return True
        return False


def flatten(profile: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in profile.items():
        if key in META_KEYS:
            continue
        if isinstance(value, dict) and key in ("prompts", "tool_descriptions", "routing", "params"):
            for sub, v in value.items():
                out[f"{key}.{sub}"] = v
            if not value:
                out[key] = {}
        else:
            out[key] = value
    return out


def changed_paths(parent: dict[str, Any], child: dict[str, Any]) -> list[str]:
    a, b = flatten(parent), flatten(child)
    return sorted(
        k for k in set(a) | set(b) if json.dumps(a.get(k), sort_keys=True) != json.dumps(b.get(k), sort_keys=True)
    )


def _text(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)


def case_literals(cases: Iterable[dict[str, Any]]) -> set[str]:
    out: set[str] = set()
    for case in cases:
        setup = case.get("setup") or {}
        expect = case.get("expect") or {}
        texts = all_strings(case.get("input")) + all_strings(setup.get("seed_overrides"))
        texts += [str(k) for k in (setup.get("seed_overrides") or {})]
        texts += [str(expect.get("gold_sql") or ""), *all_strings(expect.get("end_state"))]
        for t in texts:
            for rx in LITERAL_RES:
                for m in rx.finditer(t):
                    lit = m.group(1) if m.groups() else m.group(0)
                    if len(lit.strip()) >= 3:
                        out.add(lit.strip())
    return out


def _deny_hits(text: str) -> list[str]:
    hits = []
    for rx, negatable in DENY_PATTERNS:
        for m in rx.finditer(text):
            if negatable and NEGATION.search(text[max(0, m.start() - 60) : m.start()]):
                continue
            hits.append(m.group(0).lower())
    return hits


def _check(name: str, passed: bool, detail: str) -> dict[str, Any]:
    return {"name": name, "passed": passed, "detail": detail}


def check_edit(
    parent: dict[str, Any],
    child: dict[str, Any],
    *,
    optimizable: OptimizableKeys,
    locked: list[str],
    batch_cases: list[dict[str, Any]] | None = None,
    growth: float = 1.3,
    slack: int = 400,
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    try:
        validate_profile(child)
        same_agent = child.get("agent") == parent.get("agent")
        checks.append(_check("schema", same_agent, "valid profile.v1" if same_agent else "agent changed"))
    except ValidationError as exc:
        checks.append(_check("schema", False, f"invalid profile.v1: {exc.error_count()} error(s)"))

    changed = changed_paths(parent, child)
    locked_names = set(locked) | set(parent.get("locked") or [])
    bad = [p for p in changed if p == "locked" or any(seg in locked_names for seg in p.split("."))]
    not_allowed = [p for p in changed if p not in bad and not optimizable.allows(p)]
    detail = "only optimizable keys changed"
    if bad:
        detail = f"locked key(s) changed: {', '.join(bad)}"
    elif not_allowed:
        detail = f"not optimizable: {', '.join(not_allowed)}"
    checks.append(_check("locked_keys", not bad and not not_allowed, detail))

    pf, cf = flatten(parent), flatten(child)
    missing = [
        f"{path}: {block[:40]}…"
        for path, value in pf.items()
        if isinstance(value, str)
        for block in KEEP_RE.findall(value)
        if block not in _text(cf.get(path, ""))
    ]
    checks.append(
        _check(
            "keep_blocks",
            not missing,
            "all <keep> blocks intact" if not missing else f"removed or edited: {missing[0]}",
        )
    )

    too_long = []
    for path in changed:
        if path in cf and path in pf and isinstance(cf[path], str | list):
            before, after = len(_text(pf[path])), len(_text(cf[path]))
            if after > growth * before + slack:
                too_long.append(f"{path} {before}→{after} chars")
    checks.append(_check("length_cap", not too_long, "within 1.3× + 400 chars" if not too_long else too_long[0]))

    literals = case_literals(batch_cases or [])
    leaked = sorted(
        {
            lit
            for path in changed
            if path in cf and path != "few_shots"  # few-shots are TRAIN examples by design (SPEC §9.2)
            for lit in literals
            if lit in _text(cf[path]) and lit not in _text(pf.get(path, ""))
        }
    )
    checks.append(
        _check(
            "case_literals",
            not leaked,
            "no batch literals copied" if not leaked else f"copied from cases: {leaked[:3]}",
        )
    )

    deny = sorted(
        {h for path in changed if path in cf for h in _deny_hits(_text(cf[path]))}
        - {h for path in changed if path in pf for h in _deny_hits(_text(pf[path]))}
    )
    checks.append(
        _check("deny_list", not deny, "no weakening phrases" if not deny else f"weakening phrase: {deny[0]!r}")
    )

    checks.append(_check("non_empty_diff", bool(changed), f"changed: {', '.join(changed)}" if changed else "no change"))

    out_of_range = []
    for path in changed:
        name = path.split(".", 1)[1] if path.startswith("params.") else None
        if name and name in optimizable.param_ranges and path in cf:
            lo, hi = optimizable.param_ranges[name]
            v = cf[path]
            if not isinstance(v, int | float) or isinstance(v, bool) or not lo <= v <= hi:
                out_of_range.append(f"{name}={v!r} not in [{lo}, {hi}]")
    checks.append(
        _check(
            "param_ranges", not out_of_range, "params within declared ranges" if not out_of_range else out_of_range[0]
        )
    )
    return {"passed": all(c["passed"] for c in checks), "checks": checks, "changed": changed}
