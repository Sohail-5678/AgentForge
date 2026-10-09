import { getStore } from "@/lib/server/store";
import { handle, HttpError, json, readJson, requireApiKey } from "@/lib/server/http";
import { feedbackSchema } from "@/lib/zod";

/** PATCH /traces/{id}/feedback (§12.1). A sampled-out success with negative feedback is re-sent by the agent (§4.1). */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = await readJson(req, feedbackSchema, 8 * 1024);
  const key = await requireApiKey(req, "traces:write");
  const ok = await getStore().setTraceFeedback(id, key.agent_id ?? "", { thumbs: body.thumbs, comment: body.comment ?? null });
  if (!ok) throw new HttpError(404, "not_found", "Trace not stored (sampled out) — re-send the trace with its feedback.");
  return json({ ok: true });
});
