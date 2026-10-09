"""State of the demo world while the timeline is generated: tables, ids, clocks, and how one run is executed."""

from __future__ import annotations

import copy
import json
import random
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from agentforge_runner.budget import Ledger
from agentforge_runner.datasets.versioning import content_hash, suite_version_hash
from agentforge_runner.execute import RunOutput, execute
from agentforge_runner.graders.judge import LLMJudge, fake_responders
from agentforge_runner.graders.registry import GradedResult
from agentforge_runner.llm import FakeProvider, LLMClient
from agentforge_runner.prices import judge_model, provider_for
from agentforge_runner.summary import build_summary, pass_map
from agentforge_runner.targets.local_adapter import toy_target
from agentforge_runner.targets.simulated import SimulatedTarget
from agentforge_runner.util import canonical_json, iso, sha256_hex, stable_uuid, unit_hash

NOW = datetime(2026, 10, 8, 18, 0, tzinfo=UTC)
DATA = Path(__file__).parent / "data"
ADMIN = "Sohail-5678"
AGENT_NAMES = {"returnpilot": "ReturnPilot", "datapilot": "DataPilot", "toy": "Toy agent"}


def day(d: int, hour: int = 7, minute: int = 30) -> datetime:
    """Day offset relative to NOW's date (0 = 2026-10-08)."""
    base = NOW.replace(hour=0, minute=0, second=0, microsecond=0)
    return base + timedelta(days=d, hours=hour, minutes=minute)


def load_profile(name: str) -> dict[str, Any]:
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))


@dataclass
class RunRecord:
    row: dict[str, Any]
    results: list[GradedResult]
    cases: dict[str, dict[str, Any]]


