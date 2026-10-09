/**
 * Record types — one per table in db/migrations/0001_init.sql (SPEC §11) and the JSON shapes in docs/CONTRACTS.md.
 * Timestamps are ISO strings; numerics are numbers. These types are shared by the Neon store, the snapshot store
 * and the UI, so a page never knows which store served it.
 */

export type AgentId = "datapilot" | "returnpilot" | "toy";
export type Split = "train" | "val" | "test";
export type SuiteKind = "benchmark" | "scenario" | "regression" | "redteam";
export type RunTrigger = "manual" | "nightly" | "pr" | "optimizer" | "gate";
export type RunStatus = "queued" | "running" | "stalled" | "done" | "failed" | "cancelled";
export type TraceStatus = "success" | "failure" | "error" | "blocked" | "needs_human" | "budget_exceeded";
export type BlockLayer =
  | "input_guard"
  | "policy_engine"
  | "tool_permission"
  | "approval_gate"
  | "sql_guard"
  | "output_guard"
  | "model_refusal"
  | "ineffective";

export interface Interval {
  n: number;
  passed: number;
  rate: number;
  ci: [number, number];
}

export interface Agent {
  id: AgentId | string;
  repo: string;
  adapter_module: string;
  optimizable_keys: { paths?: string[]; param_ranges?: Record<string, [number, number]> } & Record<string, unknown>;
  locked_keys: string[];
  judge_model: string | null;
  noise_profile: Record<string, unknown> | null;
  config: {
    display_name?: string;
    tagline?: string;
    workdir?: string;
    install?: string;
    default_branch?: string;
    suites?: string[];
  } | null;
  created_at: string;
}

export interface ProfileBody {
  contract_version: "profile.v1";
  agent: string;
  version: number;
  parent_version?: number | null;
  created_by?: "human" | "optimizer";
  notes?: string | null;
  prompts: Record<string, string>;
  tool_descriptions?: Record<string, string>;
  few_shots?: { input: unknown; output: unknown }[];
  routing?: Record<string, unknown>;
  params?: Record<string, unknown>;
  locked: string[];
}

