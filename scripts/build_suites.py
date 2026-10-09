#!/usr/bin/env python3
"""Build and check AgentForge's seed suites (docs/CONTRACTS.md §2, SPEC §5 and §8.3). Standard library only.

    python scripts/build_suites.py            # regenerate suites/ from the sibling target repos + write the manifest
    python scripts/build_suites.py --check    # exit 1 if anything is invalid or would change

Sources (paths default to the sibling folders ../datapilot and ../returnpilot, or $AF_DATAPILOT_DIR /
$AF_RETURNPILOT_DIR, or --datapilot / --returnpilot):

    suites/datapilot/benchmark.jsonl   <- datapilot bench/subset_150.jsonl, split from bench/splits.json
    suites/datapilot/regression.jsonl  <- datapilot bench/regression_40.jsonl + evals/cases/smoke.jsonl
    suites/returnpilot/scenario.jsonl  <- returnpilot evals/scenarios.jsonl (split recomputed by the contract rule)
    suites/returnpilot/regression.jsonl   hand-written here (source of truth; split and form normalized)
    suites/redteam/<agent>-<category>.yaml hand-written seed attacks (§8.3), converted to case.v1 for checks + hashes
    suites/manifest.json               per-suite counts, split / category / tag counts and suite version hashes

When a source repo is missing (e.g. in AgentForge's CI) the committed files for that agent are validated and
re-serialized instead of regenerated, so `--check` still proves they are canonical, valid and correctly split.
Running the script twice produces byte-identical output. The toy suites (suites/toy, redteam/toy-*) belong to
the runner package and are not managed here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schemas" / "case.v1.json"
MANIFEST_VERSION = 1

AGENTS = ("datapilot", "returnpilot")
SPLITS = ("train", "val", "test")
CATEGORIES = (
    "direct_injection",
    "indirect_injection",
    "data_exfiltration",
    "system_prompt_extraction",
    "excessive_agency",
    "unsafe_sql",
    "tool_arg_injection",
    "unbounded_consumption",
    "misinformation",
    "off_policy_content",
)
# OWASP Top 10 for LLM Applications 2025 (SPEC §8.2). off_policy_content has no OWASP entry.
OWASP = {
    "direct_injection": "LLM01:2025",
    "indirect_injection": "LLM01:2025",
    "data_exfiltration": "LLM02:2025",
    "system_prompt_extraction": "LLM07:2025",
    "excessive_agency": "LLM06:2025",
    "unsafe_sql": "LLM05:2025",
    "tool_arg_injection": "LLM05:2025",
    "unbounded_consumption": "LLM10:2025",
    "misinformation": "LLM09:2025",
    "off_policy_content": "n/a",
}
SEVERITIES = ("low", "medium", "high")
PREDICATES = ("end_state", "tool_called", "canary_leaked", "output_contains", "judge")
SEED_KEYS = {
    "id", "agent", "category", "owasp", "family", "severity", "title", "input", "setup",
    "success_if", "must_not", "expect", "tags",
}  # fmt: skip
# must_not names the runner implements (runner/agentforge_runner/graders/must_not.py).
MUST_NOT = {
    "approve_without_review", "reveal_other_customer", "write_sql", "leak_secret",
    "refund_other_customer", "refund_above_price", "refund_undelivered_order",
}  # fmt: skip
# DataPilot's smoke cases use their own must_not names; add the AgentForge check that covers the same property.
LEGACY_MUST_NOT = {"execute_write": "write_sql", "drop_table": "write_sql", "canary_leak": "leak_secret"}

CANONICAL_JSON = "json.dumps(body, sort_keys=True, separators=(',', ':'), ensure_ascii=False), UTF-8"
SPLIT_RULE = (
    "bucket = int(sha256(case_id).hexdigest(), 16) % 10: 0-5 train, 6-7 val, 8-9 test; red-team seeds hash their "
    "family; datapilot/benchmark keeps DataPilot's bench/splits.json"
)

# ---------------------------------------------------------------- facts about the target agents
# ReturnPilot (backend/returnpilot/db/seed.py, db/overrides.py, data/policies/*.md). Cross-checked against the
# repo by `target_facts()` whenever it is present, so drift is caught locally.
RP_PERSONA_ORDERS = {
    "maya": (1042, 1031, 1050, 1019),
    "arjun": (1038, 1044, 1047, 1052),
    "lena": (1036, 1029, 1041, 1033, 1046),
}
RP_SKUS = (
    "FW-TRAIL-01", "FW-ALPINE-02", "FW-CANVAS-03", "FW-SLIPPER-04", "FW-RAIN-05", "FW-SANDAL-06", "FW-RUN-07",
    "AP-SOCK-01", "AP-LINEN-02", "AP-RAIN-03", "AP-FLEECE-04", "AP-VEST-05", "AP-FLANNEL-06", "AP-CHINO-07",
    "AP-TEE-08", "AP-PUFFER-09", "AP-BEANIE-10", "AP-HOODIE-11", "AP-SWIM-12", "EL-HEAD-01", "EL-WATCH-02",
    "EL-BUDS-03", "EL-SPEAK-04", "EL-LAMP-05", "EL-SOLAR-06", "EL-CAM-07", "HM-MUG-01", "HM-CUPS-02", "HM-LAMP-03",
    "HM-THROW-04", "HM-COOK-05", "HM-BOTTLE-06", "HM-CANDLE-07", "HM-NAPKIN-08", "HM-SKILLET-09", "AC-SCARF-01",
    "AC-WALLET-02", "AC-PACK-03", "AC-SUN-04", "AC-TOTE-05",
)  # fmt: skip
RP_SECTIONS = (
    "1.1", "1.2", "1.3", "2.1", "2.2", "2.3", "3.1", "3.2", "3.3", "3.4", "3.5", "4.1", "4.2", "4.3",
    "5.1", "5.2", "5.3", "5.4", "6.1", "6.2", "6.3", "6.4", "7.1", "7.2", "7.3", "8.1", "8.2", "8.3",
    "9.1", "9.2", "9.3",
)  # fmt: skip
RP_PERSONAS = ("maya", "arjun", "lena")
RP_REVIEWER_POLICIES = ("none", "approve", "reject")
# DataPilot (backend/datapilot/eval_adapter.py)
DP_DEMO_DBS = ("chinook", "european_football_2", "formula_1", "student_club", "superhero")
DP_CHECKPOINT_POLICIES = ("pick_first", "run", "cancel")
DP_RESERVED = ("insert_rows", "update_rows", "canary_table", "column_descriptions", "column_descriptions_mode")


class BuildError(Exception):
    pass


# ---------------------------------------------------------------- hashing, splits, serialization


def canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(text: str | bytes) -> str:
    return hashlib.sha256(text.encode("utf-8") if isinstance(text, str) else text).hexdigest()


def content_hash(case: dict) -> str:
    return sha256_hex(canonical(case))


def split_for(key: str) -> str:
    bucket = int(sha256_hex(key), 16) % 10
    return "train" if bucket <= 5 else "val" if bucket <= 7 else "test"


def suite_version_hash(cases: list[dict]) -> str:
    pairs = sorted((c["case_id"], content_hash(c)) for c in cases)
    return sha256_hex("\n".join(f"{cid}:{h}" for cid, h in pairs))


TOP_ORDER = (
    "contract_version", "case_id", "agent", "suite", "split", "title", "input", "setup", "expect", "tags",
    "category", "owasp", "family", "severity", "success_if",
)  # fmt: skip


def ordered(case: dict) -> dict:
    """Fixed top-level key order (nested objects keep their authored order) → stable, diff-friendly lines."""
    out = {k: case[k] for k in TOP_ORDER if k in case}
    out.update({k: v for k, v in case.items() if k not in out})
    return out


def jsonl(cases: list[dict]) -> str:
    return "".join(json.dumps(ordered(c), ensure_ascii=False) + "\n" for c in cases)


def read_jsonl(path: Path) -> list[dict]:
    out = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise BuildError(f"{path}:{n}: invalid JSON: {e}") from e
    return out


# ---------------------------------------------------------------- strict YAML subset (seed files)
#
# The seed files use a deliberately small YAML subset so they can be read without PyYAML: block mappings and
# sequences, inline flow mappings/sequences ({…}, […]), single- or double-quoted strings, plain scalars, comments.
# No anchors, tags, multi-line or block scalars, multi-document streams. Plain scalars that YAML 1.1 would turn
# into something surprising (yes/no/on/off, dates, times, octal/hex) are rejected — quote them. The tests check
# that this parser and PyYAML's safe_load agree on every seed file.

_INT = re.compile(r"[-+]?(0|[1-9][0-9]*)")
_FLOAT = re.compile(r"[-+]?([0-9]+\.[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?")
_AMBIGUOUS = re.compile(
    r"(?i)(y|n|yes|no|on|off|\.inf|\.nan|[-+]?0[0-9_]+|0x[0-9a-f]+|0o[0-7]+|[0-9_]+:[0-9_:]+"
    r"|\d{4}-\d{1,2}-\d{1,2}([Tt ].*)?|[-+]?[0-9][0-9_]*_[0-9_]*|[-+]?[0-9]+[eE][-+]?[0-9]+)"
)
_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\", "/": "/", "0": "\0"}


class YamlError(BuildError):
    pass


def _plain(text: str, where: str) -> Any:
    s = text.strip()
    if s in ("", "~", "null", "Null", "NULL"):
        return None
    if s in ("true", "True", "TRUE"):
        return True
    if s in ("false", "False", "FALSE"):
        return False
    if _INT.fullmatch(s):
        return int(s)
    if _FLOAT.fullmatch(s):
        return float(s)
    if _AMBIGUOUS.fullmatch(s):
        raise YamlError(f"{where}: ambiguous plain scalar {s!r}; quote it")
    if s[0] in "&*!|>%@`" or s.startswith(("- ", "? ")) or ": " in s or " #" in s:
        raise YamlError(f"{where}: unsupported plain scalar {s!r}; quote it")
    return s


def _quoted(text: str, pos: int, where: str) -> tuple[str, int]:
    q = text[pos]
    out: list[str] = []
    i = pos + 1
    while i < len(text):
        ch = text[i]
        if q == "'":
            if ch == "'":
                if text[i + 1 : i + 2] == "'":
                    out.append("'")
                    i += 2
                    continue
                return "".join(out), i + 1
            out.append(ch)
        else:
            if ch == '"':
                return "".join(out), i + 1
            if ch == "\\":
                nxt = text[i + 1 : i + 2]
                if nxt in _ESCAPES:
                    out.append(_ESCAPES[nxt])
                    i += 2
                    continue
                if nxt == "u" and re.fullmatch(r"[0-9a-fA-F]{4}", text[i + 2 : i + 6]):
                    out.append(chr(int(text[i + 2 : i + 6], 16)))
                    i += 6
                    continue
                raise YamlError(f"{where}: unsupported escape \\{nxt}")
            out.append(ch)
        i += 1
    raise YamlError(f"{where}: unterminated string")


def _flow(text: str, pos: int, where: str) -> tuple[Any, int]:
    """Parse one flow value starting at text[pos]; returns (value, position after it)."""
    while pos < len(text) and text[pos] == " ":
        pos += 1
    if pos >= len(text):
        raise YamlError(f"{where}: missing value")
    ch = text[pos]
    if ch in "\"'":
        return _quoted(text, pos, where)
    if ch in "[{":
        close = "]" if ch == "[" else "}"
        items: list[Any] = []
        mapping: dict[str, Any] = {}
        pos += 1
        while True:
            while pos < len(text) and text[pos] == " ":
                pos += 1
            if pos < len(text) and text[pos] == close:
                return (items if ch == "[" else mapping), pos + 1
            if ch == "[":
                value, pos = _flow(text, pos, where)
                items.append(value)
            else:
                if text[pos] in "\"'":
                    key, pos = _quoted(text, pos, where)
                else:
                    m = re.compile(r"[^:,{}\[\]]+").match(text, pos)
                    if not m:
                        raise YamlError(f"{where}: bad flow mapping key")
                    key, pos = m.group(0).strip(), m.end()
                while pos < len(text) and text[pos] == " ":
                    pos += 1
                if text[pos : pos + 1] != ":":
                    raise YamlError(f"{where}: expected ':' after flow key {key!r}")
                value, pos = _flow(text, pos + 1, where)
                if key in mapping:
                    raise YamlError(f"{where}: duplicate key {key!r}")
                mapping[str(key)] = value
            while pos < len(text) and text[pos] == " ":
                pos += 1
            if text[pos : pos + 1] == ",":
                pos += 1
            elif text[pos : pos + 1] != close:
                raise YamlError(f"{where}: expected ',' or {close!r}")
    m = re.compile(r"[^,\]}]+").match(text, pos)
    raw = m.group(0) if m else ""
    return _plain(raw, where), pos + len(raw)


def _inline(text: str, where: str) -> Any:
    text = text.strip()
    if text[:1] in "[{\"'":
        value, end = _flow(text, 0, where)
        if text[end:].strip():
            raise YamlError(f"{where}: trailing text {text[end:]!r}")
        return value
    if text[:1] in "|>":
        raise YamlError(f"{where}: block scalars are not supported; use a quoted one-line string")
    return _plain(text, where)


def _strip_comment(line: str) -> str:
    quote = None
    i = 0
    while i < len(line):
        ch = line[i]
        if quote == '"' and ch == "\\":
            i += 2
            continue
        if quote:
            if ch == quote:
                if quote == "'" and line[i + 1 : i + 2] == "'":
                    i += 2
                    continue
                quote = None
        elif ch in "\"'" and (i == 0 or line[i - 1] in " [{:,-"):
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1] == " "):
            return line[:i].rstrip()
        i += 1
    return line.rstrip()


def _split_key(content: str, where: str) -> tuple[str, str] | None:
    """`key: rest` → (key, rest); None if the line is not a mapping entry."""
    if content[:1] in "\"'":
        key, end = _quoted(content, 0, where)
        rest = content[end:]
        if not rest.startswith(":") or (len(rest) > 1 and rest[1] != " "):
            return None
        return key, rest[1:].strip()
    m = re.match(r"([^\s\"'{\[#][^:]*?):(?: (.*)|)$", content)
    if not m:
        return None
    return m.group(1).strip(), (m.group(2) or "").strip()


def yaml_load(text: str, name: str = "<yaml>") -> Any:
    lines: list[list[Any]] = []  # [indent, content, lineno]
    for n, raw in enumerate(text.splitlines(), 1):
        if "\t" in raw[: len(raw) - len(raw.lstrip())]:
            raise YamlError(f"{name}:{n}: tabs are not allowed for indentation")
        stripped = _strip_comment(raw)
        if not stripped.strip():
            continue
        if stripped.strip() in ("---", "..."):
            raise YamlError(f"{name}:{n}: document markers are not supported")
        lines.append([len(stripped) - len(stripped.lstrip(" ")), stripped.strip(), n])
    if not lines:
        return None

    def where(i: int) -> str:
        return f"{name}:{lines[i][2]}"

    def node(i: int, indent: int) -> tuple[Any, int]:
        if lines[i][1] == "-" or lines[i][1].startswith("- "):
            return seq(i, indent)
        if _split_key(lines[i][1], where(i)) is not None:
            return mapping(i, indent)
        value = _inline(lines[i][1], where(i))
        return value, i + 1

    def seq(i: int, indent: int) -> tuple[list[Any], int]:
        out: list[Any] = []
        while i < len(lines) and lines[i][0] == indent and (lines[i][1] == "-" or lines[i][1].startswith("- ")):
            rest = lines[i][1][1:].lstrip(" ")
            if not rest:
                if i + 1 >= len(lines) or lines[i + 1][0] <= indent:
                    out.append(None)
                    i += 1
                    continue
                value, i = node(i + 1, lines[i + 1][0])
            elif _split_key(rest, where(i)) is not None:
                # "- key: value" starts a mapping whose keys sit at the column after "- ".
                col = indent + (len(lines[i][1]) - len(rest))
                lines[i] = [col, rest, lines[i][2]]
                value, i = mapping(i, col)
            else:
                value, i = _inline(rest, where(i)), i + 1
            out.append(value)
        if i < len(lines) and lines[i][0] > indent:
            raise YamlError(f"{where(i)}: unexpected indentation")
        return out, i

    def mapping(i: int, indent: int) -> tuple[dict[str, Any], int]:
        out: dict[str, Any] = {}
        while i < len(lines) and lines[i][0] == indent:
            content = lines[i][1]
            if content == "-" or content.startswith("- "):
                break
            kv = _split_key(content, where(i))
            if kv is None:
                raise YamlError(f"{where(i)}: expected 'key: value'")
            key, rest = kv
            if key in out:
                raise YamlError(f"{where(i)}: duplicate key {key!r}")
            if rest:
                out[key], i = _inline(rest, where(i)), i + 1
                continue
            nxt = i + 1
            if nxt < len(lines) and lines[nxt][0] > indent:
                out[key], i = node(nxt, lines[nxt][0])
            elif nxt < len(lines) and lines[nxt][0] == indent and lines[nxt][1].startswith("- "):
                out[key], i = seq(nxt, indent)  # sequence at the same indent as its key (YAML allows it)
            else:
                out[key], i = None, nxt
        if i < len(lines) and lines[i][0] > indent:
            raise YamlError(f"{where(i)}: unexpected indentation")
        return out, i

    value, end = node(0, lines[0][0])
    if end != len(lines):
        raise YamlError(f"{where(end)}: unexpected content at the top level")
    return value


# ---------------------------------------------------------------- JSON Schema subset validator

SUPPORTED_KEYWORDS = {
    "$schema", "$id", "title", "description", "type", "required", "properties", "additionalProperties", "items",
    "enum", "const", "pattern", "maxLength", "minLength", "minimum", "maximum", "minItems", "maxItems",
}  # fmt: skip
_TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, int | float) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def schema_keywords(schema: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(schema, dict):
        found |= set(schema)
        for key in ("properties",):
            for sub in (schema.get(key) or {}).values():
                found |= schema_keywords(sub)
        for key in ("items", "additionalProperties"):
            if isinstance(schema.get(key), dict):
                found |= schema_keywords(schema[key])
    return found


def validate(value: Any, schema: dict, path: str = "$") -> list[str]:
    """The subset of JSON Schema used by schemas/*.v1.json (unknown keywords are ignored; see the tests)."""
    errors: list[str] = []
    t = schema.get("type")
    if t is not None:
        types = t if isinstance(t, list) else [t]
        if not any(_TYPES[x](value) for x in types):
            return [f"{path}: expected {t}, got {type(value).__name__}"]
    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: must be {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} not in {schema['enum']}")
    if isinstance(value, str):
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{path}: {value!r} does not match {schema['pattern']}")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errors.append(f"{path}: longer than {schema['maxLength']}")
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: shorter than {schema['minLength']}")
    if isinstance(value, int | float) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: below minimum {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{path}: above maximum {schema['maximum']}")
    if isinstance(value, dict):
        for key in schema.get("required") or []:
            if key not in value:
                errors.append(f"{path}: missing required {key!r}")
        props = schema.get("properties") or {}
        for key, sub in value.items():
            if key in props:
                errors += validate(sub, props[key], f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}: unexpected property {key!r}")
            elif isinstance(schema.get("additionalProperties"), dict):
                errors += validate(sub, schema["additionalProperties"], f"{path}.{key}")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path}: more than {schema['maxItems']} items")
        if isinstance(schema.get("items"), dict):
            for i, item in enumerate(value):
                errors += validate(item, schema["items"], f"{path}[{i}]")
    return errors


# ---------------------------------------------------------------- target-agent facts (repo when present)


def target_facts(dp_dir: Path | None, rp_dir: Path | None) -> dict[str, Any]:
    """Identifiers the seed overrides may reference. Read from the repos when available, else the constants."""
    facts: dict[str, Any] = {
        "rp_orders": {k: set(v) for k, v in RP_PERSONA_ORDERS.items()},
        "rp_skus": set(RP_SKUS),
        "rp_sections": set(RP_SECTIONS),
        "dp_dbs": set(DP_DEMO_DBS),
        "dp_db_paths": {},
        "from_repo": {"returnpilot": False, "datapilot": False},
    }
    if rp_dir is not None:
        seed = (rp_dir / "backend/returnpilot/db/seed.py").read_text(encoding="utf-8")
        orders: dict[str, set[int]] = {}
        starts = [(m.start(), m.group(1)) for m in re.finditer(r'"(\w+)": PersonaTemplate\(', seed)]
        for idx, (start, persona) in enumerate(starts):
            end = starts[idx + 1][0] if idx + 1 < len(starts) else len(seed)
            orders[persona] = {int(n) for n in re.findall(r"PersonaOrder\(\s*(\d+)", seed[start:end])}
        facts["rp_orders"] = orders
        facts["rp_skus"] = set(re.findall(r'\("([A-Z]{2}-[A-Z]+-\d{2})",', seed))
        sections: set[str] = set()
        for md in sorted((rp_dir / "backend/data/policies").glob("*.md")):
            sections |= set(re.findall(r"^### (\d+\.\d+) ", md.read_text(encoding="utf-8"), re.MULTILINE))
        facts["rp_sections"] = sections
        facts["from_repo"]["returnpilot"] = True
    if dp_dir is not None:
        dbs = dp_dir / "backend/data/dbs"
        facts["dp_dbs"] = {p.parent.name for p in dbs.glob("*/*.sqlite") if p.stem == p.parent.name}
        facts["dp_db_paths"] = {name: dbs / name / f"{name}.sqlite" for name in facts["dp_dbs"]}
        facts["from_repo"]["datapilot"] = True
    return facts


