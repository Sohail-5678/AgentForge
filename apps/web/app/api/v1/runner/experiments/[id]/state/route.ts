import { z } from "zod";
import { getStore } from "@/lib/server/store";
import { handle, HttpError, json, readJson, requireRunner } from "@/lib/server/http";

/** GET/PUT /runner/experiments/{id}/state (§12.2) — resumable optimizer state, saved after every iteration. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireRunner(req);
  const { id } = await ctx.params;
  const store = getStore();
  const exp = await store.experiment(id);
  if (!exp) throw new HttpError(404, "not_found", "Experiment not found.");
  const [agent, parent, candidates] = await Promise.all([
    store.agents().then((a) => a.find((x) => x.id === exp.agent_id)),
    store.profile(exp.parent_profile_id),
    store.candidates(id),
  ]);
  return json({ experiment: exp, agent, parent_profile: parent?.body ?? null, candidates });
});

const schema = z.object({
  state: z.record(z.string(), z.unknown()),
  calls_used: z.number().int().nonnegative(),
  status: z.enum(["running", "paused", "finished", "failed"]).optional(),
  best_candidate_id: z.string().uuid().nullish(),
});

export const PUT = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireRunner(req);
  const { id } = await ctx.params;
  const body = await readJson(req, schema, 1024 * 1024);
  const store = getStore();
  const exp = await store.experiment(id);
  if (!exp) throw new HttpError(404, "not_found", "Experiment not found.");
  if (exp.status === "cancelled") throw new HttpError(409, "cancelled", "Experiment was cancelled.");
  await store.updateExperiment(id, {
    state: body.state as never,
    calls_used: body.calls_used,
    ...(body.status ? { status: body.status } : {}),
    ...(body.best_candidate_id ? { best_candidate_id: body.best_candidate_id } : {}),
    ...(body.status === "finished" ? { finished_at: new Date().toISOString() } : {}),
  });
  return json({ ok: true });
});
