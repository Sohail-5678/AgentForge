import { z } from "zod";
import { getStore } from "@/lib/server/store";
import { handle, HttpError, json, readJson, redactDeep, requireRunner, truncatePayload } from "@/lib/server/http";
import { finishRun } from "@/lib/server/services";
import type { Result, RunSummary, Trace } from "@/lib/types";
import { runnerResultsSchema, traceSchema } from "@/lib/zod";

/** POST /runner/runs/{id}/start | heartbeat | results | finish (§12.2). Results are idempotent on (run, case, attempt). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string; op: string }> }) => {
  requireRunner(req);
  const { id, op } = await ctx.params;
  const store = getStore();
  const run = await store.run(id);
  if (!run) throw new HttpError(404, "not_found", "Run not found.");
  const now = new Date().toISOString();

  if (op === "start") {
    const body = await readJson(req, z.object({ gh_run_id: z.number().int().nullish() }), 4096);
    if (run.status === "cancelled") throw new HttpError(409, "cancelled", "Run was cancelled.");
    await store.updateRun(id, { status: "running", gh_run_id: body.gh_run_id ?? null, heartbeat_at: now });
    return json({ ok: true });
  }
  if (op === "heartbeat") {
    await store.updateRun(id, { heartbeat_at: now, ...(run.status === "stalled" ? { status: "running" as const } : {}) });
    return json({ ok: true, cancelled: run.status === "cancelled" });
  }
  if (op === "results") {
    const body = await readJson(req, runnerResultsSchema, 2 * 1024 * 1024);
    const traces: Trace[] = [];
    const rows: Result[] = body.results.map((r) => {
      let traceId: string | null = null;
      const t = r.trace ? traceSchema.safeParse(r.trace) : null;
      if (t?.success) {
        traceId = t.data.trace_id;
        traces.push({
          id: t.data.trace_id,
          agent_id: run.agent_id,
          mode: "eval",
          run_id: id,
          case_id: r.case_id,
          agent_version: t.data.agent_version ?? null,
          profile_version: t.data.profile_version ?? null,
          status: t.data.status,
          started_at: new Date(t.data.started_at).toISOString(),
          ended_at: t.data.ended_at ? new Date(t.data.ended_at).toISOString() : null,
          input: redactDeep(t.data.input ?? null),
          final_output: redactDeep(t.data.final_output ?? null),
          end_state: redactDeep(t.data.end_state ?? null),
          spans: t.data.spans.map((s) => ({ ...s, input_redacted: truncatePayload(s.input_redacted), output_redacted: truncatePayload(s.output_redacted) })),
          metrics: t.data.metrics,
          feedback: null,
          guard_hit: t.data.spans.some((s) => s.kind === "guard" && s.status === "blocked"),
          mined: false,
          received_at: now,
        });
      }
      return {
        run_id: id,
        case_id: r.case_id,
        attempt: r.attempt,
        passed: r.passed,
        status: r.status,
        graders: r.graders.map((g) => ({ ...g, score: g.score ?? null })),
        trace_id: traceId,
        block_layer: r.block_layer ?? null,
        cost_usd: r.cost_usd ?? null,
        latency_ms: r.latency_ms != null ? Math.round(r.latency_ms) : null,
        llm_calls: r.llm_calls ?? null,
      };
    });
    if (traces.length) await store.insertTraces(traces);
    const n = await store.upsertResults(rows);
    await store.updateRun(id, { heartbeat_at: now });
    return json({ ok: true, stored: n, traces: traces.length });
  }
  if (op === "finish") {
    const body = await readJson(req, z.object({ summary: z.record(z.string(), z.unknown()).nullish(), error: z.string().max(2000).nullish() }), 512 * 1024);
    await finishRun(id, (body.summary as RunSummary | null) ?? null, body.error ?? undefined);
    return json({ ok: true });
  }
  throw new HttpError(404, "not_found", `Unknown runner operation ${op}.`);
});
