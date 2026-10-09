"""Pareto fronts: per-case front for candidate selection (GEPA) and the cost–quality front for config search."""

from __future__ import annotations

import random
from collections.abc import Mapping
from typing import Any

Scores = Mapping[str, Mapping[str, float]]


def best_sets(scores: Scores) -> dict[str, list[str]]:
    """Case id → candidates achieving the best score on it (ties included), in candidate order."""
    cases = sorted({c for s in scores.values() for c in s})
    out: dict[str, list[str]] = {}
    for case in cases:
        vals = {cid: s[case] for cid, s in scores.items() if case in s}
        if vals:
            top = max(vals.values())
            out[case] = [cid for cid in scores if cid in vals and vals[cid] == top]
    return out


def dominates(a: Mapping[str, float], b: Mapping[str, float]) -> bool:
    shared = set(a) & set(b)
    return bool(shared) and all(a[c] >= b[c] for c in shared) and any(a[c] > b[c] for c in shared)


def front(scores: Scores) -> list[str]:
    """Candidates that are best on at least one case and not dominated by another candidate."""
    members = {cid for cids in best_sets(scores).values() for cid in cids}
    keep = [cid for cid in scores if cid in members]
    return [c for c in keep if not any(dominates(scores[o], scores[c]) for o in keep if o != c)]


def weights(scores: Scores, members: list[str]) -> dict[str, int]:
    """Number of cases where the candidate is best or tied-best (GEPA's sampling weight)."""
    counts = dict.fromkeys(members, 0)
    for cids in best_sets({m: scores[m] for m in members}).values():
        for cid in cids:
            counts[cid] += 1
    return counts


def sample_parent(scores: Scores, rng: random.Random) -> str:
    members = front(scores) or list(scores)
    w = weights(scores, members)
    total = sum(w.values())
    if total == 0:
        return members[0]
    pick = rng.uniform(0, total)
    acc = 0.0
    for m in members:
        acc += w[m]
        if pick <= acc:
            return m
    return members[-1]


def cost_quality_front(
    points: list[dict[str, Any]], *, quality: str = "val_mean", cost: str = "cost_mean"
) -> list[dict[str, Any]]:
    """Marks `on_front` on points not dominated in (higher quality, lower cost)."""
    for p in points:
        p["on_front"] = not any(
            (o[quality] >= p[quality] and o[cost] <= p[cost]) and (o[quality] > p[quality] or o[cost] < p[cost])
            for o in points
            if o is not p
        )
    return points
