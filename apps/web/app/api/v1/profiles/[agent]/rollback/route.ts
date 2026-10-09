import { z } from "zod";
import { handle, json, readJson, requireAdmin } from "@/lib/server/http";
import { rollback } from "@/lib/server/services";

/** POST /profiles/{agent}/rollback (admin): re-activate a previous version — same path as promotion, no gate (§9.6). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ agent: string }> }) => {
  const { agent } = await ctx.params;
  const admin = await requireAdmin();
  const body = await readJson(req, z.object({ to_version: z.number().int().min(1) }), 4096);
  const promotion = await rollback(agent, body.to_version, admin.login);
  return json({ ok: true, promotion_id: promotion.id });
});
