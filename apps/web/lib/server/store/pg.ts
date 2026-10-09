import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
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
import { getDb } from "../db/client";
import * as s from "../db/schema";
import type { CaseQuery, RunQuery, Store, TraceQuery } from "./types";

/** Neon / Postgres store — the system of record (SPEC §11). */

const TS_KEYS = new Set([
  "created_at",
  "finished_at",
  "heartbeat_at",
  "started_at",
  "ended_at",
  "received_at",
  "decided_at",
  "retired_at",
  "computed_at",
  "last_used_at",
  "revoked_at",
  "resolved_at",
  "at",
  "window_start",
]);

/** Postgres timestamptz strings ("2026-10-08 18:00:00+00") → ISO-8601, so rows match the snapshot exactly. */
function norm<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = TS_KEYS.has(k) && typeof v === "string" ? new Date(v).toISOString() : v;
  }
  return out as T;
}
const normAll = <T>(rows: Record<string, unknown>[]) => rows.map((r) => norm<T>(r));

function runWhere(q: RunQuery): SQL | undefined {
  const parts: SQL[] = [];
  if (q.agent) parts.push(eq(s.runs.agent_id, q.agent));
  if (q.trigger) parts.push(eq(s.runs.trigger, q.trigger));
  if (q.status) parts.push(eq(s.runs.status, q.status));
  if (q.experimentId) parts.push(eq(s.runs.experiment_id, q.experimentId));
  return parts.length ? and(...parts) : undefined;
}

