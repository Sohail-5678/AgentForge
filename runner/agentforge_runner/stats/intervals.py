"""Wilson score interval (SPEC §7.1): correct near 0% and 100%, unlike the normal approximation."""

from __future__ import annotations

import math
from typing import Any

Z95 = 1.959963984540054


def wilson(k: int, n: int, z: float = Z95) -> tuple[float, float]:
    if n <= 0:
        return (0.0, 1.0)
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def rnd(x: float, digits: int = 4) -> float:
    return round(float(x), digits)


def rate_block(passed: int, n: int) -> dict[str, Any]:
    """`{n, passed, rate, ci}` as used throughout `runs.summary`."""
    lo, hi = wilson(passed, n)
    return {"n": n, "passed": passed, "rate": rnd(passed / n) if n else 0.0, "ci": [rnd(lo), rnd(hi)]}
