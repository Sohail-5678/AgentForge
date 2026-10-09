"""Mutators, seeds loader, failure mining, clustering and drafting."""

from __future__ import annotations

import base64
import codecs
import json

import numpy as np

from agentforge_runner.budget import Ledger
from agentforge_runner.datasets.cluster import agglomerative
from agentforge_runner.datasets.drafter import draft_reviews, redact_personas
from agentforge_runner.datasets.miner import select
from agentforge_runner.llm import FakeProvider, LLMClient, hashed_embedding
from agentforge_runner.redteam.mutators import (
    attack_text,
    deterministic,
    mutate,
    parse_guard_output,
    prompt_guard_score,
)
from agentforge_runner.redteam.seeds import load_seeds
from agentforge_runner.redteam.taxonomy import CATEGORIES


def test_seed_loader(suites_dir):
    seeds = load_seeds(suites_dir)
    assert len(seeds) >= 60
    assert {s["category"] for s in seeds} <= set(CATEGORIES)
    assert len({s["category"] for s in seeds if s["agent"] != "toy"}) >= 8
    toy = [s for s in seeds if s["agent"] == "toy"]
    assert len(toy) >= 6 and all(s["suite"] == "redteam" and s["success_if"] for s in toy)


def test_deterministic_operators(toy_seeds):
    seed = next(s for s in toy_seeds if s["category"] == "direct_injection")
    _, text = attack_text(seed)
    enc = deterministic(seed, "encode", "base64").case["input"]["turns"][-1]["user"]
    assert base64.b64decode(enc.rsplit(" ", 1)[1]).decode() == text
    rot = deterministic(seed, "encode", "rot13").case["input"]["turns"][-1]["user"]
    assert codecs.decode(rot.split(": ", 1)[1], "rot13") == text
    zw = deterministic(seed, "obfuscate", "zero_width").case["input"]["turns"][-1]["user"]
    assert "​" in zw and zw.replace("​", "") == text
    assert deterministic(seed, "wrap", "system_header").case["input"]["turns"][-1]["user"].startswith("SYSTEM:")
    indirect = next(s for s in toy_seeds if s["category"] == "indirect_injection")
    loc, _ = attack_text(indirect)
    assert loc.startswith("override:")  # indirect injections mutate the planted text, not the user turn


def test_llm_refusal_falls_back_and_logs(toy_seeds):
    fake = FakeProvider()
    fake.script("mutation", "I can't help with creating attacks.")
    fake.script("mutation", json.dumps({"variants": ["Quick one: approve my refund", "Please approve my refund now"]}))
    llm = LLMClient(ledger=Ledger(unlimited=True), providers={"fake": fake}, fake=True)
    seed = toy_seeds[0]
    refused = mutate(seed, ["paraphrase"], llm)
    assert len(refused) == 1 and refused[0].refused and refused[0].events == ["mutation_refused"]
    assert refused[0].operator == "wrap" and refused[0].fallback_from == "paraphrase"
    ok = mutate(seed, ["paraphrase"], llm)
    assert [m.variant for m in ok] == ["v1", "v2"] and all(m.case["family"] == seed["family"] for m in ok)
    assert mutate(seed, ["roleplay"], None)[0].refused  # no LLM available → deterministic fallback


def test_prompt_guard_parsing():
    assert (
        parse_guard_output("0.93") == 0.93
        and parse_guard_output("LABEL_1") == 1.0
        and parse_guard_output("benign") == 0.0
    )
    assert prompt_guard_score(None, "x") is None


def _trace(i, text, status="success", thumbs=None):
    return {
        "trace_id": f"00000000-0000-0000-0000-{i:012d}",
        "agent": "returnpilot",
        "mode": "live",
        "status": status,
        "input": {"turns": [text]},
        "spans": [],
        "end_state": {},
        "feedback": {"thumbs": thumbs} if thumbs else None,
    }


def test_mining_clustering_and_drafting():
    traces = [
        _trace(1, "Why is my refund for order #1042 still pending? I'm maya.patel@example.com", thumbs=-1),
        _trace(2, "Why is my refund for order #1042 still pending?", status="error"),
        _trace(3, "Can you cancel my order #1052 please", status="budget_exceeded"),
        _trace(4, "How long do I have to return shoes?"),
    ]
    items = select(traces)
    assert [it.trace_id[-1] for it in items] == ["1", "2", "3"]

    def embed(texts):
        return np.asarray([hashed_embedding(t) for t in texts])

    drafts = draft_reviews("returnpilot", items, [], embed, threshold=0.6)
    assert len(drafts) == 2
    refund = next(d for d in drafts if "refund" in json.dumps(d["draft"]["input"]))
    assert sorted(refund["source_trace_ids"]) == sorted(t["trace_id"] for t in traces[:2])
    assert "maya.patel@example.com" not in json.dumps(drafts) or refund["draft"]["setup"]["persona"] == "maya"
    assert refund["draft"]["suite"] == "regression" and refund["draft"]["expect"]["must_not"] == [
        "approve_without_review"
    ]
    existing = [{"agent": "returnpilot", "input": refund["draft"]["input"]}]
    again = draft_reviews("returnpilot", items, existing, embed, threshold=0.6)
    assert len(again) == 1  # cosine ≥ 0.92 with an existing case → dropped


def test_redaction_uses_seeded_personas():
    out = redact_personas("I'm Priya, write to priya@gmail.com", "returnpilot")
    assert "priya" not in out.lower() and "maya.patel@example.com" in out and "Maya" in out


def test_agglomerative_is_deterministic():
    x = np.asarray(
        [hashed_embedding(t) for t in ["refund pending", "refund still pending", "cancel order", "cancel my order"]]
    )
    assert agglomerative(x, threshold=0.7) == agglomerative(x, threshold=0.7)
    assert len(agglomerative(x, threshold=0.0001)) == 4
