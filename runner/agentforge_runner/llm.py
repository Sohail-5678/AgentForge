"""LLM providers for AgentForge's own work (judge, reflection, mutation, embeddings) + the daily ledger.

Providers: Gemini (REST, project `agentforge`), Groq (OpenAI-compatible REST) and `fake` (offline, deterministic).
Rules: every call is reserved in the ledger first (refused past the daily cap → `BudgetExceeded`); the first HTTP 429
stops the client for the rest of the process (we never retry into a rate limit); keys are read from the environment
at call time and never logged.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import logging
import os
import re
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol, TypeVar

import httpx
import numpy as np

from agentforge_runner.budget import BudgetExceeded, Ledger
from agentforge_runner.prices import provider_for

log = logging.getLogger(__name__)
T = TypeVar("T")

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:{op}"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
EMBED_DIM = 256


class RateLimited(RuntimeError):
    """A provider answered 429. The client stops; the caller saves state and resumes another day."""


class ProviderError(RuntimeError):
    pass


class InvalidJSON(ValueError):
    pass


@dataclass(frozen=True)
class Completion:
    text: str
    provider: str
    model: str
    tokens_in: int
    tokens_out: int


class Provider(Protocol):
    name: str

    def complete(self, *, model: str, system: str, prompt: str, json_mode: bool, temperature: float) -> Completion: ...

    def embed(self, *, model: str, texts: list[str]) -> list[list[float]]: ...


def _raise_for(resp: httpx.Response, provider: str) -> None:
    if resp.status_code == 429:
        raise RateLimited(f"{provider}: 429 rate limited")
    if resp.status_code >= 400:
        raise ProviderError(f"{provider}: HTTP {resp.status_code}")


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, http: httpx.Client | None = None) -> None:
        self._key = api_key
        self._http = http or httpx.Client(timeout=60)

    def _headers(self) -> dict[str, str]:
        # The key goes in a header, never in the URL, so it cannot end up in logged URLs.
        return {"x-goog-api-key": self._key, "content-type": "application/json"}

    def complete(self, *, model: str, system: str, prompt: str, json_mode: bool, temperature: float) -> Completion:
        body: dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature},
        }
        if json_mode:
            body["generationConfig"]["responseMimeType"] = "application/json"
        resp = self._http.post(GEMINI_URL.format(model=model, op="generateContent"), headers=self._headers(), json=body)
        _raise_for(resp, self.name)
        data = resp.json()
        parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        usage = data.get("usageMetadata") or {}
        return Completion(
            text, self.name, model, int(usage.get("promptTokenCount", 0)), int(usage.get("candidatesTokenCount", 0))
        )

    def embed(self, *, model: str, texts: list[str]) -> list[list[float]]:
        body = {"requests": [{"model": f"models/{model}", "content": {"parts": [{"text": t}]}} for t in texts]}
        resp = self._http.post(
            GEMINI_URL.format(model=model, op="batchEmbedContents"), headers=self._headers(), json=body
        )
        _raise_for(resp, self.name)
        return [e["values"] for e in resp.json().get("embeddings", [])]


class GroqProvider:
    name = "groq"

    def __init__(self, api_key: str, http: httpx.Client | None = None) -> None:
        self._key = api_key
        self._http = http or httpx.Client(timeout=60)

    def complete(self, *, model: str, system: str, prompt: str, json_mode: bool, temperature: float) -> Completion:
        body: dict[str, Any] = {
            "model": model,
            "temperature": temperature,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        resp = self._http.post(GROQ_URL, headers={"Authorization": f"Bearer {self._key}"}, json=body)
        _raise_for(resp, self.name)
        data = resp.json()
        usage = data.get("usage") or {}
        text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        return Completion(
            text, self.name, model, int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))
        )

    def embed(self, *, model: str, texts: list[str]) -> list[list[float]]:
        raise ProviderError("groq: embeddings are not used")


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def hashed_embedding(text: str, dim: int = EMBED_DIM) -> list[float]:
    """Deterministic bag-of-words (+ bigrams) embedding with signed feature hashing; L2-normalized.

    Used offline (fake provider, demo, tests) instead of a real embedding model.
    """
    vec = np.zeros(dim)
    words = _tokens(text)
    feats = words + [f"{a}_{b}" for a, b in itertools.pairwise(words)]
    for f in feats:
        h = int.from_bytes(hashlib.sha256(f.encode()).digest()[:8], "big")
        vec[h % dim] += 1.0 if (h >> 63) & 1 else -1.0
    norm = float(np.linalg.norm(vec))
    return (vec / norm).tolist() if norm else vec.tolist()


Responder = Callable[[str, str], str]


@dataclass
class FakeProvider:
    """Offline provider: scripted replies per purpose (FIFO), else a responder function, else an echo."""

    name: str = "fake"
    scripts: dict[str, deque[str]] = field(default_factory=dict)
    responders: dict[str, Responder] = field(default_factory=dict)
    calls: list[dict[str, str]] = field(default_factory=list)
    purpose: str = ""

    def script(self, purpose: str, *replies: str) -> None:
        self.scripts.setdefault(purpose, deque()).extend(replies)

    def complete(self, *, model: str, system: str, prompt: str, json_mode: bool, temperature: float) -> Completion:
        self.calls.append({"purpose": self.purpose, "model": model, "prompt": prompt})
        queue = self.scripts.get(self.purpose)
        if queue:
            text = queue.popleft()
        elif self.purpose in self.responders:
            text = self.responders[self.purpose](system, prompt)
        else:
            text = "{}" if json_mode else "ok"
        return Completion(text, self.name, model, max(1, len(system + prompt) // 4), max(1, len(text) // 4))

    def embed(self, *, model: str, texts: list[str]) -> list[list[float]]:
        return [hashed_embedding(t) for t in texts]


def parse_json_reply(text: str) -> dict[str, Any]:
    """Accept bare JSON or JSON inside a ```json fence; anything else is invalid."""
    raw = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.S)
    if fenced:
        raw = fenced.group(1)
    elif not raw.startswith("{"):
        start, end = raw.find("{"), raw.rfind("}")
        if start < 0 or end <= start:
            raise InvalidJSON("no JSON object in reply")
        raw = raw[start : end + 1]
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidJSON(str(exc)) from exc
    if not isinstance(data, dict):
        raise InvalidJSON("reply is not a JSON object")
    return data


@dataclass
class LLMClient:
    ledger: Ledger
    providers: dict[str, Provider]
    fake: bool = False
    stopped: bool = False

    @classmethod
    def from_env(cls, *, fake: bool = False, ledger: Ledger | None = None) -> LLMClient:
        ledger = ledger or Ledger.from_env()
        if fake:
            return cls(ledger=ledger, providers={"fake": FakeProvider()}, fake=True)
        providers: dict[str, Provider] = {}
        if key := os.environ.get("AF_GEMINI_API_KEY"):
            providers["gemini"] = GeminiProvider(key)
        if key := os.environ.get("GROQ_API_KEY"):
            providers["groq"] = GroqProvider(key)
        return cls(ledger=ledger, providers=providers)

    @property
    def available(self) -> bool:
        return bool(self.providers) and not self.stopped

    def _provider(self, model: str) -> Provider:
        if self.fake:
            return self.providers["fake"]
        name = provider_for(model)
        if name not in self.providers:
            raise ProviderError(f"no API key configured for provider {name}")
        return self.providers[name]

    def complete(
        self, purpose: str, *, model: str, system: str, prompt: str, json_mode: bool = False, temperature: float = 0.0
    ) -> Completion:
        if self.stopped:
            raise RateLimited("client stopped after an earlier 429")
        provider = self._provider(model)
        self.ledger.reserve(provider.name, model, purpose)
        if isinstance(provider, FakeProvider):
            provider.purpose = purpose
        try:
            out = provider.complete(
                model=model, system=system, prompt=prompt, json_mode=json_mode, temperature=temperature
            )
        except RateLimited:
            self.stopped = True
            self.ledger.record(provider.name, model, purpose)
            log.warning("provider %s rate limited; stopping LLM work for this run", provider.name)
            raise
        self.ledger.record(provider.name, model, purpose, out.tokens_in, out.tokens_out)
        return out

    def complete_json(
        self,
        purpose: str,
        *,
        model: str,
        system: str,
        prompt: str,
        validate: Callable[[dict[str, Any]], T],
        retries: int = 1,
    ) -> T:
        """JSON reply validated by `validate` (raise ValueError to reject); one retry on invalid output."""
        last: Exception | None = None
        for _ in range(retries + 1):
            out = self.complete(purpose, model=model, system=system, prompt=prompt, json_mode=True)
            try:
                return validate(parse_json_reply(out.text))
            except (InvalidJSON, ValueError, KeyError, TypeError) as exc:
                last = exc
        raise InvalidJSON(f"{purpose}: invalid JSON reply ({last})")

    def embed(self, texts: list[str], *, model: str, purpose: str = "embeddings") -> np.ndarray:
        provider = self._provider(model)
        self.ledger.reserve(provider.name, model, purpose)
        vectors = provider.embed(model=model, texts=texts)
        self.ledger.record(provider.name, model, purpose, sum(len(t) // 4 for t in texts), 0)
        return np.asarray(vectors, dtype=float)


__all__ = [
    "BudgetExceeded",
    "Completion",
    "FakeProvider",
    "GeminiProvider",
    "GroqProvider",
    "InvalidJSON",
    "LLMClient",
    "ProviderError",
    "RateLimited",
    "hashed_embedding",
    "parse_json_reply",
]
