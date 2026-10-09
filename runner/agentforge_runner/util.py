"""Small deterministic helpers shared by every module (hashing, ids, time)."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

NAMESPACE = uuid.UUID("6f1d2c4e-4b7a-4f0e-9a51-1d2f3e4a5b6c")


def canonical_json(value: Any) -> str:
    """Sorted keys, no whitespace: the form every content hash is computed over."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def sha256_hex(text: str | bytes) -> str:
    data = text.encode("utf-8") if isinstance(text, str) else text
    return hashlib.sha256(data).hexdigest()


def stable_uuid(*parts: object) -> str:
    """A UUID derived only from its inputs, so regenerated data keeps the same ids."""
    return str(uuid.uuid5(NAMESPACE, "|".join(str(p) for p in parts)))


def unit_hash(*parts: object) -> float:
    """Deterministic pseudo-uniform number in [0, 1) from arbitrary parts (platform independent)."""
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def iso(ts: datetime) -> str:
    """ISO-8601 with a `Z` suffix and millisecond precision."""
    ts = ts.astimezone(UTC)
    return ts.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ts.microsecond // 1000:03d}Z"


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def utcnow() -> datetime:
    return datetime.now(UTC)


def add_ms(ts: datetime, ms: float) -> datetime:
    return ts + timedelta(milliseconds=ms)
