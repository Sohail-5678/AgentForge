import "server-only";
import { cache } from "react";
import type { Agent, Alert, LlmUsage, Profile, Promotion, Run } from "@/lib/types";
import { getStore } from "./store";

/** Page-shaped reads composed from the store. `cache` dedupes calls within one request. */

const NIGHTLY_LOOKBACK = 400;

export const allAgents = cache(async () => getStore().agents());

export const landingStats = cache(async () => {
  const store = getStore();
  const [cases, suites, calibrations, promotions, runCount, nightly] = await Promise.all([
    store.cases(),
    store.suites(),
    store.calibrations(),
    store.promotions(),
    store.countRuns(),
    store.runs({ agent: "returnpilot", trigger: "nightly", status: "done", limit: 1 }),
  ]);
  const redteam = cases.filter((c) => c.body.suite === "redteam");
  const cats = new Set(redteam.map((c) => c.body.category).filter(Boolean));
  const best = calibrations.filter((c) => c.calibrated).sort((a, b) => b.kappa - a.kappa)[0] ?? calibrations[0];
  const promoted = promotions.filter((p) => p.decision === "promoted" && p.path !== "rollback");
  const gains = promoted.map((p) => p.gate_report?.test?.gain).filter((g): g is number => typeof g === "number");
  const last = nightly[0]?.summary;
  return {
    cases: cases.length,
    suites: suites.length,
    seeds: redteam.filter((c) => c.origin === "seed").length,
    categories: cats.size,
    kappa: best?.kappa ?? null,
    kappaN: best?.n ?? null,
    promotions: promoted.length,
    runs: runCount,
    bestGain: gains.length ? Math.max(...gains) : null,
    asr: last?.redteam?.asr ?? null,
    costPerCase: last?.cost?.mean_list_price_usd ?? null,
  };
});

export interface AgentCardData {
  agent: Agent;
  active: Profile | null;
  lastNightly: Run | null;
  trend: { y: number; lo: number; hi: number; at: string; runId: string }[];
  asrTrend: { y: number; at: string }[];
  promotions: Promotion[];
  liveTraces: number;
  runsTotal: number;
}

export const nightlyRuns = cache(async (agentId: string) => {
  const runs = await getStore().runs({ agent: agentId, trigger: "nightly", limit: NIGHTLY_LOOKBACK });
  return runs.filter((r) => r.status === "done" && r.summary).reverse();
});

export const agentCards = cache(async (): Promise<AgentCardData[]> => {
  const store = getStore();
  const agents = await allAgents();
  return Promise.all(
    agents.map(async (agent) => {
      const [active, nightly, promotions, traces, runsTotal] = await Promise.all([
        store.activeProfile(agent.id),
        nightlyRuns(agent.id),
        store.promotions(agent.id),
        store.traces({ agent: agent.id, mode: "live", limit: 500 }),
        store.countRuns({ agent: agent.id }),
      ]);
      const lastNightly = nightly.at(-1) ?? (await store.runs({ agent: agent.id, status: "done", limit: 1 }))[0] ?? null;
      return {
        agent,
        active,
        lastNightly,
        trend: nightly.slice(-30).map((r) => ({ y: r.summary!.pass_rate, lo: r.summary!.ci[0], hi: r.summary!.ci[1], at: r.created_at, runId: r.id })),
        asrTrend: nightly
          .slice(-30)
          .filter((r) => r.summary?.redteam)
          .map((r) => ({ y: r.summary!.redteam!.asr, at: r.created_at })),
        promotions,
        liveTraces: traces.items.length,
        runsTotal,
      };
    }),
  );
});

export const openAlerts = cache(async (): Promise<Alert[]> => getStore().alerts(true));

/** Daily caps from SPEC §15.1 (overridable by env DAILY_CAP_<PURPOSE>). */
export const DAILY_CAPS: { purpose: string; label: string; cap: number }[] = [
  { purpose: "judge", label: "Rubric judge · Gemini Flash", cap: Number(process.env.DAILY_CAP_JUDGE ?? 150) },
  { purpose: "cheap_judge", label: "Cheap graders · gpt-oss-20b", cap: Number(process.env.DAILY_CAP_CHEAP_JUDGE ?? 400) },
  { purpose: "guard", label: "Prompt Guard 2 scoring", cap: Number(process.env.DAILY_CAP_GUARD ?? 500) },
  { purpose: "generation", label: "Mutation · reflection · drafts", cap: Number(process.env.DAILY_CAP_GENERATION ?? 60) },
  { purpose: "embedding", label: "Embeddings · mining", cap: Number(process.env.DAILY_CAP_EMBEDDING ?? 500) },
  { purpose: "target_eval", label: "Target-agent eval calls", cap: Number(process.env.DAILY_CAP_TARGET_EVAL ?? 600) },
];

export function usageByPurpose(rows: LlmUsage[], day: string) {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.day === day) out[r.purpose] = (out[r.purpose] ?? 0) + r.calls;
  return out;
}

export function latestDay(rows: LlmUsage[]) {
  return rows.reduce((m, r) => (r.day > m ? r.day : m), "");
}

export async function profileMap() {
  const profiles = await getStore().profiles();
  return new Map(profiles.map((p) => [p.id, p]));
}

export async function suiteLabel(run: Run) {
  if (run.summary?.suites?.length) return run.summary.suites.join(" + ");
  const versions = await getStore().suiteVersionsByIds(run.suite_version_ids);
  return versions.map((v) => v.suite_id).join(" + ") || "—";
}
