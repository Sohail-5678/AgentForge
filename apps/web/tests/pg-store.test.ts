import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Postgres store integration test — runs only when TEST_DATABASE_URL points at a throwaway, migrated database
 * (CI uses a postgres service container; locally `createdb agentforge_dev && pnpm db:migrate`). It TRUNCATES tables.
 */
const url = process.env.TEST_DATABASE_URL;

describe.runIf(!!url)("pg store", async () => {
  process.env.DATABASE_URL = url;
  const { createPgStore } = await import("@/lib/server/store/pg");
  const store = createPgStore();
  const admin = new pg.Client({ connectionString: url });
  const iso = (m: number) => new Date(Date.UTC(2026, 9, 1, 0, m)).toISOString();
  const body = (version: number) => ({ contract_version: "profile.v1" as const, agent: "toy", version, prompts: { system: `v${version}` }, locked: ["policy"] });

  beforeAll(async () => {
    await admin.connect();
    await admin.query(
      "TRUNCATE agents, profiles, traces, suites, cases, suite_versions, case_reviews, runs, results, attacks, optimizer_experiments, optimizer_candidates, promotions, judge_labels, judge_calibration, llm_usage, api_keys, rate_limits, audit_log, alerts CASCADE",
    );
    await admin.query(
      "INSERT INTO agents (id, repo, adapter_module, optimizable_keys, locked_keys) VALUES ('toy', 'Sohail-5678/AgentForge', 'toy_agent.eval_adapter', '{\"paths\":[\"prompts.system\"]}', '[\"policy\"]')",
    );
  });
  afterAll(async () => {
    await admin.end();
  });

  let p1 = "";
  let p2 = "";
  it("profiles: insert, activate atomically, single active row", async () => {
    p1 = (await store.insertProfile({ agent_id: "toy", version: 1, parent_version: null, body: body(1), body_hash: "h1", created_by: "human", experiment_id: null })).id;
    p2 = (await store.insertProfile({ agent_id: "toy", version: 2, parent_version: 1, body: body(2), body_hash: "h2", created_by: "optimizer", experiment_id: null })).id;
    await store.activateProfile("toy", p1);
    expect((await store.activeProfile("toy"))?.id).toBe(p1);
    await store.activateProfile("toy", p2);
    expect((await store.activeProfile("toy"))?.version).toBe(2);
    const { rows } = await admin.query("SELECT count(*)::int AS n FROM profiles WHERE is_active");
    expect(rows[0].n).toBe(1);
    await expect(store.activateProfile("toy", "00000000-0000-4000-8000-000000000000")).rejects.toThrow();
    expect((await store.activeProfile("toy"))?.id).toBe(p2); // rolled back, still v2
  });

  it("suites, cases and versions", async () => {
    await admin.query("INSERT INTO suites (id, agent_id, kind) VALUES ('toy/scenario', 'toy', 'scenario')");
    const now = new Date().toISOString();
    await store.insertCases(
      ["a", "b", "c"].map((id) => ({
        id: `toy-${id}`,
        suite_id: "toy/scenario",
        split: "test" as const,
        family: null,
        body: { contract_version: "case.v1" as const, case_id: `toy-${id}`, agent: "toy", suite: "scenario" as const, split: "test" as const, input: {}, expect: {}, tags: [id] },
        content_hash: id,
        origin: "seed" as const,
        source_trace_id: null,
        retired_at: null,
        created_at: now,
      })),
    );
    expect((await store.cases({ suite: "toy/scenario", tag: "b" })).map((c) => c.id)).toEqual(["toy-b"]);
    const v = await store.insertSuiteVersion({ suite_id: "toy/scenario", hash: "v1", case_ids: ["toy-a", "toy-b", "toy-c"] });
    const again = await store.insertSuiteVersion({ suite_id: "toy/scenario", hash: "v1", case_ids: ["toy-a", "toy-b", "toy-c"] });
    expect(again.id).toBe(v.id);
  });

  it("runs: create, seq, idempotent results upsert, update", async () => {
    const v = (await store.suiteVersions("toy/scenario"))[0];
    const run = await store.createRun({ agent_id: "toy", suite_version_ids: [v.id], profile_id: p2, target_ref: "main", trigger: "manual", pr_number: null, experiment_id: null, attempts: 1, budget_calls: 50, status: "queued" });
    expect(run.seq).toBeGreaterThan(0);
    expect((await store.run(String(run.seq)))?.id).toBe(run.id);
    const result = (caseId: string, passed: boolean) => ({ run_id: run.id, case_id: caseId, attempt: 1, passed, status: "success", graders: [{ grader: "status", passed: true, score: null, details: {} }], trace_id: null, block_layer: null, cost_usd: 0.0012, latency_ms: 900, llm_calls: 3 });
    await store.upsertResults([result("toy-a", false), result("toy-b", true)]);
    await store.upsertResults([result("toy-a", true)]);
    const rows = await store.results(run.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.case_id === "toy-a")?.passed).toBe(true);
    expect(typeof rows[0].cost_usd).toBe("number");
    const done = await store.updateRun(run.id, { status: "done", finished_at: new Date().toISOString(), summary: { n_cases: 2, n_results: 2, attempts: 1, passed: 2, pass_rate: 1, ci: [0.34, 1] } });
    expect(done?.status).toBe("done");
    expect(done?.created_at).toMatch(/Z$/);
    expect(await store.countRuns({ agent: "toy", status: "done" })).toBe(1);
  });

  it("traces: idempotent insert, keyset pagination, feedback, purge", async () => {
    const t = (i: number) => ({
      id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      agent_id: "toy",
      mode: "live" as const,
      run_id: null,
      case_id: null,
      agent_version: null,
      profile_version: "toy@2",
      status: i % 4 ? "success" : "failure",
      started_at: iso(i),
      ended_at: null,
      input: { q: i },
      final_output: null,
      end_state: null,
      spans: [],
      metrics: { latency_ms: 10 },
      feedback: null,
      guard_hit: i % 3 === 0,
      mined: false,
      received_at: new Date().toISOString(),
    });
    expect(await store.insertTraces(Array.from({ length: 25 }, (_, i) => t(i)))).toBe(25);
    expect(await store.insertTraces([t(1), t(2)])).toBe(0);
    const a = await store.traces({ agent: "toy", limit: 10 });
    const b = await store.traces({ agent: "toy", limit: 10, cursor: a.next });
    const c = await store.traces({ agent: "toy", limit: 10, cursor: b.next });
    expect(new Set([...a.items, ...b.items, ...c.items].map((x) => x.id)).size).toBe(25);
    expect(c.next).toBeNull();
    expect(await store.setTraceFeedback(t(5).id, "toy", { thumbs: -1, comment: "wrong" })).toBe(true);
    expect(await store.setTraceFeedback(t(5).id, "datapilot", { thumbs: -1, comment: null })).toBe(false);
    expect((await store.traces({ agent: "toy", feedback: "down" })).items.map((x) => x.id)).toEqual([t(5).id]);
    expect(await store.purgeTraces(iso(10))).toBe(10);
  });

  it("api keys + fixed-window rate limits", async () => {
    const key = await store.insertApiKey({ name: "k", agent_id: "toy", key_hash: "abc", prefix: "afk_live_xx", scopes: ["traces:write"] });
    expect((await store.apiKeyByHash("abc"))?.id).toBe(key.id);
    const w = new Date(Date.UTC(2026, 9, 1, 0, 0)).toISOString();
    expect(await store.rateLimitHit(key.id, w, 5)).toBe(5);
    expect(await store.rateLimitHit(key.id, w, 7)).toBe(12);
    expect(await store.revokeApiKey(key.id)).toBe(true);
    expect(await store.revokeApiKey(key.id)).toBe(false);
  });

  it("usage ledger sums, audit log, alerts", async () => {
    await store.addUsage([{ day: "2026-10-01", provider: "groq", model: "gpt-oss-20b", purpose: "cheap_judge", calls: 3, tokens_in: 10, tokens_out: 5 }]);
    await store.addUsage([{ day: "2026-10-01", provider: "groq", model: "gpt-oss-20b", purpose: "cheap_judge", calls: 4, tokens_in: 1, tokens_out: 1 }]);
    expect((await store.usage("2026-10-01"))[0].calls).toBe(7);
    await store.writeAudit({ actor: "test", action: "x", object_type: "y", object_id: null, details: { a: 1 } });
    expect((await store.audit(5))[0].action).toBe("x");
    await store.insertAlert({ agent_id: "toy", run_id: null, level: "warn", kind: "regression", message: "m", details: null });
    const [alert] = await store.alerts(true);
    await store.resolveAlert(alert.id);
    expect(await store.alerts(true)).toHaveLength(0);
    expect(await store.dbSizeBytes()).toBeGreaterThan(0);
  });
});
