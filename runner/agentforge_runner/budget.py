"""Daily LLM call ledger (SPEC §15.1).

Every provider call goes through `Ledger.reserve` first. Past the configured cap the call is refused with
`BudgetExceeded`, so a run ends cleanly with `budget_exceeded` instead of running into a 429 storm.
Caps: per purpose group (defaults from §15.1, `DAILY_CAP_PURPOSE_<GROUP>` overrides) and optionally per model
(`DAILY_CAP_<MODEL_ID>`, e.g. `DAILY_CAP_OPENAI_GPT_OSS_20B=300`).
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

# Purpose → cap group. The generation group shares one cap (mutation + reflection + cluster labels + drafts).
PURPOSE_GROUP: dict[str, str] = {
    "judge": "judge",
    "cheap_judge": "cheap_judge",
    "refusal": "cheap_judge",
    "prompt_guard": "prompt_guard",
    "mutation": "generation",
    "reflection": "generation",
    "cluster_label": "generation",
    "draft": "generation",
    "embeddings": "embeddings",
    "target_eval": "target_eval",
}
DEFAULT_GROUP_CAPS: dict[str, int] = {
    "judge": 150,
    "cheap_judge": 400,
    "prompt_guard": 500,
    "generation": 60,
    "embeddings": 500,
    "target_eval": 600,
}


class BudgetExceeded(RuntimeError):
    """Raised before a call that would exceed a daily cap."""


def _env_key(text: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", text.upper()).strip("_")


def group_cap(group: str) -> int:
    raw = os.environ.get(f"DAILY_CAP_PURPOSE_{_env_key(group)}")
    return int(raw) if raw else DEFAULT_GROUP_CAPS.get(group, 100)


def model_cap(model: str) -> int | None:
    raw = os.environ.get(f"DAILY_CAP_{_env_key(model)}")
    return int(raw) if raw else None


@dataclass
class UsageRow:
    day: str
    provider: str
    model: str
    purpose: str
    calls: int = 0
    tokens_in: int = 0
    tokens_out: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "day": self.day,
            "provider": self.provider,
            "model": self.model,
            "purpose": self.purpose,
            "calls": self.calls,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
        }


@dataclass
class Ledger:
    """Per (day, provider, model, purpose) counters. Optionally persisted to a JSON file between local runs."""

    path: Path | None = None
    rows: dict[tuple[str, str, str, str], UsageRow] = field(default_factory=dict)
    today: date | None = None
    unlimited: bool = False  # demo/offline grading only: count calls, never refuse

    @classmethod
    def from_env(cls) -> Ledger:
        raw = os.environ.get("AF_LEDGER_PATH")
        ledger = cls(path=Path(raw) if raw else None)
        if ledger.path and ledger.path.exists():
            for row in json.loads(ledger.path.read_text()):
                ledger.rows[(row["day"], row["provider"], row["model"], row["purpose"])] = UsageRow(**row)
        return ledger

    def day(self) -> str:
        return (self.today or datetime.now(UTC).date()).isoformat()

    def used(self, *, group: str | None = None, model: str | None = None) -> int:
        d = self.day()
        total = 0
        for (day, _prov, mod, purpose), row in self.rows.items():
            if day != d:
                continue
            if group is not None and PURPOSE_GROUP.get(purpose, purpose) != group:
                continue
            if model is not None and mod != model:
                continue
            total += row.calls
        return total

    def reserve(self, provider: str, model: str, purpose: str, calls: int = 1) -> None:
        if self.unlimited:
            return
        group = PURPOSE_GROUP.get(purpose, purpose)
        cap = group_cap(group)
        if self.used(group=group) + calls > cap:
            raise BudgetExceeded(f"daily cap reached for {group} ({cap} calls)")
        mcap = model_cap(model)
        if mcap is not None and self.used(model=model) + calls > mcap:
            raise BudgetExceeded(f"daily cap reached for model {model} ({mcap} calls)")

    def record(self, provider: str, model: str, purpose: str, tokens_in: int = 0, tokens_out: int = 0) -> None:
        key = (self.day(), provider, model, purpose)
        row = self.rows.setdefault(key, UsageRow(*key))
        row.calls += 1
        row.tokens_in += tokens_in
        row.tokens_out += tokens_out
        if self.path:
            self.path.write_text(json.dumps([r.as_dict() for r in self.rows.values()], indent=1))

    def usage_rows(self) -> list[dict[str, Any]]:
        return [self.rows[k].as_dict() for k in sorted(self.rows)]


@dataclass
class CallBudget:
    """Target-agent call budget for one run or optimizer slice (`--budget-calls`)."""

    limit: int | None
    used: int = 0

    @property
    def remaining(self) -> int | None:
        return None if self.limit is None else max(0, self.limit - self.used)

    def exhausted(self) -> bool:
        return self.limit is not None and self.used >= self.limit

    def spend(self, calls: int) -> None:
        self.used += max(0, int(calls))