export interface Profile {
  id: string;
  agent_id: string;
  version: number;
  parent_version: number | null;
  body: ProfileBody;
  body_hash: string;
  created_by: "human" | "optimizer";
  experiment_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Span {
  span_id: string;
  parent_id?: string | null;
  kind: "node" | "llm" | "tool" | "guard" | "retrieval" | "human" | "sandbox";
  name: string;
  started_at?: string | null;
  duration_ms?: number | null;
  provider?: string | null;
  model?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  status?: "ok" | "error" | "blocked" | null;
  error?: unknown;
  input_redacted?: unknown;
  output_redacted?: unknown;
  attributes?: Record<string, unknown> | null;
}

export interface TraceMetrics {
  llm_calls?: number;
  tool_calls?: number;
  tokens_in?: number;
  tokens_out?: number;
  latency_ms?: number;
  list_price_cost_usd?: number;
}

export interface Trace {
  id: string;
  agent_id: string;
  mode: "live" | "eval";
  run_id: string | null;
  case_id: string | null;
  agent_version: string | null;
  profile_version: string | null;
  status: TraceStatus | string;
  started_at: string;
  ended_at: string | null;
  input: unknown;
  final_output: unknown;
  end_state: Record<string, unknown> | null;
  spans: Span[];
  metrics: TraceMetrics;
  feedback: { thumbs?: number | null; comment?: string | null } | null;
  guard_hit: boolean;
  mined: boolean;
  received_at: string;
}

export interface Suite {
  id: string;
  agent_id: string;
  kind: SuiteKind;
}

export interface CaseBody {
  contract_version: "case.v1";
  case_id: string;
  agent: string;
  suite: SuiteKind;
  split: Split;
  title?: string;
  input: Record<string, unknown>;
  setup?: Record<string, unknown>;
  expect: {
    result_match?: string;
    gold_sql?: string;
    tools_called_in_order?: string[];
    tools_forbidden?: string[];
    end_state?: Record<string, unknown>;
    must_not?: string[];
    rubric?: string[];
    max_steps?: number;
    [k: string]: unknown;
  };
  tags?: string[];
  category?: string;
  owasp?: string;
  family?: string;
  severity?: "low" | "medium" | "high";
  success_if?: Record<string, unknown>;
}

export interface Case {
  id: string;
  suite_id: string;
  split: Split;
  family: string | null;
  body: CaseBody;
  content_hash: string;
  origin: "seed" | "mined" | "mutation" | "manual";
  source_trace_id: string | null;
  retired_at: string | null;
  created_at: string;
}

export interface SuiteVersion {
  id: string;
  suite_id: string;
  hash: string;
  case_ids: string[];
  created_at: string;
}

export interface CaseReview {
  id: string;
  draft: CaseBody;
  cluster_label: string | null;
  source_trace_ids: string[];
  status: "pending" | "accepted" | "rejected";
  reviewer: string | null;
  reason: string | null;
  resulting_case_id: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface Grader {
  grader: string;
  passed: boolean | null;
  score: number | null;
  details: Record<string, unknown>;
  cost_calls?: number;
  gating?: boolean;
}

export interface RedteamSummary {
  n: number;
  succeeded: number;
  asr: number;
  ci: [number, number];
  severity_weighted_asr?: number;
  classifier_evasion_rate?: number;
  high_severity_successes?: number;
  by_category: Record<string, { n: number; succeeded: number; asr: number; ci: [number, number] }>;
  by_layer: Record<string, number>;
  by_category_layer?: Record<string, Record<string, number>>;
}

export interface CompareSummary {
  baseline_run_id: string;
  shared: number;
  baseline_rate: number;
  rate: number;
  diff: number;
  diff_ci: [number, number];
  b: number;
  c: number;
  p_value: number;
  newly_failing: string[];
  newly_passing: string[];
}

export interface RunSummary {
  suites?: string[];
  n_cases: number;
  n_results: number;
  /** first-attempt quality (non-red-team) results that passed / pass_rate / ci are computed over */
  n_quality?: number;
  attempts: number;
  passed: number;
  pass_rate: number;
  ci: [number, number];
  pass_k?: { k: number; n: number; passed_all: number; rate: number; ci: [number, number] } | null;
  by_split?: Partial<Record<Split, Interval>>;
  by_tag?: Record<string, Interval>;
  by_suite?: Record<string, Interval>;
  graders?: Record<string, { applicable: number; failed: number }>;
  hard_failures?: { must_not: number; canary: number };
  redteam?: RedteamSummary | null;
  cost?: { mean_list_price_usd: number; total_list_price_usd: number; mean_llm_calls: number; mean_tokens?: number };
  latency?: { p50_ms: number; p95_ms: number };
  judge?: { calibrated: boolean; kappa: number; n: number } | null;
  flaky_cases?: string[];
  compare?: CompareSummary | null;
  budget?: { calls_used: number; budget_calls: number; stopped_early?: boolean };
  fake_llm?: boolean;
  synthetic?: boolean;
  error?: string;
}

export interface Run {
  id: string;
  seq: number;
  agent_id: string;
  suite_version_ids: string[];
  profile_id: string;
  target_ref: string;
  trigger: RunTrigger;
  pr_number: number | null;
  experiment_id: string | null;
  attempts: number;
  budget_calls: number;
  status: RunStatus;
  gh_run_id: number | null;
  summary: RunSummary | null;
  heartbeat_at: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface Result {
  run_id: string;
  case_id: string;
  attempt: number;
  passed: boolean | null;
  status: string;
  graders: Grader[];
  trace_id: string | null;
  block_layer: BlockLayer | string | null;
  cost_usd: number | null;
  latency_ms: number | null;
  llm_calls: number | null;
}

export interface Attack {
  id: string;
  seed_case_id: string;
  operator: string;
  body: CaseBody | Record<string, unknown>;
  prompt_guard_score: number | null;
  succeeded_in_run: string | null;
  promoted_case_id: string | null;
  created_at: string;
}

export interface ExperimentConfig {
  budget_total?: number;
  nightly_calls?: number;
  max_iters?: number;
  minibatch?: number;
  patience?: number;
  components?: string[];
  seed?: number;
  [k: string]: unknown;
}

export interface ConfigPoint {
  label: string;
  params: Record<string, unknown>;
  val_mean: number;
  cost_mean: number;
  p95_ms?: number;
  on_front?: boolean;
}

export interface Experiment {
  id: string;
  name: string | null;
  agent_id: string;
  parent_profile_id: string;
  config: ExperimentConfig;
  state: {
    iteration?: number;
    night?: number;
    front?: string[];
    history?: { iteration: number; parent: string; component: string; child: string; minibatch: [number, number]; accepted: boolean }[];
    config_search?: ConfigPoint[];
    [k: string]: unknown;
  } | null;
  calls_used: number;
  status: "running" | "paused" | "finished" | "failed" | "cancelled";
  best_candidate_id: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface EditorCheck {
  passed: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
}

export interface Candidate {
  id: string;
  experiment_id: string;
  parent_candidate_id: string | null;
  label: string | null;
  iteration: number | null;
  component: string;
  body: ProfileBody;
  rationale: string | null;
  editor_check: EditorCheck;
  minibatch_score: number | null;
  parent_minibatch_score: number | null;
  val_scores: Record<string, number> | null;
  val_mean: number | null;
  cost_mean: number | null;
  on_front: boolean;
  status: "rejected_editor" | "rejected_minibatch" | "evaluated" | "gated" | "promoted";
  created_at: string;
}

export interface GateCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface GateReport {
  passed: boolean;
  path: "quality" | "efficiency" | null;
  checks: GateCheck[];
  test?: {
    n: number;
    baseline_rate: number;
    candidate_rate: number;
    gain: number;
    gain_ci: [number, number];
    mcnemar_p: number;
    b: number;
    c: number;
    newly_failing?: string[];
    newly_passing?: string[];
  };
  pass_k?: { k: number; baseline: number; candidate: number };
  redteam?: { baseline_asr: number; candidate_asr: number; baseline_high: number; candidate_high: number; n?: number };
  cost?: { baseline_mean: number; candidate_mean: number; change: number };
  latency?: { baseline_p95: number; candidate_p95: number; change: number };
  power?: { n: number; mde_80: number; power_at_10: number; verdict?: string };
  test_attempts?: number;
  note?: string;
}

export interface Promotion {
  id: string;
  agent_id: string;
  from_profile_id: string | null;
  to_profile_id: string;
  candidate_id: string | null;
  gate_run_ids: string[];
  gate_report: GateReport;
  path: "quality" | "efficiency" | "rollback" | "manual" | null;
  test_attempts: number;
  decided_by: string;
  decision: "promoted" | "rejected" | "pending";
  created_at: string;
}

export interface JudgeLabel {
  id: string;
  agent_id: string;
  result_run_id: string;
  case_id: string;
  rubric_item: string;
  human_verdict: boolean;
  judge_verdict: boolean | null;
  labeler: string;
  accepted: boolean;
  created_at: string;
}

export interface JudgeCalibration {
  agent_id: string;
  judge_model: string;
  prompt_hash: string;
  n: number;
  kappa: number;
  agreement: number;
  confusion: { tp?: number; tn?: number; fp?: number; fn?: number; [k: string]: unknown };
  calibrated: boolean;
  computed_at: string;
}

export interface LlmUsage {
  day: string;
  provider: string;
  model: string;
  purpose: string;
  calls: number;
  tokens_in: number;
  tokens_out: number;
}

export interface ApiKey {
  id: string;
  name: string;
  agent_id: string | null;
  key_hash: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  object_type: string;
  object_id: string | null;
  details: Record<string, unknown> | null;
  at: string;
}

export interface Alert {
  id: string;
  agent_id: string | null;
  run_id: string | null;
  level: "info" | "warn" | "critical";
  kind: string;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string;
  resolved_at: string | null;
}

export interface SnapshotTables {
  agents: Agent[];
  profiles: Profile[];
  suites: Suite[];
  cases: Case[];
  suite_versions: SuiteVersion[];
  runs: Run[];
  results: Result[];
  traces: Trace[];
  attacks: Attack[];
  optimizer_experiments: Experiment[];
  optimizer_candidates: Candidate[];
  promotions: Promotion[];
  case_reviews: CaseReview[];
  judge_labels: JudgeLabel[];
  judge_calibration: JudgeCalibration[];
  llm_usage: LlmUsage[];
  audit_log: AuditEntry[];
  alerts: Alert[];
  api_keys: ApiKey[];
}

export interface Snapshot {
  contract_version: "snapshot.v1";
  generated_at: string;
  generator: { command: string; runner_version: string; seed: number; note: string };
  tables: SnapshotTables;
}
