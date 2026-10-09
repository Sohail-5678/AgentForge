"""pass^k (SPEC §7.3): share of cases where all k attempts pass — reliability, not luck."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from math import comb
from typing import Any

from agentforge_runner.stats.intervals import rnd, wilson


def pass_hat_k(n_trials: int, n_pass: int, k: int) -> float:
    """Unbiased estimate of P(all k tries pass) from n ≥ k trials with c passes: C(c, k) / C(n, k)."""
    if n_trials < k:
        raise ValueError("need at least k trials")
    return comb(n_pass, k) / comb(n_trials, k)


def pass_k(attempts: Mapping[str, Sequence[bool]], k: int) -> dict[str, Any] | None:
    """Cases with at least k attempts; a case counts as passed when all of its first k attempts passed."""
    eligible = {c: list(v)[:k] for c, v in attempts.items() if len(v) >= k}
    if not eligible or k < 2:
        return None
    n = len(eligible)
    passed_all = sum(1 for v in eligible.values() if all(v))
    lo, hi = wilson(passed_all, n)
    return {"k": k, "n": n, "passed_all": passed_all, "rate": rnd(passed_all / n), "ci": [rnd(lo), rnd(hi)]}
