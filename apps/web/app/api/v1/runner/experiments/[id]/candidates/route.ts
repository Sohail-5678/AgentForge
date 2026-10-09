import { z } from "zod";
import { getStore } from "@/lib/server/store";
import { handle, HttpError, json, readJson, requireRunner } from "@/lib/server/http";
import { assertLockedUnchanged } from "@/lib/server/services";
import type { ProfileBody } from "@/lib/types";
import { profileSchema } from "@/lib/zod";

/** POST /runner/experiments/{id}/candidates — the control plane re-checks locked keys (2nd of 3 checks, §10.4). */
const schema = z.object({
  parent_candidate_id: z.string().uuid().nullish(),
  label: z.string().max(20).nullish(),
  iteration: z.number().int().nullish(),
  component: z.string().max(120),
  body: profileSchema,
  rationale: z.string().max(4000).nullish(),
  editor_check: z.object({ passed: z.boolean(), checks: z.array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string() })) }),
  minibatch_score: z.number().nullish(),
  parent_minibatch_score: z.number().nullish(),
  val_scores: z.record(z.string(), z.number()).nullish(),
  val_mean: z.number().nullish(),
  cost_mean: z.number().nullish(),
  on_front: z.boolean().default(false),
  status: z.enum(["rejected_editor", "rejected_minibatch", "evaluated"]),
});

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireRunner(req);
  const { id } = await ctx.params;
  const body = await readJson(req, schema, 512 * 1024);
  const store = getStore();
  const exp = await store.experiment(id);
  if (!exp) throw new HttpError(404, "not_found", "Experiment not found.");
  const parent = await store.profile(exp.parent_profile_id);
  let status = body.status;
  let editor = body.editor_check;
  if (parent && status !== "rejected_editor") {
    try {
      assertLockedUnchanged(parent.body, body.body as ProfileBody);
    } catch (e) {
      status = "rejected_editor";
      editor = { passed: false, checks: [...editor.checks, { name: "control_plane_locked_keys", passed: false, detail: (e as Error).message }] };
    }
  }
  const cand = await store.insertCandidate({
    experiment_id: id,
    parent_candidate_id: body.parent_candidate_id ?? null,
    label: body.label ?? null,
    iteration: body.iteration ?? null,
    component: body.component,
    body: body.body as ProfileBody,
    rationale: body.rationale ?? null,
    editor_check: editor,
    minibatch_score: body.minibatch_score ?? null,
    parent_minibatch_score: body.parent_minibatch_score ?? null,
    val_scores: body.val_scores ?? null,
    val_mean: body.val_mean ?? null,
    cost_mean: body.cost_mean ?? null,
    on_front: body.on_front,
    status,
  });
  return json({ id: cand.id, status }, 201);
});
