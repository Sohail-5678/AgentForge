"""`execution_match` grader (SPEC §6.4): result of the predicted SQL equals the gold result, like BIRD EX.

Rows are compared as multisets (order ignored unless the gold SQL has a top-level ORDER BY), NULL equals NULL,
floats within 1e-6. Sources, in order: rows on both sides (`end_state.result_rows` + `expect.gold_rows`, or both
queries executed read-only on `expect.db_path`); a gold result hash; else the adapter's own EX (`end_state.ex`,
which DataPilot computes on the case's fresh database copy).
"""

from __future__ import annotations

import math
import re
import sqlite3
from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from agentforge_runner.graders.base import GradeContext, GraderResult, not_applicable

FLOAT_TOL = 1e-6


def _norm_cell(v: Any) -> Any:
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, float):
        if math.isnan(v):
            return ("nan",)
        if v.is_integer():
            return int(v)
    return v


def _cell_eq(a: Any, b: Any) -> bool:
    a, b = _norm_cell(a), _norm_cell(b)
    if isinstance(a, int | float) and isinstance(b, int | float):
        return abs(float(a) - float(b)) <= FLOAT_TOL * max(1.0, abs(float(a)), abs(float(b)))
    return a == b


def _row_eq(a: Sequence[Any], b: Sequence[Any]) -> bool:
    return len(a) == len(b) and all(_cell_eq(x, y) for x, y in zip(a, b, strict=True))


def _row_key(row: Sequence[Any]) -> tuple[Any, ...]:
    # Coarse key (floats rounded) for the multiset fast path; exact tolerance is checked afterwards.
    return tuple(
        round(float(_norm_cell(v)), 5) if isinstance(_norm_cell(v), float | int) else _norm_cell(v) for v in row
    )


def rows_match(pred: Sequence[Sequence[Any]], gold: Sequence[Sequence[Any]], *, ordered: bool = False) -> bool:
    if len(pred) != len(gold):
        return False
    pred_l = [list(r) for r in pred]
    gold_l = [list(r) for r in gold]
    if ordered:
        return all(_row_eq(a, b) for a, b in zip(pred_l, gold_l, strict=True))
    if Counter(map(_row_key, pred_l)) == Counter(map(_row_key, gold_l)):
        return True
    # Tolerance-aware greedy matching for float rows that round differently.
    remaining = list(gold_l)
    for row in pred_l:
        for i, cand in enumerate(remaining):
            if _row_eq(row, cand):
                del remaining[i]
                break
        else:
            return False
    return not remaining


def order_matters(gold_sql: str | None) -> bool:
    """True when the outermost query has ORDER BY (not one inside a subquery)."""
    if not gold_sql:
        return False
    depth, top = 0, []
    for ch in gold_sql:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0:
            top.append(ch)
    return re.search(r"\border\s+by\b", "".join(top), re.I) is not None


def run_readonly(db_path: str | Path, sql: str, limit: int = 100_000) -> list[tuple[Any, ...]]:
    conn = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True)
    try:
        return conn.execute(sql).fetchmany(limit)
    finally:
        conn.close()


def grade(ctx: GradeContext) -> GraderResult:
    exp = ctx.expect
    if exp.get("result_match") != "execution":
        return not_applicable("execution_match", "result_match is not execution")
    es = ctx.end_state
    gold_sql = exp.get("gold_sql")
    pred_rows, gold_rows = es.get("result_rows"), exp.get("gold_rows")
    if pred_rows is None and exp.get("db_path") and gold_sql and (es.get("pred_sql") or es.get("chosen_sql")):
        try:
            pred_rows = run_readonly(exp["db_path"], es.get("pred_sql") or es["chosen_sql"])
            gold_rows = run_readonly(exp["db_path"], gold_sql)
        except sqlite3.Error as exc:
            return GraderResult("execution_match", False, 0.0, {"source": "sqlite", "error": str(exc)[:200]})
    if pred_rows is not None and gold_rows is not None:
        ok = rows_match(pred_rows, gold_rows, ordered=order_matters(gold_sql))
        details = {
            "source": "rows",
            "pred_rows": len(pred_rows),
            "gold_rows": len(gold_rows),
            "ordered": order_matters(gold_sql),
        }
        return GraderResult("execution_match", ok, float(ok), details)
    if exp.get("gold_result_hash") and es.get("result_hash"):
        ok = es["result_hash"] == exp["gold_result_hash"]
        return GraderResult("execution_match", ok, float(ok), {"source": "result_hash"})
    if es.get("ex") is not None:
        ok = bool(es["ex"])
        details: dict[str, Any] = {"source": "adapter_ex"}
        if isinstance(es.get("ex_detail"), dict):
            details.update({k: es["ex_detail"].get(k) for k in ("gold_rows", "pred_rows", "ex_error")})
        return GraderResult("execution_match", ok, float(ok), details)
    return GraderResult("execution_match", False, 0.0, {"source": None, "error": "no predicted result to compare"})
