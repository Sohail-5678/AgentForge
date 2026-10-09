"""GEPA-lite: reflective prompt evolution with a Pareto front (SPEC §9.2), resumable in nightly slices (§4.4, §9.5).

    seed = active profile; P = {seed}; S[seed] = per-case scores on VAL
    repeat until budget / iterations / patience exhausted:
      parent    ← sample from the Pareto front of P on VAL (weight = #VAL cases where it is best or tied-best)
      component ← next optimizable component, round-robin
      batch     ← minibatch TRAIN cases (half from the parent's failures, half random)
      R_parent  ← run parent on batch (cached)
      feedback  ← condensed trace + grader details per failing case
      new_text  ← reflection(component text, feedback)          (few_shots: pick passing TRAIN examples instead)
      child     ← parent with component = new_text → editor checks (§9.4)
      R_child   ← run child on the same batch
      if sum(R_child) > sum(R_parent): evaluate child on VAL, add to P
      else: rejected (kept in the tree for the UI)
    best ← highest VAL mean (ties → lower cost)

State (CONTRACTS §6) is plain JSON so the control plane can store it between nights.
"""

from __future__ import annotations

import copy
import json
import random
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

import numpy as np

from agentforge_runner.budget import BudgetExceeded
from agentforge_runner.execute import feedback_text
from agentforge_runner.graders.registry import GradedResult, grade_case
from agentforge_runner.llm import RateLimited
from agentforge_runner.optimizer import pareto
from agentforge_runner.optimizer.config_search import get_path, search, set_path
from agentforge_runner.optimizer.editor import OptimizableKeys, check_edit
from agentforge_runner.optimizer.reflection import Reflector
from agentforge_runner.targets.base import Target
from agentforge_runner.util import canonical_json, iso, sha256_hex, stable_uuid, utcnow

PURPOSES = {
    "prompts.system": "the agent's main system prompt: how it behaves, which tools to use and in what order",
    "prompts.planner": "the planner prompt that splits a question into steps",
    "prompts.sql_direct": "the prompt that writes one SQLite query directly",
    "few_shots": "worked input→output examples shown to the model",
}


def profile_hash(profile: dict[str, Any]) -> str:
    body = {k: v for k, v in profile.items() if k not in ("version", "parent_version", "created_by", "notes")}
    return sha256_hex(canonical_json(body))[:16]


@dataclass
class Outcome:
    passed: bool
    cost: float
    latency_ms: int
    feedback: str = ""
    example: dict[str, Any] | None = None
    tags: list[str] = field(default_factory=list)


class Evaluator(Protocol):
    calls: int

    def evaluate(self, profile: dict[str, Any], cases: list[dict[str, Any]]) -> dict[str, Outcome]: ...


@dataclass
class TargetEvaluator:
    """Runs the target on cases with a profile and grades them; results are cached by (profile_hash, case_id)."""

    target: Target
    fake_llm: bool = False
    judge: Any = None
    judge_calibrated: bool = False
    cache: dict[str, dict[str, Outcome]] = field(default_factory=dict)
    calls: int = 0
    runs: list[tuple[str, list[GradedResult]]] = field(default_factory=list)

    def evaluate(self, profile: dict[str, Any], cases: list[dict[str, Any]]) -> dict[str, Outcome]:
        h = profile_hash(profile)
        known = self.cache.setdefault(h, {})
        todo = [c for c in cases if c["case_id"] not in known]
        if todo:
            raw = self.target.run(todo, profile, fake_llm=self.fake_llm)
            graded = []
            for case, res in zip(todo, raw, strict=True):
                r = grade_case(case, res, judge_=self.judge, judge_calibrated=self.judge_calibrated)
                graded.append(r)
                self.calls += res.llm_calls
                example = None
                if r.passed and r.trace:
                    turns = (r.trace.get("input") or {}).get("turns") or []
                    out = r.trace.get("final_output") or {}
                    example = {
                        "input": str(turns[-1]) if turns else "",
                        "output": str(out.get("reply") or out.get("answer") or "")[:300],
                    }
                known[case["case_id"]] = Outcome(
                    r.passed,
                    r.cost_usd,
                    r.latency_ms,
                    "" if r.passed else feedback_text(case, r),
                    example,
                    list(case.get("tags") or []),
                )
            self.runs.append((h, graded))
        return {c["case_id"]: known[c["case_id"]] for c in cases}

    def export(self) -> dict[str, dict[str, list[Any]]]:
        return {
            h: {
                cid: [int(o.passed), round(o.cost, 6), o.latency_ms, o.feedback, o.example, o.tags]
                for cid, o in sorted(v.items())
            }
            for h, v in sorted(self.cache.items())
        }

    def load(self, data: dict[str, dict[str, list[Any]]]) -> None:
        for h, v in data.items():
            self.cache.setdefault(h, {}).update(
                {cid: Outcome(bool(x[0]), float(x[1]), int(x[2]), x[3], x[4], list(x[5])) for cid, x in v.items()}
            )


