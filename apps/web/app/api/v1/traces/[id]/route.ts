import { getStore } from "@/lib/server/store";
import { handle, HttpError, json } from "@/lib/server/http";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const trace = await getStore().trace(id);
  if (!trace) throw new HttpError(404, "not_found", "Trace not found (it may have been purged — live traces are kept 30 days).");
  return json(trace, { headers: { "cache-control": "public, max-age=60, s-maxage=300" } });
});
