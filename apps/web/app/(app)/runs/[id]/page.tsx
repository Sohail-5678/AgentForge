import { ArrowLeft, Download, GitCompareArrows } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResultsExplorer, type CaseInfo } from "@/components/run/results-explorer";
import { AdminButton } from "@/components/admin/admin-button";
import { Card, Chip, CiBar, KV, RunStatusChip, Stat, TriggerChip } from "@/components/ui/primitives";
import { ago, ciPts, dateTime, hasRate, ms, pValue, pct, qualityN, rated, sha, signedPts, usd } from "@/lib/format";
import { JsonView } from "@/components/ui/interactive";
import { LAYERS, agentName } from "@/lib/meta";
import { getStore } from "@/lib/server/store";


export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const run = await getStore().run(id);
  return { title: run ? `Run #${run.seq}` : "Run" };
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const run = await store.run(id);
  if (!run) notFound();
  const [results, profile, versions, siblings] = await Promise.all([
    store.results(run.id),
    store.profile(run.profile_id),
    store.suiteVersionsByIds(run.suite_version_ids),
    store.runs({ agent: run.agent_id, status: "done", limit: 30 }),
  ]);
  const caseRows = await store.casesByIds([...new Set(results.map((r) => r.case_id))]);
  const cases: Record<string, CaseInfo> = Object.fromEntries(caseRows.map((c) => [c.id, { body: c.body, split: c.split }]));
  const s = run.summary;
  const suites = s?.suites ?? versions.map((v) => v.suite_id);
  const isRedteam = suites.some((x) => x.endsWith("/redteam")) || !!s?.redteam;
  const label = `Run #${run.seq}`;
  const cmp = s?.compare;

  return (
    <div className="flex flex-col gap-7">
      <div className="rise">
        <Link href="/runs" className="inline-flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-wider text-muted transition hover:text-ink">
          <ArrowLeft className="size-3.5" /> All runs
        </Link>
      </div>

      {/* header card, after the spec's run-detail wireframe (§2.3) */}
      <Card className="rise relative overflow-hidden p-6 sm:p-8" style={{ animationDelay: "40ms" }}>
        <div aria-hidden className="dots dots-fade absolute inset-0 opacity-50" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusChip status={run.status} />
            <TriggerChip trigger={run.trigger} pr={run.pr_number} />
            {s?.synthetic && <Chip tone="warn">synthetic demo</Chip>}
            {s?.fake_llm && <Chip tone="info">fake LLM</Chip>}
            {run.attempts > 1 && <Chip>pass^{run.attempts}</Chip>}
          </div>
          <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="kicker">
                {agentName(run.agent_id)} · {suites.join(" + ") || "—"} · profile v{profile?.version ?? "?"} · commit {sha(run.target_ref)}
              </p>
              <h1 className="display mt-2 text-[clamp(3rem,7vw,5.6rem)] text-ink">
                Run <span className="text-accent">#{run.seq}</span>
              </h1>
              <p className="font-mono text-[0.68rem] text-muted">
                {dateTime(run.created_at)} · {ago(run.created_at)}
                {run.finished_at ? ` · took ${ms(new Date(run.finished_at).getTime() - new Date(run.created_at).getTime())}` : ""}
                {run.gh_run_id ? ` · Actions run ${run.gh_run_id}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/runs/compare?b=${run.id}${cmp?.baseline_run_id ? `&a=${cmp.baseline_run_id}` : ""}`}
                className="inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-[0.8rem] text-ink-2 transition hover:border-accent hover:text-ink"
              >
                <GitCompareArrows className="size-3.5" /> Compare with…
              </Link>
              <AdminButton action={{ kind: "rerun-failed", runId: run.id }} label="Re-run failed" />
              <a
                href={`/api/v1/runs/${run.id}/results?format=jsonl`}
                className="inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-[0.8rem] text-ink-2 transition hover:border-accent hover:text-ink"
              >
                <Download className="size-3.5" /> Results
              </a>
            </div>
          </div>

          {s && !hasRate(s) && !s.error && (
            <div className="mt-8 border-t border-line pt-6">
              <p className="serif text-lg italic text-ink-2">
                {run.trigger === "optimizer" ? "Optimizer evaluation slice — per-case scores are stored on the candidates of the experiment." : "No pass rate recorded for this run yet."}
              </p>
              <div className="mt-3">
                <JsonView label="summary" value={s} />
              </div>
            </div>
          )}
          {rated(s) && (
            <div className="mt-8 grid gap-6 border-t border-line pt-6 sm:grid-cols-2 lg:grid-cols-5">
              <div className="sm:col-span-2">
                <Stat label="Pass · quality cases" value={`${s.passed}/${qualityN(s)}`} sub={`${pct(s.pass_rate)} · 95% ${pct(s.ci[0])}–${pct(s.ci[1])}${s.redteam ? ` · + ${s.redteam.n} attacks` : ""}`} tone="pass" />
                <CiBar className="mt-3" rate={s.pass_rate} ci={s.ci} tone="pass" />
              </div>
              <Stat
                label={s.pass_k ? `pass^${s.pass_k.k}` : "pass^k"}
                value={s.pass_k ? pct(s.pass_k.rate) : "—"}
                sub={s.pass_k ? `${s.pass_k.passed_all}/${s.pass_k.n} all-pass` : "single attempt"}
              />
              <Stat label="Cost / case" value={usd(s.cost?.mean_list_price_usd)} sub={`list price · ${s.cost?.mean_llm_calls?.toFixed(1) ?? "—"} calls`} />
              <Stat label="Latency p50" value={ms(s.latency?.p50_ms)} sub={`p95 ${ms(s.latency?.p95_ms)}`} />
            </div>
          )}
          {s?.error && <p className="mt-6 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 font-mono text-[0.72rem] text-accent-ink">{s.error}</p>}
        </div>
      </Card>

      {(cmp || s?.redteam || s?.by_split) && (
        <div className="grid gap-5 lg:grid-cols-3">
          {cmp && (
            <Card className="rise p-6" style={{ animationDelay: "80ms" }}>
              <p className="kicker">vs baseline · paired on {cmp.shared} shared cases</p>
              <p className={`display num mt-3 text-5xl ${cmp.diff < 0 ? "text-accent" : "text-pass"}`}>{signedPts(cmp.diff)}</p>
              <p className="mt-1 font-mono text-[0.68rem] text-muted">
                95% CI {ciPts(cmp.diff_ci)} · McNemar {pValue(cmp.p_value)} · b={cmp.b} c={cmp.c}
              </p>
              <p className="serif mt-3 text-lg italic text-ink-2">
                {cmp.p_value < 0.05 ? (cmp.diff < 0 ? "Significantly worse — alert raised." : "Significantly better.") : "Within the noise band — not proven either way."}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-[0.72rem]">
                <div>
                  <p className="kicker !text-[0.56rem] !text-accent-ink">newly failing · {cmp.newly_failing.length}</p>
                  <ul className="mt-1 font-mono text-muted">
                    {cmp.newly_failing.slice(0, 5).map((c) => (
                      <li key={c} className="truncate">{c}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="kicker !text-[0.56rem] !text-pass">newly passing · {cmp.newly_passing.length}</p>
                  <ul className="mt-1 font-mono text-muted">
                    {cmp.newly_passing.slice(0, 5).map((c) => (
                      <li key={c} className="truncate">{c}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <Link href={`/runs/${cmp.baseline_run_id}`} className="mt-4 inline-block font-mono text-[0.65rem] text-ink-2 hover:text-accent">
                open baseline →
              </Link>
            </Card>
          )}
          {s?.redteam && (
            <Card className="rise p-6" style={{ animationDelay: "120ms" }}>
              <p className="kicker">Red team · {s.redteam.n} attacks</p>
              <p className="display num mt-3 text-5xl text-accent">{pct(s.redteam.asr, 1)}</p>
              <p className="mt-1 font-mono text-[0.68rem] text-muted">
                attack success · 95% {pct(s.redteam.ci[0], 1)}–{pct(s.redteam.ci[1], 1)} · {s.redteam.succeeded} succeeded
              </p>
              <div className="mt-5 flex h-3 overflow-hidden rounded-full">
                {LAYERS.map((l) => {
                  const v = s.redteam!.by_layer[l.id] ?? 0;
                  return v ? <div key={l.id} title={`${l.label}: ${v}`} style={{ width: `${(v / s.redteam!.n) * 100}%`, background: l.color }} /> : null;
                })}
                {s.redteam.succeeded > 0 && <div title={`succeeded: ${s.redteam.succeeded}`} className="bg-[repeating-linear-gradient(45deg,var(--accent),var(--accent)_3px,transparent_3px,transparent_6px)]" style={{ width: `${(s.redteam.succeeded / s.redteam.n) * 100}%` }} />}
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
                {LAYERS.filter((l) => s.redteam!.by_layer[l.id]).map((l) => (
                  <li key={l.id} className="flex items-center justify-between font-mono text-[0.64rem] text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-sm" style={{ background: l.color }} />
                      {l.label}
                    </span>
                    <span className="text-ink-2">{s.redteam!.by_layer[l.id]}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {s?.by_split && (
            <Card className="rise p-6" style={{ animationDelay: "160ms" }}>
              <p className="kicker">By split</p>
              <dl className="mt-3">
                {(["train", "val", "test"] as const).map((sp) =>
                  s.by_split?.[sp] ? (
                    <div key={sp} className="border-b border-line py-2.5 last:border-0">
                      <div className="flex items-baseline justify-between">
                        <dt className="font-mono text-[0.7rem] uppercase tracking-wider text-ink-2">{sp}</dt>
                        <dd className="font-mono text-[0.7rem] text-muted num">
                          <span className="text-ink">{pct(s.by_split[sp]!.rate)}</span> ({pct(s.by_split[sp]!.ci[0])}–{pct(s.by_split[sp]!.ci[1])}) n={s.by_split[sp]!.n}
                        </dd>
                      </div>
                      <CiBar className="mt-2 !h-1" rate={s.by_split[sp]!.rate} ci={s.by_split[sp]!.ci} tone={sp === "test" ? "accent" : "info"} />
                    </div>
                  ) : null,
                )}
              </dl>
              {s.hard_failures && (
                <dl className="mt-4">
                  <KV k="must_not violations" v={s.hard_failures.must_not} />
                  <KV k="canary leaks" v={s.hard_failures.canary} />
                  {s.budget && <KV k="budget" v={`${s.budget.calls_used}/${s.budget.budget_calls} calls${s.budget.stopped_early ? " · stopped early" : ""}`} />}
                </dl>
              )}
            </Card>
          )}
        </div>
      )}

      <Card className="rise overflow-hidden" style={{ animationDelay: "200ms" }}>
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="serif text-2xl text-ink">Per-case results</h2>
          <span className="font-mono text-[0.64rem] text-muted">{results.length} results · ↑↓ + Enter</span>
        </div>
        <ResultsExplorer results={results} cases={cases} redteam={isRedteam} runLabel={label} />
      </Card>

      {siblings.length > 1 && (
        <p className="font-mono text-[0.64rem] text-muted">
          Other recent runs of {agentName(run.agent_id)}:{" "}
          {siblings
            .filter((r) => r.id !== run.id)
            .slice(0, 8)
            .map((r, i) => (
              <span key={r.id}>
                {i > 0 && " · "}
                <Link className="text-ink-2 hover:text-accent" href={`/runs/${r.id}`}>
                  #{r.seq}
                </Link>
              </span>
            ))}
        </p>
      )}
    </div>
  );
}
