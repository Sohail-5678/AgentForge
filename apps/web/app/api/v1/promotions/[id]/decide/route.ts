import { z } from "zod";
import { handle, json, readJson, requireAdmin } from "@/lib/server/http";
import { decidePromotion } from "@/lib/server/services";

/** POST /promotions/{id}/decide (admin) {decision} — after the gate report; activates the profile in one transaction. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const body = await readJson(req, z.object({ decision: z.enum(["promoted", "rejected"]) }), 4096);
  await decidePromotion(id, body.decision, admin.login);
  return json({ ok: true });
});
