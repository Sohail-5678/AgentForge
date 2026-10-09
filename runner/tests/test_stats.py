"""Statistics against textbook values and a coverage simulation (SPEC §7, §13.1)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from scipy.stats import binomtest

from agentforge_runner.stats.crosscheck import build_fixture
from agentforge_runner.stats.intervals import rate_block, wilson
from agentforge_runner.stats.kappa import calibration_report, cohen_kappa
from agentforge_runner.stats.paired import compare, mcnemar_exact, paired_bootstrap
from agentforge_runner.stats.passk import pass_hat_k, pass_k
from agentforge_runner.stats.power import minimum_detectable_effect, power_at


@pytest.mark.parametrize(
    ("k", "n", "lo", "hi"),
    [
        (8, 10, 0.4902, 0.9433),
        (0, 10, 0.0, 0.2775),
        (10, 10, 0.7225, 1.0),
        (41, 50, 0.6920, 0.9023),
        (1, 50, 0.0035, 0.1050),
    ],
)
def test_wilson_textbook(k, n, lo, hi):
    a, b = wilson(k, n)
    assert a == pytest.approx(lo, abs=6e-4) and b == pytest.approx(hi, abs=6e-4)


def test_wilson_empty_and_block():
    assert wilson(0, 0) == (0.0, 1.0)
    assert rate_block(41, 50) == {"n": 50, "passed": 41, "rate": 0.82, "ci": [0.692, 0.9023]}


@pytest.mark.parametrize(
    ("b", "c", "p"), [(1, 8, 0.0390625), (0, 6, 0.03125), (0, 5, 0.0625), (3, 3, 1.0), (0, 0, 1.0)]
)
def test_mcnemar_textbook(b, c, p):
    assert mcnemar_exact(b, c) == pytest.approx(p, abs=1e-12)
    if b + c:
        assert mcnemar_exact(b, c) == pytest.approx(binomtest(min(b, c), b + c, 0.5).pvalue, abs=1e-12)


def test_compare_lists_newly_failing_and_passing():
    base = {"a": True, "b": True, "c": False, "d": False, "x": True}
    cand = {"a": True, "b": False, "c": True, "d": True, "y": False}
    out = compare(base, cand)
    assert out["shared"] == 4 and out["b"] == 1 and out["c"] == 2
    assert out["newly_failing"] == ["b"] and out["newly_passing"] == ["c", "d"]
    assert out["diff"] == 0.25


def test_bootstrap_is_seeded():
    a, b = [1, 0, 1, 1, 0] * 8, [1, 1, 1, 1, 0] * 8
    assert paired_bootstrap(a, b) == paired_bootstrap(a, b)


def test_bootstrap_coverage_simulation():
    """1,000 simulated paired datasets with a known +10-point difference: the 95% CI covers it ~95% of the time."""
    rng = np.random.default_rng(2026)
    probs = [0.60, 0.05, 0.15, 0.20]  # (1,1), (1,0), (0,1), (0,0) → true diff = 0.15 − 0.05
    pairs = np.array([(1, 1), (1, 0), (0, 1), (0, 0)])
    covered = 0
    for i in range(1000):
        idx = rng.choice(4, size=80, p=probs)
        base, cand = pairs[idx, 0], pairs[idx, 1]
        lo, hi = paired_bootstrap(base, cand, resamples=500, seed=i)
        covered += lo <= 0.10 <= hi
    assert 0.92 <= covered / 1000 <= 0.98


def test_kappa_textbook():
    human = [True] * 20 + [False] * 5 + [True] * 10 + [False] * 15
    judge = [True] * 25 + [False] * 25
    kappa, agreement = cohen_kappa(human, judge)
    assert kappa == pytest.approx(0.4) and agreement == pytest.approx(0.7)
    rep = calibration_report(human, judge)
    assert rep["confusion"] == {
        "tp": 20,
        "fp": 5,
        "fn": 10,
        "tn": 15,
    }
    assert rep["calibrated"] is False
    assert cohen_kappa([True, False] * 30, [True, False] * 30)[0] == pytest.approx(1.0)
    assert calibration_report([True, False] * 30, [True, False] * 30)["calibrated"] is True


def test_pass_k():
    assert pass_hat_k(5, 3, 2) == pytest.approx(0.3)
    out = pass_k({"a": [True, True], "b": [True, False], "c": [True]}, 2)
    assert out is not None and out["n"] == 2 and out["passed_all"] == 1 and out["rate"] == 0.5


def test_power_matches_the_spec_table():
    assert power_at(50, 0.10, sims=3000) < 0.35
    assert power_at(150, 0.10, sims=3000) > 0.6
    assert power_at(400, 0.10, sims=3000) > 0.95
    mde = minimum_detectable_effect(50, sims=2000)
    assert mde is not None and 0.18 <= mde <= 0.26


def test_crosscheck_fixture_is_current():
    path = Path(__file__).parent / "fixtures" / "stats_crosscheck.json"
    assert json.loads(path.read_text()) == json.loads(json.dumps(build_fixture()))
