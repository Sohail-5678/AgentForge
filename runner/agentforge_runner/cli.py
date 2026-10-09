"""`af-run` — the AgentForge runner CLI (CONTRACTS §8)."""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import tempfile
from pathlib import Path
from typing import Any

from agentforge_runner import __version__
from agentforge_runner.api_client import ControlPlane, mask_secrets
from agentforge_runner.datasets.suites import find_suites_dir, load_jsonl, load_suite
from agentforge_runner.execute import RunOutput, execute
from agentforge_runner.graders.judge import LLMJudge
from agentforge_runner.llm import LLMClient
from agentforge_runner.summary import build_summary
from agentforge_runner.targets.datasets import ensure_bird, needs_bird
from agentforge_runner.targets.local_adapter import toy_target, toy_workdir
from agentforge_runner.targets.subprocess_adapter import SubprocessTarget, TargetSpec

log = logging.getLogger("af-run")
AGENT_LOCKED = {"toy": ["approval_threshold", "guardrails", "policy", "tool_permissions"]}
TOY_OPTIMIZABLE = {
    "paths": [
        "prompts.system",
        "tool_descriptions.get_order",
        "tool_descriptions.check_eligibility",
        "tool_descriptions.issue_refund",
        "few_shots",
        "params.self_consistency_k",
        "params.temperature",
    ],
    "param_ranges": {"self_consistency_k": [1, 3], "temperature": [0, 0.7], "max_steps": [4, 10]},
}


