import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Control-plane API contract test against a throwaway Postgres (TEST_DATABASE_URL, migrated; tables are TRUNCATED).
 * Drives the real route handlers: key auth + scopes, ingest validation/limits/sampling, profile ETag, and the full
 * runner lifecycle (create → config → start → results → finish → paired comparison → alert).
 */
const url = process.env.TEST_DATABASE_URL;
const RUNNER_KEY = "afr_test_runner_key_for_ci_only";

describe.runIf(!!url)("api /api/v1", async () => {
  process.env.DATABASE_URL = url;
  process.env.RUNNER_KEY_HASH = createHash("sha256").update(RUNNER_KEY).digest("hex");
  delete process.env.GH_TOKEN;
  const { setStore } = await import("@/lib/server/store");
  setStore(null);
  const { newApiKey } = await import("@/lib/server/http");
  const traces = await import("@/app/api/v1/traces/route");
  const active = await import("@/app/api/v1/profiles/[agent]/active/route");
  const runnerRuns = await import("@/app/api/v1/runner/runs/route");
  const runnerRun = await import("@/app/api/v1/runner/runs/[id]/route");
  const runnerOp = await import("@/app/api/v1/runner/runs/[id]/[op]/route");
  const runsList = await import("@/app/api/v1/runs/route");
  const db = new pg.Client({ connectionString: url });
  const keys = { write: "", read: "" };

  const req = (path: string, init: RequestInit & { json?: unknown } = {}) =>
    new Request(`http://test${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  const ctx = <T,>(params: T) => ({ params: Promise.resolve(params) });
  const runner = { authorization: `Bearer ${RUNNER_KEY}` };

  beforeAll(async () => {
    await db.connect();
    await db.query(
      "TRUNCATE agents, profiles, traces, suites, cases, suite_versions, case_reviews, runs, results, attacks, optimizer_experiments, optimizer_candidates, promotions, judge_labels, judge_calibration, llm_usage, api_keys, rate_limits, audit_log, alerts CASCADE",
    );
    await db.query(`INSERT INTO agents (id, repo, adapter_module, optimizable_keys, locked_keys, config) VALUES
      ('returnpilot', 'Sohail-5678/returnpilot', 'returnpilot.eval_adapter', '{"paths":["prompts.system"]}', '["policy"]', '{"workdir":"backend"}')`);
    await db.query(`INSERT INTO profiles (agent_id, version, body, body_hash, created_by, is_active) VALUES
      ('returnpilot', 1, '{"contract_version":"profile.v1","agent":"returnpilot","version":1,"prompts":{"system":"hi"},"locked":["policy"]}', 'hash-v1', 'human', true)`);
    await db.query("INSERT INTO suites (id, agent_id, kind) VALUES ('returnpilot/regression', 'returnpilot', 'regression'), ('returnpilot/redteam', 'returnpilot', 'redteam')");
    for (let i = 0; i < 12; i++) {
      const id = `rp-reg-${i}`;
      await db.query("INSERT INTO cases (id, suite_id, split, body, content_hash, origin) VALUES ($1, 'returnpilot/regression', 'test', $2, $3, 'seed')", [
        id,
        JSON.stringify({ contract_version: "case.v1", case_id: id, agent: "returnpilot", suite: "regression", split: "test", input: { turns: ["hi"] }, expect: {} }),
        `h${i}`,
      ]);
    }
    for (const [name, scopes] of [
      ["write", ["traces:write"]],
      ["read", ["profiles:read"]],
    ] as const) {
      const k = newApiKey();
      keys[name] = k.key;
      await db.query("INSERT INTO api_keys (name, agent_id, key_hash, prefix, scopes) VALUES ($1, 'returnpilot', $2, $3, $4)", [name, k.hash, k.prefix, scopes]);
    }
  });
  afterAll(async () => {
    await db.end();
    setStore(null);
  });

  const trace = (i: number, status = "failure") => ({
    contract_version: "trace.v1",
    trace_id: `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    agent: "returnpilot",
    mode: "live",
    started_at: new Date(Date.UTC(2026, 9, 8, 10, i)).toISOString(),
    status,
    input: { turns: [{ user: `refund for order 1042, email maya${i}@example.com` }] },
    spans: [{ span_id: "s1", kind: "guard", name: "input_guard", status: i === 1 ? "blocked" : "ok", output_redacted: { big: "x".repeat(9000) } }],
    metrics: { llm_calls: 2, latency_ms: 1500, list_price_cost_usd: 0.0008 },
  });

  it("ingest: auth, scope, validation", async () => {
    const body = { traces: [trace(1)] };
    expect((await traces.POST(req("/api/v1/traces", { method: "POST", json: body }))).status).toBe(401);
    expect((await traces.POST(req("/api/v1/traces", { method: "POST", json: body, headers: { "x-agentforge-key": keys.read } }))).status).toBe(403);
    expect((await traces.POST(req("/api/v1/traces", { method: "POST", json: { traces: [{ nope: 1 }] }, headers: { "x-agentforge-key": keys.write } }))).status).toBe(422);
    const big = { traces: [{ ...trace(2), final_output: "y".repeat(300_000) }] };
    expect((await traces.POST(req("/api/v1/traces", { method: "POST", json: big, headers: { "x-agentforge-key": keys.write } }))).status).toBe(413);
  });

  it("ingest: stores failures, redacts PII, truncates spans, marks guard hits; idempotent", async () => {
    const res = await traces.POST(req("/api/v1/traces", { method: "POST", json: { traces: [trace(1), trace(3)] }, headers: { "x-agentforge-key": keys.write } }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: 2, dropped: 0 });
    const again = await (await traces.POST(req("/api/v1/traces", { method: "POST", json: { traces: [trace(1)] }, headers: { "x-agentforge-key": keys.write } }))).json();
    expect(again.accepted).toBe(0);
    const { rows } = await db.query("SELECT input, spans, guard_hit FROM traces WHERE id = $1", [trace(1).trace_id]);
    expect(JSON.stringify(rows[0].input)).not.toContain("@example.com");
    expect(rows[0].spans[0].output_redacted.truncated).toBe(true);
    expect(rows[0].guard_hit).toBe(true);
    const list = await (await traces.GET(req("/api/v1/traces?agent=returnpilot"))).json();
    expect(list.items.length).toBe(2);
    expect(list.items[0].spans).toBeUndefined();
  });

  it("profiles: active profile with ETag → 304", async () => {
    const r = await active.GET(req("/api/v1/profiles/returnpilot/active", { headers: { "x-agentforge-key": keys.read } }), ctx({ agent: "returnpilot" }));
    expect(r.status).toBe(200);
    const etag = r.headers.get("etag")!;
    expect(etag).toBe('"hash-v1"');
    const r2 = await active.GET(req("/api/v1/profiles/returnpilot/active", { headers: { "x-agentforge-key": keys.read, "if-none-match": etag } }), ctx({ agent: "returnpilot" }));
    expect(r2.status).toBe(304);
    expect((await active.GET(req("/api/v1/profiles/returnpilot/active", { headers: { "x-agentforge-key": keys.write } }), ctx({ agent: "returnpilot" }))).status).toBe(403);
  });

  async function nightly(passing: number) {
    const created = await runnerRuns.POST(req("/api/v1/runner/runs", { method: "POST", json: { agent: "returnpilot" }, headers: runner }));
    expect(created.status).toBe(201);
    const { run_id, dispatched } = await created.json();
    expect(dispatched).toBe(false); // no GH_TOKEN in tests — run stays queued, nothing else breaks
    const cfg = await (await runnerRun.GET(req(`/api/v1/runner/runs/${run_id}`, { headers: runner }), ctx({ id: run_id }))).json();
    expect(cfg.cases).toHaveLength(12);
    expect(cfg.canaries[0]).toMatch(/^AFC-[0-9a-f]{8}$/);
    expect(cfg.target.adapter_module).toBe("returnpilot.eval_adapter");
    const op = (o: string, json: unknown) => runnerOp.POST(req(`/api/v1/runner/runs/${run_id}/${o}`, { method: "POST", json, headers: runner }), ctx({ id: run_id, op: o }));
    expect((await op("start", { gh_run_id: 123 })).status).toBe(200);
    expect((await op("heartbeat", {})).status).toBe(200);
    const results = cfg.cases.map((c: { case_id: string }, i: number) => ({ case_id: c.case_id, attempt: 1, passed: i < passing, status: "success", graders: [{ grader: "status", passed: true }], cost_usd: 0.001, latency_ms: 1200, llm_calls: 3 }));
    expect((await op("results", { results })).status).toBe(200);
    expect((await op("results", { results: results.slice(0, 2) })).status).toBe(200); // idempotent re-post
    const summary = { n_cases: 12, n_results: 12, attempts: 1, passed: passing, pass_rate: passing / 12, ci: [0, 1], hard_failures: { must_not: 0, canary: 0 } };
    expect((await op("finish", { summary })).status).toBe(200);
    return run_id as string;
  }

  it("runner lifecycle: nightly → results → finish; second nightly gets a paired comparison + alert", async () => {
    const first = await nightly(12);
    const { rows: r1 } = await db.query("SELECT status, gh_run_id, (SELECT count(*)::int FROM results WHERE run_id = $1) AS n FROM runs WHERE id = $1", [first]);
    expect(r1[0]).toMatchObject({ status: "done", n: 12 });
    expect(Number(r1[0].gh_run_id)).toBe(123);
    const second = await nightly(4);
    const { rows: r2 } = await db.query("SELECT summary FROM runs WHERE id = $1", [second]);
    expect(r2[0].summary.compare.baseline_run_id).toBe(first);
    expect(r2[0].summary.compare.b).toBe(8);
    expect(r2[0].summary.compare.p_value).toBeLessThan(0.05);
    const { rows: alerts } = await db.query("SELECT kind, level FROM alerts WHERE run_id = $1", [second]);
    expect(alerts).toEqual([{ kind: "regression", level: "warn" }]);
  });

  it("rejects bad runner keys and visitor writes", async () => {
    expect((await runnerRuns.POST(req("/api/v1/runner/runs", { method: "POST", json: { agent: "returnpilot" }, headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    expect((await runsList.POST(req("/api/v1/runs", { method: "POST", json: { agent: "returnpilot", suites: ["returnpilot/regression"] } }))).status).toBe(401);
    const list = await (await runsList.GET(req("/api/v1/runs?agent=returnpilot"))).json();
    expect(list.total).toBe(2);
  });
});
