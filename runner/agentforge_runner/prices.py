"""List prices (USD per 1M tokens) and model ids.

We pay $0 on free tiers; `list_price_cost_usd` = tokens × the provider's published paid price so cost improvements
are measurable (SPEC §S.2). The table matches the target agents' tables. Every model id is an env var (SPEC §S.1).
"""

from __future__ import annotations

import json
import os

# First (most specific) substring match wins, like DataPilot's llm/prices.py.
DEFAULT_PRICES: dict[str, tuple[float, float]] = {
    "flash-lite": (0.25, 1.50),
    "gemini-3-flash": (0.50, 3.00),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-flash": (0.50, 3.00),
    "embedding": (0.15, 0.0),
    "qwen": (0.29, 0.59),
    "gpt-oss-120b": (0.15, 0.60),
    "gpt-oss-20b": (0.075, 0.30),
    "prompt-guard": (0.03, 0.03),
}

MODEL_DEFAULTS: dict[str, str] = {
    "JUDGE_MODEL_DATAPILOT": "gemini-3-flash-preview",
    "JUDGE_MODEL_RETURNPILOT": "gemini-3-flash-preview",
    "JUDGE_MODEL_TOY": "gemini-3-flash-preview",
    "CHEAP_JUDGE_MODEL": "openai/gpt-oss-20b",
    "GUARD_MODEL": "meta-llama/llama-prompt-guard-2-86m",
    "REFLECTION_MODEL": "gemini-3-flash-preview",
    "MUTATION_MODEL": "gemini-3-flash-preview",
    "EMBED_MODEL": "gemini-embedding-001",
    # Target agents' own models (used by the demo simulator to label spans realistically).
    "RP_MAIN_MODEL": "gemini-3-flash-preview",
    "RP_FAST_MODEL": "openai/gpt-oss-120b",
    "RP_SMALL_MODEL": "openai/gpt-oss-20b",
    "DP_MAIN_MODEL": "gemini-3-flash-preview",
    "DP_LITE_MODEL": "gemini-3.1-flash-lite-preview",
    "DP_FAST_MODEL": "qwen/qwen3.8-27b",
    "TOY_MODEL": "openai/gpt-oss-20b",
}


def model_id(name: str) -> str:
    return os.environ.get(name) or MODEL_DEFAULTS[name]


def judge_model(agent: str) -> str:
    return model_id(f"JUDGE_MODEL_{agent.upper()}")


def price_table() -> dict[str, tuple[float, float]]:
    table = dict(DEFAULT_PRICES)
    raw = os.environ.get("PRICE_TABLE_JSON", "")
    if raw:
        table.update({k: (float(v[0]), float(v[1])) for k, v in json.loads(raw).items()})
    return table


def provider_for(model: str) -> str:
    return "gemini" if "gemini" in model.lower() else "groq"


def cost_usd(model: str | None, tokens_in: int, tokens_out: int) -> float:
    if not model:
        return 0.0
    m = model.lower()
    for key, (pin, pout) in price_table().items():
        if key in m:
            return (tokens_in * pin + tokens_out * pout) / 1_000_000
    return 0.0
