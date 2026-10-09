import type { Metadata } from "next";
import Link from "next/link";
import { TraceList } from "@/components/trace/trace-list";
import { FilterBar } from "@/components/ui/filter-bar";
import { Card, Empty, PageHeader } from "@/components/ui/primitives";
import { agentName } from "@/lib/meta";
import { getStore } from "@/lib/server/store";

export const metadata: Metadata = { title: "Traces" };

export default async function TracesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const store = getStore();
  const values = { agent: sp.agent, status: sp.status, feedback: sp.feedback, guard: sp.guard, mode: sp.mode };
  const [page, agents, profiles] = await Promise.all([
    store.traces({
      agent: sp.agent || undefined,
      status: sp.status || undefined,
      feedback: (sp.feedback as "down" | "up" | undefined) || undefined,
      guardHit: sp.guard === "hit" ? true : sp.guard === "clean" ? false : undefined,
      profileVersion: sp.profile || undefined,
      mode: (sp.mode as "live" | "eval" | undefined) || "live",
      cursor: sp.cursor ?? null,
      limit: 40,
    }),
    store.agents(),
    store.profiles(),
  ]);
  const items = page.items.map(({ spans, ...t }) => ({ ...t, span_count: spans.length }));
  const nextHref = (() => {
    if (!page.next) return null;
    const u = new URLSearchParams(Object.entries({ ...values, profile: sp.profile, cursor: page.next }).filter(([, v]) => v) as [string, string][]);
    return `/traces?${u}`;
  })();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker="Monitor · 04 · trace.v1"
        title={
          <>
            Tra<span className="text-accent">ces</span>
          </>
        }
        subtitle="Redacted traces from the live agents: every failure, guard hit and thumbs-down is kept; ~20% of successes are sampled. Failures feed the review queue."
      />
      <FilterBar
        base="/traces"
        values={values}
        filters={[
          { key: "agent", label: "Agent", options: agents.filter((a) => a.id !== "toy").map((a) => ({ value: a.id, label: agentName(a.id) })) },
          { key: "status", label: "Status", options: ["success", "failure", "blocked", "needs_human", "error", "budget_exceeded"].map((s) => ({ value: s, label: s.replace("_", " ") })) },
          { key: "feedback", label: "Feedback", options: [{ value: "down", label: "👎 down" }, { value: "up", label: "👍 up" }] },
          { key: "guard", label: "Guard", options: [{ value: "hit", label: "hit" }, { value: "clean", label: "clean" }] },
          { key: "mode", label: "Mode", options: [{ value: "eval", label: "eval" }] },
        ]}
      />
      {sp.agent && (
        <div className="rise -mt-4 flex flex-wrap items-center gap-1.5" style={{ animationDelay: "60ms" }}>
          <span className="kicker mr-1 !text-[0.58rem]">Profile</span>
          {profiles
            .filter((p) => p.agent_id === sp.agent)
            .map((p) => {
              const v = `${p.agent_id}@${p.version}`;
              const u = new URLSearchParams(Object.entries({ ...values, profile: sp.profile === v ? undefined : v }).filter(([, x]) => x) as [string, string][]);
              return (
                <Link key={p.id} href={`/traces?${u}`} className={`rounded-full border px-2.5 py-1 font-mono text-[0.62rem] ${sp.profile === v ? "border-accent bg-accent-soft text-accent-ink" : "border-line-strong text-muted hover:text-ink"}`}>
                  v{p.version}
                </Link>
              );
            })}
        </div>
      )}
      {items.length === 0 ? (
        <Empty title="No traces match">Live traces arrive from DataPilot and ReturnPilot via POST /api/v1/traces once their AGENTFORGE_KEY is set.</Empty>
      ) : (
        <Card className="rise overflow-hidden" style={{ animationDelay: "80ms" }}>
          <TraceList items={items} />
          <div className="flex items-center justify-between border-t border-line px-5 py-3 font-mono text-[0.66rem] text-muted">
            <span>{items.length} on this page · keyset pagination on (started_at, id)</span>
            <span className="flex gap-2">
              {sp.cursor && (
                <Link href={`/traces?${new URLSearchParams(Object.entries(values).filter(([, v]) => v) as [string, string][])}`} className="rounded-full border border-line-strong px-3 py-1 hover:text-ink">
                  ← newest
                </Link>
              )}
              {nextHref && (
                <Link href={nextHref} className="rounded-full border border-line-strong px-3 py-1 hover:border-accent hover:text-ink">
                  older →
                </Link>
              )}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
