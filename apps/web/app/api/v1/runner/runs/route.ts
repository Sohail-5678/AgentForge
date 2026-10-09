import { z } from "zod";
import { getStore } from "@/lib/server/store";
import { handle, json, readJson, requireRunner } from "@/lib/server/http";
import { createRun } from "@/lib/server/services";

/** POST /runner/runs — used by `af-run nightly` (§4.3): regression (all splits) + red-team core on the active profile. */
const schema = z.object({
  agent: z.string(),
  suites: z.array(z.string()).optional(),
  trigger: z.enum(["nightly", "optimizer"]).default("nightly"),
  attempts: z.number().int().min(1).max(3).default(1),
  budget_calls: z.number().int().min(1).max(2000).optional(),
  experiment_id: z.string().uuid().optional(),
});

export const POST = handle(async (req: Request) => {
  requireRunner(req);
  const body = await readJson(req, schema, 8192);
  const suites = (await getStore().suites()).filter((s) => s.agent_id === body.agent);
  const defaults = [
    ...(suites.some((s) => s.kind === "regression") ? suites.filter((s) => s.kind === "regression") : suites.filter((s) => s.kind !== "redteam")),
    ...suites.filter((s) => s.kind === "redteam"),
  ].map((s) => s.id);
  const { run, dispatched, dispatchReason } = await createRun({
    agent: body.agent,
    suites: body.suites ?? defaults,
    trigger: body.trigger,
    actor: "runner",
    attempts: body.attempts,
    budgetCalls: body.budget_calls,
    experimentId: body.experiment_id ?? null,
    caseFilter: (c) => c.body.suite !== "redteam" || c.origin === "seed",
  });
  return json({ run_id: run.id, seq: run.seq, dispatched, reason: dispatchReason }, 201);
});
