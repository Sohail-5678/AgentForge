import { z } from "zod";
import { getStore } from "@/lib/server/store";
import { handle, HttpError, json, readJson, requireAdmin } from "@/lib/server/http";

export const GET = handle(async (req: Request) => {
  const agent = new URL(req.url).searchParams.get("agent") || undefined;
  return json({ items: await getStore().experiments(agent) });
});

/** POST /experiments (admin): create a GEPA-lite experiment from the active profile (§4.4, §9). */
const schema = z.object({
  agent: z.string(),
  components: z.array(z.string()).max(12).optional(),
  budget_total: z.number().int().min(50).max(5000).optional(),
});

export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const body = await readJson(req, schema, 8192);
  const store = getStore();
  const [agent, active, running] = await Promise.all([
    store.agents().then((a) => a.find((x) => x.id === body.agent)),
    store.activeProfile(body.agent),
    store.experiments(body.agent).then((e) => e.filter((x) => x.status === "running")),
  ]);
  if (!agent || !active) throw new HttpError(422, "no_active_profile", "Agent not registered or no active profile.");
  if (running.length) throw new HttpError(409, "already_running", "An experiment is already running for this agent.");
  const paths = agent.optimizable_keys.paths ?? [];
  const exp = await store.createExperiment({
    name: `opt-${agent.id}-${new Date().toISOString().slice(0, 10)}`,
    agent_id: agent.id,
    parent_profile_id: active.id,
    config: {
      budget_total: body.budget_total ?? Number(process.env.OPT_TOTAL_CALLS ?? 1500),
      nightly_calls: Number(process.env.OPT_NIGHTLY_CALLS ?? 300),
      max_iters: Number(process.env.OPT_MAX_ITERS ?? 8),
      minibatch: Number(process.env.OPT_MINIBATCH ?? 10),
      patience: 3,
      components: body.components ?? paths.filter((p) => p.startsWith("prompts.") || p.startsWith("tool_descriptions.") || p === "few_shots"),
      seed: 7,
    },
    state: { iteration: 0, night: 0, front: [], history: [] },
    status: "running",
  });
  await store.writeAudit({ actor: admin.login, action: "experiment.create", object_type: "experiment", object_id: exp.id, details: { agent: agent.id } });
  return json({ id: exp.id }, 201);
});
