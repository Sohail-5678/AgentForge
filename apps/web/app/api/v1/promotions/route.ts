import { z } from "zod";
import { getStore } from "@/lib/server/store";
import { handle, json, readJson, requireAdmin } from "@/lib/server/http";
import { requestPromotion } from "@/lib/server/services";

export const GET = handle(async (req: Request) => {
  const agent = new URL(req.url).searchParams.get("agent") || undefined;
  return json({ items: await getStore().promotions(agent) });
});

/** POST /promotions (admin) {candidate_id} → candidate profile + gate runs (TEST × pass^2 + red-team core, both profiles). */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const body = await readJson(req, z.object({ candidate_id: z.string().uuid() }), 4096);
  const res = await requestPromotion(body.candidate_id, admin.login);
  return json({ promotion_id: res.promotion.id, gate_run_ids: res.runs }, 201);
});