class SqliteSchema:
    """Read-only view of one demo DB, for checking DataPilot seed overrides against the real tables."""

    def __init__(self, path: Path):
        self.conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        self.tables = {
            r[0].lower(): r[0] for r in self.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }

    def table(self, name: str) -> str | None:
        return self.tables.get(str(name).lower())

    def columns(self, table: str) -> list[tuple[str, int]]:
        return [(r[1], int(r[5])) for r in self.conn.execute(f'PRAGMA table_info("{table}")')]

    def has_column(self, table: str, col: str) -> bool:
        return any(c.lower() == str(col).lower() for c, _ in self.columns(table))

    def key_column(self, table: str) -> str:
        pks = [c for c, pk in self.columns(table) if pk]
        return pks[0] if len(pks) == 1 else "rowid"

    def has_row(self, table: str, key: Any) -> bool:
        kcol = self.key_column(table)
        col = "rowid" if kcol == "rowid" else f'"{kcol}"'
        if isinstance(key, str) and key.lstrip("-").isdigit():
            key = int(key)
        return self.conn.execute(f'SELECT 1 FROM "{table}" WHERE {col} = ? LIMIT 1', (key,)).fetchone() is not None

    def close(self) -> None:
        self.conn.close()


# ---------------------------------------------------------------- semantic checks


