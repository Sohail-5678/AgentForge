import { getStore } from "@/lib/server/store";
import { handle, HttpError, json } from "@/lib/server/http";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const run = await getStore().run(id);
  if (!run) throw new HttpError(404, "not_found", "Run not found.");
  return json(run);
});