@dataclass
class World:
    seed: int
    tables: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    cases: dict[str, dict[str, Any]] = field(default_factory=dict)  # case_id → case.v1
    suite_members: dict[str, list[str]] = field(default_factory=dict)  # suite id → current case ids
    suite_version_id: dict[str, str] = field(default_factory=dict)  # suite id → current version id
    active: dict[str, str] = field(default_factory=dict)  # agent → active profile id
    profiles: dict[str, dict[str, Any]] = field(default_factory=dict)  # profile id → row
    calibration: dict[str, dict[str, Any]] = field(default_factory=dict)  # agent → {calibrated, kappa, n}
    last_nightly: dict[str, RunRecord] = field(default_factory=dict)
    runs: list[RunRecord] = field(default_factory=list)
    keep_traces: set[str] = field(default_factory=set)
    traces: dict[str, dict[str, Any]] = field(default_factory=dict)
    usage: dict[tuple[str, str, str, str], list[int]] = field(default_factory=dict)
    commits: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for name in (
            "agents",
            "profiles",
            "suites",
            "cases",
            "suite_versions",
            "runs",
            "results",
            "traces",
            "attacks",
            "optimizer_experiments",
            "optimizer_candidates",
            "promotions",
            "case_reviews",
            "judge_labels",
            "judge_calibration",
            "llm_usage",
            "audit_log",
            "alerts",
            "api_keys",
        ):
            self.tables[name] = []
        self.ledger = Ledger(unlimited=True)
        self.llm = LLMClient(
            ledger=self.ledger, providers={"fake": FakeProvider(responders=fake_responders())}, fake=True
        )

    # ids / small helpers -------------------------------------------------------------------------------
    def uid(self, *parts: object) -> str:
        return stable_uuid("demo", self.seed, *parts)

    def rng(self, *parts: object) -> random.Random:
        return random.Random(sha256_hex(f"{self.seed}|" + "|".join(map(str, parts))))

    def u(self, *parts: object) -> float:
        return unit_hash(self.seed, *parts)

    def commit(self, agent: str, at: datetime) -> str:
        week = at.isocalendar().week
        return sha256_hex(f"{self.seed}:{agent}:commit:{week}")[:40]

    def audit(
        self,
        at: datetime,
        action: str,
        object_type: str,
        object_id: str | None,
        details: dict[str, Any],
        actor: str = ADMIN,
    ) -> None:
        self.tables["audit_log"].append(
            {
                "id": 0,
                "actor": actor,
                "action": action,
                "object_type": object_type,
                "object_id": object_id,
                "details": details,
                "at": iso(at),
            }
        )

    def judge(self, agent: str) -> LLMJudge:
        if agent == "toy":  # toy runs are fake-LLM CI runs: their offline judge calls are not provider usage
            offline = LLMClient(
                ledger=Ledger(unlimited=True), providers={"fake": FakeProvider(responders=fake_responders())}, fake=True
            )
            return LLMJudge(offline, agent)
        return LLMJudge(self.llm, agent)

    # suites / cases ---------------------------------------------------------------------------------------
    def add_case(
        self, case: dict[str, Any], *, origin: str, created_at: datetime, source_trace_id: str | None = None
    ) -> None:
        cid = case["case_id"]
        if cid in self.cases:
            return
        self.cases[cid] = case
        self.tables["cases"].append(
            {
                "id": cid,
                "suite_id": f"{case['agent']}/{case['suite']}",
                "split": case["split"],
                "family": case.get("family"),
                "body": case,
                "content_hash": content_hash(case),
                "origin": origin,
                "source_trace_id": source_trace_id,
                "retired_at": None,
                "created_at": iso(created_at),
            }
        )

    def new_suite_version(self, suite_id: str, case_ids: list[str], at: datetime) -> str:
        pairs = sorted((cid, content_hash(self.cases[cid])) for cid in case_ids)
        h = suite_version_hash(pairs)
        vid = self.uid("suite_version", suite_id, h)
        self.tables["suite_versions"].append(
            {"id": vid, "suite_id": suite_id, "hash": h, "case_ids": [c for c, _ in pairs], "created_at": iso(at)}
        )
        self.suite_members[suite_id] = [c for c, _ in pairs]
        self.suite_version_id[suite_id] = vid
        return vid

    # profiles ------------------------------------------------------------------------------------------------
    def add_profile(
        self,
        agent: str,
        body: dict[str, Any],
        *,
        created_by: str,
        at: datetime,
        experiment_id: str | None = None,
        active: bool = False,
    ) -> str:
        body = copy.deepcopy(body)
        pid = self.uid("profile", agent, body["version"])
        row = {
            "id": pid,
            "agent_id": agent,
            "version": body["version"],
            "parent_version": body.get("parent_version"),
            "body": body,
            "body_hash": sha256_hex(canonical_json(body)),
            "created_by": created_by,
            "experiment_id": experiment_id,
            "is_active": False,
            "created_at": iso(at),
        }
        self.tables["profiles"].append(row)
        self.profiles[pid] = row
        if active:
            self.activate(agent, pid)
        return pid

    def activate(self, agent: str, pid: str) -> None:
        for row in self.tables["profiles"]:
            if row["agent_id"] == agent:
                row["is_active"] = row["id"] == pid
        self.active[agent] = pid

    def profile_body(self, pid: str) -> dict[str, Any]:
        return self.profiles[pid]["body"]

    # runs ----------------------------------------------------------------------------------------------------
    def target(self, agent: str, run_id: str, at: datetime, **kw: Any) -> Any:
        if agent == "toy":
            t = toy_target()
            t.run_kwargs = {"started_at": at, "trace_seed": run_id}
            return t
        return SimulatedTarget(
            agent,
            run_seed=run_id,
            started_at=at,
            agent_version=self.commit(agent, at),
            judge_calibrated=bool(self.calibration.get(agent, {}).get("calibrated")),
            **kw,
        )

    def run(
        self,
        agent: str,
        suites: list[str],
        trigger: str,
        at: datetime,
        *,
        profile_id: str | None = None,
        profile_body: dict[str, Any] | None = None,
        cases: list[dict[str, Any]] | None = None,
        attempts: int = 1,
        budget_calls: int = 300,
        status: str = "done",
        pr_number: int | None = None,
        experiment_id: str | None = None,
        compare_to: RunRecord | None = None,
        guard_scores: dict[str, float | None] | None = None,
        summary_extra: dict[str, Any] | None = None,
        target_kw: dict[str, Any] | None = None,
        target_ref: str | None = None,
        partial: float | None = None,
    ) -> RunRecord:
        run_id = self.uid("run", agent, trigger, iso(at), pr_number or "")
        pid = profile_id or self.active[agent]
        body = profile_body or self.profile_body(pid)
        if cases is None:
            cases = [self.cases[c] for s in suites for c in self.suite_members[s]]
        self.ledger.today = at.date()
        results: list[GradedResult] = []
        out: RunOutput | None = None
        summary: dict[str, Any] | None = None
        start = at + timedelta(seconds=40 + int(80 * self.u(run_id, "boot")))
        if status in ("done", "stalled", "running") and cases:
            tgt = self.target(agent, run_id, start, **(target_kw or {}))
            cal = self.calibration.get(agent, {})
            run_cases = cases if partial is None else cases[: max(1, int(len(cases) * partial))]
            on_attempt = getattr(tgt, "set_attempt", None)
            if agent == "toy":
                on_attempt = lambda a: tgt.run_kwargs.update(trace_seed=f"{run_id}:{a}")  # noqa: E731
            out = execute(
                tgt,
                run_cases,
                body,
                attempts=attempts,
                budget_calls=budget_calls * attempts,
                fake_llm=True,
                judge=self.judge(agent),
                judge_calibrated=bool(cal.get("calibrated")),
                rng=self.rng(run_id, "canary"),
                on_attempt=on_attempt,
            )
            results = out.results
            self._usage_from_results(agent, trigger, results)
        by_id = {c["case_id"]: c for c in cases}
        if results and status == "done":
            judge_info = None
            if any(c.get("expect", {}).get("rubric") for c in cases):
                cal = self.calibration.get(agent) or {"calibrated": False, "kappa": None, "n": 0}
                judge_info = {"calibrated": bool(cal["calibrated"]), "kappa": cal.get("kappa"), "n": cal.get("n", 0)}
            baseline = None
            if compare_to is not None:
                baseline = (compare_to.row["id"], pass_map(compare_to.results, compare_to.cases))
            noise = next((a["noise_profile"] for a in self.tables["agents"] if a["id"] == agent), None) or {}
            flaky_all = set(noise.get("flaky_cases", []))
            flaky = sorted(c for c in flaky_all if c in by_id)
            summary = build_summary(
                results,
                by_id,
                attempts=attempts,
                budget=out.budget() if out else None,
                baseline=baseline,
                judge=judge_info,
                flaky_cases=flaky,
                guard_scores=guard_scores,
                fake_llm=agent == "toy",
                synthetic=agent != "toy",
            )
            if summary.get("compare") and flaky_all:
                from agentforge_runner.stats.paired import compare as paired

                base_map = {k: v for k, v in baseline[1].items() if k not in flaky_all}
                cand_map = {k: v for k, v in pass_map(results, by_id).items() if k not in flaky_all}
                ex = paired(base_map, cand_map)
                summary["compare"]["excluding_flaky"] = {k: ex[k] for k in ("shared", "diff", "b", "c", "p_value")}
            if summary_extra:
                summary.update(summary_extra)
        ended = max((r.trace["ended_at"] for r in results if r.trace), default=iso(start))
        finished = None if status in ("running", "stalled", "queued") else ended
        if status in ("failed", "cancelled"):
            finished = iso(start + timedelta(minutes=3 + int(10 * self.u(run_id, "fail"))))
        heartbeat = {
            "running": iso(NOW - timedelta(seconds=35)),
            "stalled": iso(start + timedelta(minutes=14)),
            "queued": None,
        }.get(status, finished)
        row = {
            "id": run_id,
            "seq": 0,
            "agent_id": agent,
            "suite_version_ids": [self.suite_version_id[s] for s in suites if s in self.suite_version_id],
            "profile_id": pid,
            "target_ref": target_ref or self.commit(agent, at),
            "trigger": trigger,
            "pr_number": pr_number,
            "experiment_id": experiment_id,
            "attempts": attempts,
            "budget_calls": budget_calls * attempts,
            "status": status,
            "gh_run_id": None if status == "queued" else 18_400_000_000 + int(9_000_000 * self.u(run_id, "gh")),
            "summary": summary,
            "heartbeat_at": heartbeat,
            "created_at": iso(at),
            "finished_at": finished,
        }
        if status == "failed":
            row["summary"] = {
                "error": (summary_extra or {}).get("error", "target install failed"),
                "n_results": 0,
                "n_quality": 0,
                "synthetic": True,
            }
        rec = RunRecord(row, results, by_id)
        self.runs.append(rec)
        return rec

    def _usage_from_results(self, agent: str, trigger: str, results: list[GradedResult]) -> None:
        if agent == "toy":
            return
        purpose = {
            "nightly": "eval_nightly",
            "pr": "eval_pr",
            "gate": "eval_gate",
            "manual": "eval_manual",
            "optimizer": "eval_optimizer",
        }.get(trigger, "eval_manual")
        for r in results:
            for s in (r.trace or {}).get("spans", []):
                if s.get("model") and s.get("kind") in ("llm", "guard"):
                    key = (r.trace["started_at"][:10], provider_for(s["model"]), s["model"], f"{purpose}:{agent}")
                    slot = self.usage.setdefault(key, [0, 0, 0])
                    slot[0] += 1
                    slot[1] += int(s.get("tokens_in") or 0)
                    slot[2] += int(s.get("tokens_out") or 0)

    def add_usage(self, at: datetime, model: str, purpose: str, calls: int, tokens_in: int, tokens_out: int) -> None:
        key = (at.date().isoformat(), provider_for(model), model, purpose)
        slot = self.usage.setdefault(key, [0, 0, 0])
        slot[0] += calls
        slot[1] += tokens_in
        slot[2] += tokens_out

    def judge_model(self, agent: str) -> str:
        return judge_model(agent)
