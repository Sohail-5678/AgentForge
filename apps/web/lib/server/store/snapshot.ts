import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Snapshot, SnapshotTables, Trace } from "@/lib/types";
import { ReadOnlyError, type CaseQuery, type RunQuery, type Store, type TraceQuery } from "./types";

/**
 * Read-only store over the committed demo snapshot (docs/CONTRACTS.md §7). Used when DATABASE_URL is not set, so
 * the public site works before a database exists. Loaded once per server instance and indexed in memory.
 */
const EMPTY: SnapshotTables = {
  agents: [],
  profiles: [],
  suites: [],
  cases: [],
  suite_versions: [],
  runs: [],
  results: [],
  traces: [],
  attacks: [],
  optimizer_experiments: [],
  optimizer_candidates: [],
  promotions: [],
  case_reviews: [],
  judge_labels: [],
  judge_calibration: [],
  llm_usage: [],
  audit_log: [],
  alerts: [],
  api_keys: [],
};

interface Indexed {
  snapshot: Snapshot | null;
  t: SnapshotTables;
  resultsByRun: Map<string, SnapshotTables["results"]>;
  traceById: Map<string, Trace>;
  runsDesc: SnapshotTables["runs"];
}

let loaded: Indexed | null = null;

export function snapshotPath() {
  return process.env.AF_SNAPSHOT_PATH || path.join(process.cwd(), "data", "demo-snapshot.json");
}

export function loadSnapshot(): Indexed {
  if (loaded) return loaded;
  let snapshot: Snapshot | null = null;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath(), "utf8")) as Snapshot;
  } catch {
    snapshot = null;
  }
  const t: SnapshotTables = { ...EMPTY, ...(snapshot?.tables ?? {}) };
  const resultsByRun = new Map<string, SnapshotTables["results"]>();
  for (const r of t.results) {
    const list = resultsByRun.get(r.run_id);
    if (list) list.push(r);
    else resultsByRun.set(r.run_id, [r]);
  }
  const traceById = new Map(t.traces.map((tr) => [tr.id, tr]));
  const runsDesc = [...t.runs].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.seq - a.seq);
  loaded = { snapshot, t, resultsByRun, traceById, runsDesc };
  return loaded;
}

/** Test hook. */
export function resetSnapshotCache() {
  loaded = null;
}

const byNewest = <T extends { created_at: string }>(a: T, b: T) => b.created_at.localeCompare(a.created_at);

function matchRun(q: RunQuery) {
  return (r: SnapshotTables["runs"][number]) =>
    (!q.agent || r.agent_id === q.agent) &&
    (!q.trigger || r.trigger === q.trigger) &&
    (!q.status || r.status === q.status) &&
    (!q.experimentId || r.experiment_id === q.experimentId);
}

function readOnly(): never {
  throw new ReadOnlyError();
}