@dataclass
class OptimizerConfig:
    budget_total: int = 1500
    nightly_calls: int = 300
    max_iters: int = 8
    minibatch: int = 10
    patience: int = 3
    components: list[str] = field(default_factory=lambda: ["prompts.system", "few_shots"])
    seed: int = 7
    grid: dict[str, list[Any]] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "budget_total": self.budget_total,
            "nightly_calls": self.nightly_calls,
            "max_iters": self.max_iters,
            "minibatch": self.minibatch,
            "patience": self.patience,
            "components": list(self.components),
            "seed": self.seed,
            "grid": self.grid,
        }


@dataclass
class SliceResult:
    stop_reason: str
    finished: bool
    new_candidates: list[dict[str, Any]]


class GepaLite:
    def __init__(
        self,
        *,
        experiment_id: str,
        seed_profile: dict[str, Any],
        train: list[dict[str, Any]],
        val: list[dict[str, Any]],
        evaluator: Evaluator,
        reflector: Reflector,
        optimizable: OptimizableKeys,
        locked: list[str],
        config: OptimizerConfig,
        state: dict[str, Any] | None = None,
        clock: Callable[[], datetime] = utcnow,
        on_save: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.exp = experiment_id
        self.seed_profile = seed_profile
        self.train, self.val = train, val
        self.ev = evaluator
        self.reflector = reflector
        self.opt = optimizable
        self.locked = locked
        self.cfg = config
        self.clock = clock
        self.on_save = on_save
        # Locked components are not filtered here on purpose: the editor is the enforcement point and rejects them.
        self.components = list(config.components)
        if state and state.get("cache") and hasattr(evaluator, "load"):
            evaluator.load(state["cache"])
        self.state: dict[str, Any] = state or {
            "iteration": 0,
            "night": 0,
            "front": [],
            "round_robin": 0,
            "calls_used": 0,
            "no_improve": 0,
            "status": "running",
            "stop_reason": None,
            "best": None,
            "candidates": [],
            "history": [],
            "config_search": [],
        }

    # candidates ---------------------------------------------------------------------------------------------
    @property
    def candidates(self) -> list[dict[str, Any]]:
        return self.state["candidates"]

    def cand(self, cid: str) -> dict[str, Any]:
        return next(c for c in self.candidates if c["id"] == cid)

    def body(self, cid: str) -> dict[str, Any]:
        """Rebuild a candidate's profile from the seed + the chain of component edits (state stays small)."""
        chain = []
        c: dict[str, Any] | None = self.cand(cid)
        while c is not None and c["component"] != "seed":
            chain.append(c)
            c = self.cand(c["parent_candidate_id"]) if c["parent_candidate_id"] else None
        body = copy.deepcopy(self.seed_profile)
        for step in reversed(chain):
            body = set_path(body, step["component"], copy.deepcopy(step["value"]))
        body["parent_version"] = self.seed_profile.get("version")
        body["created_by"] = "optimizer"
        return body

    def _new(
        self, *, parent: str | None, component: str, value: Any, rationale: str, editor: dict[str, Any]
    ) -> dict[str, Any]:
        label = "seed" if component == "seed" else f"c{sum(1 for c in self.candidates if c['label'] != 'seed') + 1}"
        cand = {
            "id": stable_uuid(self.exp, label),
            "label": label,
            "iteration": self.state["iteration"],
            "parent_candidate_id": parent,
            "component": component,
            "value": value,
            "rationale": rationale,
            "editor_check": editor,
            "minibatch_score": None,
            "parent_minibatch_score": None,
            "val_scores": None,
            "val_mean": None,
            "cost_mean": None,
            "p95_ms": None,
            "on_front": False,
            "status": "evaluated",
            "created_at": iso(self.clock()),
        }
        self.candidates.append(cand)
        return cand

    def _spend(self, before: int) -> None:
        self.state["calls_used"] += self.ev.calls - before

    def _val_eval(self, cand: dict[str, Any]) -> None:
        before = self.ev.calls
        res = self.ev.evaluate(self.body(cand["id"]), self.val)
        self._spend(before)
        cand["val_scores"] = {cid: int(o.passed) for cid, o in sorted(res.items())}
        cand["val_mean"] = round(float(np.mean([o.passed for o in res.values()])), 4) if res else 0.0
        cand["cost_mean"] = round(float(np.mean([o.cost for o in res.values()])), 6) if res else 0.0
        cand["p95_ms"] = int(np.percentile([o.latency_ms for o in res.values()], 95)) if res else 0

    def _update_front(self) -> None:
        scored = {c["id"]: c["val_scores"] for c in self.candidates if c["val_scores"] is not None}
        members = pareto.front(scored)
        for c in self.candidates:
            c["on_front"] = c["id"] in members
        self.state["front"] = members
        best = max(
            (c for c in self.candidates if c["val_mean"] is not None),
            key=lambda c: (c["val_mean"], -(c["cost_mean"] or 0.0), -self.candidates.index(c)),
        )
        self.state["best"] = best["id"]

    def _minibatch(self, parent: str, rng: random.Random) -> list[dict[str, Any]]:
        known = getattr(self.ev, "cache", {}).get(profile_hash(self.body(parent)), {})
        failures = [c for c in self.train if c["case_id"] in known and not known[c["case_id"]].passed]
        rng.shuffle(failures)
        size = min(self.cfg.minibatch, len(self.train))
        batch = failures[: size // 2]
        rest = [c for c in self.train if c not in batch]
        rng.shuffle(rest)
        batch += rest[: size - len(batch)]
        return sorted(batch, key=lambda c: c["case_id"])

    def _few_shots(self, parent_body: dict[str, Any]) -> list[dict[str, Any]]:
        """Up to 4 passing TRAIN examples, diverse by tag, within the editor's length cap."""
        known = getattr(self.ev, "cache", {}).get(profile_hash(parent_body), {})
        current = parent_body.get("few_shots") or []
        budget = int(1.3 * len(json.dumps(current, ensure_ascii=False, sort_keys=True)) + 400)
        picked: list[dict[str, Any]] = []
        seen_tags: set[str] = set()
        for cid in sorted(known):
            o = known[cid]
            if not (o.passed and o.example) or set(o.tags) & seen_tags:
                continue
            example = {"input": str(o.example["input"])[:160], "output": str(o.example["output"])[:220]}
            if len(json.dumps([*picked, example], ensure_ascii=False, sort_keys=True)) > budget:
                continue
            picked.append(example)
            seen_tags |= set(o.tags)
            if len(picked) == 4:
                break
        return picked

    # main loop ----------------------------------------------------------------------------------------------
    def _save(self) -> None:
        export = getattr(self.ev, "export", None)
        if callable(export):
            self.state["cache"] = export()
        if self.on_save:
            self.on_save(self.state)

    def run_slice(self) -> SliceResult:
        st = self.state
        new: list[dict[str, Any]] = []
        st["night"] += 1
        night_start = st["calls_used"]
        try:
            if not self.candidates:
                seed = self._new(
                    parent=None,
                    component="seed",
                    value=None,
                    rationale="active profile",
                    editor={"passed": True, "checks": []},
                )
                self._val_eval(seed)
                self._update_front()
                new.append(seed)
                self._save()
            while True:
                if st["iteration"] >= self.cfg.max_iters:
                    return self._finish("max_iters", new)
                if st["no_improve"] >= self.cfg.patience:
                    return self._finish("patience", new)
                if st["calls_used"] >= self.cfg.budget_total:
                    return self._finish("budget_total", new)
                if st["calls_used"] - night_start >= self.cfg.nightly_calls:
                    st["stop_reason"] = "nightly_budget"
                    self._save()
                    return SliceResult("nightly_budget", False, new)
                new.append(self._iterate())
                self._save()
        except (RateLimited, BudgetExceeded) as exc:
            st["stop_reason"] = "rate_limited" if isinstance(exc, RateLimited) else "budget_exceeded"
            self._save()
            return SliceResult(st["stop_reason"], False, new)

    def _iterate(self) -> dict[str, Any]:
        st = self.state
        st["iteration"] += 1
        rng = random.Random(f"{self.cfg.seed}:{self.exp}:{st['iteration']}")
        scored = {c["id"]: c["val_scores"] for c in self.candidates if c["val_scores"] is not None}
        parent = pareto.sample_parent(scored, rng)
        component = self.components[st["round_robin"] % len(self.components)]
        st["round_robin"] += 1
        parent_body = self.body(parent)
        batch = self._minibatch(parent, rng)
        before = self.ev.calls
        r_parent = self.ev.evaluate(parent_body, batch)
        self._spend(before)
        feedback = [o.feedback for o in r_parent.values() if not o.passed and o.feedback]
        current = get_path(parent_body, component)
        if component == "few_shots":
            value, rationale = self._few_shots(parent_body), "passing TRAIN traces as examples, diverse by tag"
        else:
            proposal = self.reflector.propose(
                component=component, current=current, feedback=feedback, purpose=PURPOSES.get(component, component)
            )
            st["calls_used"] += 1
            value, rationale = proposal.new_text, proposal.rationale
        child_body = set_path(parent_body, component, copy.deepcopy(value))
        editor = check_edit(parent_body, child_body, optimizable=self.opt, locked=self.locked, batch_cases=batch)
        cand = self._new(parent=parent, component=component, value=value, rationale=rationale, editor=editor)
        entry: dict[str, Any] = {
            "iteration": st["iteration"],
            "parent": parent,
            "component": component,
            "child": cand["id"],
        }
        p_score = sum(o.passed for o in r_parent.values())
        cand["parent_minibatch_score"] = round(p_score / len(batch), 4) if batch else None
        if not editor["passed"]:
            cand["status"] = "rejected_editor"
            st["no_improve"] += 1
            entry.update(minibatch=[p_score, None], accepted=False)
            st["history"].append(entry)
            return cand
        before = self.ev.calls
        r_child = self.ev.evaluate(child_body, batch)
        self._spend(before)
        c_score = sum(o.passed for o in r_child.values())
        cand["minibatch_score"] = round(c_score / len(batch), 4) if batch else None
        entry["minibatch"] = [p_score, c_score]
        if c_score > p_score:
            prev_best = self.cand(st["best"])["val_mean"] if st["best"] else 0.0
            self._val_eval(cand)
            self._update_front()
            st["no_improve"] = 0 if cand["val_mean"] > prev_best else st["no_improve"] + 1
            entry["accepted"] = True
        else:
            cand["status"] = "rejected_minibatch"
            st["no_improve"] += 1
            entry["accepted"] = False
        st["history"].append(entry)
        return cand

    def _finish(self, reason: str, new: list[dict[str, Any]]) -> SliceResult:
        st = self.state
        st["stop_reason"] = reason
        if self.cfg.grid and not st["config_search"] and st["best"]:
            best_body = self.body(st["best"])

            def evaluate(profile: dict[str, Any]) -> dict[str, float]:
                before = self.ev.calls
                res = self.ev.evaluate(profile, self.val)
                self._spend(before)
                vals = list(res.values())
                return {
                    "val_mean": float(np.mean([o.passed for o in vals])),
                    "cost_mean": float(np.mean([o.cost for o in vals])),
                    "p95_ms": float(np.percentile([o.latency_ms for o in vals], 95)),
                }

            st["config_search"] = search(best_body, self.cfg.grid, evaluate)
        st["status"] = "finished"
        self._save()
        return SliceResult(reason, True, new)

    def run(self, max_slices: int = 10) -> SliceResult:
        result = SliceResult("not_started", False, [])
        for _ in range(max_slices):
            result = self.run_slice()
            if result.finished or result.stop_reason in ("rate_limited", "budget_exceeded"):
                break
        return result

    def best_body(self) -> dict[str, Any]:
        return self.body(self.state["best"])


def candidate_row(exp_id: str, cand: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """An `optimizer_candidates` row (CONTRACTS §6)."""
    return {
        "id": cand["id"],
        "experiment_id": exp_id,
        "parent_candidate_id": cand["parent_candidate_id"],
        "label": cand["label"],
        "iteration": cand["iteration"],
        "component": cand["component"],
        "body": body,
        "rationale": cand["rationale"],
        "editor_check": cand["editor_check"],
        "minibatch_score": cand["minibatch_score"],
        "parent_minibatch_score": cand["parent_minibatch_score"],
        "val_scores": cand["val_scores"],
        "val_mean": cand["val_mean"],
        "cost_mean": cand["cost_mean"],
        "on_front": cand["on_front"],
        "status": cand["status"],
        "created_at": cand["created_at"],
    }
