"""Cohen's kappa for judge calibration (SPEC §13.2): agreement corrected for chance."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from agentforge_runner.stats.intervals import rnd

KAPPA_MIN = 0.6
N_MIN = 50


def confusion(human: Sequence[bool], judge: Sequence[bool]) -> dict[str, int]:
    """Positive = pass: tp both pass, fp judge pass / human fail, fn judge fail / human pass, tn both fail."""
    if len(human) != len(judge):
        raise ValueError("label lists differ in length")
    out = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
    for h, j in zip(human, judge, strict=True):
        out["tp" if h and j else "fp" if j else "fn" if h else "tn"] += 1
    return out


def cohen_kappa(human: Sequence[bool], judge: Sequence[bool]) -> tuple[float, float]:
    """(kappa, observed agreement). Degenerate case (chance agreement = 1) → kappa 1.0 if perfect else 0.0."""
    n = len(human)
    if n == 0:
        return (0.0, 0.0)
    m = confusion(human, judge)
    po = (m["tp"] + m["tn"]) / n
    p_h = (m["tp"] + m["fn"]) / n
    p_j = (m["tp"] + m["fp"]) / n
    pe = p_h * p_j + (1 - p_h) * (1 - p_j)
    if pe >= 1.0:
        return (1.0 if po == 1.0 else 0.0, po)
    return ((po - pe) / (1 - pe), po)


def calibration_report(human: Sequence[bool], judge: Sequence[bool]) -> dict[str, Any]:
    kappa, agreement = cohen_kappa(human, judge)
    n = len(human)
    return {
        "n": n,
        "kappa": rnd(kappa),
        "agreement": rnd(agreement),
        "confusion": confusion(human, judge),
        "calibrated": bool(kappa >= KAPPA_MIN and n >= N_MIN),
    }
