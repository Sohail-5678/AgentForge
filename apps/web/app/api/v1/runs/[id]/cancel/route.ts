import { getStore } from "@/lib/server/store";
import { handle, HttpError, json, requireAdmin } from "@/lib/server/http";
import { cancelWorkflowRun } from "@/lib/server/github";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const store = getStore();
  const run = await store.run(id);
  if (!run) throw new HttpError(404, "not_found", "Run not found.");
  if (!["queued", "running", "stalled"].includes(run.status)) throw new HttpError(409, "not_cancellable", `Run is ${run.status}.`);
  const gh = run.gh_run_id ? await cancelWorkflowRun(run.gh_run_id) : null;
  await store.updateRun(id, { status: "cancelled", finished_at: new Date().toISOString() });
  await store.writeAudit({ actor: admin.login, action: "run.cancel", object_type: "run", object_id: id, details: { gh_cancel: gh?.ok ?? null } });
  return json({ ok: true });
});