def _write(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")


def _profile(agent: str, path: str | None) -> dict[str, Any]:
    if path:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    if agent == "toy":
        return json.loads((toy_workdir() / "toy_agent" / "profiles" / "default.json").read_text())
    raise SystemExit(f"--profile is required for agent {agent}")


def _judge(agent: str, fake: bool) -> LLMJudge | None:
    llm = LLMClient.from_env(fake=fake)
    if fake:
        from agentforge_runner.graders.judge import fake_responders
        from agentforge_runner.llm import FakeProvider

        llm.providers["fake"] = FakeProvider(responders=fake_responders())
    return LLMJudge(llm, agent) if llm.available else None


def _local_target(agent: str) -> Any:
    if agent != "toy":
        raise SystemExit("local mode runs the bundled toy agent; real targets run through the control plane (--run-id)")
    return toy_target()


def _report(out: RunOutput, cases: list[dict[str, Any]], args: argparse.Namespace, **kw: Any) -> dict[str, Any]:
    by_id = {c["case_id"]: c for c in cases}
    summary = build_summary(
        out.results,
        by_id,
        attempts=getattr(args, "attempts", 1),
        budget=out.budget(),
        fake_llm=bool(getattr(args, "fake_llm", False)),
        **kw,
    )
    if args.out:
        d = Path(args.out)
        d.mkdir(parents=True, exist_ok=True)
        (d / "results.jsonl").write_text("".join(json.dumps(r.as_row()) + "\n" for r in out.results), encoding="utf-8")
        _write(d / "summary.json", summary)
    rt = summary.get("redteam") or {}
    print(
        f"pass {summary['passed']}/{len(out.results) if not rt else summary['n_results'] - rt.get('n', 0)} "
        f"({summary['pass_rate']:.0%}, 95% CI {summary['ci'][0]:.0%}–{summary['ci'][1]:.0%})"
        + (f" · ASR {rt['asr']:.1%} ({rt['succeeded']}/{rt['n']})" if rt else "")
        + f" · cost/case ${summary['cost']['mean_list_price_usd']:.6f}"
    )
    return summary


# ------------------------------------------------------------------------------------------------ suite


def cmd_suite(args: argparse.Namespace) -> int:
    if args.run_id:
        return _suite_control_plane(args)
    if not args.agent or not args.suite:
        raise SystemExit("local mode needs --agent and --suite (or use --run-id)")
    cases = [c for s in args.suite.split(",") for c in load_suite(s)]
    cases = cases[: args.limit] if args.limit else cases
    out = execute(
        _local_target(args.agent),
        cases,
        _profile(args.agent, args.profile),
        attempts=args.attempts,
        fake_llm=args.fake_llm,
        judge=_judge(args.agent, args.fake_llm),
        budget_calls=args.budget_calls,
    )
    _report(out, cases, args)
    return 0


def _suite_control_plane(args: argparse.Namespace) -> int:
    mask_secrets()
    cp = ControlPlane.from_env()
    cfg = cp.get_run(args.run_id)
    agent = cfg["agent"] if isinstance(cfg["agent"], str) else cfg["agent"]["id"]
    gh = os.environ.get("GITHUB_RUN_ID")
    cp.start_run(args.run_id, int(gh) if gh and gh.isdigit() else None)
    try:
        with cp.heartbeats(args.run_id), tempfile.TemporaryDirectory(prefix="af-work-") as work:
            if needs_bird(agent, cfg["cases"]):
                # DataPilot's BIRD cases read the Mini-Dev databases (the job caches AF_BIRD_CACHE between runs).
                cache = Path(os.environ.get("AF_BIRD_CACHE") or Path(tempfile.gettempdir()) / "af-bird")
                os.environ["BIRD_DIR"] = str(ensure_bird(cache, Path(work)))
            target = (
                toy_target()
                if agent == "toy"
                else SubprocessTarget(TargetSpec.from_run_config(agent, cfg["target"]), Path(work))
            )
            judge_info = cfg.get("judge") or {}
            judge = _judge(agent, bool(cfg.get("fake_llm")))
            out = execute(
                target,
                cfg["cases"],
                cfg["profile"],
                attempts=int(cfg.get("attempts", 1)),
                budget_calls=cfg.get("budget_calls"),
                fake_llm=bool(cfg.get("fake_llm")),
                canaries=cfg.get("canaries") or None,
                judge=judge,
                judge_calibrated=bool(judge_info.get("calibrated")),
            )
            cp.post_results(args.run_id, [r.as_row() for r in out.results])
            by_id = {c["case_id"]: c for c in cfg["cases"]}
            baseline = cfg.get("baseline")
            summary = build_summary(
                out.results,
                by_id,
                attempts=int(cfg.get("attempts", 1)),
                budget=out.budget(),
                baseline=(baseline["run_id"], baseline["passed"]) if baseline else None,
                judge=judge_info or None,
                fake_llm=bool(cfg.get("fake_llm")),
            )
            cp.finish_run(args.run_id, summary=summary)
            if judge is not None and not judge.llm.fake:
                cp.post_usage(judge.llm.ledger.usage_rows())
    except Exception as exc:
        cp.finish_run(args.run_id, error=f"{type(exc).__name__}")
        raise
    return 0


# ------------------------------------------------------------------------------------------------ redteam


def cmd_redteam(args: argparse.Namespace) -> int:
    from agentforge_runner.redteam.mutators import mutate, prompt_guard_score

    seeds = load_suite(f"{args.agent}/redteam")
    llm = LLMClient.from_env(fake=args.fake_llm)
    cases = list(seeds)
    events = []
    if args.mutate:
        for seed in seeds:
            for m in mutate(
                seed, [o.strip() for o in args.mutate.split(",") if o.strip()], None if args.fake_llm else llm
            ):
                cases.append(m.case)
                events += [{"case_id": m.case["case_id"], "event": e} for e in m.events]
    out = execute(
        _local_target(args.agent),
        cases,
        _profile(args.agent, args.profile),
        fake_llm=args.fake_llm,
        judge=_judge(args.agent, args.fake_llm),
        rng=random.Random(args.seed),
    )
    scores = {c["case_id"]: prompt_guard_score(None if args.fake_llm else llm, json.dumps(c["input"])) for c in cases}
    summary = _report(out, cases, args, guard_scores=scores)
    if args.out and events:
        _write(Path(args.out) / "mutation_events.json", events)
    return 0 if summary else 1


# ------------------------------------------------------------------------------------------------ optimize / gate


def _toy_experiment(args: argparse.Namespace) -> tuple[Any, list[dict[str, Any]], dict[str, Any]]:
    from agentforge_runner.optimizer.editor import OptimizableKeys
    from agentforge_runner.optimizer.gepa_lite import GepaLite, OptimizerConfig, TargetEvaluator
    from agentforge_runner.optimizer.reflection import LLMReflection
    from agentforge_runner.optimizer.scripts import toy_script

    cases = load_suite("toy/scenario")
    seed = _profile("toy", args.profile)
    reflector = toy_script() if args.scripted_reflection else LLMReflection(LLMClient.from_env())
    opt = GepaLite(
        experiment_id="local-toy",
        seed_profile=seed,
        train=[c for c in cases if c["split"] == "train"],
        val=[c for c in cases if c["split"] == "val"],
        evaluator=TargetEvaluator(toy_target(), fake_llm=True),
        reflector=reflector,
        optimizable=OptimizableKeys.from_agent(TOY_OPTIMIZABLE),
        locked=AGENT_LOCKED["toy"],
        config=OptimizerConfig(
            components=["prompts.system", "tool_descriptions.issue_refund", "few_shots"],
            max_iters=args.max_iters,
            patience=3,
            grid={"params.self_consistency_k": [1, 2, 3]},
        ),
    )
    return opt, cases, seed


def cmd_optimize(args: argparse.Namespace) -> int:
    if args.experiment_id:
        raise SystemExit(
            "control-plane experiments: run `af-run optimize --experiment-id` from optimize.yml with "
            "AF_API_URL/AF_RUNNER_KEY set; local mode: --agent toy --local"
        )
    if args.agent != "toy":
        raise SystemExit("local optimizer runs use the toy agent (--agent toy --local)")
    opt, _, _ = _toy_experiment(args)
    result = opt.run()
    for c in opt.candidates:
        print(f"{c['label']:>5} {c['component']:<32} {c['status']:<19} val={c['val_mean']} front={c['on_front']}")
    best = opt.cand(opt.state["best"])
    print(f"stop: {result.stop_reason} · best {best['label']} val={best['val_mean']} · calls {opt.state['calls_used']}")
    if args.out:
        _write(Path(args.out) / "state.json", opt.state)
        _write(Path(args.out) / "best_profile.json", opt.best_body())
    return 0


def cmd_gate(args: argparse.Namespace) -> int:
    from agentforge_runner.optimizer.promotion import run_gate

    if args.candidate_id:
        raise SystemExit(
            "control-plane gate runs are created by POST /api/v1/promotions and executed with "
            "`af-run suite --run-id`; use --agent toy --local --candidate FILE for a local gate"
        )
    seeds = load_suite("toy/redteam")
    cases = [c for c in load_suite("toy/scenario") if c["split"] == "test"]
    outcome = run_gate(
        toy_target(),
        baseline_profile=_profile("toy", args.baseline),
        candidate_profile=_profile("toy", args.candidate),
        test_cases=cases,
        redteam_cases=seeds,
        fake_llm=True,
        rng=random.Random(args.seed),
    )
    report = outcome.report
    for c in report["checks"]:
        print(f"{'PASS' if c['passed'] else 'FAIL'} {c['name']:<12} {c['detail']}")
    print(f"gate: {'passed' if report['passed'] else 'rejected'} (path: {report['path']})")
    if args.out:
        _write(Path(args.out) / "gate_report.json", report)
    return 0 if report["passed"] else 1


# ------------------------------------------------------------------------------------------------ misc


def cmd_calibrate(args: argparse.Namespace) -> int:
    from agentforge_runner.stats.kappa import calibration_report

    labels = [
        x
        for x in load_jsonl(Path(args.labels))
        if x.get("agent_id", args.agent) == args.agent and x.get("accepted", True)
    ]
    pairs = [(bool(x["human_verdict"]), bool(x["judge_verdict"])) for x in labels if x.get("judge_verdict") is not None]
    report = calibration_report([h for h, _ in pairs], [j for _, j in pairs])
    print(json.dumps(report, indent=2))
    return 0


def cmd_mine(args: argparse.Namespace) -> int:
    from agentforge_runner.datasets.drafter import draft_reviews
    from agentforge_runner.datasets.miner import select

    llm = LLMClient.from_env(fake=args.fake_llm)
    traces = load_jsonl(Path(args.traces))
    existing = [c for f in (args.cases or []) for c in load_jsonl(Path(f))]

    def embed(texts: list[str]) -> Any:
        from agentforge_runner.prices import model_id

        return llm.embed(texts, model=model_id("EMBED_MODEL"))

    drafts = draft_reviews(args.agent, select(traces), existing, embed, llm=None if args.fake_llm else llm)
    if args.post:
        ControlPlane.from_env().post_reviews(drafts)
    print(json.dumps(drafts, indent=2) if not args.out else f"{len(drafts)} draft(s)")
    if args.out:
        _write(Path(args.out), drafts)
    return 0


def cmd_info(args: argparse.Namespace) -> int:
    """Tell the workflow which agent a run targets (and whether it needs the BIRD cache) before it runs."""
    cfg = ControlPlane.from_env().get_run(args.run_id)
    agent = cfg["agent"] if isinstance(cfg["agent"], str) else cfg["agent"]["id"]
    lines = [f"agent={agent}", f"needs_bird={'true' if needs_bird(agent, cfg['cases']) else 'false'}"]
    out = os.environ.get("GITHUB_OUTPUT") if args.github_output else None
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 0


def cmd_request(args: argparse.Namespace) -> int:
    """Ask the control plane for a run (it snapshots the suites and dispatches run-suite.yml)."""
    body: dict[str, Any] = {"agent": args.agent, "trigger": "manual", "attempts": args.attempts}
    if args.suites:
        body["suites"] = [s.strip() for s in args.suites.split(",") if s.strip()]
    if args.split:
        body["split"] = args.split
    if args.budget_calls:
        body["budget_calls"] = args.budget_calls
    if args.profile_version:
        body["profile_version"] = args.profile_version
    run_id = ControlPlane.from_env().create_run(body)
    print(f"{args.agent}: run {run_id}")
    return 0


def cmd_nightly(args: argparse.Namespace) -> int:
    cp = ControlPlane.from_env()
    for agent in args.agents.split(","):
        budget = int(os.environ.get(f"NIGHTLY_CALLS_{agent.upper()}", "300"))
        # Suites are chosen by the control plane (§4.3): the agent's regression suite (or its scenario/benchmark
        # suites when it has none, e.g. the toy agent) plus the red-team seed set.
        run_id = cp.create_run(
            {
                "agent": agent,
                "trigger": "nightly",
                "attempts": 1,
                "budget_calls": budget,
            }
        )
        print(f"{agent}: nightly run {run_id}")
    return 0


def cmd_power(args: argparse.Namespace) -> int:
    from agentforge_runner.stats.power import power_report

    print(json.dumps(power_report(args.n, baseline=args.baseline, break_rate=args.break_rate), indent=2))
    return 0


def cmd_demo(args: argparse.Namespace) -> int:
    from agentforge_runner.demo.generate import write_snapshot

    path, size, counts = write_snapshot(Path(args.out), seed=args.seed, suites_dir=find_suites_dir())
    print(f"wrote {path} ({size / 1_000_000:.2f} MB)")
    for table, n in counts.items():
        print(f"  {table:<22} {n}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="af-run", description="AgentForge runner (execution plane)")
    ap.add_argument("--version", action="version", version=f"af-run {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser(
        "suite", help="run suites (control plane: --run-id; local: --agent toy --suite toy/scenario --local)"
    )
    s.add_argument("--run-id")
    s.add_argument("--agent")
    s.add_argument("--suite", help="comma-separated suite ids, e.g. toy/scenario,toy/redteam")
    s.add_argument("--local", action="store_true")
    s.add_argument("--profile")
    s.add_argument("--fake-llm", action="store_true")
    s.add_argument("--limit", type=int)
    s.add_argument("--attempts", type=int, default=1)
    s.add_argument("--budget-calls", type=int)
    s.add_argument("--out")
    s.set_defaults(fn=cmd_suite)

    r = sub.add_parser("redteam", help="seed attacks (+ mutations) against an agent")
    r.add_argument("--agent", required=True)
    r.add_argument("--local", action="store_true")
    r.add_argument("--mutate", default="")
    r.add_argument("--fake-llm", action="store_true")
    r.add_argument("--profile")
    r.add_argument("--seed", type=int, default=7)
    r.add_argument("--out")
    r.set_defaults(fn=cmd_redteam)

    o = sub.add_parser("optimize", help="GEPA-lite experiment slice")
    o.add_argument("--experiment-id")
    o.add_argument("--agent")
    o.add_argument("--local", action="store_true")
    o.add_argument("--scripted-reflection", action="store_true")
    o.add_argument("--profile")
    o.add_argument("--max-iters", type=int, default=8)
    o.add_argument("--out")
    o.set_defaults(fn=cmd_optimize)

    g = sub.add_parser("gate", help="promotion gate: TEST × pass^2 + red-team core → gate report")
    g.add_argument("--candidate-id")
    g.add_argument("--agent", default="toy")
    g.add_argument("--local", action="store_true")
    g.add_argument("--candidate", help="candidate profile.v1 file (local)")
    g.add_argument("--baseline", help="active profile.v1 file (local; default: toy default)")
    g.add_argument("--seed", type=int, default=7)
    g.add_argument("--out")
    g.set_defaults(fn=cmd_gate)

    c = sub.add_parser("calibrate", help="Cohen's kappa from accepted judge labels")
    c.add_argument("--agent", required=True)
    c.add_argument("--labels", required=True, help="jsonl of {human_verdict, judge_verdict}")
    c.set_defaults(fn=cmd_calibrate)

    m = sub.add_parser("mine", help="failure mining → review drafts")
    m.add_argument("--agent", required=True)
    m.add_argument("--traces", required=True, help="jsonl of trace.v1")
    m.add_argument("--cases", nargs="*", help="existing case files for dedupe")
    m.add_argument("--fake-llm", action="store_true")
    m.add_argument("--post", action="store_true", help="submit drafts to the control plane")
    m.add_argument("--out")
    m.set_defaults(fn=cmd_mine)

    i = sub.add_parser("info", help="which agent a run targets (for workflow conditionals)")
    i.add_argument("--run-id", required=True)
    i.add_argument("--github-output", action="store_true", help="also append to $GITHUB_OUTPUT")
    i.set_defaults(fn=cmd_info)

    q = sub.add_parser("request", help="request a manual run of chosen suites via the API")
    q.add_argument("--agent", required=True, choices=["datapilot", "returnpilot", "toy"])
    q.add_argument("--suites", help="comma-separated suite ids (default: the control plane's choice)")
    q.add_argument("--split", choices=["train", "val", "test"], help="only cases of this split")
    q.add_argument("--attempts", type=int, default=1)
    q.add_argument("--budget-calls", type=int)
    q.add_argument("--profile-version", type=int, help="profile version to run (default: the active one)")
    q.set_defaults(fn=cmd_request)

    n = sub.add_parser("nightly", help="create nightly runs via the API")
    n.add_argument("--agents", default="datapilot,returnpilot")
    n.set_defaults(fn=cmd_nightly)

    p = sub.add_parser("power", help="power simulation for a paired McNemar test")
    p.add_argument("--n", type=int, default=50)
    p.add_argument("--baseline", type=float, default=0.7)
    p.add_argument("--break-rate", type=float, default=0.08)
    p.set_defaults(fn=cmd_power)

    d = sub.add_parser("demo", help="write the demo snapshot (CONTRACTS §7)")
    d.add_argument("--out", required=True)
    d.add_argument("--seed", type=int, default=7)
    d.set_defaults(fn=cmd_demo)
    return ap


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=os.environ.get("AF_LOG_LEVEL", "WARNING"), format="%(levelname)s %(name)s: %(message)s")
    args = build_parser().parse_args(argv)
    return int(args.fn(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
