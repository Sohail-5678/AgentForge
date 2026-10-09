import { handle, json, requireRunner } from "@/lib/server/http";
import { runnerConfig } from "@/lib/server/services";

/** GET /runner/runs/{id} (§12.2): everything a job needs — the workflow input is only the run id (§10.2). */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireRunner(req);
  const { id } = await ctx.params;
  return json(await runnerConfig(id));
});
