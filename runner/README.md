# AgentForge runner (`af-run`)

The execution plane of AgentForge (spec: `../docs/SPEC.md`, shared shapes: `../docs/CONTRACTS.md`). It runs target
agents through their eval adapters, grades every case, computes the statistics, runs the red-team engine and the
GEPA-lite optimizer, and writes the public demo snapshot. Python 3.12, managed with `uv`; dependencies are numpy,
scipy, pydantic, httpx and pyyaml.

```
cd runner
uv sync                                    # dev environment (pytest, ruff, jsonschema)
uv run pytest -q                           # 225 tests, no network, no live LLM (≈12 s)
uv run ruff check . && uv run ruff format --check .
```

## Commands (CONTRACTS §8)

| Command | What it does |
|---|---|
| `af-run suite --run-id ID` | Control-plane mode (GitHub Actions): fetch run config, install the target in its own venv, run, grade, post results + summary, heartbeat every 60 s |
| `af-run suite --agent toy --suite toy/scenario,toy/redteam --local --fake-llm [--attempts 2] [--out DIR]` | Local run of the bundled toy agent; writes `results.jsonl` + `summary.json` |
| `af-run redteam --agent toy --local --fake-llm --mutate encode,wrap,paraphrase` | Seeds + mutations, ASR per category, block attribution |
| `af-run optimize --agent toy --local --scripted-reflection [--out DIR]` | GEPA-lite with the scripted reflection LLM |
| `af-run gate --agent toy --local --candidate best_profile.json` | TEST × pass^2 + red-team core → gate report (exit 1 when rejected) |
| `af-run calibrate --agent A --labels labels.jsonl` | Cohen's kappa + confusion from judge labels |
| `af-run mine --agent A --traces traces.jsonl [--post]` | Failure mining → clustered review drafts |
| `af-run nightly` | Creates the nightly runs through the API |
| `af-run power --n 50 --baseline 0.7 --break-rate 0.08` | Power simulation for the promotion card |
| `af-run demo --out ../apps/web/data/demo-snapshot.json --seed 7` | Writes the demo snapshot (≈6 s, byte-identical per seed) |