def check_rp_setup(case: dict, facts: dict) -> list[str]:
    errs: list[str] = []
    setup = case.get("setup") or {}
    persona = setup.get("persona", "maya")
    if persona not in RP_PERSONAS:
        errs.append(f"unknown persona {persona!r}")
    if setup.get("reviewer_policy", "none") not in RP_REVIEWER_POLICIES:
        errs.append(f"reviewer_policy must be one of {RP_REVIEWER_POLICIES}")
    persona_orders = set().union(*facts["rp_orders"].values())
    for key in setup.get("seed_overrides") or {}:
        parts = key.split(".")
        table, ident, field = parts[0], ".".join(parts[1:-1]), parts[-1]
        if len(parts) < 3:
            errs.append(f"override {key!r}: expected <table>.<id>.<field>")
        elif table == "orders" and field == "customer_note":
            if not ident.lstrip("#").isdigit() or int(ident.lstrip("#")) not in persona_orders:
                errs.append(f"override {key!r}: only demo-persona orders can be changed")
        elif table == "products" and field == "name":
            if ident not in facts["rp_skus"]:
                errs.append(f"override {key!r}: unknown SKU")
        elif table in ("customers", "tickets") and field == ("name" if table == "customers" else "text"):
            if ident not in facts["rp_orders"]:
                errs.append(f"override {key!r}: unknown persona")
        elif table == "policy_chunks" and field == "copy":
            if ident.lstrip("§") not in facts["rp_sections"]:
                errs.append(f"override {key!r}: unknown policy section")
        else:
            errs.append(f"override {key!r} is not a ReturnPilot red-team surface (see returnpilot/db/overrides.py)")
    turns = (case.get("input") or {}).get("turns")
    if not isinstance(turns, list) or not turns:
        errs.append("input.turns must be a non-empty list")
    else:
        for t in turns:
            text = t.get("user") if isinstance(t, dict) else t
            if not isinstance(text, str) or not text.strip():
                errs.append("every turn must be a non-empty string (or {user: str})")
    return errs


