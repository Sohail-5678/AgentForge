# AgentForge internal contracts

The build spec is `docs/SPEC.md`. This file pins down the shapes that the **runner** (Python, `runner/`) and the
**control plane** (Next.js, `apps/web/`) share, so both halves can be built and tested independently.

- JSON Schemas: `schemas/{trace,profile,case}.v1.json` (shared contracts §S).
- SQL schema: `apps/web/db/migrations/0001_init.sql` (§11 + a few marked additions).
- API: §12 of the spec. Base path **`/api/v1`**. Target agents are configured with
  `AGENTFORGE_URL=https://<host>/api` because they call `{AGENTFORGE_URL}/v1/traces` etc.

---

## 0. Storage

- **Neon Postgres** (free plan, own project `agentforge`; limits are per project, so DataPilot/ReturnPilot are unaffected) is
  the system of record when `DATABASE_URL` is set. `pnpm --dir apps/web db:migrate` applies the SQL; `db:seed` loads the demo
  snapshot (§7) into an empty database so the dashboards have history from day one.
- **Without `DATABASE_URL`** the control plane serves the committed demo snapshot read-only (writes return 503
  `read_only_demo`). This lets the site go live before the database exists.
- **Throwaway Postgres service container** in GitHub Actions is used only by ReturnPilot's eval adapter during a run.
- Heartbeats are written to `runs.heartbeat_at` (one small UPDATE per minute during a run is fine on Neon).

---

## 1. Agents registry (rows of `agents`)

| id | repo | workdir | adapter_module | install |
|---|---|---|---|---|
| `datapilot` | `Sohail-5678/Datapilot-Multi-Agent-Data-Analyst` | `backend` | `datapilot.eval_adapter` | `uv sync --frozen` |
| `returnpilot` | `Sohail-5678/returnpilot` | `backend` | `returnpilot.eval_adapter` | `uv sync --frozen` |
| `toy` | (this repo) | `runner/examples/toy_agent` | `toy_agent.eval_adapter` | — (same venv) |

`agents.config` jsonb: `{ "display_name", "tagline", "workdir", "install", "default_branch": "main", "suites": [suite ids] }`.

`optimizable_keys`: `{ "paths": ["prompts.system", "tool_descriptions.check_return_eligibility", "few_shots", "routing.use_fast_when", "params.temperature", …], "param_ranges": { "temperature": [0, 0.7], "history_messages": [4, 16], "self_consistency_k": [1, 3], "max_steps": [4, 10] } }`
`locked_keys`: the profile's `locked` list (e.g. `["policy","guardrails","approval_threshold","tool_permissions"]`).

## 2. Suites and case ids

- Suite ids: `"<agent>/<kind>"` → `datapilot/benchmark`, `datapilot/regression`, `returnpilot/scenario`,
  `returnpilot/regression`, `datapilot/redteam`, `returnpilot/redteam`, `toy/scenario`, `toy/redteam`.
- Files: `suites/<agent>/<kind>.jsonl` (case.v1, one per line) and `suites/redteam/<agent>-<category>.yaml` (lists of seeds,
  §8.3 format, converted to case.v1 with `suite: "redteam"` + `category/family/severity/owasp/success_if`).
- Split: `bucket = int(sha256(case_id).hexdigest(), 16) % 10` → 0–5 train, 6–7 val, 8–9 test. Red-team cases hash
  the **family** instead of the case id. DataPilot benchmark cases keep the split from DataPilot's `bench/splits.json`.
- `content_hash` = sha256 of the canonical JSON (sorted keys, no whitespace) of the case body.
- `suite_versions.hash` = sha256 of `"\n".join(f"{case_id}:{content_hash}" for sorted case ids)`.

## 3. Graders → `results.graders`

Array of `{ "grader": str, "passed": bool|null, "score": float|null, "details": {...}, "cost_calls": int, "gating": bool }`.
Grader names: `status`, `execution_match`, `end_state`, `trajectory`, `must_not`, `canary`, `rubric_judge`,
`cheap_judge`, `cost_latency`, `attack` (red-team only; `passed` = the attack did **not** succeed;
`details = {succeeded, category, severity, family, operator, matched_predicate}`).

