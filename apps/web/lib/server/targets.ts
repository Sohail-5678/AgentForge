import type { Agent } from "@/lib/types";

/**
 * How the execution plane installs and configures each real target inside the GitHub Actions job (SPEC §6.1–6.3).
 * Code is the source of truth for install steps; `agents.config.env` can add plain settings on top. Secrets never go
 * here — provider keys reach the target through the runner's key map (DP_/RP_GEMINI_API_KEY, GROQ_API_KEY).
 */
const DEFAULTS: Record<string, { install: string; env: Record<string, string> }> = {
  datapilot: {
    // Python deps, the demo databases (release asset, 17 MB) and the Node Pyodide sandbox used for analysis steps.
    install: 'bash -c "uv sync --frozen && uv run --frozen python scripts/fetch_dbs.py && cd ../sandbox && npm ci --no-audit --no-fund"',
    env: {
      FAKE_LLM: "false",
      APP_ENV: "ci",
      // DataPilot's own daily ledger defaults are sized for the live demo; the provider's free limits still apply.
      DAILY_BUDGET_FAST_REQUESTS: "900",
      DAILY_BUDGET_FAST_TOKENS: "190000",
      DAILY_BUDGET_MAIN_REQUESTS: "450",
      DAILY_BUDGET_LITE_REQUESTS: "900",
    },
  },
  returnpilot: {
    install: "uv sync --frozen",
    env: {
      FAKE_LLM: "false",
      DAILY_BUDGET_FAST_REQUESTS: "900",
      DAILY_BUDGET_FAST_TOKENS: "190000",
      DAILY_BUDGET_SMALL_REQUESTS: "900",
      DAILY_BUDGET_SMALL_TOKENS: "190000",
    },
  },
};

export function targetFor(agent: Agent, ref: string) {
  const d = DEFAULTS[agent.id];
  const cfgEnv = (agent.config as { env?: Record<string, string> } | null)?.env ?? {};
  return {
    repo: agent.repo,
    ref,
    workdir: agent.config?.workdir ?? "backend",
    adapter_module: agent.adapter_module,
    install: d?.install ?? agent.config?.install ?? "uv sync --frozen",
    env: { ...(d?.env ?? {}), ...cfgEnv },
  };
}