def check_dp_setup(case: dict, facts: dict, schemas: dict[str, SqliteSchema]) -> list[str]:
    errs: list[str] = []
    inp = case.get("input") or {}
    setup = case.get("setup") or {}
    if not isinstance(inp.get("question"), str) or not inp["question"].strip():
        errs.append("input.question is required")
    db_id = inp.get("db_id")
    bird = inp.get("db_source") == "bird" or "bird" in (case.get("tags") or [])
    if not bird and db_id not in facts["dp_dbs"]:
        errs.append(f"input.db_id {db_id!r} is not a DataPilot demo database")
    if setup.get("checkpoint_policy", "pick_first") not in DP_CHECKPOINT_POLICIES:
        errs.append(f"checkpoint_policy must be one of {DP_CHECKPOINT_POLICIES}")
    overrides = setup.get("seed_overrides") or {}
    db = schemas.get(db_id) if not bird else None

    def table(name: Any) -> str | None:
        if db is None:
            return str(name)
        real = db.table(name)
        if real is None:
            errs.append(f"override: no table {name!r} in {db_id}")
        return real

    def column(tname: str | None, col: Any) -> None:
        if db is not None and tname is not None and not db.has_column(tname, col):
            errs.append(f"override: no column {tname}.{col} in {db_id}")

    for key, value in overrides.items():
        if key in DP_RESERVED:
            continue
        parts = key.split(".")
        if len(parts) != 3:
            errs.append(f"override {key!r}: expected <Table>.<key>.<Column> or one of {DP_RESERVED}")
            continue
        t = table(parts[0])
        column(t, parts[2])
        if db is not None and t is not None and not db.has_row(t, parts[1]):
            errs.append(f"override {key!r}: no row with key {parts[1]} in {t}")
        if not isinstance(value, str | int | float):
            errs.append(f"override {key!r}: value must be a scalar")
    for op in overrides.get("insert_rows") or []:
        t = table(op.get("table"))
        for col in op.get("values") or {}:
            column(t, col)
        if db is not None and t is not None and "copy_from" in op and not db.has_row(t, op["copy_from"]):
            errs.append(f"insert_rows: no row {op['copy_from']} to copy in {t}")
    for op in overrides.get("update_rows") or []:
        t = table(op.get("table"))
        if not op.get("set") or not op.get("where"):
            errs.append("update_rows needs non-empty set and where")
        for col in [*(op.get("set") or {}), *(op.get("where") or {})]:
            column(t, col)
    canary = overrides.get("canary_table")
    if canary is not None and not isinstance(canary, dict | bool):
        errs.append("canary_table must be an object {name, rows, expose}")
    for ref in overrides.get("column_descriptions") or {}:
        if "." not in ref:
            errs.append(f"column_descriptions key {ref!r}: expected Table.column")
            continue
        tname, cname = ref.split(".", 1)
        column(table(tname), cname)
    if overrides.get("column_descriptions_mode", "append") not in ("append", "replace"):
        errs.append("column_descriptions_mode must be append or replace")
    return errs


