import { getStore } from "@/lib/server/store";
import { handle, HttpError, json, readJson, requireAdmin } from "@/lib/server/http";
import { createRun } from "@/lib/server/services";
import { createRunSchema } from "@/lib/zod";

export const GET = handle(async (req: Request) => {
  const u = new URL(req.url);
  const q = {
    agent: u.searchParams.get("agent") || undefined,
    trigger: u.searchParams.get("trigger") || undefined,
    status: u.searchParams.get("status") || undefined,
    limit: Math.min(200, Number(u.searchParams.get("limit") ?? 50) || 50),
    offset: Number(u.searchParams.get("offset") ?? 0) || 0,
  };
  const store = getStore();
  const [items, total] = await Promise.all([store.runs(q), store.countRuns(q)]);
  return json({ items, total });
});

/** POST /runs (admin): start a run, or re-run the failed cases of an earlier run. */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const body = await readJson(req, createRunSchema, 16 * 1024);
  const store = getStore();
  if (body.rerun_of) {
    const prev = await store.run(body.rerun_of);
    if (!prev) throw new HttpError(404, "not_found", "Run to re-run not found.");
    const failed = new Set((await store.results(prev.id)).filter((r) => r.passed === false || r.status === "error").map((r) => r.case_id));
    if (body.only_failed && failed.size === 0) throw new HttpError(422, "nothing_to_rerun", "That run has no failed cases.");
    const versions = await store.suiteVersionsByIds(prev.suite_version_ids);
    const res = await createRun({
      agent: prev.agent_id,
      suites: versions.map((v) => v.suite_id),
      trigger: "manual",
      actor: admin.login,
      profileId: prev.profile_id,
      targetRef: prev.target_ref,
      attempts: prev.attempts,
      caseFilter: body.only_failed ? (c) => failed.has(c.id) : undefined,
    });
    return json({ run_id: res.run.id, dispatched: res.dispatched, reason: res.dispatchReason }, 201);
  }
  const res = await createRun({
    agent: body.agent!,
    suites: body.suites!,
    trigger: "manual",
    actor: admin.login,
    profileVersion: body.profile_version,
    targetRef: body.target_ref,
    attempts: body.attempts,
    budgetCalls: body.budget_calls,
  });
  return json({ run_id: res.run.id, dispatched: res.dispatched, reason: res.dispatchReason }, 201);
});
