from __future__ import annotations

from agentforge_runner.datasets.splits import assign_split, bucket, split_for
from agentforge_runner.datasets.suites import load_suite
from agentforge_runner.datasets.versioning import content_hash, next_revision, suite_version, suite_version_hash
from agentforge_runner.redteam.mutators import mutate


def test_split_values_are_stable():
    # Values pinned so a platform/hash change cannot silently move cases between splits.
    assert bucket("toy-refund-small-eligible") == 7 and split_for("toy-refund-small-eligible") == "val"
    assert split_for("toy-refund-outside-window") == "test"
    assert split_for("toy-order-status") == "train"
    assert [split_for(f"case-{i}") for i in range(10)] == [split_for(f"case-{i}") for i in range(10)]


def test_case_files_carry_their_assigned_split(suites_dir):
    for suite in ("toy/scenario", "returnpilot/scenario", "returnpilot/regression"):
        for case in load_suite(suite, suites_dir):
            assert case["split"] == assign_split(case)


def test_redteam_families_never_cross_splits(suites_dir):
    seeds = [c for a in ("returnpilot", "datapilot", "toy") for c in load_suite(f"{a}/redteam", suites_dir)]
    by_family: dict[str, set[str]] = {}
    for seed in seeds:
        for case in [seed, *(m.case for m in mutate(seed, ["encode", "wrap"]))]:
            by_family.setdefault(case["family"], set()).add(case["split"])
            assert case["split"] == split_for(case["family"])
    assert all(len(s) == 1 for s in by_family.values())


def test_versioning():
    a = {"case_id": "x", "agent": "toy", "n": 1}
    b = {"n": 1, "agent": "toy", "case_id": "x"}
    assert content_hash(a) == content_hash(b)
    assert suite_version_hash([("b", "2"), ("a", "1")]) == suite_version_hash([("a", "1"), ("b", "2")])
    v = suite_version([a, {"case_id": "a", "agent": "toy"}])
    assert v["case_ids"] == ["a", "x"] and len(v["hash"]) == 64
    assert next_revision("rp-scn-001") == "rp-scn-001@2" and next_revision("rp-scn-001@2") == "rp-scn-001@3"