def check_success_if(pred: Any, category: str) -> list[str]:
    errs: list[str] = []
    if not isinstance(pred, dict) or len(pred) != 1 or next(iter(pred)) not in ("any", "all"):
        return ["success_if must be {any: [...]} or {all: [...]}"]
    items = next(iter(pred.values()))
    if not isinstance(items, list) or not items:
        return ["success_if needs a non-empty list of predicates"]
    for p in items:
        if isinstance(p, dict) and len(p) == 1 and next(iter(p)) in ("any", "all"):
            errs += check_success_if(p, category)
            continue
        if not isinstance(p, dict) or len(p) != 1 or next(iter(p)) not in PREDICATES:
            errs.append(f"predicate {p!r}: use exactly one of {PREDICATES}")
            continue
        kind, arg = next(iter(p.items()))
        if kind == "end_state" and (not isinstance(arg, dict) or not arg):
            errs.append("end_state predicate needs a non-empty object")
        if kind in ("tool_called", "output_contains", "judge") and (not isinstance(arg, str) or not arg.strip()):
            errs.append(f"{kind} predicate needs a non-empty string")
        if kind == "canary_leaked" and arg is not True:
            errs.append("canary_leaked predicate must be true")
        if kind == "judge" and category != "off_policy_content":
            errs.append("judge predicates are reserved for off_policy_content (SPEC §8.2)")
    return errs


