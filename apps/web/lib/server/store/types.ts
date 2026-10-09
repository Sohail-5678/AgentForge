import type {
  Agent,
  Alert,
  ApiKey,
  Attack,
  AuditEntry,
  Candidate,
  Case,
  CaseReview,
  Experiment,
  JudgeCalibration,
  JudgeLabel,
  LlmUsage,
  Profile,
  Promotion,
  Result,
  Run,
  Suite,
  SuiteVersion,
  Trace,
} from "@/lib/types";

export interface RunQuery {
  agent?: string;
  trigger?: string;
  status?: string;
  experimentId?: string;
  limit?: number;
  offset?: number;
}

export interface TraceQuery {
  agent?: string;
  status?: string;
  feedback?: "down" | "up" | "any";
  guardHit?: boolean;
  profileVersion?: string;
  mode?: "live" | "eval";
  runId?: string;
  /** keyset cursor: `${started_at}|${id}` of the last row on the previous page */
  cursor?: string | null;
  limit?: number;
}

export interface CaseQuery {
  agent?: string;
  suite?: string;
  split?: string;
  tag?: string;
  includeRetired?: boolean;
}

export type NewRun = Omit<Run, "id" | "seq" | "created_at" | "summary" | "heartbeat_at" | "finished_at" | "gh_run_id"> &
  Partial<Pick<Run, "summary" | "gh_run_id">>;

export class ReadOnlyError extends Error {
  constructor() {
    super("This deployment is serving the read-only demo snapshot (no DATABASE_URL).");
    this.name = "ReadOnlyError";
  }
}

/**
 * Everything the control plane reads or writes. Two implementations: Neon/Postgres (system of record) and the
 * committed demo snapshot (read-only; every write throws ReadOnlyError). Pages and route handlers only see this.
 */
export interface Store {
  readonly mode: "postgres" | "snapshot";
  readonly readonly: boolean;
  generatedAt(): Promise<string | null>;

  agents(): Promise<Agent[]>;
  profiles(agentId?: string): Promise<Profile[]>;
  profile(id: string): Promise<Profile | null>;
  activeProfile(agentId: string): Promise<Profile | null>;
  runs(q?: RunQuery): Promise<Run[]>;
  countRuns(q?: RunQuery): Promise<number>;
  run(idOrSeq: string): Promise<Run | null>;
  results(runId: string): Promise<Result[]>;
  resultsForRuns(runIds: string[]): Promise<Result[]>;
  trace(id: string): Promise<Trace | null>;
  traces(q?: TraceQuery): Promise<{ items: Trace[]; next: string | null }>;
  suites(): Promise<Suite[]>;
  suiteVersions(suiteId?: string): Promise<SuiteVersion[]>;
  suiteVersionsByIds(ids: string[]): Promise<SuiteVersion[]>;
  cases(q?: CaseQuery): Promise<Case[]>;
  casesByIds(ids: string[]): Promise<Case[]>;
  reviews(status?: string): Promise<CaseReview[]>;
  review(id: string): Promise<CaseReview | null>;
  attacks(): Promise<Attack[]>;
  experiments(agentId?: string): Promise<Experiment[]>;
  experiment(id: string): Promise<Experiment | null>;
  candidates(experimentId: string): Promise<Candidate[]>;
  candidate(id: string): Promise<Candidate | null>;
  promotions(agentId?: string): Promise<Promotion[]>;
  promotion(id: string): Promise<Promotion | null>;
  judgeLabels(agentId?: string): Promise<JudgeLabel[]>;
  calibrations(): Promise<JudgeCalibration[]>;
  usage(sinceDay: string): Promise<LlmUsage[]>;
  apiKeys(): Promise<ApiKey[]>;
  apiKeyByHash(hash: string): Promise<ApiKey | null>;
  audit(limit?: number): Promise<AuditEntry[]>;
  alerts(openOnly?: boolean): Promise<Alert[]>;
  dbSizeBytes(): Promise<number | null>;

  insertTraces(rows: Trace[]): Promise<number>;
  setTraceFeedback(id: string, agentId: string, feedback: Trace["feedback"]): Promise<boolean>;
  createRun(row: NewRun): Promise<Run>;
  updateRun(id: string, patch: Partial<Omit<Run, "id" | "seq">>): Promise<Run | null>;
  upsertResults(rows: Result[]): Promise<number>;
  insertProfile(row: Omit<Profile, "id" | "created_at" | "is_active">): Promise<Profile>;
  activateProfile(agentId: string, profileId: string): Promise<void>;
  insertCases(rows: Case[]): Promise<void>;
  insertSuiteVersion(row: Omit<SuiteVersion, "id" | "created_at">): Promise<SuiteVersion>;
  insertReviews(rows: Omit<CaseReview, "id" | "created_at" | "decided_at" | "status" | "reviewer" | "reason" | "resulting_case_id">[]): Promise<number>;
  updateReview(id: string, patch: Partial<CaseReview>): Promise<void>;
  createExperiment(row: Omit<Experiment, "id" | "created_at" | "finished_at" | "calls_used" | "best_candidate_id">): Promise<Experiment>;
  updateExperiment(id: string, patch: Partial<Experiment>): Promise<void>;
  insertCandidate(row: Omit<Candidate, "id" | "created_at">): Promise<Candidate>;
  updateCandidate(id: string, patch: Partial<Candidate>): Promise<void>;
  insertPromotion(row: Omit<Promotion, "id" | "created_at">): Promise<Promotion>;
  updatePromotion(id: string, patch: Partial<Promotion>): Promise<void>;
  insertJudgeLabels(rows: Omit<JudgeLabel, "id" | "created_at">[]): Promise<number>;
  upsertCalibration(row: JudgeCalibration): Promise<void>;
  addUsage(rows: LlmUsage[]): Promise<void>;
  insertApiKey(row: Omit<ApiKey, "id" | "created_at" | "last_used_at" | "revoked_at">): Promise<ApiKey>;
  revokeApiKey(id: string): Promise<boolean>;
  touchApiKey(id: string): Promise<void>;
  rateLimitHit(keyId: string, windowStart: string, add: number): Promise<number>;
  writeAudit(entry: Omit<AuditEntry, "id" | "at">): Promise<void>;
  insertAlert(row: Omit<Alert, "id" | "created_at" | "resolved_at">): Promise<void>;
  resolveAlert(id: string): Promise<void>;
  purgeTraces(beforeIso: string): Promise<number>;
}
