import { z } from "zod";
import { getStore } from "@/lib/server/store";
import { handle, json, readJson, requireRunner } from "@/lib/server/http";

/** POST /runner/usage — the runner's LLM ledger rows (per day/provider/model/purpose), summed server-side. */
const row = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provider: z.string().max(40),
  model: z.string().max(160),
  purpose: z.string().max(40),
  calls: z.number().int().nonnegative(),
  tokens_in: z.number().int().nonnegative().default(0),
  tokens_out: z.number().int().nonnegative().default(0),
});

export const POST = handle(async (req: Request) => {
  requireRunner(req);
  const body = await readJson(req, z.object({ rows: z.array(row).min(1).max(200) }), 64 * 1024);
  await getStore().addUsage(body.rows);
  return json({ ok: true, rows: body.rows.length });
});
