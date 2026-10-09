import { z } from "zod";
import { getStore } from "@/lib/server/store";
import { handle, json, readJson, redactDeep, requireRunner } from "@/lib/server/http";
import type { CaseBody } from "@/lib/types";
import { caseSchema } from "@/lib/zod";

/** POST /runner/reviews — mined drafts + successful mutations enter the human review queue; nothing auto-enters a suite. */
const schema = z.object({
  drafts: z
    .array(z.object({ draft: caseSchema, cluster_label: z.string().max(300).nullish(), source_trace_ids: z.array(z.string().uuid()).max(50).default([]) }))
    .min(1)
    .max(50),
});

export const POST = handle(async (req: Request) => {
  requireRunner(req);
  const body = await readJson(req, schema, 512 * 1024);
  const n = await getStore().insertReviews(
    body.drafts.map((d) => ({ draft: redactDeep(d.draft) as CaseBody, cluster_label: d.cluster_label ?? null, source_trace_ids: d.source_trace_ids })),
  );
  return json({ queued: n }, 201);
});
