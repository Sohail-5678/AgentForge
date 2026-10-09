"""Power simulation (SPEC §7.4): what gain a paired McNemar test can detect with n test cases.

Model: baseline passes each case with probability `baseline`; a candidate breaks `break_rate` of the baseline-passing
cases and fixes enough failing cases that its expected pass rate is `baseline + gain`.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy.stats import binom

ALPHA = 0.05


def power_at(
    n: int, gain: float, *, baseline: float = 0.7, break_rate: float = 0.08, sims: int = 4000, seed: int = 7
) -> float:
    if n <= 0:
        return 0.0
    fix = (gain + baseline * break_rate) / (1 - baseline) if baseline < 1 else 0.0
    if fix > 1 or fix < 0:
        return float("nan")
    rng = np.random.default_rng(seed)
    passing = rng.binomial(n, baseline, size=sims)
    b = rng.binomial(passing, break_rate)
    c = rng.binomial(n - passing, fix)
    disc = b + c
    p = np.where(disc > 0, np.minimum(1.0, 2.0 * binom.cdf(np.minimum(b, c), np.maximum(disc, 1), 0.5)), 1.0)
    return float(np.mean((p < ALPHA) & (c > b)))


def minimum_detectable_effect(
    n: int, *, baseline: float = 0.7, break_rate: float = 0.08, target: float = 0.8, sims: int = 4000, seed: int = 7
) -> float | None:
    """Smallest gain (1-point grid) detected with probability ≥ target; None if no feasible gain reaches it."""
    max_gain = (1 - baseline) - baseline * break_rate
    for step in range(1, 101):
        gain = step / 100
        if gain > max_gain + 1e-9:
            return None
        if power_at(n, gain, baseline=baseline, break_rate=break_rate, sims=sims, seed=seed) >= target:
            return gain
    return None


def power_report(
    n: int, *, baseline: float = 0.7, break_rate: float = 0.08, proven: bool | None = None, sims: int = 4000
) -> dict[str, Any]:
    mde = minimum_detectable_effect(n, baseline=baseline, break_rate=break_rate, sims=sims)
    at10 = power_at(n, 0.10, baseline=baseline, break_rate=break_rate, sims=sims)
    report: dict[str, Any] = {
        "n": n,
        "baseline": round(baseline, 4),
        "break_rate": round(break_rate, 4),
        "mde_80": mde,
        "power_at_10": None if np.isnan(at10) else round(at10, 3),
    }
    if proven is not None:
        report["verdict"] = "proven" if proven else "not proven"
    return report


def power_table(ns: tuple[int, ...] = (50, 150, 400), **kw: Any) -> list[dict[str, Any]]:
    return [power_report(n, **kw) for n in ns]
