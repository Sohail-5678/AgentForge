"""Content hashes and suite versions (CONTRACTS §2, SPEC §5.4)."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from agentforge_runner.util import canonical_json, sha256_hex


def content_hash(case: dict[str, Any]) -> str:
    return sha256_hex(canonical_json(case))


def suite_version_hash(pairs: Iterable[tuple[str, str]]) -> str:
    """sha256 of "case_id:content_hash" lines, sorted by case id."""
    return sha256_hex("\n".join(f"{cid}:{h}" for cid, h in sorted(pairs)))


def suite_version(cases: list[dict[str, Any]]) -> dict[str, Any]:
    pairs = sorted((str(c["case_id"]), content_hash(c)) for c in cases)
    return {"hash": suite_version_hash(pairs), "case_ids": [cid for cid, _ in pairs]}


def next_revision(case_id: str) -> str:
    """Cases are immutable: editing creates `…@2`, `…@3`."""
    base, _, rev = case_id.partition("@")
    return f"{base}@{int(rev or 1) + 1}"
