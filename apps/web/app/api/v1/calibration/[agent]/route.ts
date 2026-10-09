import { createHash } from "node:crypto";
import { z } from "zod";
import { getStore } from "@/lib/server/store";
import { handle, HttpError, json, readJson, requireUser } from "@/lib/server/http";
import { cohensKappa } from "@/lib/stats";

/**
 * GET /calibration/{agent}: blind labelling items (judge verdicts hidden) + the current kappa report.
 * POST: submit labels. Labels from non-admins are stored but not accepted until an admin does so (§2.1).
 */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ agent: string }> }) => {
  const { agent } = await ctx.params;
  const store = getStore();
  const [labels, calibrations, runs] = await Promise.all([
    store.judgeLabels(agent),
    store.calibrations(),
    store.runs({ agent, status: "done", limit: 5 }),
  ]);
  const labelled = new Set(labels.map((l) => `${l.result_run_id}|${l.case_id}|${l.rubric_item}`));
  const items: { run_id: string; case_id: string; rubric_item: string; output: unknown }[] = [];
  for (const run of runs) {
    const results = await store.results(run.id);
    for (const r of results) {
      const judge = r.graders.find((g) => g.grader === "rubric_judge");
      const list = (judge?.details?.items ?? []) as { item?: string }[];
      for (const it of list) {
        if (!it.item || labelled.has(`${run.id}|${r.case_id}|${it.item}`)) continue;
        items.push({ run_id: run.id, case_id: r.case_id, rubric_item: it.item, output: null });
        if (items.length >= 20) break;
      }
      if (items.length >= 20) break;
    }
    if (items.length >= 20) break;
  }
  const accepted = labels.filter((l) => l.accepted && l.judge_verdict !== null);
  const report = cohensKappa(accepted.map((l) => ({ human: l.human_verdict, judge: !!l.judge_verdict })));
  return json({ items, report, calibration: calibrations.filter((c) => c.agent_id === agent) });
});

const schema = z.object({
  labels: z
    .array(z.object({ run_id: z.string().uuid(), case_id: z.string(), rubric_item: z.string().max(500), human_verdict: z.boolean() }))
    .min(1)
    .max(50),
});

export const POST = handle(async (req: Request, ctx: { params: Promise<{ agent: string }> }) => {
  const user = await requireUser();
  const { agent } = await ctx.params;
  const body = await readJson(req, schema, 64 * 1024);
  const store = getStore();
  if (store.readonly) throw new HttpError(503, "read_only_demo", "Read-only demo snapshot.");
  const rows = [];
  for (const l of body.labels) {
    const results = await store.results(l.run_id);
    const judge = results.find((r) => r.case_id === l.case_id)?.graders.find((g) => g.grader === "rubric_judge");
    const item = ((judge?.details?.items ?? []) as { item?: string; verdict?: boolean }[]).find((i) => i.item === l.rubric_item);
    rows.push({ agent_id: agent, result_run_id: l.run_id, case_id: l.case_id, rubric_item: l.rubric_item, human_verdict: l.human_verdict, judge_verdict: item?.verdict ?? null, labeler: user.login, accepted: user.role === "admin" });
  }
  const n = await store.insertJudgeLabels(rows);
  if (user.role === "admin") {
    const accepted = (await store.judgeLabels(agent)).filter((l) => l.accepted && l.judge_verdict !== null);
    const k = cohensKappa(accepted.map((l) => ({ human: l.human_verdict, judge: !!l.judge_verdict })));
    const model = process.env[`JUDGE_MODEL_${agent.toUpperCase()}`] ?? "gemini-flash";
    const promptHash = createHash("sha256").update(process.env.JUDGE_PROMPT_VERSION ?? "judge-v1").digest("hex").slice(0, 12);
    await store.upsertCalibration({ agent_id: agent, judge_model: model, prompt_hash: promptHash, n: k.n, kappa: k.kappa, agreement: k.agreement, confusion: k.confusion, calibrated: k.kappa >= 0.6 && k.n >= 50, computed_at: new Date().toISOString() });
  }
  return json({ stored: n, accepted: user.role === "admin" });
});
