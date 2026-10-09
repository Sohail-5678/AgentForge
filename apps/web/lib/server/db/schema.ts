import {
  bigint,
  bigserial,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Drizzle mirror of db/migrations/0001_init.sql (the SQL file is the source of truth; keep both in sync). */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  repo: text("repo").notNull(),
  adapter_module: text("adapter_module").notNull(),
  optimizable_keys: jsonb("optimizable_keys").notNull(),
  locked_keys: jsonb("locked_keys").notNull(),
  judge_model: text("judge_model"),
  noise_profile: jsonb("noise_profile"),
  config: jsonb("config"),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  agent_id: text("agent_id").notNull(),
  version: integer("version").notNull(),
  parent_version: integer("parent_version"),
  body: jsonb("body").notNull(),
  body_hash: text("body_hash").notNull(),
  created_by: text("created_by").notNull(),
  experiment_id: uuid("experiment_id"),
  is_active: boolean("is_active").notNull().default(false),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const traces = pgTable("traces", {
  id: uuid("id").primaryKey(),
  agent_id: text("agent_id").notNull(),
  mode: text("mode").notNull(),
  run_id: uuid("run_id"),
  case_id: text("case_id"),
  agent_version: text("agent_version"),
  profile_version: text("profile_version"),
  status: text("status").notNull(),
  started_at: ts("started_at").notNull(),
  ended_at: ts("ended_at"),
  input: jsonb("input"),
  final_output: jsonb("final_output"),
  end_state: jsonb("end_state"),
  spans: jsonb("spans").notNull(),
  metrics: jsonb("metrics").notNull(),
  feedback: jsonb("feedback"),
  guard_hit: boolean("guard_hit").notNull().default(false),
  mined: boolean("mined").notNull().default(false),
  received_at: ts("received_at").notNull().defaultNow(),
});

export const suites = pgTable("suites", {
  id: text("id").primaryKey(),
  agent_id: text("agent_id").notNull(),
  kind: text("kind").notNull(),
});

export const cases = pgTable("cases", {
  id: text("id").primaryKey(),
  suite_id: text("suite_id").notNull(),
  split: text("split").notNull(),
  family: text("family"),
  body: jsonb("body").notNull(),
  content_hash: text("content_hash").notNull(),
  origin: text("origin").notNull(),
  source_trace_id: uuid("source_trace_id"),
  retired_at: ts("retired_at"),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const suiteVersions = pgTable("suite_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  suite_id: text("suite_id").notNull(),
  hash: text("hash").notNull(),
  case_ids: text("case_ids").array().notNull(),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const caseReviews = pgTable("case_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  draft: jsonb("draft").notNull(),
  cluster_label: text("cluster_label"),
  source_trace_ids: uuid("source_trace_ids").array().notNull(),
  status: text("status").notNull().default("pending"),
  reviewer: text("reviewer"),
  reason: text("reason"),
  resulting_case_id: text("resulting_case_id"),
  created_at: ts("created_at").notNull().defaultNow(),
  decided_at: ts("decided_at"),
});

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  seq: bigint("seq", { mode: "number" }).generatedByDefaultAsIdentity(),
  agent_id: text("agent_id").notNull(),
  suite_version_ids: uuid("suite_version_ids").array().notNull(),
  profile_id: uuid("profile_id").notNull(),
  target_ref: text("target_ref").notNull(),
  trigger: text("trigger").notNull(),
  pr_number: integer("pr_number"),
  experiment_id: uuid("experiment_id"),
  attempts: integer("attempts").notNull().default(1),
  budget_calls: integer("budget_calls").notNull(),
  status: text("status").notNull().default("queued"),
  gh_run_id: bigint("gh_run_id", { mode: "number" }),
  summary: jsonb("summary"),
  heartbeat_at: ts("heartbeat_at"),
  created_at: ts("created_at").notNull().defaultNow(),
  finished_at: ts("finished_at"),
});

export const results = pgTable(
  "results",
  {
    run_id: uuid("run_id").notNull(),
    case_id: text("case_id").notNull(),
    attempt: integer("attempt").notNull().default(1),
    passed: boolean("passed"),
    status: text("status").notNull(),
    graders: jsonb("graders").notNull(),
    trace_id: uuid("trace_id"),
    block_layer: text("block_layer"),
    cost_usd: numeric("cost_usd", { precision: 10, scale: 6, mode: "number" }),
    latency_ms: integer("latency_ms"),
    llm_calls: integer("llm_calls"),
  },
  (t) => [primaryKey({ columns: [t.run_id, t.case_id, t.attempt] })],
);

export const attacks = pgTable("attacks", {
  id: uuid("id").primaryKey().defaultRandom(),
  seed_case_id: text("seed_case_id").notNull(),
  operator: text("operator").notNull(),
  body: jsonb("body").notNull(),
  prompt_guard_score: real("prompt_guard_score"),
  succeeded_in_run: uuid("succeeded_in_run"),
  promoted_case_id: text("promoted_case_id"),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const experiments = pgTable("optimizer_experiments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  agent_id: text("agent_id").notNull(),
  parent_profile_id: uuid("parent_profile_id").notNull(),
  config: jsonb("config").notNull(),
  state: jsonb("state"),
  calls_used: integer("calls_used").notNull().default(0),
  status: text("status").notNull().default("running"),
  best_candidate_id: uuid("best_candidate_id"),
  created_at: ts("created_at").notNull().defaultNow(),
  finished_at: ts("finished_at"),
});

export const candidates = pgTable("optimizer_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  experiment_id: uuid("experiment_id").notNull(),
  parent_candidate_id: uuid("parent_candidate_id"),
  label: text("label"),
  iteration: integer("iteration"),
  component: text("component").notNull(),
  body: jsonb("body").notNull(),
  rationale: text("rationale"),
  editor_check: jsonb("editor_check").notNull(),
  minibatch_score: real("minibatch_score"),
  parent_minibatch_score: real("parent_minibatch_score"),
  val_scores: jsonb("val_scores"),
  val_mean: real("val_mean"),
  cost_mean: real("cost_mean"),
  on_front: boolean("on_front").notNull().default(false),
  status: text("status").notNull(),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const promotions = pgTable("promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  agent_id: text("agent_id").notNull(),
  from_profile_id: uuid("from_profile_id"),
  to_profile_id: uuid("to_profile_id").notNull(),
  candidate_id: uuid("candidate_id"),
  gate_run_ids: uuid("gate_run_ids").array().notNull(),
  gate_report: jsonb("gate_report").notNull(),
  path: text("path"),
  test_attempts: integer("test_attempts").notNull().default(1),
  decided_by: text("decided_by").notNull(),
  decision: text("decision").notNull(),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const judgeLabels = pgTable("judge_labels", {
  id: uuid("id").primaryKey().defaultRandom(),
  agent_id: text("agent_id").notNull(),
  result_run_id: uuid("result_run_id").notNull(),
  case_id: text("case_id").notNull(),
  rubric_item: text("rubric_item").notNull(),
  human_verdict: boolean("human_verdict").notNull(),
  judge_verdict: boolean("judge_verdict"),
  labeler: text("labeler").notNull(),
  accepted: boolean("accepted").notNull().default(false),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const judgeCalibration = pgTable(
  "judge_calibration",
  {
    agent_id: text("agent_id").notNull(),
    judge_model: text("judge_model").notNull(),
    prompt_hash: text("prompt_hash").notNull(),
    n: integer("n").notNull(),
    kappa: real("kappa").notNull(),
    agreement: real("agreement").notNull(),
    confusion: jsonb("confusion").notNull(),
    calibrated: boolean("calibrated").notNull(),
    computed_at: ts("computed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agent_id, t.judge_model, t.prompt_hash] })],
);

export const llmUsage = pgTable(
  "llm_usage",
  {
    day: date("day", { mode: "string" }).notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    purpose: text("purpose").notNull(),
    calls: integer("calls").notNull().default(0),
    tokens_in: bigint("tokens_in", { mode: "number" }).notNull().default(0),
    tokens_out: bigint("tokens_out", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.provider, t.model, t.purpose] })],
);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  agent_id: text("agent_id"),
  key_hash: text("key_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  scopes: text("scopes").array().notNull(),
  last_used_at: ts("last_used_at"),
  revoked_at: ts("revoked_at"),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key_id: uuid("key_id").notNull(),
    window_start: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key_id, t.window_start] })],
);

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  object_type: text("object_type").notNull(),
  object_id: text("object_id"),
  details: jsonb("details"),
  at: ts("at").notNull().defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  agent_id: text("agent_id"),
  run_id: uuid("run_id"),
  level: text("level").notNull(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  details: jsonb("details"),
  created_at: ts("created_at").notNull().defaultNow(),
  resolved_at: ts("resolved_at"),
});
