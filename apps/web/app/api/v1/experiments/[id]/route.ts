import { getStore } from "@/lib/server/store";
import { handle, HttpError, json } from "@/lib/server/http";

/** GET /experiments/{id}: tree, front, candidates, budget. */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const store = getStore();
  const exp = await store.experiment(id);
  if (!exp) throw new HttpError(404, "not_found", "Experiment not found.");
  const candidates = await store.candidates(id);
  return json({ experiment: exp, candidates, front: candidates.filter((c) => c.on_front).map((c) => c.id) });
});
