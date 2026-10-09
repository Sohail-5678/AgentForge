import type { Metadata } from "next";
import { LabelPanel } from "@/components/calibration/label-panel";
import { Card, CardHead, Chip, Empty, PageHeader } from "@/components/ui/primitives";
import { dateShort, pct } from "@/lib/format";
import { agentName } from "@/lib/meta";
import { getStore } from "@/lib/server/store";
import { cohensKappa } from "@/lib/stats";

export const metadata: Metadata = { title: "Calibration" };

export default async function CalibrationPage() {
  const store = getStore();
  const [calibrations, labels, agents] = await Promise.all([store.calibrations(), store.judgeLabels(), store.agents()]);
  const ids = agents.filter((a) => a.id !== "toy").map((a) => a.id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker="Improve · 09 · LLM judge"
        title={
          <>
            Cali<span className="text-accent">bration</span>
          </>
        }
        subtitle="The rubric judge counts in a gate only after blind human labels agree with it: Cohen's κ ≥ 0.6 on at least 50 items. Recalibrate whenever the judge model or prompt changes."
      />
      {ids.length === 0 && <Empty title="No agents">Register agents first.</Empty>}
      <div className="grid gap-5 xl:grid-cols-2">
        {ids.map((agent, i) => {
          const cal = calibrations.find((c) => c.agent_id === agent);
          const accepted = labels.filter((l) => l.agent_id === agent && l.accepted && l.judge_verdict !== null);
          const k = cal ? { kappa: cal.kappa, agreement: cal.agreement, n: cal.n, confusion: cal.confusion } : cohensKappa(accepted.map((l) => ({ human: l.human_verdict, judge: !!l.judge_verdict })));
          const c = { tp: Number(k.confusion.tp ?? 0), tn: Number(k.confusion.tn ?? 0), fp: Number(k.confusion.fp ?? 0), fn: Number(k.confusion.fn ?? 0) };
          const max = Math.max(1, c.tp, c.tn, c.fp, c.fn);
          const calibrated = cal?.calibrated ?? (k.kappa >= 0.6 && k.n >= 50);
          const pendingLabels = labels.filter((l) => l.agent_id === agent && !l.accepted).length;
          return (
            <Card key={agent} className="rise p-6" style={{ animationDelay: `${60 + i * 80}ms` }}>
              <CardHead
                code={String(i + 1).padStart(2, "0")}
                title={agentName(agent)}
                kicker={cal ? `${cal.judge_model} · prompt ${cal.prompt_hash.slice(0, 8)} · ${dateShort(cal.computed_at)}` : "no calibration yet"}
                right={<Chip tone={calibrated ? "pass" : "warn"}>{calibrated ? "calibrated" : "not calibrated"}</Chip>}
              />
              <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_1.1fr]">
                <div>
                  <p className="kicker">Cohen&apos;s kappa</p>
                  <p className="display num mt-2 text-7xl leading-none text-ink">{k.kappa.toFixed(2)}</p>
                  <p className="mt-2 font-mono text-[0.68rem] text-muted">
                    raw agreement {pct(k.agreement)} · n={k.n}
                    {k.n < 50 ? ` · ${50 - k.n} more labels needed` : ""}
                  </p>
                  <div className="relative mt-4 h-2 rounded-full bg-surface-3">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-transparent to-[var(--pass)]" style={{ width: `${Math.max(0, Math.min(1, k.kappa)) * 100}%` }} />
                    <div className="absolute -top-1.5 h-5 w-px bg-ink" style={{ left: "60%" }} />
                    <span className="absolute -top-6 font-mono text-[0.58rem] text-ink-2" style={{ left: "calc(60% - 14px)" }}>
                      0.60
                    </span>
                  </div>
                  {pendingLabels > 0 && <p className="mt-4 font-mono text-[0.64rem] text-warn">{pendingLabels} labels from signed-in users await admin acceptance</p>}
                </div>
                <div>
                  <p className="kicker mb-2">Confusion · human (rows) × judge (cols)</p>
                  <div className="grid grid-cols-[64px_1fr_1fr] gap-1.5 text-center font-mono text-[0.62rem]">
                    <span />
                    <span className="text-muted">judge pass</span>
                    <span className="text-muted">judge fail</span>
                    {[
                      ["human pass", c.tp, c.fn, "agree", "too strict"],
                      ["human fail", c.fp, c.tn, "too lenient", "agree"],
                    ].map(([label, a, b, la, lb]) => (
                      <div key={String(label)} className="contents">
                        <span className="self-center text-left text-muted">{label}</span>
                        {[
                          [a, la],
                          [b, lb],
                        ].map(([v, l], j) => (
                          <div
                            key={j}
                            className="flex aspect-[4/3] flex-col items-center justify-center rounded-xl border border-line"
                            style={{ background: l === "agree" ? `rgb(79 209 161 / ${0.08 + (Number(v) / max) * 0.4})` : `rgb(243 46 53 / ${0.06 + (Number(v) / max) * 0.4})` }}
                          >
                            <span className="display num text-3xl text-ink">{String(v)}</span>
                            <span className="text-[0.56rem] text-muted">{String(l)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  {c.fp > c.fn * 2 && c.fp > 2 && <p className="serif mt-3 text-[0.98rem] italic text-ink-2">Judge is lenient — tighten rubric wording first, not the threshold.</p>}
                </div>
              </div>
              <div className="mt-8 border-t border-line pt-6">
                <p className="kicker mb-3">Label more · blind</p>
                <LabelPanel agent={agent} />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
