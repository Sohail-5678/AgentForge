import { getStore } from "@/lib/server/store";
import { handle, json, keepTrace, rateLimit, readJson, redactDeep, requireApiKey, truncatePayload, HttpError } from "@/lib/server/http";
import type { Trace } from "@/lib/types";
import { traceBatchSchema, traceSchema } from "@/lib/zod";

/** GET — trace explorer for the dashboard (public read, synthetic data). §12.3 */
export const GET = handle(async (req: Request) => {
  const u = new URL(req.url);
  const g = (k: string) => u.searchParams.get(k) || undefined;
  const page = await getStore().traces({
    agent: g("agent"),
    status: g("status"),
    mode: (g("mode") as "live" | "eval" | undefined) ?? "live",
    feedback: g("feedback") as "down" | "up" | undefined,
    guardHit: g("guard_hit") === undefined ? undefined : g("guard_hit") === "true",
    profileVersion: g("profile_version"),
    cursor: g("cursor"),
    limit: Math.min(100, Number(g("limit") ?? 50) || 50),
  });
  return json({ items: page.items.map(({ spans, ...t }) => ({ ...t, span_count: spans.length })), next: page.next });
});

/** POST — batch ingest from target agents (§4.1): key + scope, zod, ≤ 20 traces / 256 KB, sampling, redaction. */
export const POST = handle(async (req: Request) => {
  const body = await readJson(req, traceBatchSchema);
  const parsed = body.traces.map((t) => traceSchema.safeParse(t));
  const bad = parsed.findIndex((p) => !p.success);
  if (bad >= 0) {
    const issue = !parsed[bad].success ? parsed[bad].error.issues[0] : null;
    throw new HttpError(422, "validation_failed", `traces[${bad}].${issue?.path.join(".")}: ${issue?.message}`);
  }
  const traces = parsed.map((p) => (p.success ? p.data : null)).filter((t) => t !== null);
  const agents = new Set(traces.map((t) => t.agent));
  if (agents.size !== 1) throw new HttpError(422, "mixed_agents", "One batch must contain traces for a single agent.");
  const key = await requireApiKey(req, "traces:write", [...agents][0]);
  await rateLimit(key.id, traces.length);
  const kept = traces.filter((t) => t.mode === "eval" || keepTrace(t));
  const rows: Trace[] = kept.map((t) => ({
    id: t.trace_id,
    agent_id: t.agent,
    mode: t.mode,
    run_id: null,
    case_id: t.case_id ?? null,
    agent_version: t.agent_version ?? null,
    profile_version: t.profile_version ?? null,
    status: t.status,
    started_at: new Date(t.started_at).toISOString(),
    ended_at: t.ended_at ? new Date(t.ended_at).toISOString() : null,
    input: redactDeep(t.input ?? null),
    final_output: redactDeep(t.final_output ?? null),
    end_state: redactDeep(t.end_state ?? null),
    spans: t.spans.map((s) => ({ ...s, input_redacted: truncatePayload(redactDeep(s.input_redacted)), output_redacted: truncatePayload(redactDeep(s.output_redacted)) })),
    metrics: t.metrics,
    feedback: t.feedback ?? null,
    guard_hit: t.spans.some((s) => s.kind === "guard" && s.status === "blocked"),
    mined: false,
    received_at: new Date().toISOString(),
  }));
  const accepted = await getStore().insertTraces(rows);
  return json({ accepted, dropped: traces.length - kept.length, duplicates: kept.length - accepted }, 202);
});
