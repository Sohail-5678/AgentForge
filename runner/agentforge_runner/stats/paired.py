"""Paired comparisons on the same cases (SPEC §7.2): exact McNemar, paired bootstrap, per-case diff."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np
from scipy.stats import binom

from agentforge_runner.stats.intervals import rnd

BOOTSTRAP_SEED = 20251008


def mcnemar_exact(b: int, c: int) -> float:
    """Two-sided exact binomial test of b vs c with p = 0.5 (discordant pairs only)."""
    n = b + c
    if n == 0:
        return 1.0
    return float(min(1.0, 2.0 * binom.cdf(min(b, c), n, 0.5)))


def paired_bootstrap(
    baseline: list[int] | np.ndarray,
    candidate: list[int] | np.ndarray,
    *,
    resamples: int = 5000,
    seed: int = BOOTSTRAP_SEED,
    alpha: float = 0.05,
) -> tuple[float, float]:
    """Percentile CI for mean(candidate) − mean(baseline), resampling case ids with replacement."""
    a = np.asarray(baseline, dtype=float)
    b = np.asarray(candidate, dtype=float)
    if a.shape != b.shape:
        raise ValueError("paired samples must have the same length")
    n = a.size
    if n == 0:
        return (0.0, 0.0)
    diff = b - a
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(resamples, n))
    means = diff[idx].mean(axis=1)
    lo, hi = np.quantile(means, [alpha / 2, 1 - alpha / 2])
    return (float(lo), float(hi))


def compare(
    baseline: Mapping[str, bool], candidate: Mapping[str, bool], *, resamples: int = 5000, seed: int = BOOTSTRAP_SEED
) -> dict[str, Any]:
    """Paired comparison on the intersection of case ids (the UI says "compared on N shared cases")."""
    shared = sorted(set(baseline) & set(candidate))
    a = [int(bool(baseline[c])) for c in shared]
    b = [int(bool(candidate[c])) for c in shared]
    newly_failing = [c for c in shared if baseline[c] and not candidate[c]]
    newly_passing = [c for c in shared if candidate[c] and not baseline[c]]
    n = len(shared)
    lo, hi = paired_bootstrap(a, b, resamples=resamples, seed=seed) if n else (0.0, 0.0)
    base_rate = sum(a) / n if n else 0.0
    rate = sum(b) / n if n else 0.0
    return {
        "shared": n,
        "baseline_rate": rnd(base_rate),
        "rate": rnd(rate),
        "diff": rnd(rate - base_rate),
        "diff_ci": [rnd(lo), rnd(hi)],
        "b": len(newly_failing),
        "c": len(newly_passing),
        "p_value": rnd(mcnemar_exact(len(newly_failing), len(newly_passing)), 6),
        "newly_failing": newly_failing,
        "newly_passing": newly_passing,
    }