export function createSnapshotStore(): Store {
  const db = () => loadSnapshot();
  return {
    mode: "snapshot",
    readonly: true,
    async generatedAt() {
      return db().snapshot?.generated_at ?? null;
    },
    async agents() {
      return db().t.agents;
    },
    async profiles(agentId) {
      return db()
        .t.profiles.filter((p) => !agentId || p.agent_id === agentId)
        .sort((a, b) => a.agent_id.localeCompare(b.agent_id) || b.version - a.version);
    },
    async profile(id) {
      return db().t.profiles.find((p) => p.id === id) ?? null;
    },
    async activeProfile(agentId) {
      return db().t.profiles.find((p) => p.agent_id === agentId && p.is_active) ?? null;
    },
    async runs(q = {}) {
      const all = db().runsDesc.filter(matchRun(q));
      const offset = q.offset ?? 0;
      return all.slice(offset, offset + (q.limit ?? 50));
    },
    async countRuns(q = {}) {
      return db().runsDesc.filter(matchRun(q)).length;
    },
    async run(idOrSeq) {
      const runs = db().t.runs;
      if (/^\d+$/.test(idOrSeq)) return runs.find((r) => r.seq === Number(idOrSeq)) ?? null;
      return runs.find((r) => r.id === idOrSeq) ?? null;
    },
    async results(runId) {
      return db().resultsByRun.get(runId) ?? [];
    },
    async resultsForRuns(runIds) {
      const m = db().resultsByRun;
      return runIds.flatMap((id) => m.get(id) ?? []);
    },
    async trace(id) {
      return db().traceById.get(id) ?? null;
    },
    async traces(q: TraceQuery = {}) {
      const limit = q.limit ?? 50;
      const [cAt, cId] = q.cursor ? q.cursor.split("|") : [null, null];
      const rows = db()
        .t.traces.filter(
          (t) =>
            (!q.agent || t.agent_id === q.agent) &&
            (!q.status || t.status === q.status) &&
            (!q.mode || t.mode === q.mode) &&
            (!q.runId || t.run_id === q.runId) &&
            (q.guardHit === undefined || t.guard_hit === q.guardHit) &&
            (!q.profileVersion || t.profile_version === q.profileVersion) &&
            (!q.feedback ||
              q.feedback === "any" ||
              (q.feedback === "down" ? (t.feedback?.thumbs ?? 0) < 0 : (t.feedback?.thumbs ?? 0) > 0)),
        )
        .sort((a, b) => b.started_at.localeCompare(a.started_at) || b.id.localeCompare(a.id))
        .filter((t) => !cAt || t.started_at < cAt || (t.started_at === cAt && t.id < (cId ?? "")));
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return { items, next: rows.length > limit && last ? `${last.started_at}|${last.id}` : null };
    },
    async suites() {
      return db().t.suites;
    },
    async suiteVersions(suiteId) {
      return db()
        .t.suite_versions.filter((v) => !suiteId || v.suite_id === suiteId)
        .sort(byNewest);
    },
    async suiteVersionsByIds(ids) {
      const set = new Set(ids);
      return db().t.suite_versions.filter((v) => set.has(v.id));
    },
    async cases(q: CaseQuery = {}) {
      return db().t.cases.filter(
        (c) =>
          (q.includeRetired || !c.retired_at) &&
          (!q.suite || c.suite_id === q.suite) &&
          (!q.agent || c.suite_id.startsWith(`${q.agent}/`)) &&
          (!q.split || c.split === q.split) &&
          (!q.tag || (c.body.tags ?? []).includes(q.tag)),
      );
    },
    async casesByIds(ids) {
      const set = new Set(ids);
      return db().t.cases.filter((c) => set.has(c.id));
    },
    async reviews(status) {
      return db()
        .t.case_reviews.filter((r) => !status || r.status === status)
        .sort(byNewest);
    },
    async review(id) {
      return db().t.case_reviews.find((r) => r.id === id) ?? null;
    },
    async attacks() {
      return [...db().t.attacks].sort(byNewest);
    },
    async experiments(agentId) {
      return db()
        .t.optimizer_experiments.filter((e) => !agentId || e.agent_id === agentId)
        .sort(byNewest);
    },
    async experiment(id) {
      return db().t.optimizer_experiments.find((e) => e.id === id) ?? null;
    },
    async candidates(experimentId) {
      return db()
        .t.optimizer_candidates.filter((c) => c.experiment_id === experimentId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    async candidate(id) {
      return db().t.optimizer_candidates.find((c) => c.id === id) ?? null;
    },
    async promotions(agentId) {
      return db()
        .t.promotions.filter((p) => !agentId || p.agent_id === agentId)
        .sort(byNewest);
    },
    async promotion(id) {
      return db().t.promotions.find((p) => p.id === id) ?? null;
    },
    async judgeLabels(agentId) {
      return db().t.judge_labels.filter((l) => !agentId || l.agent_id === agentId);
    },
    async calibrations() {
      return db().t.judge_calibration;
    },
    async usage(sinceDay) {
      return db().t.llm_usage.filter((u) => u.day >= sinceDay);
    },
    async apiKeys() {
      return [...db().t.api_keys].sort(byNewest);
    },
    async apiKeyByHash(hash) {
      return db().t.api_keys.find((k) => k.key_hash === hash) ?? null;
    },
    async audit(limit = 50) {
      return [...db().t.audit_log].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
    },
    async alerts(openOnly) {
      return db()
        .t.alerts.filter((a) => !openOnly || !a.resolved_at)
        .sort(byNewest);
    },
    async dbSizeBytes() {
      return null;
    },

    insertTraces: readOnly,
    setTraceFeedback: readOnly,
    createRun: readOnly,
    updateRun: readOnly,
    upsertResults: readOnly,
    insertProfile: readOnly,
    activateProfile: readOnly,
    insertCases: readOnly,
    insertSuiteVersion: readOnly,
    insertReviews: readOnly,
    updateReview: readOnly,
    createExperiment: readOnly,
    updateExperiment: readOnly,
    insertCandidate: readOnly,
    updateCandidate: readOnly,
    insertPromotion: readOnly,
    updatePromotion: readOnly,
    insertJudgeLabels: readOnly,
    upsertCalibration: readOnly,
    addUsage: readOnly,
    insertApiKey: readOnly,
    revokeApiKey: readOnly,
    touchApiKey: readOnly,
    rateLimitHit: readOnly,
    writeAudit: readOnly,
    insertAlert: readOnly,
    resolveAlert: readOnly,
    purgeTraces: readOnly,
  };
}
