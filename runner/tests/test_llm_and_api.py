"""LLM ledger + providers and the control-plane client — all offline (httpx.MockTransport)."""

from __future__ import annotations

import io
import json
from datetime import date

import httpx
import pytest

from agentforge_runner.api_client import ControlPlane, ControlPlaneError, mask_secrets
from agentforge_runner.budget import BudgetExceeded, CallBudget, Ledger
from agentforge_runner.llm import FakeProvider, GroqProvider, InvalidJSON, LLMClient, RateLimited, parse_json_reply


def test_ledger_refuses_past_the_daily_cap(monkeypatch):
    monkeypatch.setenv("DAILY_CAP_PURPOSE_JUDGE", "2")
    ledger = Ledger(today=date(2026, 10, 8))
    llm = LLMClient(ledger=ledger, providers={"fake": FakeProvider()}, fake=True)
    for _ in range(2):
        llm.complete("judge", model="gemini-x", system="s", prompt="p")
    with pytest.raises(BudgetExceeded):
        llm.complete("judge", model="gemini-x", system="s", prompt="p")
    assert ledger.usage_rows()[0]["calls"] == 2 and ledger.usage_rows()[0]["day"] == "2026-10-08"


def test_model_cap(monkeypatch):
    monkeypatch.setenv("DAILY_CAP_OPENAI_GPT_OSS_20B", "1")
    ledger = Ledger()
    ledger.record("groq", "openai/gpt-oss-20b", "cheap_judge")
    with pytest.raises(BudgetExceeded):
        ledger.reserve("groq", "openai/gpt-oss-20b", "refusal")


def test_first_429_stops_the_client():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        assert request.headers["authorization"] == "Bearer test-key"
        return httpx.Response(429, json={"error": "rate"})

    groq = GroqProvider("test-key", http=httpx.Client(transport=httpx.MockTransport(handler)))
    llm = LLMClient(ledger=Ledger(), providers={"groq": groq})
    with pytest.raises(RateLimited):
        llm.complete("cheap_judge", model="openai/gpt-oss-20b", system="s", prompt="p")
    with pytest.raises(RateLimited):
        llm.complete("cheap_judge", model="openai/gpt-oss-20b", system="s", prompt="p")
    assert calls["n"] == 1 and llm.stopped


def test_json_validation_and_retry():
    fake = FakeProvider()
    fake.script("judge", "not json", '```json\n{"verdict": true}\n```')
    llm = LLMClient(ledger=Ledger(unlimited=True), providers={"fake": fake}, fake=True)
    assert llm.complete_json("judge", model="m", system="s", prompt="p", validate=lambda d: d["verdict"]) is True
    fake.script("judge", "nope", "still nope")
    with pytest.raises(InvalidJSON):
        llm.complete_json("judge", model="m", system="s", prompt="p", validate=lambda d: d["verdict"])
    assert parse_json_reply('prefix {"a": 1} suffix') == {"a": 1}


def test_call_budget():
    b = CallBudget(10)
    b.spend(7)
    assert b.remaining == 3 and not b.exhausted()
    b.spend(5)
    assert b.exhausted()


def _cp(handler) -> ControlPlane:
    return ControlPlane("https://af.example/api", "runner-secret", transport=httpx.MockTransport(handler), backoff_s=0)


def test_control_plane_auth_retries_and_batches():
    seen: list[tuple[str, str, int]] = []
    flaky = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer runner-secret"
        if request.url.path.endswith("/start") and flaky["n"] == 0:
            flaky["n"] += 1
            return httpx.Response(503)
        body = json.loads(request.content or b"{}")
        seen.append((request.method, request.url.path, len(body.get("results", []))))
        return httpx.Response(200, json={"ok": True})

    cp = _cp(handler)
    cp.start_run("r1", 42)
    cp.post_results("r1", [{"case_id": str(i)} for i in range(60)])
    assert [s[2] for s in seen if s[1].endswith("/results")] == [25, 25, 10]
    assert all(p.startswith("/api/v1/runner/") for _, p, _ in seen)


def test_control_plane_errors_do_not_echo_bodies():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"code": "unauthorized", "message": "key runner-secret is wrong"}})

    with pytest.raises(ControlPlaneError) as exc:
        _cp(handler).get_run("r1")
    assert "runner-secret" not in str(exc.value) and "unauthorized" in str(exc.value)


def test_mask_secrets_only_in_actions():
    out = io.StringIO()
    assert mask_secrets({"AF_RUNNER_KEY": "abc", "GROQ_API_KEY": "def"}, out) == 0
    n = mask_secrets({"GITHUB_ACTIONS": "true", "AF_RUNNER_KEY": "abc", "GROQ_API_KEY": "def"}, out)
    assert n == 2 and "::add-mask::abc" in out.getvalue() and "::add-mask::def" in out.getvalue()