Environment: `AF_API_URL`, `AF_RUNNER_KEY` (control plane); `AF_GEMINI_API_KEY`, `GROQ_API_KEY` (AgentForge's own
judge/reflection/mutation calls); `DP_GEMINI_API_KEY`, `RP_GEMINI_API_KEY`, `EVAL_DATABASE_URL` (mapped to the target's
own names — `GEMINI_API_KEY` etc. — and never mixed with AgentForge's secrets); model ids `JUDGE_MODEL_<AGENT>`,
`CHEAP_JUDGE_MODEL`, `GUARD_MODEL`, `REFLECTION_MODEL`, `MUTATION_MODEL`, `EMBED_MODEL`; daily caps
`DAILY_CAP_PURPOSE_<GROUP>` / `DAILY_CAP_<MODEL_ID>`; `PRICE_TABLE_JSON`; `AF_SUITES_DIR`. In GitHub Actions every
secret is registered with `::add-mask::` before anything runs.

## Layout

```
agentforge_runner/
  cli.py · api_client.py · budget.py (daily ledger) · llm.py (gemini / groq / fake) · prices.py · contracts.py
  execute.py (one run: canaries, attempts, budget, grading) · summary.py (runs.summary, CONTRACTS §4)
  targets/    subprocess_adapter (clone → uv venv → install → eval adapter CLI), local_adapter (toy), simulated (demo only)
  graders/    status · execution · end_state · trajectory · must_not · canary · judge · cost_latency · attack · registry
  stats/      intervals (Wilson) · paired (McNemar exact, paired bootstrap) · power · kappa · passk · crosscheck
  redteam/    taxonomy · seeds · mutators · canaries · attribution
  optimizer/  gepa_lite · reflection · pareto · config_search · editor · gate · promotion · scripts (scripted edits)
  datasets/   splits · versioning · suites · miner · cluster · drafter
  demo/       world · timeline · live · generate (+ data/: the real v1/v2 profiles of both target agents)
examples/toy_agent/   3-tool refund agent with an eval adapter (fake-LLM policy driven by the profile text)
```

## The demo snapshot is synthetic — and says so

`targets/simulated.py` simulates DataPilot and ReturnPilot: a latent difficulty per case, a profile "skill" read from
the profile text (helpful/harmful phrases and parameters, `targets/sim_config.py`), ~8 % flaky cases, and per-category
block probabilities for each defence layer. It writes realistic `trace.v1` documents and end states. Everything after
that is the real code: the graders grade those traces (a test asserts they reproduce every sampled outcome), the
statistics, block attribution, GEPA-lite + editor + gate, failure mining/clustering/drafting and kappa all run
unmodified. Simulated runs carry `summary.synthetic = true`; toy runs are real executions of the toy adapter with
`summary.fake_llm = true`. Judge verdicts in the demo come from an offline keyword judge that answers the same prompts
the Gemini judge would get (`graders/judge.py: fake_responders`).

Size budget (≤ 8,000,000 bytes; the coordinator allows ≤ 9 MB): results keep every run, but passing graders keep only a
one-line summary (no details at all on older nightlies), the
reported `cost_latency` grader and passing `canary` checks are left out (the row's `cost_usd`/`latency_ms`/`llm_calls`
carry the numbers), and the status grader is omitted on passing rows (`results.status` holds it). All live traces are
kept; eval traces are kept by priority (latest nightly first, failures before passes) until the budget is reached, and
`results.trace_id` is `null` for traces that were not retained. `generator.eval_traces_kept/dropped` report the counts.

## Contract additions (fields added, nothing renamed)

- `runs.summary`: `n_quality` (the first-attempt quality results that `passed`/`pass_rate`/`ci` are computed over;
  `n_results` still counts every row); `compare.excluding_flaky {shared, diff, b, c, p_value}` (nightly alerts ignore flaky cases, §7.5);
  `redteam.successes` (case ids); `pr {number, title, status, reasons, context}` on PR runs; `gate {role, candidate_id,
  candidate_label}` on gate runs; `optimizer {experiment_id, night, iteration, candidates, stop_reason, best}` on optimizer
  slice runs (`suites`, `n_cases`, `n_results` = evaluations that night, `n_quality: 0`, no pass statistics); failed runs:
  `{error, n_results: 0, n_quality: 0, synthetic}`.
- `promotions.gate_report.candidate {label, config_point}`; manual/rollback rows use `{passed: null, path, checks: [], note}`.
  A rejected promotion keeps `to_profile_id = from_profile_id` and points at the attempt through `candidate_id`.
- `optimizer_candidates.editor_check.changed` (changed paths); `optimizer_experiments.config.grid`;
  `state.{calls_used, no_improve, status, stop_reason, best, candidates[], cache}` (`cache` is omitted in the snapshot).
- `agents.noise_profile {runs, split, n, flaky_cases, flake_rate, computed_at}`; `agents.config.live_url`.
- `judge_calibration.confusion {tp, fp, fn, tn}` (positive = pass; same keys as the web app's `lib/stats.ts`).
- `attacks.body {case_id, input, setup, mutation, events, fallback_from}`; mutation cases carry
  `case.mutation {operator, variant, seed_case_id}` and live in `cases` with `origin = "mutation"`.
- Case expectations understood besides §S.4: `status_in`, `cheap_checks`, and ReturnPilot's `tools_called_any`,
  `approval_created`, `approval_rules_any`, `reply_contains_any`, `reply_not_contains`, `citations_any`, `fallback_used`.
- Runner config (`GET /runner/runs/{id}`) optional extras: `judge {calibrated, kappa, n}`, `baseline {run_id, passed}`,
  `fake_llm`. `alerts.kind` values: `regression`, `hard_failure`, `run_failed`, `pr_gate`, `judge_uncalibrated`.
- `llm_usage.purpose` for target calls: `eval_nightly:<agent>`, `eval_gate:<agent>`, `eval_pr:<agent>`, `eval_manual:<agent>`.

## Known limits

- The control-plane `gate --candidate-id` path is not wired (gate runs are created by the control plane and executed
  with `suite --run-id`); local gates work end to end.
- Real DataPilot/ReturnPilot runs need their repos, a throwaway Postgres (ReturnPilot) and keys; the subprocess adapter is
  unit-tested with a fake process runner only (no network in tests). The Docker image was not built here.
- With n ≈ 13 test cases ReturnPilot can only prove gains through the efficiency path; the demo shows exactly that.