def check_case(case: dict, schema: dict, facts: dict, schemas: dict[str, SqliteSchema]) -> list[str]:
    errs = validate(case, schema)
    if errs:
        return errs
    exp = case.get("expect") or {}
    unknown = [n for n in exp.get("must_not") or [] if n not in MUST_NOT and n not in LEGACY_MUST_NOT]
    legacy_dp = case["agent"] == "datapilot" and not case["case_id"].startswith(("rt-dp-", "dp-bird-", "dp-reg-"))
    if unknown and not legacy_dp:
        errs.append(f"unknown must_not {unknown}; known: {sorted(MUST_NOT)}")
    if case["agent"] == "returnpilot":
        errs += check_rp_setup(case, facts)
    elif case["agent"] == "datapilot":
        errs += check_dp_setup(case, facts, schemas)
    if case["suite"] == "redteam":
        for key in ("category", "owasp", "family", "severity", "success_if"):
            if key not in case:
                errs.append(f"red-team case needs {key!r}")
        errs += check_success_if(case.get("success_if"), case.get("category", ""))
        if case.get("owasp") != OWASP.get(case.get("category", "")):
            errs.append(f"owasp for {case.get('category')} should be {OWASP.get(case.get('category', ''))!r}")
        if case["split"] != split_for(case.get("family", "")):
            errs.append(f"split should be {split_for(case.get('family', ''))} (hash of family)")
    return errs


# ---------------------------------------------------------------- red-team seeds


def seed_to_case(seed: dict) -> dict:
    """§8.3 seed → case.v1 (suite "redteam"). Runner / importer must use the same mapping for hashes to agree."""
    case: dict[str, Any] = {
        "contract_version": "case.v1",
        "case_id": seed["id"],
        "agent": seed["agent"],
        "suite": "redteam",
        "split": split_for(seed["family"]),
    }
    if seed.get("title"):
        case["title"] = seed["title"]
    case["input"] = seed["input"]
    if seed.get("setup"):
        case["setup"] = seed["setup"]
    expect: dict[str, Any] = {"result_match": "none"}
    expect.update(seed.get("expect") or {})
    if seed.get("must_not"):
        expect["must_not"] = list(seed["must_not"])
    case["expect"] = expect
    case["tags"] = ["redteam", seed["category"], *(seed.get("tags") or [])]
    for key in ("category", "owasp", "family", "severity", "success_if"):
        case[key] = seed[key]
    return case


def load_seed_file(path: Path) -> list[dict]:
    m = re.fullmatch(r"(datapilot|returnpilot)-([a-z_]+)\.yaml", path.name)
    if not m or m.group(2) not in CATEGORIES:
        raise BuildError(f"{path.name}: red-team files are named <agent>-<category>.yaml")
    agent, category = m.group(1), m.group(2)
    data = yaml_load(path.read_text(encoding="utf-8"), path.name)
    if not isinstance(data, list) or not data:
        raise BuildError(f"{path.name}: expected a non-empty list of seeds")
    prefix = {"datapilot": "rt-dp-", "returnpilot": "rt-rp-"}[agent]
    errs: list[str] = []
    for seed in data:
        sid = seed.get("id") if isinstance(seed, dict) else None
        if not isinstance(seed, dict):
            errs.append(f"{path.name}: every seed must be a mapping")
            continue
        extra = set(seed) - SEED_KEYS
        missing = {"id", "agent", "category", "owasp", "family", "severity", "input", "success_if"} - set(seed)
        if extra or missing:
            errs.append(f"{path.name} {sid}: unexpected {sorted(extra)} / missing {sorted(missing)}")
            continue
        if seed["agent"] != agent or seed["category"] != category:
            errs.append(f"{path.name} {sid}: agent/category must match the file name")
        if not str(sid).startswith(prefix):
            errs.append(f"{path.name} {sid}: id must start with {prefix}")
        if seed["severity"] not in SEVERITIES:
            errs.append(f"{path.name} {sid}: severity must be one of {SEVERITIES}")
        if "must_not" in (seed.get("expect") or {}):
            errs.append(f"{path.name} {sid}: put must_not at the top level of the seed")
    if errs:
        raise BuildError("\n".join(errs))
    return data


# ---------------------------------------------------------------- generators (from the source repos)


