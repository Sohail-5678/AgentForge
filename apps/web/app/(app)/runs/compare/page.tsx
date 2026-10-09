import type { Metadata } from "next";
import Link from "next/link";
import { Card, CiBar, Empty, PageHeader, PassChip } from "@/components/ui/primitives";
import { ciPts, dateShort, pValue, pct, signedPts } from "@/lib/format";
import { agentName } from "@/lib/meta";
import { getStore } from "@/lib/server/store";
import { comparePaired } from "@/lib/stats";
import type { Run } from "@/lib/types";

export const metadata: Metadata = { title: "Compare runs" };

export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const store = getStore();
  const [ra, rb] = await Promise.all([sp.a ? store.run(sp.a) : null, sp.b ? store.run(sp.b) : null]);
  const agent = rb?.agent_id ?? ra?.agent_id;
  const recent = await store.runs({ agent, status: "done", limit: 40 });

  const picker = (side: "a" | "b", current: Run | null) => (
    <div>
      <p className="kicker mb-2">{side === "a" ? "Baseline (A)" : "Candidate (B)"}</p>
      <div className="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-2xl border border-line p-1.5">
        {recent.map((r) => {
          const href = `/runs/compare?${new URLSearchParams({ ...(side === "a" ? { a: r.id, ...(rb ? { b: rb.id } : {}) } : { b: r.id, ...(ra ? { a: ra.id } : {}) }) })}`;
          const active = current?.id === r.id;
          return (
            <Link key={r.id} href={href} scroll={false} className={`flex items-center justify-between rounded-xl px-3 py-2 text-[0.78rem] transition ${active ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-surface-2"}`}>
              <span className="font-mono">#{r.seq} · {r.trigger}</span>
              <span className="font-mono text-[0.66rem] text-muted">
                {r.summary ? pct(r.summary.pass_rate) : "—"} · {dateShort(r.created_at)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );

  let body: React.ReactNode = <Empty title="Pick two runs">Comparisons pair results on the cases both runs share (§5.4) and use McNemar + a paired bootstrap (§7.2).</Empty>;
  if (ra && rb) {
    const [resA, resB] = await Promise.all([store.results(ra.id), store.results(rb.id)]);
    const ma = new Map(resA.filter((r) => r.attempt === 1).map((r) => [r.case_id, r.passed === true]));
    const mb = new Map(resB.filter((r) => r.attempt === 1).map((r) => [r.case_id, r.passed === true]));
    const c = comparePaired(ma, mb);
    const discordant = [...c.newly_failing.map((id) => ({ id, a: true, b: false })), ...c.newly_passing.map((id) => ({ id, a: false, b: true }))];
    body = (
      <div className="flex flex-col gap-5">
        <Card className="rise p-6 sm:p-8">
          <p className="kicker">compared on {c.shared} shared cases · A #{ra.seq} vs B #{rb.seq}</p>
          <div className="mt-5 grid gap-8 md:grid-cols-4">
            <div>
              <p className="kicker">A · baseline</p>
              <p className="display num mt-2 text-5xl text-ink">{pct(c.baseline_rate)}</p>
              <CiBar className="mt-3" rate={c.baseline_rate} tone="info" />
            </div>
            <div>
              <p className="kicker">B · candidate</p>
              <p className="display num mt-2 text-5xl text-ink">{pct(c.rate)}</p>
              <CiBar className="mt-3" rate={c.rate} tone="pass" />
            </div>
            <div>
              <p className="kicker">Difference</p>
              <p className={`display num mt-2 text-5xl ${c.diff < 0 ? "text-accent" : "text-pass"}`}>{signedPts(c.diff)}</p>
              <p className="mt-1 font-mono text-[0.66rem] text-muted">95% bootstrap CI {ciPts(c.diff_ci)}</p>
            </div>
            <div>
              <p className="kicker">McNemar exact</p>
              <p className="display num mt-2 text-5xl normal-case text-ink">{pValue(c.p_value)}</p>
              <p className="mt-1 font-mono text-[0.66rem] text-muted">b={c.b} (A✓ B✗) · c={c.c} (A✗ B✓)</p>
            </div>
          </div>
          <p className="serif mt-6 text-xl italic text-ink-2">
            {c.p_value < 0.05 ? (c.diff > 0 ? "B is significantly better on the shared cases." : "B is significantly worse on the shared cases.") : "Not proven either way — the difference is within what chance produces at this sample size."}
          </p>
        </Card>
        <Card className="rise overflow-hidden" style={{ animationDelay: "80ms" }}>
          <div className="px-6 pt-6">
            <h2 className="serif text-2xl text-ink">Per-case diff</h2>
            <p className="kicker mt-1">only discordant cases — what reviewers actually read</p>
          </div>
          <table className="table-af mt-4">
            <thead>
              <tr>
                <th>Case</th>
                <th>A</th>
                <th>B</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {discordant.map((d) => (
                <tr key={d.id}>
                  <td className="font-mono text-[0.74rem] text-ink">{d.id}</td>
                  <td><PassChip passed={d.a} /></td>
                  <td><PassChip passed={d.b} /></td>
                  <td className={`font-mono text-[0.7rem] ${d.b ? "text-pass" : "text-accent-ink"}`}>{d.b ? "newly passing" : "newly failing"}</td>
                </tr>
              ))}
              {discordant.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-muted">No discordant cases.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker="Improve · 10 · paired statistics"
        title={
          <>
            Com<span className="text-accent">pare</span>
          </>
        }
        subtitle={agent ? `${agentName(agent)} — pick a baseline and a candidate run.` : "Pick a baseline and a candidate run of the same agent."}
      />
      <div className="rise grid gap-5 md:grid-cols-2" style={{ animationDelay: "40ms" }}>
        {picker("a", ra)}
        {picker("b", rb)}
      </div>
      {body}
    </div>
  );
}
