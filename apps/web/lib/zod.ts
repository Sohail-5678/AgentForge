import { z } from "zod";

/** zod mirrors of schemas/*.json (shared contracts §S). Loose on agent-specific objects, strict on structure. */

const iso = z.string().min(10).max(40);
const obj = z.record(z.string(), z.unknown());

export const spanSchema = z.object({
  span_id: z.string().min(1).max(120),
  parent_id: z.string().max(120).nullish(),
  kind: z.enum(["node", "llm", "tool", "guard", "retrieval", "human", "sandbox"]),
  name: z.string().min(1).max(200),
  started_at: iso.nullish(),
  duration_ms: z.number().nonnegative().nullish(),
  provider: z.string().max(80).nullish(),
  model: z.string().max(160).nullish(),
  tokens_in: z.number().int().nonnegative().nullish(),
  tokens_out: z.number().int().nonnegative().nullish(),
  status: z.enum(["ok", "error", "blocked"]).nullish(),
  error: z.unknown().optional(),
  input_redacted: z.unknown().optional(),
  output_redacted: z.unknown().optional(),
  attributes: obj.nullish(),
});

export const traceSchema = z.object({
  contract_version: z.literal("trace.v1"),
  trace_id: z.string().uuid(),
  agent: z.enum(["datapilot", "returnpilot", "toy"]),
  agent_version: z.string().max(80).nullish(),
  profile_version: z.string().max(80).nullish(),
  mode: z.enum(["live", "eval"]),
  case_id: z.string().max(160).nullish(),
  started_at: iso,
  ended_at: iso.nullish(),
  status: z.enum(["success", "failure", "error", "blocked", "needs_human", "budget_exceeded"]),
  input: z.unknown().optional(),
  final_output: z.unknown().optional(),
  end_state: obj.nullish(),
  spans: z.array(spanSchema).max(400),
  metrics: z.object({
    llm_calls: z.number().nonnegative().optional(),
    tool_calls: z.number().nonnegative().optional(),
    tokens_in: z.number().nonnegative().optional(),
    tokens_out: z.number().nonnegative().optional(),
    latency_ms: z.number().nonnegative().optional(),
    list_price_cost_usd: z.number().nonnegative().optional(),
  }),
  feedback: z.object({ thumbs: z.number().int().min(-1).max(1).nullish(), comment: z.string().max(2000).nullish() }).nullish(),
});
export type TraceV1 = z.infer<typeof traceSchema>;

export const traceBatchSchema = z.object({ traces: z.array(z.unknown()).min(1).max(20) });

export const feedbackSchema = z.object({
  thumbs: z.number().int().min(-1).max(1),
  comment: z.string().max(2000).nullish(),
});

export const profileSchema = z.object({
  contract_version: z.literal("profile.v1"),
  agent: z.enum(["datapilot", "returnpilot", "toy"]),
  version: z.number().int().min(1),
  parent_version: z.number().int().nullish(),
  created_by: z.enum(["human", "optimizer"]).optional(),
  notes: z.string().max(4000).nullish(),
  prompts: z.record(z.string(), z.string().max(40_000)),
  tool_descriptions: z.record(z.string(), z.string().max(8_000)).optional(),
  few_shots: z.array(z.object({ input: z.unknown(), output: z.unknown() })).max(8).optional(),
  routing: obj.optional(),
  params: obj.optional(),
  locked: z.array(z.string()),
});

export const caseSchema = z.object({
  contract_version: z.literal("case.v1"),
  case_id: z.string().regex(/^[a-z0-9][a-z0-9._-]*(@[0-9]+)?$/).max(120),
  agent: z.enum(["datapilot", "returnpilot", "toy"]),
  suite: z.enum(["benchmark", "scenario", "regression", "redteam"]),
  split: z.enum(["train", "val", "test"]),
  title: z.string().max(300).optional(),
  input: obj,
  setup: obj.optional(),
  expect: obj,
  tags: z.array(z.string().max(60)).max(30).optional(),
  category: z.string().optional(),
  owasp: z.string().optional(),
  family: z.string().optional(),
  severity: z.enum(["low", "medium", "high"]).optional(),
  success_if: obj.optional(),
});

export const graderSchema = z.object({
  grader: z.string().max(60),
  passed: z.boolean().nullable(),
  score: z.number().nullable().optional(),
  details: obj.default({}),
  cost_calls: z.number().int().nonnegative().optional(),
  gating: z.boolean().optional(),
});

export const runnerResultSchema = z.object({
  case_id: z.string().max(160),
  attempt: z.number().int().min(1).max(10).default(1),
  passed: z.boolean().nullable(),
  status: z.string().max(40),
  graders: z.array(graderSchema).max(30),
  block_layer: z.string().max(40).nullish(),
  cost_usd: z.number().nonnegative().nullish(),
  latency_ms: z.number().nonnegative().nullish(),
  llm_calls: z.number().int().nonnegative().nullish(),
  trace: z.unknown().nullish(),
});

export const runnerResultsSchema = z.object({ results: z.array(runnerResultSchema).min(1).max(25) });

export const createRunSchema = z
  .object({
    agent: z.string().optional(),
    suites: z.array(z.string()).max(6).optional(),
    profile_version: z.number().int().optional(),
    target_ref: z.string().max(64).optional(),
    attempts: z.number().int().min(1).max(3).default(1),
    budget_calls: z.number().int().min(1).max(2000).optional(),
    rerun_of: z.string().uuid().optional(),
    only_failed: z.boolean().optional(),
    trigger: z.enum(["manual", "nightly"]).optional(),
  })
  .refine((v) => v.rerun_of || (v.agent && v.suites?.length), { message: "agent + suites or rerun_of is required" });
