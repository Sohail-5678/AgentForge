import type { Metadata } from "next";
import Link from "next/link";
import { Card, CiBar, Empty, PageHeader, RunStatusChip, TriggerChip } from "@/components/ui/primitives";
import { FilterBar } from "@/components/ui/filter-bar";
import { ago, ms, pct, qualityN, rated, sha, usd } from "@/lib/format";
import { agentName } from "@/lib/meta";
import { profileMap } from "@/lib/server/queries";
import { getStore } from "@/lib/server/store";

export const metadata: Metadata = { title: "Runs" };

const PAGE = 40;

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const q = { agent: sp.agent || undefined, trigger: sp.trigger || undefined, status: sp.status || undefined };
  const store = getStore();
  const [runs, total, profiles, agents] = await Promise.all([
    store.runs({ ...q, limit: PAGE, offset: (page - 1) * PAGE }),
    store.countRuns(q),
    profileMap(),
    store.agents(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => {
    const u = new URLSearchParams(Object.entries({ ...q, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `/runs?${u}`;
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker="Monitor · 03"
        title={
          <>
            R<span className="text-accent">uns</span>
          </>
        }
        subtitle="Every suite execution — nightly, manual, PR gate, optimizer and promotion gate — with its interval, cost and trigger."
      />
      <FilterBar
        base="/runs"
        values={q}
        filters={[
          { key: "agent", label: "Agent", options: agents.map((a) => ({ value: a.id, label: agentName(a.id) })) },
          { key: "trigger", label: "Trigger", options: ["nightly", "manual", "pr", "optimizer", "gate"].map((v) => ({ value: v, label: v })) },
          { key: "status", label: "Status", options: ["done", "running", "queued", "stalled", "failed", "cancelled"].map((v) => ({ value: v, label: v })) },
        ]}
        count={`${total} runs`}
      />
      {runs.length === 0 ? (
        <Empty title="No runs match">Try clearing the filters — or trigger one from Settings.</Empty>
      ) : (
        <Card className="rise overflow-hidden" style={{ animationDelay: "80ms" }}>
          <div className="overflow-x-auto">
            <table className="table-af min-w-[1040px]">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Agent · suite</th>
                  <th>Profile</th>
                  <th>Commit</th>
                  <th>Status</th>
                  <th className="w-[220px]">Pass rate (95% CI)</th>
                  <th>Cost / case</th>
                  <th>Duration</th>
                  <th>Trigger</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const s = r.summary;
                  const rs = rated(s) ? s : null;
                  const prof = profiles.get(r.profile_id);
                  const dur = r.finished_at ? new Date(r.finished_at).getTime() - new Date(r.created_at).getTime() : null;
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/runs/${r.id}`} className="font-mono text-[0.78rem] text-ink hover:text-accent">
                          #{r.seq}
                        </Link>
                      </td>
                      <td>
                        <Link href={`/runs/${r.id}`} className="block hover:text-accent">
                          <span className="text-ink">{agentName(r.agent_id)}</span>
                          <span className="block font-mono text-[0.64rem] text-muted">{s?.suites?.join(" + ") ?? "—"}</span>
                        </Link>
                      </td>
                      <td className="font-mono text-[0.72rem] text-ink-2">v{prof?.version ?? "?"}</td>
                      <td className="font-mono text-[0.72rem] text-muted">{sha(r.target_ref)}</td>
                      <td>
                        <RunStatusChip status={r.status} />
                      </td>
                      <td>
                        {rs ? (
                          <div>
                            <div className="flex items-baseline justify-between font-mono text-[0.72rem] num">
                              <span className="text-ink">{pct(rs.pass_rate)}</span>
                              <span className="text-muted">
                                {pct(rs.ci[0])}–{pct(rs.ci[1])} · n={qualityN(rs)}
                              </span>
                            </div>
                            <CiBar className="mt-1.5 !h-1" rate={rs.pass_rate} ci={rs.ci} tone="pass" />
                          </div>
                        ) : (
                          <span className="font-mono text-[0.68rem] text-muted">{s?.error ? "error" : r.trigger === "optimizer" && s ? `${s.n_results} evals · scored on candidate` : "—"}</span>
                        )}
                      </td>
                      <td className="font-mono text-[0.72rem] text-ink-2 num">{usd(s?.cost?.mean_list_price_usd)}</td>
                      <td className="font-mono text-[0.72rem] text-ink-2 num">{ms(dur)}</td>
                      <td>
                        <TriggerChip trigger={r.trigger} pr={r.pr_number} />
                      </td>
                      <td className="whitespace-nowrap font-mono text-[0.68rem] text-muted">{ago(r.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-5 py-3 font-mono text-[0.68rem] text-muted">
              <span>
                page {page} / {pages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link className="rounded-full border border-line-strong px-3 py-1 hover:border-accent hover:text-ink" href={qs(page - 1)}>
                    ← newer
                  </Link>
                )}
                {page < pages && (
                  <Link className="rounded-full border border-line-strong px-3 py-1 hover:border-accent hover:text-ink" href={qs(page + 1)}>
                    older →
                  </Link>
                )}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
