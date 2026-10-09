"""The demo snapshot loads into the real schema: every primary key / UNIQUE constraint holds and every foreign key
resolves, read straight from apps/web/db/migrations/0001_init.sql (the Neon seed enforces the same rules)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from conftest import REPO

MIGRATION = REPO / "apps" / "web" / "db" / "migrations" / "0001_init.sql"


@dataclass
class Table:
    name: str
    primary_key: list[str] = field(default_factory=list)
    unique: list[list[str]] = field(default_factory=list)
    foreign_keys: list[tuple[str, str, str]] = field(default_factory=list)  # (column, table, column)


def _split_top_level(body: str) -> list[str]:
    items, depth, cur = [], 0, []
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            items.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        items.append("".join(cur).strip())
    return items


def parse_schema(sql: str) -> dict[str, Table]:
    sql = re.sub(r"--[^\n]*", "", sql)
    tables: dict[str, Table] = {}
    for m in re.finditer(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\n\);", sql, re.S):
        t = Table(m.group(1))
        for item in _split_top_level(m.group(2)):
            cols = re.match(r"(PRIMARY KEY|UNIQUE)\s*\(([^)]*)\)", item)
            if cols:
                names = [c.strip() for c in cols.group(2).split(",")]
                if cols.group(1) == "PRIMARY KEY":
                    t.primary_key = names
                else:
                    t.unique.append(names)
                continue
            col = item.split()[0]
            if "PRIMARY KEY" in item:
                t.primary_key = [col]
            if re.search(r"\bUNIQUE\b", item):
                t.unique.append([col])
            ref = re.search(r"REFERENCES (\w+)\((\w+)\)", item)
            if ref:
                t.foreign_keys.append((col, ref.group(1), ref.group(2)))
        tables[t.name] = t
    return tables


SCHEMA = parse_schema(MIGRATION.read_text()) if MIGRATION.exists() else {}
pytestmark = pytest.mark.skipif(not SCHEMA, reason="apps/web/db/migrations/0001_init.sql not found")


def test_the_parser_sees_the_schema():
    assert SCHEMA["results"].primary_key == ["run_id", "case_id", "attempt"]
    assert ("case_id", "cases", "id") in SCHEMA["results"].foreign_keys
    assert ["agent_id", "version"] in SCHEMA["profiles"].unique
    assert SCHEMA["judge_calibration"].primary_key == ["agent_id", "judge_model", "prompt_hash"]


def _key(row: dict[str, Any], cols: list[str]) -> tuple[Any, ...]:
    return tuple(row[c] for c in cols)


@pytest.mark.parametrize("table", sorted(SCHEMA))
def test_primary_keys_and_unique_constraints(snapshot, table):
    rows = snapshot["tables"].get(table)
    if rows is None:
        pytest.skip(f"{table} is not part of the snapshot")
    spec = SCHEMA[table]
    for cols in [spec.primary_key, *spec.unique]:
        if not cols:
            continue
        keys = [_key(r, cols) for r in rows if all(r.get(c) is not None for c in cols)]
        dupes = sorted({k for k in keys if keys.count(k) > 1}, key=str)[:5] if len(set(keys)) != len(keys) else []
        assert not dupes, f"{table}{tuple(cols)} duplicates: {dupes}"
    if spec.primary_key:
        assert all(all(r.get(c) is not None for c in spec.primary_key) for r in rows), f"{table}: null primary key"


@pytest.mark.parametrize("table", sorted(SCHEMA))
def test_foreign_keys_resolve(snapshot, table):
    rows = snapshot["tables"].get(table)
    if rows is None:
        pytest.skip(f"{table} is not part of the snapshot")
    for col, ref_table, ref_col in SCHEMA[table].foreign_keys:
        targets = {r[ref_col] for r in snapshot["tables"][ref_table]}
        missing = sorted({r[col] for r in rows if r.get(col) is not None and r[col] not in targets})
        assert not missing, f"{table}.{col} → {ref_table}.{ref_col} missing: {missing[:5]}"


def test_one_active_profile_per_agent(snapshot):
    active = [p["agent_id"] for p in snapshot["tables"]["profiles"] if p["is_active"]]
    assert sorted(active) == sorted(set(active))


def test_application_level_references(snapshot):
    """References the schema keeps as plain uuids/arrays (no REFERENCES clause) still point at real rows."""
    t = snapshot["tables"]
    runs = {r["id"] for r in t["runs"]}
    traces = {x["id"] for x in t["traces"]}
    versions = {v["id"] for v in t["suite_versions"]}
    assert all(r["trace_id"] is None or r["trace_id"] in traces for r in t["results"])
    assert all(x["run_id"] is None or x["run_id"] in runs for x in t["traces"])
    assert all(set(r["suite_version_ids"]) <= versions for r in t["runs"])
    assert all(set(p["gate_run_ids"]) <= runs for p in t["promotions"])
    assert all(a["succeeded_in_run"] is None or a["succeeded_in_run"] in runs for a in t["attacks"])
    assert all(label["result_run_id"] in runs for label in t["judge_labels"])
    cands = {c["id"] for c in t["optimizer_candidates"]}
    assert all(p["candidate_id"] is None or p["candidate_id"] in cands for p in t["promotions"])
    assert [a["id"] for a in t["audit_log"]] == list(range(1, len(t["audit_log"]) + 1))
    assert Path(MIGRATION).exists()
