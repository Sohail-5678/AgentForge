import { getStore } from "@/lib/server/store";
import { handle, HttpError, json, requireAdmin } from "@/lib/server/http";

const NEXT: Record<string, { from: string[]; to: "paused" | "running" | "cancelled" }> = {
  pause: { from: ["running"], to: "paused" },
  resume: { from: ["paused"], to: "running" },
  cancel: { from: ["running", "paused"], to: "cancelled" },
};

/** POST /experiments/{id}/pause | resume | cancel (admin). */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string; op: string }> }) => {
  const admin = await requireAdmin();
  const { id, op } = await ctx.params;
  const rule = NEXT[op];
  if (!rule) throw new HttpError(404, "not_found", `Unknown operation ${op}.`);
  const store = getStore();
  const exp = await store.experiment(id);
  if (!exp) throw new HttpError(404, "not_found", "Experiment not found.");
  if (!rule.from.includes(exp.status)) throw new HttpError(409, "bad_state", `Cannot ${op} an experiment that is ${exp.status}.`);
  await store.updateExperiment(id, { status: rule.to, ...(rule.to === "cancelled" ? { finished_at: new Date().toISOString() } : {}) });
  await store.writeAudit({ actor: admin.login, action: `experiment.${op}`, object_type: "experiment", object_id: id, details: null });
  return json({ ok: true, status: rule.to });
});