A result passes iff every applicable gating grader passed (`rubric_judge` gates only when the agent's judge is calibrated).
`results.block_layer` ∈ `input_guard | policy_engine | tool_permission | approval_gate | sql_guard | output_guard |
model_refusal | ineffective | null` (null for non-red-team or successful attacks).

## 4. `runs.summary` (written by the runner at finish)

```jsonc
{
  "suites": ["returnpilot/scenario"],          // suite ids covered
  "n_cases": 50, "n_results": 50, "attempts": 1,
  "passed": 41, "pass_rate": 0.82, "ci": [0.70, 0.91],          // Wilson 95 %
  "pass_k": { "k": 2, "n": 30, "passed_all": 22, "rate": 0.733, "ci": [0.56, 0.86] } | null,
  "by_split": { "train": {"n","passed","rate","ci"}, "val": {…}, "test": {…} },
  "by_tag":   { "refund": {"n","passed","rate","ci"}, … },
  "by_suite": { "returnpilot/scenario": {"n","passed","rate","ci"} },
  "graders":  { "end_state": {"applicable": 40, "failed": 5}, … },
  "hard_failures": { "must_not": 0, "canary": 0 },
  "redteam": null | {
    "n": 64, "succeeded": 4, "asr": 0.0625, "ci": [0.02, 0.15],
    "severity_weighted_asr": 0.05, "classifier_evasion_rate": 0.31,
    "high_severity_successes": 1,
    "by_category": { "indirect_injection": {"n","succeeded","asr","ci"}, … },
    "by_layer": { "input_guard": 21, "policy_engine": 9, "approval_gate": 6, "model_refusal": 14, "ineffective": 10 },
    "by_category_layer": { "indirect_injection": { "input_guard": 3, … }, … }
  },
  "cost":    { "mean_list_price_usd": 0.0011, "total_list_price_usd": 0.055, "mean_llm_calls": 4.2, "mean_tokens": 9100 },
  "latency": { "p50_ms": 6100, "p95_ms": 12100 },
  "judge":   { "calibrated": false, "kappa": 0.52, "n": 38 } | null,
  "flaky_cases": ["rp-scn-…"],
  "compare": null | {                          // vs baseline (previous nightly / main nightly for PR gate)
    "baseline_run_id": "uuid", "shared": 47,
    "baseline_rate": 0.80, "rate": 0.85, "diff": 0.05, "diff_ci": [-0.04, 0.13],
    "b": 1, "c": 3, "p_value": 0.625,           // McNemar exact; b = baseline pass→candidate fail
    "newly_failing": ["case ids"], "newly_passing": ["case ids"]
  },
  "budget": { "calls_used": 212, "budget_calls": 300, "stopped_early": false },
  "fake_llm": true,                             // true when produced without real providers
  "synthetic": true                             // true when produced by the demo simulator (see §7)
}
```

## 5. Gate report → `promotions.gate_report`

```jsonc
{
  "passed": true, "path": "quality" | "efficiency" | null,
  "checks": [ { "name": "hard_safety" | "redteam" | "quality" | "efficiency" | "reliability" | "judge",
                "passed": true, "detail": "0 must_not, 0 canary on test + red-team" } ],
  "test": { "n": 30, "baseline_rate": 0.78, "candidate_rate": 0.88, "gain": 0.10, "gain_ci": [0.03, 0.17],
            "mcnemar_p": 0.012, "b": 1, "c": 4, "newly_failing": [], "newly_passing": [] },
  "pass_k": { "k": 2, "baseline": 0.70, "candidate": 0.80 },
  "redteam": { "baseline_asr": 0.067, "candidate_asr": 0.05, "baseline_high": 1, "candidate_high": 0, "n": 60 },
  "cost":    { "baseline_mean": 0.0012, "candidate_mean": 0.0011, "change": -0.08 },
  "latency": { "baseline_p95": 12100, "candidate_p95": 11800, "change": -0.025 },
  "power":   { "n": 30, "mde_80": 0.21, "power_at_10": 0.24, "verdict": "proven" | "not proven" },
  "test_attempts": 1
}
```

## 6. Optimizer

- `optimizer_experiments.config`: `{ "budget_total": 1500, "nightly_calls": 300, "max_iters": 8, "minibatch": 10, "patience": 3,
  "components": ["prompts.system", "tool_descriptions.check_return_eligibility", "few_shots"], "seed": 7 }`
- `optimizer_experiments.state`: `{ "iteration": 5, "night": 2, "front": ["cand ids"], "round_robin": 3, "cache": {…}, "history": [ {"iteration", "parent", "component", "child", "minibatch": [p, c], "accepted"} ] }`
- `optimizer_candidates.editor_check`: `{ "passed": bool, "checks": [ { "name": "schema" | "locked_keys" | "keep_blocks" | "length_cap" | "case_literals" | "deny_list" | "non_empty_diff" | "param_ranges", "passed": bool, "detail": str } ] }`
- The seed candidate has `label: "seed"`, `component: "seed"`, `parent_candidate_id: null`, status `evaluated`.
- `config_search` points are stored in `state.config_search = [ { "label", "params", "val_mean", "cost_mean", "p95_ms", "on_front" } ]`.

## 7. Demo snapshot (`apps/web/data/demo-snapshot.json`)

Produced by `af-run demo --out ../apps/web/data/demo-snapshot.json --seed 7` (runner). The web app serves it read-only when
`DATABASE_URL` is not set, and `pnpm db:seed` loads the same rows into an empty Neon database (§0).

```jsonc
{
  "contract_version": "snapshot.v1",
  "generated_at": "ISO-8601",
  "generator": { "command": "af-run demo --seed 7", "runner_version": "0.1.0", "seed": 7,
                 "note": "Synthetic demo history: simulated DataPilot/ReturnPilot behaviour graded by the real graders, statistics, red-team attribution, optimizer and gate. Toy-agent runs are real executions in fake-LLM mode." },
  "tables": {
    "agents": [ … ], "profiles": [ … ], "suites": [ … ], "cases": [ … ], "suite_versions": [ … ],
    "runs": [ … ], "results": [ … ], "traces": [ … ], "attacks": [ … ],
    "optimizer_experiments": [ … ], "optimizer_candidates": [ … ], "promotions": [ … ],
    "case_reviews": [ … ], "judge_labels": [ … ], "judge_calibration": [ … ], "llm_usage": [ … ],
    "audit_log": [ … ], "alerts": [ … ], "api_keys": [ … ]
  }
}
```

Row objects use the **exact SQL column names** (snake_case). `uuid` → string, `timestamptz` → ISO-8601 string with `Z`,
`date` → `YYYY-MM-DD`, arrays → JSON arrays, `jsonb` → JSON, `numeric` → number. `cases.input_embedding` is omitted.
`api_keys` rows carry only fake hashes/prefixes (never real secrets). `runs.seq` is included.
`cases.input_embedding` is omitted from the snapshot; the runner's miner computes embeddings in memory (numpy cosine) for dedupe (§5.3).

Size budget: ≤ 6 MB. Results are kept for every run; traces are kept for the latest nightly per agent, every red-team,
gate and toy run, every failed result, and all live traces.

## 8. Runner CLI (`af-run`)

```
af-run suite    --run-id ID                              # control-plane mode (GitHub Actions)
af-run suite    --agent toy --suite toy/scenario --local [--profile P] [--fake-llm] [--limit N] [--attempts K] [--out DIR]
af-run redteam  --agent A --local [--mutate paraphrase,encode,wrap] [--fake-llm]
af-run optimize --experiment-id ID | --agent toy --local [--scripted-reflection]
af-run gate     --candidate-id ID                        # runs TEST × pass^2 + red-team core, writes gate report
af-run calibrate --agent A                               # kappa from accepted judge_labels
af-run mine     --agent A                                # failure mining → review drafts
af-run nightly                                           # creates nightly runs via the API (dispatch happens server-side)
af-run power    --n 50 --baseline 0.7 --break-rate 0.08
af-run demo     --out PATH --seed 7                      # writes the demo snapshot (§7)
```

## 9. Runner ⇄ control plane

Runner calls use `Authorization: Bearer <AF_RUNNER_KEY>`; the control plane compares `sha256(key)` with `RUNNER_KEY_HASH`.

- `GET  /api/v1/runner/runs/{id}` → `{ run, agent, profile (body), cases: [case.v1], canaries: [str], budget_calls, attempts, target: {repo, ref, workdir, adapter_module, install} }`
- `POST /api/v1/runner/runs/{id}/start` `{gh_run_id}`
- `POST /api/v1/runner/runs/{id}/heartbeat` `{}`
- `POST /api/v1/runner/runs/{id}/results` `{ results: [ { case_id, attempt, passed, status, graders, block_layer, cost_usd, latency_ms, llm_calls, trace: trace.v1 | null } ] }` (≤ 25)
- `POST /api/v1/runner/runs/{id}/finish` `{ summary }` | `{ error }`
- `GET|PUT /api/v1/runner/experiments/{id}/state`, `POST /api/v1/runner/experiments/{id}/candidates`
- `POST /api/v1/runner/reviews` `{ drafts: [ { draft: case.v1, cluster_label, source_trace_ids } ] }`
- `POST /api/v1/runner/usage` `{ rows: [ { day, provider, model, purpose, calls, tokens_in, tokens_out } ] }`
- `POST /api/v1/runner/runs` (runner key, used by `af-run nightly`) `{ agent, suites, trigger: "nightly", attempts, budget_calls }` → `{ run_id }`
