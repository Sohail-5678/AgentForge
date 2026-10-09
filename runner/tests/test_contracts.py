"""Pydantic models ⇄ JSON Schemas (schemas/*.json): documents produced by the runner validate against both."""

from __future__ import annotations

from datetime import UTC, datetime

import jsonschema
import pytest

from agentforge_runner.contracts import Case, Profile, Trace, validate_case, validate_profile, validate_trace
from agentforge_runner.datasets.suites import load_suite
from agentforge_runner.demo.world import load_profile
from agentforge_runner.redteam.mutators import mutate
from agentforge_runner.targets.local_adapter import toy_target
from agentforge_runner.targets.simulated import SimulatedTarget

SUITES = [
    "toy/scenario",
    "toy/redteam",
    "returnpilot/scenario",
    "returnpilot/regression",
    "returnpilot/redteam",
    "datapilot/benchmark",
    "datapilot/regression",
    "datapilot/redteam",
]


def test_required_fields_match_schemas(schemas):
    for model, name in ((Trace, "trace"), (Profile, "profile"), (Case, "case")):
        required = {k for k, f in model.model_fields.items() if f.is_required()}
        assert set(schemas[name]["required"]) <= required | {"contract_version"}


@pytest.mark.parametrize("suite", SUITES)
def test_suite_cases_validate(suite, suites_dir, schemas):
    for case in load_suite(suite, suites_dir):
        jsonschema.validate(case, schemas["case"])
        validate_case(case)


def test_profiles_validate(schemas, vulnerable, hardened):
    for p in (
        vulnerable,
        hardened,
        *(load_profile(n) for n in ("returnpilot_v1", "returnpilot_v2", "datapilot_v1", "datapilot_v2")),
    ):
        jsonschema.validate(p, schemas["profile"])
        validate_profile(p)


def test_toy_and_simulated_traces_validate(toy_cases, vulnerable, suites_dir, schemas):
    traces = [r.trace for r in toy_target().run(toy_cases, vulnerable, fake_llm=True)]
    for agent, suite, profile in (
        ("returnpilot", "returnpilot/scenario", "returnpilot_v2"),
        ("datapilot", "datapilot/regression", "datapilot_v2"),
    ):
        cases = load_suite(suite, suites_dir)[:15] + load_suite(f"{agent}/redteam", suites_dir)[:10]
        sim = SimulatedTarget(agent, run_seed="schema", started_at=datetime(2026, 10, 1, tzinfo=UTC))
        traces += [r.trace for r in sim.run(cases, load_profile(profile))]
    for t in traces:
        jsonschema.validate(t, schemas["trace"])
        validate_trace(t)


def test_mutations_validate(suites_dir, schemas):
    seed = load_suite("returnpilot/redteam", suites_dir)[0]
    for m in mutate(seed, ["encode", "obfuscate", "wrap"]):
        jsonschema.validate(m.case, schemas["case"])
        assert m.case["family"] == seed["family"] and m.case["split"] == seed["split"]
