import { z } from "zod";
import { getStore } from "@/lib/server/store";
import { handle, HttpError, json, readJson, requireApiKey } from "@/lib/server/http";
import { setCommitStatus } from "@/lib/server/github";
import { createRun } from "@/lib/server/services";

/** POST /gate/pr (§4.6): a target repo's CI asks for a quality gate on a same-repo PR commit. */
const schema = z.object({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/), sha: z.string().regex(/^[0-9a-f]{7,40}$/i), pr: z.number().int().positive() });

export const POST = handle(async (req: Request) => {
  const body = await readJson(req, schema, 4096);
  const key = await requireApiKey(req, "gate:trigger");
  const store = getStore();
  const agent = (await store.agents()).find((a) => a.id === key.agent_id && a.repo.toLowerCase() === body.repo.toLowerCase());
  if (!agent) throw new HttpError(403, "forbidden", "This key may only gate PRs of its own agent's repository.");
  const suites = (await store.suites()).filter((s) => s.agent_id === agent.id);
  const quality = suites.filter((s) => s.kind === "regression").map((s) => s.id);
  const redteam = suites.filter((s) => s.kind === "redteam").map((s) => s.id);
  const { run, dispatched, dispatchReason } = await createRun({
    agent: agent.id,
    suites: [...quality, ...redteam],
    trigger: "pr",
    actor: `key:${key.prefix}`,
    targetRef: body.sha,
    prNumber: body.pr,
    caseFilter: (c) => (c.body.suite === "redteam" ? c.origin === "seed" : c.split !== "train"),
  });
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  await setCommitStatus(agent.repo, body.sha, "pending", "AgentForge quality gate running", `${site}/runs/${run.id}`);
  return json({ run_id: run.id, dispatched, reason: dispatchReason }, 202);
});