def gen_dp_benchmark(dp: Path) -> list[dict]:
    splits = json.loads((dp / "bench/splits.json").read_text(encoding="utf-8"))
    by_qid: dict[int, str] = {}
    for split in SPLITS:
        for qid in splits[split]:
            if qid in by_qid:
                raise BuildError(f"bench/splits.json: question {qid} is in two splits")
            by_qid[int(qid)] = split
    cases = []
    for item in read_jsonl(dp / "bench/subset_150.jsonl"):
        qid = int(item["question_id"])
        if qid not in by_qid:
            raise BuildError(f"bench/splits.json has no split for question {qid}")
        cases.append(
            {
                "contract_version": "case.v1",
                "case_id": f"dp-bird-{qid}",
                "agent": "datapilot",
                "suite": "benchmark",
                "split": by_qid[qid],
                "input": {
                    "question": item["question"],
                    "db_id": item["db_id"],
                    "evidence": item.get("evidence") or "",
                    "db_source": "bird",
                },
                "expect": {
                    "result_match": "execution",
                    "gold_sql": item["gold_sql"],
                    "must_not": ["write_sql"],
                    "max_steps": 12,
                },
                "tags": [item["difficulty"], item["db_id"], "bird"],
            }
        )
    if len(cases) != len(by_qid):
        raise BuildError(f"subset_150.jsonl has {len(cases)} questions but splits.json lists {len(by_qid)}")
    return cases


def gen_dp_regression(dp: Path) -> list[dict]:
    cases = []
    for item in read_jsonl(dp / "bench/regression_40.jsonl"):
        cid = f"dp-reg-bird-{int(item['question_id'])}"
        cases.append(
            {
                "contract_version": "case.v1",
                "case_id": cid,
                "agent": "datapilot",
                "suite": "regression",
                "split": split_for(cid),
                "input": {
                    "question": item["question"],
                    "db_id": item["db_id"],
                    "evidence": item.get("evidence") or "",
                    "db_source": "bird",
                },
                "expect": {
                    "result_match": "execution",
                    "gold_sql": item["gold_sql"],
                    "must_not": ["write_sql"],
                    "max_steps": 12,
                },
                "tags": [item["difficulty"], item["db_id"], "bird", "regression-40"],
            }
        )
    for item in read_jsonl(dp / "evals/cases/smoke.jsonl"):
        case = json.loads(json.dumps(item))  # deep copy; ids are already case.v1 and stay as they are
        case["suite"] = "regression"
        case["split"] = split_for(case["case_id"])
        exp = case.setdefault("expect", {})
        if exp.get("must_not"):
            mapped = [LEGACY_MUST_NOT[n] for n in exp["must_not"] if n in LEGACY_MUST_NOT]
            exp["must_not"] = list(dict.fromkeys([*exp["must_not"], *mapped]))
        tags = case.setdefault("tags", [])
        if "smoke" not in tags:
            tags.append("smoke")
        cases.append(case)
    return cases


def gen_rp_scenario(rp: Path) -> list[dict]:
    cases = []
    for item in read_jsonl(rp / "evals/scenarios.jsonl"):
        case = dict(item)
        case["split"] = split_for(case["case_id"])  # ReturnPilot ships them all as "test"; the contract rule wins
        cases.append(case)
    return cases


def normalize_committed(cases: list[dict], suite: str, *, keep_split: bool = False) -> list[dict]:
    out = []
    for c in cases:
        c = dict(c)
        c["suite"] = suite
        if not keep_split:
            c["split"] = split_for(c["case_id"])
        out.append(c)
    return out


# ---------------------------------------------------------------- build


def file_sha(path: Path) -> str:
    return sha256_hex(path.read_bytes())


def summarize(cases: list[dict], files: list[str], agent: str, kind: str) -> dict:
    entry: dict[str, Any] = {
        "agent": agent,
        "kind": kind,
        "files": files,
        "n": len(cases),
        "splits": {s: sum(1 for c in cases if c["split"] == s) for s in SPLITS},
        "by_tag": dict(sorted(Counter(t for c in cases for t in c.get("tags") or []).items())),
        "version_hash": suite_version_hash(cases),
    }
    if kind == "redteam":
        entry["by_category"] = dict(sorted(Counter(c["category"] for c in cases).items()))
        entry["by_severity"] = dict(sorted(Counter(c["severity"] for c in cases).items()))
        entry["by_category_split"] = {
            cat: {s: sum(1 for c in cases if c["category"] == cat and c["split"] == s) for s in SPLITS}
            for cat in sorted({c["category"] for c in cases})
        }
    return entry


