import { getStore } from "@/lib/server/store";
import { handle, json, requireAdmin } from "@/lib/server/http";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  await getStore().resolveAlert(id);
  await getStore().writeAudit({ actor: admin.login, action: "alert.resolve", object_type: "alert", object_id: id, details: null });
  return json({ ok: true });
});
