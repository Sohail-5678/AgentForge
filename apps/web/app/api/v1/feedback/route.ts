import { z } from "zod";
import { getStore } from "@/lib/server/store";
import { handle, HttpError, json, readJson, requireApiKey } from "@/lib/server/http";

/** POST /feedback — DataPilot's shape {agent, trace_id, thumbs, comment}; same semantics as PATCH /traces/{id}/feedback. */
const schema = z.object({ agent: z.string(), trace_id: z.string().uuid(), thumbs: z.number().int().min(-1).max(1), comment: z.string().max(2000).nullish() });

export const POST = handle(async (req: Request) => {
  const body = await readJson(req, schema, 8 * 1024);
  await requireApiKey(req, "traces:write", body.agent);
  const ok = await getStore().setTraceFeedback(body.trace_id, body.agent, { thumbs: body.thumbs, comment: body.comment ?? null });
  if (!ok) throw new HttpError(404, "not_found", "Trace not stored (sampled out) — re-send the trace with its feedback.");
  return json({ ok: true });
});
