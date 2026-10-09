"""Configuration search (SPEC §9.3): a small grid over routing/params on VAL; keep the cost–quality front."""

from __future__ import annotations

import copy
import itertools
from collections.abc import Callable
from typing import Any

from agentforge_runner.optimizer.pareto import cost_quality_front

GRIDS: dict[str, dict[str, list[Any]]] = {
    "datapilot": {
        "params.self_consistency_k": [1, 2, 3],
        "params.adaptive_k": [True, False],
        "routing.planner.primary": ["lite", "main"],
    },
    "returnpilot": {
        "routing.use_fast_when": ["never", "route in ['faq']", "route in ['faq','order_lookup']"],
        "params.history_messages": [6, 12],
    },
    "toy": {"params.self_consistency_k": [1, 2, 3]},
}


def set_path(profile: dict[str, Any], path: str, value: Any) -> dict[str, Any]:
    out = copy.deepcopy(profile)
    cur = out
    parts = path.split(".")
    for p in parts[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[p] = nxt
        cur = nxt
    cur[parts[-1]] = value
    return out


def get_path(profile: dict[str, Any], path: str) -> Any:
    cur: Any = profile
    for p in path.split("."):
        if not isinstance(cur, dict) or p not in cur:
            return None
        cur = cur[p]
    return cur


def grid_points(grid: dict[str, list[Any]]) -> list[dict[str, Any]]:
    keys = sorted(grid)
    return [dict(zip(keys, combo, strict=True)) for combo in itertools.product(*(grid[k] for k in keys))]


def apply_point(profile: dict[str, Any], point: dict[str, Any]) -> dict[str, Any]:
    out = profile
    for path, value in point.items():
        out = set_path(out, path, value)
    return out


def search(
    base: dict[str, Any],
    grid: dict[str, list[Any]],
    evaluate: Callable[[dict[str, Any]], dict[str, float]],
) -> list[dict[str, Any]]:
    """`evaluate(profile)` → {val_mean, cost_mean, p95_ms}. Returns CONTRACTS §6 config_search points."""
    points = []
    for i, point in enumerate(grid_points(grid)):
        res = evaluate(apply_point(base, point))
        points.append(
            {
                "label": f"g{i + 1}",
                "params": point,
                "val_mean": round(float(res["val_mean"]), 4),
                "cost_mean": round(float(res["cost_mean"]), 6),
                "p95_ms": int(res.get("p95_ms", 0)),
                "on_front": False,
            }
        )
    return cost_quality_front(points)
