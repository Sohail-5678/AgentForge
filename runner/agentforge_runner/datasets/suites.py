"""Locate and load suites from the repository's `suites/` folder (CONTRACTS §2)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from agentforge_runner.redteam.seeds import load_seeds


def find_suites_dir(start: Path | None = None) -> Path:
    env = os.environ.get("AF_SUITES_DIR")
    if env:
        return Path(env)
    for base in [start or Path.cwd(), Path(__file__).resolve()]:
        for p in [base, *base.parents]:
            if (p / "suites").is_dir() and (p / "schemas").is_dir():
                return p / "suites"
    raise FileNotFoundError("could not find the repository's suites/ folder (set AF_SUITES_DIR)")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def load_suite(suite: str, suites_dir: Path | None = None) -> list[dict[str, Any]]:
    """`<agent>/<kind>` → case.v1 list. Red-team suites come from the YAML seed files."""
    root = suites_dir or find_suites_dir()
    agent, kind = suite.split("/", 1)
    if kind == "redteam":
        return load_seeds(root, agent)
    path = root / agent / f"{kind}.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"suite file {path} not found")
    return load_jsonl(path)
