from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from agentforge_runner.budget import Ledger
from agentforge_runner.datasets.suites import find_suites_dir, load_suite
from agentforge_runner.graders.judge import LLMJudge, fake_responders
from agentforge_runner.llm import FakeProvider, LLMClient
from agentforge_runner.optimizer.scripts import toy_profile

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def suites_dir() -> Path:
    return find_suites_dir(REPO)


@pytest.fixture(scope="session")
def snapshot(suites_dir: Path) -> dict[str, Any]:
    from agentforge_runner.demo.generate import build_snapshot

    return build_snapshot(7, suites_dir)


@pytest.fixture(scope="session")
def schemas() -> dict[str, Any]:
    return {n: json.loads((REPO / "schemas" / f"{n}.v1.json").read_text()) for n in ("trace", "profile", "case")}


@pytest.fixture
def toy_cases(suites_dir: Path) -> list[dict[str, Any]]:
    return load_suite("toy/scenario", suites_dir)


@pytest.fixture
def toy_seeds(suites_dir: Path) -> list[dict[str, Any]]:
    return load_suite("toy/redteam", suites_dir)


@pytest.fixture
def vulnerable() -> dict[str, Any]:
    return toy_profile("vulnerable")


@pytest.fixture
def hardened() -> dict[str, Any]:
    return toy_profile("hardened")


def offline_judge(agent: str) -> LLMJudge:
    llm = LLMClient(
        ledger=Ledger(unlimited=True), providers={"fake": FakeProvider(responders=fake_responders())}, fake=True
    )
    return LLMJudge(llm, agent)


@pytest.fixture
def judge_factory():
    return offline_judge
