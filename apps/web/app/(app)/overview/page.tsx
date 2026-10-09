import { AlertTriangle, ArrowRight, ArrowUpRight, GitPullRequestArrow, Inbox, RotateCcw, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TrendChart } from "@/components/charts/trend-chart";
import { SpotlightCard } from "@/components/ui/interactive";
import { ButtonLink, Card, CardHead, Chip, CiBar, Empty, Meter, PageHeader } from "@/components/ui/primitives";
import { Sparkline } from "@/components/ui/sparkline";
import { ago, cn, dateShort, ms, pct, pctCi, usd } from "@/lib/format";
import { AGENT_META, agentName } from "@/lib/meta";
import { DAILY_CAPS, agentCards, latestDay, openAlerts, profileMap, usageByPurpose } from "@/lib/server/queries";
import { getStore } from "@/lib/server/store";

export const metadata: Metadata = { title: "Overview" };
export const revalidate = 60;

export default async function OverviewPage() {
  const store = getStore();
  const [cards, alerts, reviews, calibrations, usage, profiles, promotions] = await Promise.all([
    agentCards(),
    openAlerts(),
    store.reviews("pending"),
    store.calibrations(),
    store.usage("2000-01-01"),
    profileMap(),
    store.promotions(),
  ]);
  const day = latestDay(usage);
  const used = usageByPurpose(usage, day);
  const lastNightlyAt = cards.map((c) => c.lastNightly?.created_at).filter(Boolean).sort().at(-1) ?? null;
  const main = cards.filter((c) => c.agent.id !== "toy");
  const toy = cards.find((c) => c.agent.id === "toy");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker="Issue 03 · Monitor · 01"
        title={
          <>
            Over<span className="text-accent">view</span>
          </>
        }
        subtitle={
          lastNightlyAt
            ? `${main.length} agents under test. Last nightly ${ago(lastNightlyAt)} — every rate shown with its 95% interval.`
            : "No nightly runs yet — enable the nightly workflow or trigger a run from Settings."
        }
        actions={
          <>
            <ButtonLink href="/runs">All runs</ButtonLink>
            <ButtonLink href="/redteam" variant="solid">
              Red-team heatmap <ArrowRight className="size-3.5" />
            </ButtonLink>
          </>
        }
      />

      {alerts.length > 0 && (
        <div className="rise flex flex-col gap-2" style={{ animationDelay: "60ms" }} role="region" aria-label="Open alerts">
          {alerts.slice(0, 3).map((a) => (
            <Link
              key={a.id}
              href={a.run_id ? `/runs/${a.run_id}` : "/runs"}
              className="group flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 transition hover:border-accent"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
                <AlertTriangle className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="kicker !text-accent-ink">{a.level} · {agentName(a.agent_id)} · {ago(a.created_at)}</span>
                <span className="block truncate text-sm text-ink">{a.message}</span>
              </span>
              <ArrowUpRight className="size-4 text-accent transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      )}

      {/* agent cards */}
      {main.length === 0 ? (
        <Empty title="No agents registered yet">Seed the agents table (pnpm db:seed) or connect the runner.</Empty>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {main.map((c, i) => {
            const s = c.lastNightly?.summary;
            const meta = AGENT_META[c.agent.id];
            const rt = s?.redteam;
            return (
              <SpotlightCard key={c.agent.id} className="rise overflow-hidden p-6" style={{ animationDelay: `${120 + i * 80}ms` }}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="kicker">{String(i + 1).padStart(2, "0")} · {meta?.tagline}</p>
                    <Link href={`/agents/${c.agent.id}`} className="serif mt-1 block text-[2.1rem] leading-none text-ink transition hover:text-accent">
                      {meta?.name ?? c.agent.id}
                    </Link>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    {c.active && <Chip tone="accent">profile v{c.active.version}</Chip>}
                    <span className="font-mono text-[0.6rem] text-muted">{c.active?.created_by === "optimizer" ? "optimizer-made" : "human-made"}</span>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-[1.1fr_1fr] items-end gap-6">
                  <div>
                    <p className="kicker">Last nightly pass rate</p>
                    <p className="display num mt-2 text-[4.2rem] leading-[0.85] text-ink">{s ? pct(s.pass_rate) : "—"}</p>
                    <p className="mt-2 font-mono text-[0.68rem] text-muted num">
                      {s ? `95% ${pct(s.ci[0])}–${pct(s.ci[1])} · n=${s.n_results}` : "no runs"}
                    </p>
                    {s && <CiBar className="mt-3" rate={s.pass_rate} ci={s.ci} tone="pass" />}
                  </div>
                  <div>
                    <Sparkline points={c.trend} color={meta?.color ?? "var(--accent)"} label={`${meta?.name} 30-night pass-rate trend`} />
                    <p className="mt-1 text-right font-mono text-[0.6rem] text-muted">{c.trend.length} nights</p>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
                  <Mini label="Attack success" value={rt ? pct(rt.asr, 1) : "—"} sub={rt ? `${rt.succeeded}/${rt.n} · ${pct(rt.ci[0], 0)}–${pct(rt.ci[1], 0)}` : "no red-team"} tone={rt && rt.asr > 0 ? "accent" : undefined} />
                  <Mini label="Cost / case" value={usd(s?.cost?.mean_list_price_usd)} sub="list price · paid $0" />
                  <Mini label="p50 latency" value={ms(s?.latency?.p50_ms)} sub={`p95 ${ms(s?.latency?.p95_ms)}`} />
                  <Mini label="Hard failures" value={s?.hard_failures ? String(s.hard_failures.must_not + s.hard_failures.canary) : "—"} sub="must_not + canary" tone={s?.hard_failures && s.hard_failures.must_not + s.hard_failures.canary > 0 ? "accent" : "pass"} />
                </div>

                <div className="mt-5 flex items-center justify-between text-[0.75rem] text-muted">
                  <span className="font-mono">
                    {c.lastNightly ? `run #${c.lastNightly.seq} · ${ago(c.lastNightly.created_at)}` : "—"} · {c.runsTotal} runs total
                  </span>
                  {c.lastNightly && (
                    <Link href={`/runs/${c.lastNightly.id}`} className="inline-flex items-center gap-1 text-ink-2 transition hover:text-accent">
                      Open run <ArrowRight className="size-3.5" />
                    </Link>
                  )}
                </div>
              </SpotlightCard>
            );
          })}
        </div>
      )}

      {/* bento */}
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card className="rise p-6" style={{ animationDelay: "300ms" }}>
          <CardHead code="A" title="Nightly pass rate" kicker="regression suite · active profile · Wilson 95% band" />
          <div className="mt-5">
            <TrendChart
              series={main.map((c) => ({
                key: c.agent.id,
                name: AGENT_META[c.agent.id]?.name ?? c.agent.id,
                color: c.agent.id === "returnpilot" ? "#f32e35" : "#8ab4ff",
                points: c.trend,
              }))}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {main.map((c) => (
              <span key={c.agent.id} className="flex items-center gap-2 font-mono text-[0.65rem] text-muted">
                <span className="h-0.5 w-5 rounded" style={{ background: c.agent.id === "returnpilot" ? "#f32e35" : "#8ab4ff" }} />
                {AGENT_META[c.agent.id]?.name}
              </span>
            ))}
          </div>
        </Card>

        <Card className="rise flex flex-col p-6" style={{ animationDelay: "360ms" }}>
          <CardHead code="B" title="Recent promotions" kicker="gated · human-approved · audit-logged" right={<ButtonLink href="/optimizer" className="!px-3 !py-1.5 !text-[0.7rem]">Optimizer</ButtonLink>} />
          <ol className="mt-5 flex flex-1 flex-col gap-1">
            {promotions.slice(0, 6).map((p) => {
              const to = profiles.get(p.to_profile_id);
              const from = p.from_profile_id ? profiles.get(p.from_profile_id) : null;
              const Icon = p.path === "rollback" ? RotateCcw : p.decision === "rejected" ? AlertTriangle : Sparkles;
              return (
                <li key={p.id} className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition hover:bg-surface-2">
                  <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", p.decision === "rejected" ? "bg-warn-soft text-warn" : p.path === "rollback" ? "bg-info-soft text-info" : "bg-accent-soft text-accent")}>
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.82rem] text-ink">
                      {agentName(p.agent_id)} {from ? `v${from.version}` : ""} → v{to?.version ?? "?"}
                      <span className="ml-2 font-mono text-[0.62rem] uppercase text-muted">{p.decision === "rejected" ? "rejected" : p.path}</span>
                    </p>
                    <p className="truncate font-mono text-[0.64rem] text-muted">
                      {p.gate_report?.test ? `test ${pct(p.gate_report.test.baseline_rate)} → ${pct(p.gate_report.test.candidate_rate)} · ` : ""}
                      {p.decided_by} · {dateShort(p.created_at)}
                    </p>
                  </div>
                </li>
              );
            })}
            {promotions.length === 0 && <p className="text-sm text-muted">No promotions yet.</p>}
          </ol>
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Card className="rise p-6" style={{ animationDelay: "420ms" }}>
          <CardHead code="C" title="LLM budget" kicker={day ? `ledger · ${day} · caps from SPEC §15.1` : "no usage recorded"} />
          <div className="mt-5 flex flex-col gap-4">
            {DAILY_CAPS.map((c) => (
              <Meter key={c.purpose} label={c.label} value={used[c.purpose] ?? 0} max={c.cap} />
            ))}
          </div>
        </Card>

        <Card className="rise p-6" style={{ animationDelay: "480ms" }}>
          <CardHead code="D" title="Judge calibration" kicker="Cohen's κ vs blind human labels · gate needs κ ≥ 0.6, n ≥ 50" />
          <div className="mt-5 flex flex-col gap-5">
            {calibrations.map((c) => (
              <div key={`${c.agent_id}-${c.prompt_hash}`}>
                <div className="flex items-baseline justify-between">
                  <span className="serif text-xl text-ink">{agentName(c.agent_id)}</span>
                  <Chip tone={c.calibrated ? "pass" : "warn"}>{c.calibrated ? "calibrated" : "not calibrated"}</Chip>
                </div>
                <div className="mt-2 flex items-end gap-4">
                  <p className="display num text-4xl text-ink">κ {c.kappa.toFixed(2)}</p>
                  <p className="pb-1 font-mono text-[0.65rem] text-muted">agreement {pct(c.agreement)} · n={c.n}</p>
                </div>
                <div className="relative mt-3 h-1.5 rounded-full bg-surface-3">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-transparent to-[var(--pass)]" style={{ width: `${Math.max(0, c.kappa) * 100}%` }} />
                  <div className="absolute -top-1 h-3.5 w-px bg-ink" style={{ left: "60%" }} title="κ = 0.6 threshold" />
                </div>
              </div>
            ))}
            {calibrations.length === 0 && <p className="text-sm text-muted">No labels yet — label 50 items on Calibration.</p>}
          </div>
        </Card>

        <Card className="rise flex flex-col justify-between p-6" style={{ animationDelay: "540ms" }}>
          <CardHead code="E" title="Review queue" kicker="drafted from failing live traces · human-accepted only" />
          <div className="mt-4">
            <p className="display num text-[5rem] leading-none text-ink">{reviews.length}</p>
            <p className="serif text-xl italic text-ink-2">drafts waiting for a human</p>
            <ul className="mt-4 flex flex-col gap-2">
              {reviews.slice(0, 3).map((r) => (
                <li key={r.id} className="flex items-center gap-2 truncate text-[0.8rem] text-muted">
                  <Inbox className="size-3.5 shrink-0 text-accent" aria-hidden />
                  <span className="truncate">{r.cluster_label ?? r.draft.title ?? r.draft.case_id}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-5 flex items-center justify-between">
            {toy?.lastNightly?.summary || toy?.trend.length ? (
              <span className="flex items-center gap-1.5 font-mono text-[0.62rem] text-muted">
                <GitPullRequestArrow className="size-3.5" aria-hidden /> toy agent CI {toy?.lastNightly?.summary ? pctCi(toy.lastNightly.summary.pass_rate, toy.lastNightly.summary.ci) : ""}
              </span>
            ) : (
              <span />
            )}
            <ButtonLink href="/datasets/review" variant="solid" className="!px-3.5 !py-1.5 !text-[0.72rem]">
              Review <ArrowRight className="size-3" />
            </ButtonLink>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Mini({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "accent" | "pass" }) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="kicker !text-[0.56rem]">{label}</p>
      <p className={cn("display num mt-1 text-2xl", tone === "accent" ? "text-accent" : tone === "pass" ? "text-pass" : "text-ink")}>{value}</p>
      <p className="truncate font-mono text-[0.58rem] text-muted num">{sub}</p>
    </div>
  );
}
