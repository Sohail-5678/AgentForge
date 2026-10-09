import type { Metadata } from "next";
import Link from "next/link";
import { RedteamExplorer } from "@/components/redteam/redteam-explorer";
import type { CaseInfo } from "@/components/run/results-explorer";
import { Card, CardHead, Chip, Empty, PageHeader, Stat } from "@/components/ui/primitives";
import { Sparkline } from "@/components/ui/sparkline";
import { ago, pct } from "@/lib/format";
import { AGENT_META, CATEGORIES } from "@/lib/meta";
import { redteamSummary } from "@/lib/server/redteam";
import { getStore } from "@/lib/server/store";

export const metadata: Metadata = { title: "Red team" };

export default async function RedteamPage() {
  const store = getStore();
  const data = await redteamSummary();
  const results = await store.resultsForRuns(data.runs.map((r) => r.id));
  const caseRows = await store.casesByIds([...new Set(data.rows.map((r) => r.case_id))]);
  const cases: Record<string, CaseInfo> = Object.fromEntries(caseRows.map((c) => [c.id, { body: c.body, split: c.split }]));
  const seeds = (await store.cases()).filter((c) => c.body.suite === "redteam");
  const agents = Object.keys(data.totals).filter((a) => data.totals[a].n > 0);
  const ops = new Map<string, { n: number; succeeded: number }>();
  for (const m of data.mutations) {
    const o = ops.get(m.operator) ?? { n: 0, succeeded: 0 };
    o.n++;
    if (m.succeeded_in_run) o.succeeded++;
    ops.set(m.operator, o);
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker="Attack · 05 · OWASP Top 10 for LLM apps (2025)"
        title={
          <>
            Red <span className="grunge">team</span>
          </>
        }
        subtitle="Guardrails proven, not assumed: how often each attack category succeeds, and which defence layer stopped the rest."
      />

      {agents.length === 0 ? (
        <Empty title="No red-team runs yet">The nightly red-team core runs after the regression suite. Seeds live in suites/redteam/*.yaml.</Empty>
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {agents.map((a, i) => {
              const t = data.totals[a];
              const run = data.runs.find((r) => r.agent === a);
              return (
                <Card key={a} className="rise p-6" style={{ animationDelay: `${60 + i * 60}ms` }}>
                  <p className="kicker">{AGENT_META[a]?.name ?? a} · attack success</p>
                  <Stat label="" value={pct(t.asr, 1)} sub={`${t.succeeded}/${t.n} · 95% ${pct(t.ci[0], 1)}–${pct(t.ci[1], 1)}`} tone={t.asr > 0 ? "accent" : "pass"} className="-mt-2" />
                  <div className="mt-4">
                    <Sparkline points={(data.trend[a] ?? []).map((p) => ({ y: p.asr }))} height={40} color="var(--accent)" label={`${AGENT_META[a]?.name} attack success trend`} />
                  </div>
                  {run && (
                    <Link href={`/runs/${run.id}`} className="mt-2 block font-mono text-[0.62rem] text-muted hover:text-accent">
                      run #{run.seq} · {ago(run.created_at)} · severity-weighted {pct(run.summary?.severity_weighted_asr ?? 0, 1)}
                    </Link>
                  )}
                </Card>
              );
            })}
            <Card className="rise p-6" style={{ animationDelay: "200ms" }}>
              <p className="kicker">Classifier evasion · Prompt Guard 2</p>
              <Stat
                label=""
                value={pct(data.classifier_evasion.rate)}
                sub={`${data.classifier_evasion.evaded}/${data.classifier_evasion.n} mutations missed · ${pct(data.classifier_evasion.ci[0])}–${pct(data.classifier_evasion.ci[1])}`}
                className="-mt-2"
              />
              <p className="mt-3 text-[0.78rem] leading-relaxed text-muted">Missed by the input classifier ≠ attack success — later layers still get a say (§8.4).</p>
            </Card>
            <Card className="rise p-6" style={{ animationDelay: "260ms" }}>
              <p className="kicker">Seed library</p>
              <Stat label="" value={String(seeds.length)} sub={`${new Set(seeds.map((s) => s.body.category)).size} categories · ${new Set(seeds.map((s) => s.family)).size} families`} className="-mt-2" />
              <div className="mt-3 flex flex-wrap gap-1.5">
                {CATEGORIES.filter((c) => seeds.some((s) => s.body.category === c.id)).map((c) => (
                  <Chip key={c.id}>{c.owasp}</Chip>
                ))}
              </div>
            </Card>
          </div>

          <RedteamExplorer agents={agents} heat={data.heat} layers={data.layers} rows={data.rows} results={results} cases={cases} />

          <Card className="rise overflow-hidden" style={{ animationDelay: "120ms" }}>
            <div className="px-6 pt-6">
              <CardHead code="M" title="Mutation operators" kicker="paraphrase · translate · encode · obfuscate · wrap · crescendo · roleplay — successes go to the review queue" />
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="table-af min-w-[720px]">
                <thead>
                  <tr>
                    <th>Operator</th>
                    <th>Kind</th>
                    <th>Mutations</th>
                    <th>Succeeded</th>
                    <th>Latest example</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ops.entries()].map(([op, o]) => {
                    const ex = data.mutations.find((m) => m.operator === op);
                    const llm = ["paraphrase", "translate", "crescendo", "roleplay"].includes(op);
                    return (
                      <tr key={op}>
                        <td className="font-mono text-[0.74rem] text-ink">{op}</td>
                        <td>
                          <Chip tone={llm ? "info" : undefined}>{llm ? "LLM" : "deterministic"}</Chip>
                        </td>
                        <td className="font-mono text-[0.72rem] num">{o.n}</td>
                        <td className="font-mono text-[0.72rem] num">
                          <span className={o.succeeded ? "text-accent-ink" : "text-pass"}>{o.succeeded}</span>
                        </td>
                        <td className="max-w-[420px] truncate font-mono text-[0.68rem] text-muted">{ex?.seed_case_id}{ex?.prompt_guard_score != null ? ` · guard score ${ex.prompt_guard_score.toFixed(2)}` : ""}</td>
                      </tr>
                    );
                  })}
                  {ops.size === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-muted">No mutations generated yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
