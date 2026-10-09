import { z } from "zod";
import { handle, json, readJson, requireAdmin } from "@/lib/server/http";
import { decideReview } from "@/lib/server/services";

/** POST /reviews/{id}/decide (admin): {decision, edited_case?, reason?} — accepted drafts join the regression suite. */
const schema = z.object({ decision: z.enum(["accept", "reject"]), edited_case: z.record(z.string(), z.unknown()).optional(), reason: z.string().max(1000).optional() });

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const body = await readJson(req, schema, 64 * 1024);
  const caseId = await decideReview(id, body.decision === "accept" ? "accepted" : "rejected", admin.login, body.edited_case, body.reason);
  return json({ ok: true, case_id: caseId });
});