def build(dp: Path | None, rp: Path | None, root: Path = ROOT) -> tuple[dict[str, str], list[str]]:
    """→ ({relative path: expected file text}, errors)."""
    suites = root / "suites"
    schema = json.loads((root / "schemas/case.v1.json").read_text(encoding="utf-8"))
    facts = target_facts(dp, rp)
    schemas = {name: SqliteSchema(p) for name, p in facts["dp_db_paths"].items()}
    errors: list[str] = []
    outputs: dict[str, str] = {}
    by_suite: dict[str, list[dict]] = {}
    files_by_suite: dict[str, list[str]] = {}

    old_manifest_path = suites / "manifest.json"
    old_manifest = json.loads(old_manifest_path.read_text(encoding="utf-8")) if old_manifest_path.exists() else {}
    sources: dict[str, dict[str, str]] = dict(old_manifest.get("sources") or {})

    def committed(rel: str) -> list[dict]:
        p = root / rel
        if not p.exists():
            errors.append(f"{rel}: missing (and its source repo is not available to regenerate it)")
            return []
        return read_jsonl(p)

    # DataPilot
    if dp is not None:
        bench, reg = gen_dp_benchmark(dp), gen_dp_regression(dp)
        sources["datapilot"] = {
            rel: file_sha(dp / rel)
            for rel in (
                "bench/subset_150.jsonl",
                "bench/splits.json",
                "bench/regression_40.jsonl",
                "evals/cases/smoke.jsonl",
            )
        }
    else:
        bench = normalize_committed(committed("suites/datapilot/benchmark.jsonl"), "benchmark", keep_split=True)
        reg = normalize_committed(committed("suites/datapilot/regression.jsonl"), "regression")
    # ReturnPilot
    if rp is not None:
        scen = gen_rp_scenario(rp)
        sources["returnpilot"] = {"evals/scenarios.jsonl": file_sha(rp / "evals/scenarios.jsonl")}
    else:
        scen = normalize_committed(committed("suites/returnpilot/scenario.jsonl"), "scenario")
    rp_reg = normalize_committed(committed("suites/returnpilot/regression.jsonl"), "regression")

    for rel, suite_id, cases in (
        ("suites/datapilot/benchmark.jsonl", "datapilot/benchmark", bench),
        ("suites/datapilot/regression.jsonl", "datapilot/regression", reg),
        ("suites/returnpilot/scenario.jsonl", "returnpilot/scenario", scen),
        ("suites/returnpilot/regression.jsonl", "returnpilot/regression", rp_reg),
    ):
        outputs[rel] = jsonl(cases)
        by_suite[suite_id] = cases
        files_by_suite[suite_id] = [rel]

    # Red-team seeds (hand-written YAML; validated, not rewritten)
    families: dict[str, str] = {}
    for agent in AGENTS:
        by_suite[f"{agent}/redteam"] = []
        files_by_suite[f"{agent}/redteam"] = []
    for path in sorted((suites / "redteam").glob("*.yaml")):
        if path.name.startswith("toy-"):
            continue
        try:
            seeds = load_seed_file(path)
        except BuildError as e:
            errors.append(str(e))
            continue
        rel = f"suites/redteam/{path.name}"
        agent = seeds[0]["agent"]
        files_by_suite[f"{agent}/redteam"].append(rel)
        for seed in seeds:
            fam = seed["family"]
            if fam in families:
                errors.append(f"{rel} {seed['id']}: family {fam!r} already used by {families[fam]}")
            families[fam] = seed["id"]
            by_suite[f"{agent}/redteam"].append(seed_to_case(seed))

    # Validation across everything
    seen: dict[str, str] = {}
    for suite_id, cases in by_suite.items():
        agent, kind = suite_id.split("/")
        for case in cases:
            cid = case.get("case_id", "?")
            if cid in seen:
                errors.append(f"{suite_id}: duplicate case_id {cid} (also in {seen[cid]})")
            seen[cid] = suite_id
            if case.get("agent") != agent or case.get("suite") != kind:
                errors.append(f"{suite_id} {cid}: agent/suite fields do not match the file")
            if kind not in ("benchmark", "redteam") and case.get("split") != split_for(cid):
                errors.append(f"{suite_id} {cid}: split must be {split_for(cid)}")
            errors += [f"{suite_id} {cid}: {e}" for e in check_case(case, schema, facts, schemas)]
    for db in schemas.values():
        db.close()

    manifest = {
        "manifest_version": MANIFEST_VERSION,
        "generator": "scripts/build_suites.py",
        "canonical_json": CANONICAL_JSON,
        "content_hash": "sha256(canonical_json(case))",
        "version_hash": "sha256('\\n'.join(f'{case_id}:{content_hash}' for sorted case ids))",
        "split_rule": SPLIT_RULE,
        "sources": dict(sorted(sources.items())),
        "suites": {sid: summarize(by_suite[sid], files_by_suite[sid], *sid.split("/")) for sid in sorted(by_suite)},
        "totals": {
            "suites": len(by_suite),
            "cases": sum(len(v) for v in by_suite.values()),
            "redteam_seeds": sum(len(by_suite[f"{a}/redteam"]) for a in AGENTS),
        },
    }
    outputs["suites/manifest.json"] = json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    return outputs, errors


def resolve_repo(arg: str | None, env: str, default: Path, marker: str) -> Path | None:
    path = Path(arg or os.environ.get(env) or default).expanduser()
    return path.resolve() if (path / marker).exists() else None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="validate; exit 1 if any file is invalid or would change")
    ap.add_argument("--datapilot", help="DataPilot repo (default ../datapilot or $AF_DATAPILOT_DIR)")
    ap.add_argument("--returnpilot", help="ReturnPilot repo (default ../returnpilot or $AF_RETURNPILOT_DIR)")
    ap.add_argument("--require-sources", action="store_true", help="fail if a source repo is not found")
    a = ap.parse_args(argv)
    dp = resolve_repo(a.datapilot, "AF_DATAPILOT_DIR", ROOT.parent / "datapilot", "bench/splits.json")
    rp = resolve_repo(a.returnpilot, "AF_RETURNPILOT_DIR", ROOT.parent / "returnpilot", "evals/scenarios.jsonl")
    for name, path in (("datapilot", dp), ("returnpilot", rp)):
        if path is None:
            if a.require_sources:
                print(f"error: {name} repo not found", file=sys.stderr)
                return 2
            print(f"note: {name} repo not found; validating the committed {name} suites instead of regenerating")
    try:
        outputs, errors = build(dp, rp)
    except BuildError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    changed = [rel for rel, text in outputs.items() if not (ROOT / rel).exists() or (ROOT / rel).read_text("utf-8") != text]
    for e in errors:
        print(f"invalid: {e}", file=sys.stderr)
    if a.check:
        for rel in changed:
            print(f"stale: {rel} (run python scripts/build_suites.py)", file=sys.stderr)
        ok = not errors and not changed
        manifest = json.loads(outputs["suites/manifest.json"])
        print(
            f"{'ok' if ok else 'FAILED'}: {manifest['totals']['cases']} cases in {manifest['totals']['suites']} suites "
            f"({manifest['totals']['redteam_seeds']} red-team seeds); {len(errors)} invalid, {len(changed)} stale"
        )
        return 0 if ok else 1
    if errors:
        print(f"not writing: {len(errors)} invalid case(s)", file=sys.stderr)
        return 1
    for rel in changed:
        (ROOT / rel).parent.mkdir(parents=True, exist_ok=True)
        (ROOT / rel).write_text(outputs[rel], encoding="utf-8")
        print(f"wrote {rel}")
    if not changed:
        print("up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
