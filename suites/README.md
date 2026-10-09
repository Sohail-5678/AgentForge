# AgentForge seed suites

The versioned eval and red-team suites AgentForge runs against its two target agents — **DataPilot** (a
multi-agent text-to-SQL analyst) and **ReturnPilot** (an e-commerce returns/refunds agent with human
approval). Every case validates against [`schemas/case.v1.json`](../schemas/case.v1.json). Counts below are
regenerated into [`manifest.json`](manifest.json); treat the manifest as the source of truth.

| Suite id | File | Cases | train / val / test | Purpose |
|---|---|--:|---|---|
| `datapilot/benchmark` | `datapilot/benchmark.jsonl` | 150 | 50 / 50 / 50 | BIRD execution accuracy (EX) |
| `datapilot/regression` | `datapilot/regression.jsonl` | 50 | 32 / 8 / 10 | Nightly + PR gate + optimizer |
| `datapilot/redteam` | `redteam/datapilot-*.yaml` | 40 | by family | Attack success rate |
| `returnpilot/scenario` | `returnpilot/scenario.jsonl` | 30 | 13 / 10 / 7 | End-state + trajectory checks |
| `returnpilot/regression` | `returnpilot/regression.jsonl` | 17 | 8 / 3 / 6 | Nightly + PR gate + optimizer |
| `returnpilot/redteam` | `redteam/returnpilot-*.yaml` | 47 | by family | Attack success rate |

87 hand-written red-team seeds in total. The `toy/*` suites belong to the runner package and are not built
here.

## What each suite is

- **`datapilot/benchmark`** — the 150-question BIRD Mini-Dev subset DataPilot ships
  (`bench/subset_150.jsonl`). `case_id = dp-bird-<question_id>`; `input = {question, db_id, evidence,
  db_source: "bird"}`; `expect = {result_match: "execution", gold_sql, must_not: ["write_sql"],
  max_steps: 12}`; tags `[difficulty, db_id, "bird"]`. The split is taken from DataPilot's
  `bench/splits.json` (not recomputed) so the two projects report EX on the same train/val/test partition.
- **`datapilot/regression`** — DataPilot's 40 regression questions (`bench/regression_40.jsonl`, drawn from
  the BIRD val split) as `dp-reg-bird-<question_id>`, plus the 10 `evals/cases/smoke.jsonl` cases kept with
  their existing case.v1 ids. Smoke cases that used DataPilot's own `must_not` names
  (`execute_write`, `drop_table`, `canary_leak`) also carry the AgentForge equivalent
  (`write_sql`, `leak_secret`).
- **`returnpilot/scenario`** — ReturnPilot's 30 hand-written multi-turn scenarios
  (`evals/scenarios.jsonl`), ids and expectations unchanged. **Split note:** ReturnPilot ships every
  scenario as `test`; AgentForge recomputes the split by the contract rule below, so these 30 land across
  train/val/test (13 / 10 / 7).
- **`returnpilot/regression`** — 17 regression cases written here, grounded in ReturnPilot's real behaviour
  and fixed bugs: the "use my usual" memory recall and the "check eligibility immediately, assume unused for
  non-electronics, ask condition first for electronics" rules from its live-tuning profile v2; refunds over
  the $50 auto-approve limit ending `pending_approval` and the reply never claiming an unissued refund;
  reviewer-approved refunds issued exactly once; unknown and mistyped order numbers; international shipping
  not refunded; damaged low-value items refunded without a return; final-sale damaged → exchange not refund;
  one-refund-per-item; the Groq-fallback tool-call-history fix; escalation and no-false-cancellation.
- **`{agent}/redteam`** — hand-written seed attacks (SPEC §8.3) as `redteam/<agent>-<category>.yaml`, one
  file per `<agent>-<category>`. Each seed is grounded in the real adapter: ReturnPilot uses real persona
  order ids / override surfaces (`orders.<n>.customer_note`, `products.<sku>.name`, `customers.<p>.name`,
  `tickets.<p>.text`, `policy_chunks.<§>.copy`); DataPilot uses real demo tables/columns and the
  `insert_rows` / `update_rows` / `canary_table` / `column_descriptions` override formats. The build
  converts each seed to a case.v1 record (`suite: "redteam"`, carrying `category/owasp/family/severity/
  success_if`) for hashing and schema validation.

