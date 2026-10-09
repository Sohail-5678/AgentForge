import "server-only";
import { wilson } from "@/lib/stats";
import type { Attack, Run } from "@/lib/types";
import { getStore } from "./store";

export interface AttackRow {
  run_id: string;
  case_id: string;
  agent: string;
  category: string;
  severity: string;
  family: string | null;
  owasp: string | null;
  title: string | null;
  succeeded: boolean;
  block_layer: string | null;
  trace_id: string | null;
}

export interface Cell {
  n: number;
  succeeded: number;
  asr: number;
  ci: [number, number];
}

/** Heatmap + attribution from each agent's most recent finished run that contains red-team results (§8.6–8.7). */
export async function redteamSummary(agentFilter?: string) {
  const store = getStore();
  const agents = (await store.agents()).filter((a) => !agentFilter || a.id === agentFilter);
  const latest: Run[] = [];
  const trend: Record<string, { at: string; asr: number; seq: number; profile_id: string }[]> = {};
  for (const a of agents) {
    const runs = (await store.runs({ agent: a.id, status: "done", limit: 200 })).filter((r) => r.summary?.redteam);
    if (runs[0]) latest.push(runs[0]);
    trend[a.id] = runs
      .filter((r) => r.trigger === "nightly")
      .slice(0, 30)
      .reverse()
      .map((r) => ({ at: r.created_at, asr: r.summary!.redteam!.asr, seq: r.seq, profile_id: r.profile_id }));
  }
  const results = await store.resultsForRuns(latest.map((r) => r.id));
  const cases = new Map((await store.casesByIds([...new Set(results.map((r) => r.case_id))])).map((c) => [c.id, c]));
  const rows: AttackRow[] = [];
  for (const r of results) {
    const attack = r.graders.find((g) => g.grader === "attack");
    if (!attack || r.attempt !== 1) continue;
    const c = cases.get(r.case_id);
    const run = latest.find((x) => x.id === r.run_id)!;
    rows.push({
      run_id: r.run_id,
      case_id: r.case_id,
      agent: run.agent_id,
      category: String(c?.body.category ?? attack.details?.category ?? "unknown"),
      severity: String(c?.body.severity ?? attack.details?.severity ?? "medium"),
      family: (c?.body.family ?? (attack.details?.family as string) ?? null) || null,
      owasp: c?.body.owasp ?? null,
      title: c?.body.title ?? null,
      succeeded: attack.passed === false,
      block_layer: r.block_layer,
      trace_id: r.trace_id,
    });
  }
  const cell = (list: AttackRow[]): Cell => {
    const n = list.length;
    const s = list.filter((x) => x.succeeded).length;
    return { n, succeeded: s, asr: n ? s / n : 0, ci: wilson(s, n) };
  };
  const heat: Record<string, Record<string, Cell>> = {};
  const layers: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    heat[row.category] ??= {};
    layers[row.category] ??= {};
    if (!row.succeeded && row.block_layer) layers[row.category][row.block_layer] = (layers[row.category][row.block_layer] ?? 0) + 1;
    if (row.succeeded) layers[row.category].succeeded = (layers[row.category].succeeded ?? 0) + 1;
  }
  for (const cat of Object.keys(heat)) for (const a of agents) heat[cat][a.id] = cell(rows.filter((r) => r.category === cat && r.agent === a.id));
  const totals: Record<string, Cell> = Object.fromEntries(agents.map((a) => [a.id, cell(rows.filter((r) => r.agent === a.id))]));
  const attacks: Attack[] = await store.attacks();
  const scored = attacks.filter((a) => a.prompt_guard_score != null);
  const evaded = scored.filter((a) => (a.prompt_guard_score ?? 0) < 0.5).length;
  return {
    runs: latest.map((r) => ({ id: r.id, seq: r.seq, agent: r.agent_id, created_at: r.created_at, profile_id: r.profile_id, summary: r.summary?.redteam })),
    heat,
    layers,
    totals,
    rows,
    trend,
    mutations: attacks,
    classifier_evasion: { n: scored.length, evaded, rate: scored.length ? evaded / scored.length : 0, ci: wilson(evaded, scored.length) },
  };
}
