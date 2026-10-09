import { getStore } from "@/lib/server/store";
import { handle, json, requireRunner } from "@/lib/server/http";

/** POST /admin/purge (runner key, daily purge.yml): live traces older than TRACE_RETENTION_DAYS (30) — §10.5. */
export const POST = handle(async (req: Request) => {
  requireRunner(req);
  const days = Number(process.env.TRACE_RETENTION_DAYS ?? 30);
  const before = new Date(Date.now() - days * 86400_000).toISOString();
  const store = getStore();
  const purged = await store.purgeTraces(before);
  await store.writeAudit({ actor: "runner", action: "traces.purge", object_type: "traces", object_id: null, details: { before, purged } });
  return json({ ok: true, purged, before });
});
