import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminButton } from "@/components/admin/admin-button";
import { GateCard } from "@/components/optimizer/gate-card";
import { SpotlightCard } from "@/components/ui/interactive";
import { Card, CardHead, Chip, Empty, Meter, PageHeader } from "@/components/ui/primitives";
import { ago, dateShort, pct } from "@/lib/format";
import { AGENT_META, agentName } from "@/lib/meta";
import { profileMap } from "@/lib/server/queries";
import { getStore } from "@/lib/server/store";

export const metadata: Metadata = { title: "Optimizer" };
export const revalidate = 60;

const STATUS_TONE: Record<string, "pass" | "info" | "warn" | "accent" | undefined> = { running: "info", finished: "pass", paused: "warn", failed: "accent", cancelled: undefined };

export default async function OptimizerPage() {
  const store = getStore();
  const [experiments, promotions, profiles, agents] = await Promise.all([store.experiments(), store.promotions(), profileMap(), store.agents()]);
  const candCounts = new Map<string, { total: number; front: number; rejected: number }>();
  await Promise.all(
    experiments.map(async (e) => {
      const c = await store.candidates(e.id);
      candCounts.set(e.id, { total: c.length, front: c.filter((x) => x.on_front).length, rejected: c.filter((x) => x.status === "rejected_editor").length });
    }),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker="Improve · 06 · GEPA-lite"
        title={
          <>
            Opti<span className="text-accent">mizer</span>
          </>
        }
        subtitle="Reflective prompt evolution on failed traces, one component at a time, with a Pareto front — and a gate that only statistics, safety and a human can open."
        actions={agents
          .filter((a) => a.id !== "toy")
          .map((a) => (
            <AdminButton key={a.id} action={{ kind: "start-experiment", agent: a.id }} label={`New · ${agentName(a.id)}`} />
          ))}
      />

      {experiments.length === 0 ? (
        <Empty title="No experiments yet">Start one from the button above — it runs in nightly slices within OPT_NIGHTLY_CALLS.</Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
          {experiments.map((e, i) => {
            const parent = profiles.get(e.parent_profile_id);
            const cc = candCounts.get(e.id);
            const budget = e.config.budget_total ?? 0;
            return (
              <Link key={e.id} href={`/optimizer/${e.id}`} className="group block">
                <SpotlightCard className="rise h-full p-6" style={{ animationDelay: `${60 + i * 60}ms` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="kicker">{AGENT_META[e.agent_id]?.name ?? e.agent_id} · from v{parent?.version ?? "?"}</p>
                      <p className="mt-1 truncate font-mono text-[0.95rem] text-ink transition group-hover:text-accent">{e.name ?? e.id.slice(0, 8)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Chip tone={STATUS_TONE[e.status]}>{e.status}</Chip>
                      <ArrowUpRight className="size-4 text-muted transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
                    </div>
                  </div>
                  <div className="mt-6 grid grid-cols-3 gap-3">
                    <div>
                      <p className="kicker !text-[0.56rem]">candidates</p>
                      <p className="display num mt-1 text-3xl text-ink">{cc?.total ?? 0}</p>
                    </div>
                    <div>
                      <p className="kicker !text-[0.56rem]">on front</p>
                      <p className="display num mt-1 text-3xl text-pass">{cc?.front ?? 0}</p>
                    </div>
                    <div>
                      <p className="kicker !text-[0.56rem]">editor ✗</p>
                      <p className="display num mt-1 text-3xl text-accent">{cc?.rejected ?? 0}</p>
                    </div>
                  </div>
                  <div className="mt-5">
                    <Meter label={`budget · night ${e.state?.night ?? 0} · iteration ${e.state?.iteration ?? 0}`} value={e.calls_used} max={budget || Math.max(1, e.calls_used)} />
                  </div>
                  <p className="mt-4 font-mono text-[0.62rem] text-muted">started {dateShort(e.created_at)} · {e.finished_at ? `finished ${ago(e.finished_at)}` : `updated ${ago(e.created_at)}`}</p>
                </SpotlightCard>
              </Link>
            );
          })}
        </div>
      )}

      <Card className="rise p-6" style={{ animationDelay: "200ms" }}>
        <CardHead code="P" title="Promotion history" kicker="every gate decision with its evidence · rollbacks included" />
        <div className="mt-6 flex flex-col gap-6">
          {promotions.map((p) => {
            const to = profiles.get(p.to_profile_id);
            const from = p.from_profile_id ? profiles.get(p.from_profile_id) : null;
            return (
              <details key={p.id} className="group rounded-2xl border border-line bg-surface-2/40 open:bg-surface-2/70">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-4">
                  <span className="serif text-xl text-ink">
                    {agentName(p.agent_id)} v{from?.version ?? "–"} → v{to?.version ?? "?"}
                  </span>
                  <Chip tone={p.decision === "promoted" ? (p.path === "rollback" ? "info" : "pass") : p.decision === "pending" ? "warn" : "accent"}>
                    {p.path === "rollback" ? "rollback" : p.decision}
                  </Chip>
                  {p.path && p.path !== "rollback" && <Chip>{p.path} path</Chip>}
                  {p.gate_report?.test && (
                    <span className="font-mono text-[0.68rem] text-muted">
                      test {pct(p.gate_report.test.baseline_rate)} → {pct(p.gate_report.test.candidate_rate)} · p={p.gate_report.test.mcnemar_p.toFixed(3)}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[0.64rem] text-muted">
                    {p.decided_by} · {dateShort(p.created_at)}
                  </span>
                </summary>
                <div className="border-t border-line px-5 py-5">
                  <GateCard report={p.gate_report} promotion={p} />
                  {p.gate_run_ids.length > 0 && (
                    <p className="mt-4 font-mono text-[0.64rem] text-muted">
                      gate runs:{" "}
                      {p.gate_run_ids.map((id, i) => (
                        <span key={id}>
                          {i > 0 && " · "}
                          <Link className="text-ink-2 hover:text-accent" href={`/runs/${id}`}>
                            {i === 0 ? "candidate" : "baseline"}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </details>
            );
          })}
          {promotions.length === 0 && <p className="text-sm text-muted">No promotions yet.</p>}
        </div>
      </Card>
    </div>
  );
}