export function createPgStore(): Store {
  const db = () => getDb();
  return {
    mode: "postgres",
    readonly: false,
    async generatedAt() {
      return null;
    },

    async agents() {
      return normAll<Agent>(await db().select().from(s.agents).orderBy(asc(s.agents.id)));
    },
    async profiles(agentId) {
      const q = db().select().from(s.profiles);
      const rows = agentId
        ? await q.where(eq(s.profiles.agent_id, agentId)).orderBy(desc(s.profiles.version))
        : await q.orderBy(asc(s.profiles.agent_id), desc(s.profiles.version));
      return normAll<Profile>(rows);
    },
    async profile(id) {
      const [row] = await db().select().from(s.profiles).where(eq(s.profiles.id, id));
      return row ? norm<Profile>(row) : null;
    },
    async activeProfile(agentId) {
      const [row] = await db()
        .select()
        .from(s.profiles)
        .where(and(eq(s.profiles.agent_id, agentId), eq(s.profiles.is_active, true)));
      return row ? norm<Profile>(row) : null;
    },
    async runs(q = {}) {
      const rows = await db()
        .select()
        .from(s.runs)
        .where(runWhere(q))
        .orderBy(desc(s.runs.created_at), desc(s.runs.seq))
        .limit(q.limit ?? 50)
        .offset(q.offset ?? 0);
      return normAll<Run>(rows);
    },
    async countRuns(q = {}) {
      const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(s.runs).where(runWhere(q));
      return row?.n ?? 0;
    },
    async run(idOrSeq) {
      const cond = /^\d+$/.test(idOrSeq)
        ? eq(s.runs.seq, Number(idOrSeq))
        : /^[0-9a-f-]{36}$/i.test(idOrSeq)
          ? eq(s.runs.id, idOrSeq)
          : null;
      if (!cond) return null;
      const [row] = await db().select().from(s.runs).where(cond);
      return row ? norm<Run>(row) : null;
    },
    async results(runId) {
      return normAll<Result>(
        await db().select().from(s.results).where(eq(s.results.run_id, runId)).orderBy(asc(s.results.case_id)),
      );
    },
    async resultsForRuns(runIds) {
      if (!runIds.length) return [];
      return normAll<Result>(await db().select().from(s.results).where(inArray(s.results.run_id, runIds)));
    },
    async trace(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const [row] = await db().select().from(s.traces).where(eq(s.traces.id, id));
      return row ? norm<Trace>(row) : null;
    },
    async traces(q: TraceQuery = {}) {
      const limit = q.limit ?? 50;
      const parts: SQL[] = [];
      if (q.agent) parts.push(eq(s.traces.agent_id, q.agent));
      if (q.status) parts.push(eq(s.traces.status, q.status));
      if (q.mode) parts.push(eq(s.traces.mode, q.mode));
      if (q.runId) parts.push(eq(s.traces.run_id, q.runId));
      if (q.guardHit !== undefined) parts.push(eq(s.traces.guard_hit, q.guardHit));
      if (q.profileVersion) parts.push(eq(s.traces.profile_version, q.profileVersion));
      if (q.feedback === "down") parts.push(sql`(${s.traces.feedback}->>'thumbs')::int < 0`);
      if (q.feedback === "up") parts.push(sql`(${s.traces.feedback}->>'thumbs')::int > 0`);
      if (q.cursor) {
        const [at, id] = q.cursor.split("|");
        if (at && id) {
          const atIso = new Date(at).toISOString();
          parts.push(or(lt(s.traces.started_at, atIso), and(eq(s.traces.started_at, atIso), lt(s.traces.id, id)))!);
        }
      }
      const rows = normAll<Trace>(
        await db()
          .select()
          .from(s.traces)
          .where(parts.length ? and(...parts) : undefined)
          .orderBy(desc(s.traces.started_at), desc(s.traces.id))
          .limit(limit + 1),
      );
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return { items, next: rows.length > limit && last ? `${last.started_at}|${last.id}` : null };
    },
    async suites() {
      return normAll<Suite>(await db().select().from(s.suites).orderBy(asc(s.suites.id)));
    },
    async suiteVersions(suiteId) {
      const q = db().select().from(s.suiteVersions);
      const rows = suiteId
        ? await q.where(eq(s.suiteVersions.suite_id, suiteId)).orderBy(desc(s.suiteVersions.created_at))
        : await q.orderBy(desc(s.suiteVersions.created_at));
      return normAll<SuiteVersion>(rows);
    },
    async suiteVersionsByIds(ids) {
      if (!ids.length) return [];
      return normAll<SuiteVersion>(await db().select().from(s.suiteVersions).where(inArray(s.suiteVersions.id, ids)));
    },
    async cases(q: CaseQuery = {}) {
      const parts: SQL[] = [];
      if (!q.includeRetired) parts.push(isNull(s.cases.retired_at));
      if (q.suite) parts.push(eq(s.cases.suite_id, q.suite));
      if (q.agent) parts.push(sql`${s.cases.suite_id} LIKE ${`${q.agent}/%`}`);
      if (q.split) parts.push(eq(s.cases.split, q.split));
      if (q.tag) parts.push(sql`${s.cases.body}->'tags' ? ${q.tag}`);
      return normAll<Case>(
        await db()
          .select()
          .from(s.cases)
          .where(parts.length ? and(...parts) : undefined)
          .orderBy(asc(s.cases.id)),
      );
    },
    async casesByIds(ids) {
      if (!ids.length) return [];
      return normAll<Case>(await db().select().from(s.cases).where(inArray(s.cases.id, ids)));
    },
    async reviews(status) {
      const q = db().select().from(s.caseReviews);
      const rows = status
        ? await q.where(eq(s.caseReviews.status, status)).orderBy(desc(s.caseReviews.created_at))
        : await q.orderBy(desc(s.caseReviews.created_at));
      return normAll<CaseReview>(rows);
    },
    async review(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const [row] = await db().select().from(s.caseReviews).where(eq(s.caseReviews.id, id));
      return row ? norm<CaseReview>(row) : null;
    },
    async attacks() {
      return normAll<Attack>(await db().select().from(s.attacks).orderBy(desc(s.attacks.created_at)));
    },
    async experiments(agentId) {
      const q = db().select().from(s.experiments);
      const rows = agentId
        ? await q.where(eq(s.experiments.agent_id, agentId)).orderBy(desc(s.experiments.created_at))
        : await q.orderBy(desc(s.experiments.created_at));
      return normAll<Experiment>(rows);
    },
    async experiment(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const [row] = await db().select().from(s.experiments).where(eq(s.experiments.id, id));
      return row ? norm<Experiment>(row) : null;
    },
    async candidates(experimentId) {
      return normAll<Candidate>(
        await db()
          .select()
          .from(s.candidates)
          .where(eq(s.candidates.experiment_id, experimentId))
          .orderBy(asc(s.candidates.created_at)),
      );
    },
    async candidate(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const [row] = await db().select().from(s.candidates).where(eq(s.candidates.id, id));
      return row ? norm<Candidate>(row) : null;
    },
    async promotions(agentId) {
      const q = db().select().from(s.promotions);
      const rows = agentId
        ? await q.where(eq(s.promotions.agent_id, agentId)).orderBy(desc(s.promotions.created_at))
        : await q.orderBy(desc(s.promotions.created_at));
      return normAll<Promotion>(rows);
    },
    async promotion(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const [row] = await db().select().from(s.promotions).where(eq(s.promotions.id, id));
      return row ? norm<Promotion>(row) : null;
    },
    async judgeLabels(agentId) {
      const q = db().select().from(s.judgeLabels);
      return normAll<JudgeLabel>(agentId ? await q.where(eq(s.judgeLabels.agent_id, agentId)) : await q);
    },
    async calibrations() {
      return normAll<JudgeCalibration>(await db().select().from(s.judgeCalibration));
    },
    async usage(sinceDay) {
      return normAll<LlmUsage>(await db().select().from(s.llmUsage).where(gte(s.llmUsage.day, sinceDay)));
    },
    async apiKeys() {
      return normAll<ApiKey>(await db().select().from(s.apiKeys).orderBy(desc(s.apiKeys.created_at)));
    },
    async apiKeyByHash(hash) {
      const [row] = await db().select().from(s.apiKeys).where(eq(s.apiKeys.key_hash, hash));
      return row ? norm<ApiKey>(row) : null;
    },
    async audit(limit = 50) {
      return normAll<AuditEntry>(await db().select().from(s.auditLog).orderBy(desc(s.auditLog.at)).limit(limit));
    },
    async alerts(openOnly) {
      const q = db().select().from(s.alerts);
      const rows = openOnly
        ? await q.where(isNull(s.alerts.resolved_at)).orderBy(desc(s.alerts.created_at))
        : await q.orderBy(desc(s.alerts.created_at));
      return normAll<Alert>(rows);
    },
    async dbSizeBytes() {
      const res = await db().execute(sql`select pg_database_size(current_database())::bigint as bytes`);
      const row = (res as unknown as { rows: { bytes: string | number }[] }).rows?.[0];
      return row ? Number(row.bytes) : null;
    },

    async insertTraces(rows) {
      if (!rows.length) return 0;
      const inserted = await db()
        .insert(s.traces)
        .values(rows)
        .onConflictDoNothing({ target: s.traces.id })
        .returning({ id: s.traces.id });
      return inserted.length;
    },
    async setTraceFeedback(id, agentId, feedback) {
      const res = await db()
        .update(s.traces)
        .set({ feedback })
        .where(and(eq(s.traces.id, id), eq(s.traces.agent_id, agentId)))
        .returning({ id: s.traces.id });
      return res.length > 0;
    },
    async createRun(row) {
      const [created] = await db().insert(s.runs).values(row).returning();
      return norm<Run>(created);
    },
    async updateRun(id, patch) {
      const [row] = await db().update(s.runs).set(patch).where(eq(s.runs.id, id)).returning();
      return row ? norm<Run>(row) : null;
    },
    async upsertResults(rows) {
      if (!rows.length) return 0;
      const res = await db()
        .insert(s.results)
        .values(rows)
        .onConflictDoUpdate({
          target: [s.results.run_id, s.results.case_id, s.results.attempt],
          set: {
            passed: sql`excluded.passed`,
            status: sql`excluded.status`,
            graders: sql`excluded.graders`,
            trace_id: sql`excluded.trace_id`,
            block_layer: sql`excluded.block_layer`,
            cost_usd: sql`excluded.cost_usd`,
            latency_ms: sql`excluded.latency_ms`,
            llm_calls: sql`excluded.llm_calls`,
          },
        })
        .returning({ case_id: s.results.case_id });
      return res.length;
    },
    async insertProfile(row) {
      const [created] = await db().insert(s.profiles).values(row).returning();
      return norm<Profile>(created);
    },
    async activateProfile(agentId, profileId) {
      // One transaction: the partial unique index allows only one active row per agent at commit time.
      await db().transaction(async (tx) => {
        await tx
          .update(s.profiles)
          .set({ is_active: false })
          .where(and(eq(s.profiles.agent_id, agentId), eq(s.profiles.is_active, true)));
        const res = await tx
          .update(s.profiles)
          .set({ is_active: true })
          .where(and(eq(s.profiles.id, profileId), eq(s.profiles.agent_id, agentId)))
          .returning({ id: s.profiles.id });
        if (!res.length) throw new Error("profile not found for agent");
      });
    },
    async insertCases(rows) {
      if (rows.length) await db().insert(s.cases).values(rows).onConflictDoNothing({ target: s.cases.id });
    },
    async insertSuiteVersion(row) {
      const [created] = await db()
        .insert(s.suiteVersions)
        .values(row)
        .onConflictDoUpdate({ target: [s.suiteVersions.suite_id, s.suiteVersions.hash], set: { hash: sql`excluded.hash` } })
        .returning();
      return norm<SuiteVersion>(created);
    },
    async insertReviews(rows) {
      if (!rows.length) return 0;
      const res = await db().insert(s.caseReviews).values(rows).returning({ id: s.caseReviews.id });
      return res.length;
    },
    async updateReview(id, patch) {
      await db().update(s.caseReviews).set(patch).where(eq(s.caseReviews.id, id));
    },
    async createExperiment(row) {
      const [created] = await db().insert(s.experiments).values(row).returning();
      return norm<Experiment>(created);
    },
    async updateExperiment(id, patch) {
      await db().update(s.experiments).set(patch).where(eq(s.experiments.id, id));
    },
    async insertCandidate(row) {
      const [created] = await db().insert(s.candidates).values(row).returning();
      return norm<Candidate>(created);
    },
    async updateCandidate(id, patch) {
      await db().update(s.candidates).set(patch).where(eq(s.candidates.id, id));
    },
    async insertPromotion(row) {
      const [created] = await db().insert(s.promotions).values(row).returning();
      return norm<Promotion>(created);
    },
    async updatePromotion(id, patch) {
      await db().update(s.promotions).set(patch).where(eq(s.promotions.id, id));
    },
    async insertJudgeLabels(rows) {
      if (!rows.length) return 0;
      const res = await db().insert(s.judgeLabels).values(rows).returning({ id: s.judgeLabels.id });
      return res.length;
    },
    async upsertCalibration(row) {
      await db()
        .insert(s.judgeCalibration)
        .values(row)
        .onConflictDoUpdate({
          target: [s.judgeCalibration.agent_id, s.judgeCalibration.judge_model, s.judgeCalibration.prompt_hash],
          set: {
            n: row.n,
            kappa: row.kappa,
            agreement: row.agreement,
            confusion: row.confusion,
            calibrated: row.calibrated,
            computed_at: row.computed_at,
          },
        });
    },
    async addUsage(rows) {
      for (const r of rows) {
        await db()
          .insert(s.llmUsage)
          .values(r)
          .onConflictDoUpdate({
            target: [s.llmUsage.day, s.llmUsage.provider, s.llmUsage.model, s.llmUsage.purpose],
            set: {
              calls: sql`${s.llmUsage.calls} + ${r.calls}`,
              tokens_in: sql`${s.llmUsage.tokens_in} + ${r.tokens_in}`,
              tokens_out: sql`${s.llmUsage.tokens_out} + ${r.tokens_out}`,
            },
          });
      }
    },
    async insertApiKey(row) {
      const [created] = await db().insert(s.apiKeys).values(row).returning();
      return norm<ApiKey>(created);
    },
    async revokeApiKey(id) {
      const res = await db()
        .update(s.apiKeys)
        .set({ revoked_at: new Date().toISOString() })
        .where(and(eq(s.apiKeys.id, id), isNull(s.apiKeys.revoked_at)))
        .returning({ id: s.apiKeys.id });
      return res.length > 0;
    },
    async touchApiKey(id) {
      await db().update(s.apiKeys).set({ last_used_at: new Date().toISOString() }).where(eq(s.apiKeys.id, id));
    },
    async rateLimitHit(keyId, windowStart, add) {
      const [row] = await db()
        .insert(s.rateLimits)
        .values({ key_id: keyId, window_start: windowStart, count: add })
        .onConflictDoUpdate({
          target: [s.rateLimits.key_id, s.rateLimits.window_start],
          set: { count: sql`${s.rateLimits.count} + ${add}` },
        })
        .returning({ count: s.rateLimits.count });
      return row?.count ?? add;
    },
    async writeAudit(entry) {
      await db().insert(s.auditLog).values(entry);
    },
    async insertAlert(row) {
      await db().insert(s.alerts).values(row);
    },
    async resolveAlert(id) {
      await db().update(s.alerts).set({ resolved_at: new Date().toISOString() }).where(eq(s.alerts.id, id));
    },
    async purgeTraces(beforeIso) {
      const res = await db()
        .delete(s.traces)
        .where(and(eq(s.traces.mode, "live"), lt(s.traces.started_at, beforeIso)))
        .returning({ id: s.traces.id });
      await db().delete(s.rateLimits).where(lt(s.rateLimits.window_start, beforeIso));
      return res.length;
    },
  };
}
