# AgentForge — notes for Claude Code

The full build spec is `docs/SPEC.md` (source of truth); `docs/CONTRACTS.md` pins the shapes shared by the runner and the
control plane (snapshot format, graders, run summary, gate report, runner API). The README lists deliberate deviations.

## Layout
- `apps/web/` — Next.js 16 control plane (Vercel): App Router pages under `app/(app)/*`, API under `app/api/v1/*`,
  store abstraction in `lib/server/store` (Neon/Postgres via Drizzle, or the read-only demo snapshot when DATABASE_URL is
  unset), services (run lifecycle, PR gate, promotion gate, rollback, reviews) in `lib/server/services.ts`, stats in
  `lib/stats.ts` (mirrors the runner's), Nocturne design system in `app/globals.css`.
- `runner/` — Python 3.12 execution plane (`af-run`): graders, stats, red team, GEPA-lite optimizer, datasets, demo
  snapshot generator; `examples/toy_agent` is the bundled target used by CI.
- `suites/` — case.v1 suites + red-team seeds; regenerate with `python3 scripts/build_suites.py` (check with `--check`).
- `.github/workflows/` — ci, build-runner-image, run-suite (execution plane), nightly/optimize/purge (opt-in via repo vars).

## Commands
- Web: `cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` (e2e builds and serves snapshot mode).
- Runner: `cd runner && uv run ruff check . && uv run ruff format --check . && uv run pytest -q` (fake LLM, no network).
- Demo snapshot: `cd runner && uv run af-run demo --out ../apps/web/data/demo-snapshot.json --seed 7`.
- Suites: `python3 scripts/build_suites.py --check && python3 -m pytest scripts/test_build_suites.py -q`.
- DB: `cd apps/web && DATABASE_URL=… pnpm db:migrate && pnpm db:seed`.
- Deploy web: `cd apps/web && vercel deploy --prod` (project `agentforge-eval`, CLI-deployed).

## Rules
- $0 only: free tiers, no card. Secrets live only in Vercel env / GitHub Actions secrets; never commit keys.
- Locked profile fields (policy, guardrails, approval thresholds, tool permissions, SQL guard, …) are never optimizable;
  they are rejected by the runner's editor, by the control plane, and by each target's own loader.
- Never present synthetic demo data as real results: simulated runs carry `summary.synthetic = true` and the UI labels them.