### Red-team coverage (OWASP LLM Top 10, 2025 — SPEC §8.2)

| Category | OWASP | ReturnPilot | DataPilot |
|---|---|--:|--:|
| `direct_injection` | LLM01 | 6 | 6 |
| `indirect_injection` | LLM01 | 6 | 5 |
| `data_exfiltration` | LLM02 | 5 | 5 |
| `system_prompt_extraction` | LLM07 | 6 | 4 |
| `excessive_agency` | LLM06 | 6 | — |
| `unsafe_sql` | LLM05 | — | 6 |
| `tool_arg_injection` | LLM05 | 6 | 4 |
| `unbounded_consumption` | LLM10 | 6 | 4 |
| `misinformation` | LLM09 | — | 6 |
| `off_policy_content` | — | 6 | — |
| **Total** | | **47** | **40** |

Severity mix: ReturnPilot 20 high / 15 medium / 12 low; DataPilot 18 high / 16 medium / 6 low. `judge`
success predicates are used only for `off_policy_content` (the one non-deterministic category); every other
seed's `success_if` is deterministic (`end_state`, `tool_called`, `canary_leaked`, `output_contains`). Each
seed has a distinct `family`; mutations of a seed inherit its family and stay in its split (SPEC §5.2, §8.4).

## Split rule (CONTRACTS §2)

`bucket = int(sha256(case_id).hexdigest(), 16) % 10` → 0–5 `train`, 6–7 `val`, 8–9 `test`. Exceptions:

- **Red-team** cases hash their **family** instead of the case id, so every mutation of a seed stays in the
  same split (no train/test leakage of an attack's paraphrases).
- **`datapilot/benchmark`** keeps DataPilot's `bench/splits.json` so both projects use the same BIRD split.

`content_hash` = `sha256` of the canonical JSON (sorted keys, no whitespace) of the case body;
`suite_versions.hash` = `sha256` of `"\n".join(f"{case_id}:{content_hash}")` over sorted case ids.

## Sources & licences

- **BIRD Mini-Dev** (`datapilot/benchmark`, the `dp-reg-bird-*` regression cases, and the `superhero` /
  `student_club` demo databases) — **CC BY-SA 4.0**, <https://github.com/bird-bench/mini_dev>. Questions,
  gold SQL and difficulty labels are from the BIRD Mini-Dev subset DataPilot vendored.
- **Chinook** sample database (used by many DataPilot red-team seeds) — MIT License, Luis Rocha,
  <https://github.com/lerocha/chinook-database>.
- **ReturnPilot scenarios** and all **red-team seeds** are original work in this project (synthetic data
  only; no real customers). ReturnPilot's demo store data is generated deterministically from a fixed seed.

All data in every suite is synthetic or public; no personal data is included.

## Regenerate

```bash
# From the AgentForge repo root, with the target repos as siblings (../datapilot, ../returnpilot),
# or set AF_DATAPILOT_DIR / AF_RETURNPILOT_DIR, or pass --datapilot / --returnpilot.
python scripts/build_suites.py            # (re)write the .jsonl suites and manifest.json
python scripts/build_suites.py --check    # CI: fail if anything is invalid or would change
python scripts/test_build_suites.py       # unit tests for the builder, parser, validator and seeds
```

The red-team `*.yaml` seed files are authored by hand and are **not** rewritten by the builder — it only
validates them (naming, grounding against the real adapters, unique families, success-predicate shapes) and
folds their counts and version hashes into the manifest. When a target repo is absent (as in AgentForge's
own CI), `--check` validates the committed `.jsonl` files and manifest instead of regenerating them. The
builder uses the standard library only and is deterministic: running it twice produces identical output.
