"""Target-agent adapter interface: run case.v1 cases with a profile, get one result line per case (SPEC §S.4)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


@dataclass
class AdapterResult:
    case_id: str
    trace: dict[str, Any] | None
    end_state: dict[str, Any] | None
    error: str | None = None

    @classmethod
    def from_line(cls, line: dict[str, Any]) -> AdapterResult:
        return cls(
            case_id=str(line.get("case_id")),
            trace=line.get("trace"),
            end_state=line.get("end_state") or (line.get("trace") or {}).get("end_state"),
            error=line.get("error"),
        )

    @property
    def llm_calls(self) -> int:
        return int(((self.trace or {}).get("metrics") or {}).get("llm_calls") or 0)


class Target(Protocol):
    agent: str

    def run(
        self,
        cases: list[dict[str, Any]],
        profile: dict[str, Any],
        *,
        fake_llm: bool = False,
        budget_calls: int | None = None,
        concurrency: int = 2,
    ) -> list[AdapterResult]: ...


def read_results(path: Path, cases: list[dict[str, Any]]) -> list[AdapterResult]:
    """Parse results.jsonl; cases with no line (crashed worker) become error results, in case order."""
    by_id: dict[str, AdapterResult] = {}
    if path.exists():
        for raw in path.read_text(encoding="utf-8").splitlines():
            if raw.strip():
                try:
                    res = AdapterResult.from_line(json.loads(raw))
                except json.JSONDecodeError:
                    continue
                by_id[res.case_id] = res
    out = []
    for case in cases:
        cid = str(case["case_id"])
        out.append(by_id.get(cid) or AdapterResult(cid, None, None, "adapter produced no result"))
    return out


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
