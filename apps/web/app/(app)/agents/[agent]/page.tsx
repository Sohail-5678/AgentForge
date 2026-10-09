import { ArrowUpRight, Bot, Lock, Sparkles, User } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminButton } from "@/components/admin/admin-button";
import { TrendChart } from "@/components/charts/trend-chart";
import { ProfileDiff } from "@/components/optimizer/profile-diff";
import { JsonView } from "@/components/ui/interactive";
import { Card, CardHead, Chip, CiBar, PageHeader, TraceStatusChip } from "@/components/ui/primitives";
import { cn, dateShort, pct } from "@/lib/format";
import { AGENT_META } from "@/lib/meta";
import { nightlyRuns } from "@/lib/server/queries";
import { getStore } from "@/lib/server/store";
import type { Run } from "@/lib/types";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ agent: string }> }): Promise<Metadata> {
  const { agent } = await params;
  return { title: AGENT_META[agent]?.name ?? agent };
}

export default async function AgentPage({ params }: { params: Promise<{ agent: string }> }) {
  const { agent: agentId } = await params;
  const store = getStore();
  const agents = await store.agents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) notFound();
  const [profiles, promotions, nightly, runs, live] = await Promise.all([
    store.profiles(agentId),
    store.promotions(agentId),
    nightlyRuns(agentId),
    store.runs({ agent: agentId, status: "done", limit: 200 }),
    store.traces({ agent: agentId, mode: "live", limit: 500 }),
  ]);
  const active = profiles.find((p) => p.is_active);
  const meta = AGENT_META[agentId];
  // Suite score per profile version: the latest finished nightly on that profile.
  const byProfile = new Map<string, Run>();
  for (const r of runs) if (r.trigger === "nightly" && !byProfile.has(r.profile_id)) byProfile.set(r.profile_id, r);
  const statusCounts = live.items.reduce<Record<string, number>>((m, t) => ((m[t.status] = (m[t.status] ?? 0) + 1), m), {});
  const thumbs = live.items.filter((t) => t.feedback?.thumbs != null);
  const down = thumbs.filter((t) => (t.feedback?.thumbs ?? 0) < 0).length;
  const guard = live.items.filter((t) => t.guard_hit).length;
  const prev = active ? profiles.find((p) => p.version === (active.parent_version ?? active.version - 1)) : null;

  return (
    <div className="flex flex-col gap-8">
      <nav className="rise flex flex-wrap gap-2" aria-label="Agents">
        {agents.map((a) => (
          <Link
            key={a.id}
            href={`/agents/${a.id}`}
            aria-current={a.id === agentId ? "page" : undefined}
            className={cn("rounded-full border px-3.5 py-1.5 text-[0.78rem] transition", a.id === agentId ? "border-accent bg-accent-soft text-ink" : "border-line-strong text-muted hover:text-ink")}
          >
            {AGENT_META[a.id]?.name ?? a.id}
          </Link>
        ))}
      </nav>
      <PageHeader
        kicker={`Monitor · 02 · ${meta?.tagline ?? agent.adapter_module}`}
        title={meta?.name ?? agent.id}
        subtitle={`Profile history, suite scores per version and live trace health. Active: v${active?.version ?? "—"}${active ? `, ${active.created_by}-made` : ""}.`}
        actions={
          <>
            {meta?.repo && (
              <a href={meta.repo} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.8rem] text-ink-2 transition hover:border-accent hover:text-ink">
                Repository <ArrowUpRight className="size-3.5" />
              </a>
            )}
            <AdminButton action={{ kind: "trigger-run", agent: agent.id, suites: agent.config?.suites ?? [`${agent.id}/regression`] }} label="Run suite now" />
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card className="rise p-6" style={{ animationDelay: "60ms" }}>
          <CardHead code="A" title="Nightly pass rate" kicker={`${nightly.length} nightly runs · profile changes marked by colour`} />
          <div className="mt-5">
            <TrendChart series={[{ key: agent.id, name: meta?.name ?? agent.id, color: agent.id === "returnpilot" ? "#f32e35" : agent.id === "datapilot" ? "#8ab4ff" : "#b9a2ff", points: nightly.map((r) => ({ at: r.created_at, y: r.summary!.pass_rate, lo: r.summary!.ci[0], hi: r.summary!.ci[1] })) }]} />
          </div>
        </Card>
        <Card className="rise p-6" style={{ animationDelay: "120ms" }}>
          <CardHead code="B" title="Live traces" kicker={`${live.items.length} kept · sampling keeps every failure + 20% of successes`} />
          <div className="mt-5 grid grid-cols-3 gap-4">
            <div>
              <p className="kicker !text-[0.56rem]">thumbs-down</p>
              <p className="display num mt-1 text-3xl text-ink">{thumbs.length ? pct(down / thumbs.length) : "—"}</p>
              <p className="font-mono text-[0.58rem] text-muted">{down}/{thumbs.length} rated</p>
            </div>
            <div>
              <p className="kicker !text-[0.56rem]">guard hits</p>
              <p className="display num mt-1 text-3xl text-ink">{guard}</p>
              <p className="font-mono text-[0.58rem] text-muted">blocked by a guard span</p>
            </div>
            <div>
              <p className="kicker !text-[0.56rem]">mined</p>
              <p className="display num mt-1 text-3xl text-ink">{live.items.filter((t) => t.mined).length}</p>
              <p className="font-mono text-[0.58rem] text-muted">→ review drafts</p>
            </div>
          </div>
          <ul className="mt-6 flex flex-col gap-2">
            {Object.entries(statusCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([s, n]) => (
                <li key={s} className="grid grid-cols-[110px_1fr_40px] items-center gap-3">
                  <TraceStatusChip status={s} />
                  <div className="h-1.5 rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-ink-2/70" style={{ width: `${(n / Math.max(1, live.items.length)) * 100}%` }} />
                  </div>
                  <span className="text-right font-mono text-[0.66rem] text-muted num">{n}</span>
                </li>
              ))}
          </ul>
          <Link href={`/traces?agent=${agent.id}`} className="mt-5 inline-flex items-center gap-1 font-mono text-[0.66rem] text-ink-2 hover:text-accent">
            open trace explorer <ArrowUpRight className="size-3" />
          </Link>
        </Card>
      </div>

      <Card className="rise p-6" style={{ animationDelay: "160ms" }}>
        <CardHead code="C" title="Profile history" kicker="versions · who or what created them · suite score on each · promote/rollback audit-logged" />
        <ol className="relative mt-8 flex flex-col gap-0 pl-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-line-strong">
          {profiles.map((p) => {
            const run = byProfile.get(p.id);
            const promo = promotions.find((x) => x.to_profile_id === p.id && x.decision === "promoted");
            return (
              <li key={p.id} className="relative pb-7 last:pb-0">
                <span className={cn("absolute -left-6 top-1 grid size-[15px] place-items-center rounded-full border", p.is_active ? "border-accent bg-accent shadow-[0_0_14px_var(--accent-glow)]" : "border-line-strong bg-bg")} />
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="display text-3xl text-ink">v{p.version}</span>
                  {p.is_active && <Chip tone="accent">active</Chip>}
                  <span className="flex items-center gap-1 font-mono text-[0.64rem] text-muted">
                    {p.created_by === "optimizer" ? <Sparkles className="size-3 text-accent" /> : <User className="size-3" />}
                    {p.created_by} · {dateShort(p.created_at)}
                  </span>
                  {promo && <span className="font-mono text-[0.64rem] text-muted">{promo.path === "rollback" ? "rolled back to" : `promoted (${promo.path})`} by {promo.decided_by}</span>}
                  {!p.is_active && active && p.version < active.version && (
                    <AdminButton action={{ kind: "rollback", agent: agent.id, toVersion: p.version, fromVersion: active.version }} label="Roll back here" className="!px-3 !py-1 !text-[0.7rem]" />
                  )}
                </div>
                {p.body.notes && <p className="serif mt-1 max-w-3xl text-[1.05rem] italic text-ink-2">{p.body.notes}</p>}
                {run?.summary && (
                  <div className="mt-3 grid max-w-xl grid-cols-[1fr_auto] items-center gap-4">
                    <CiBar rate={run.summary.pass_rate} ci={run.summary.ci} tone="pass" />
                    <Link href={`/runs/${run.id}`} className="font-mono text-[0.66rem] text-ink-2 hover:text-accent num">
                      {pct(run.summary.pass_rate)} ({pct(run.summary.ci[0])}–{pct(run.summary.ci[1])}) · #{run.seq}
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </Card>

      {active && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="rise p-6" style={{ animationDelay: "200ms" }}>
            <CardHead code="D" title={`Active profile v${active.version}`} kicker="profile.v1 · served to the agent with an ETag" />
            <div className="mt-5 flex flex-col gap-3">
              {Object.entries(active.body.prompts).map(([k, v]) => (
                <details key={k} className="group rounded-xl border border-line">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5">
                    <code className="font-mono text-[0.72rem] text-ink">prompts.{k}</code>
                    <span className="font-mono text-[0.6rem] text-muted">{v.length.toLocaleString()} chars</span>
                  </summary>
                  <p className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-line bg-[var(--code-bg)] px-4 py-3 font-mono text-[0.68rem] leading-relaxed text-[#d9d3ca]">{v}</p>
                </details>
              ))}
              <JsonView label="params · routing · tool_descriptions" value={{ params: active.body.params, routing: active.body.routing, tool_descriptions: active.body.tool_descriptions }} />
            </div>
          </Card>
          <Card className="rise p-6" style={{ animationDelay: "240ms" }}>
            <CardHead code="E" title="Safety surface" kicker="locked fields — rejected by the editor, the control plane and the agent's own loader" />
            <ul className="mt-5 flex flex-wrap gap-2">
              {(agent.locked_keys ?? active.body.locked).map((k) => (
                <li key={k} className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 py-1.5 font-mono text-[0.68rem] text-accent-ink">
                  <Lock className="size-3" aria-hidden /> {k}
                </li>
              ))}
            </ul>
            <p className="kicker mt-6">optimizable</p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {(agent.optimizable_keys.paths ?? []).map((k) => (
                <li key={k} className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2.5 py-1 font-mono text-[0.62rem] text-ink-2">
                  <Bot className="size-3 text-muted" aria-hidden /> {k}
                </li>
              ))}
            </ul>
            {prev && (
              <>
                <p className="kicker mt-6 mb-3">what changed in v{active.version} vs v{prev.version}</p>
                <ProfileDiff before={prev.body} after={active.body} max={3} />
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
