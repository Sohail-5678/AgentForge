"""Stable splits (CONTRACTS §2, SPEC §5.2): sha256 bucket mod 10 → 0–5 train, 6–7 val, 8–9 test.

Red-team cases hash their seed *family* so every mutation of a seed stays in the seed's split. DataPilot benchmark
cases keep the split from DataPilot's bench/splits.json so numbers match across projects.
"""

from __future__ import annotations

import hashlib
from typing import Any


def bucket(key: str) -> int:
    return int(hashlib.sha256(key.encode("utf-8")).hexdigest(), 16) % 10


def split_for(key: str) -> str:
    b = bucket(key)
    return "train" if b <= 5 else ("val" if b <= 7 else "test")


def assign_split(case: dict[str, Any], fixed: dict[str, str] | None = None) -> str:
    """The split a case must have. `fixed` maps case ids to an external split (DataPilot's splits.json)."""
    cid = str(case["case_id"]).split("@", 1)[0]
    if fixed and cid in fixed:
        return fixed[cid]
    if case.get("suite") == "redteam" and case.get("family"):
        return split_for(str(case["family"]))
    return split_for(cid)
