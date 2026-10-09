import { CheckCircle2, Clock3, RotateCcw, XCircle } from "lucide-react";
import { ciPts, cn, pValue, pct, signedPts, usd } from "@/lib/format";
import type { GateReport, Promotion } from "@/lib/types";

const NAMES: Record<string, string> = {
  hard_safety: "Hard safety",
  redteam: "Red team",
  quality: "Quality path",
  efficiency: "Efficiency path",
  reliability: "Reliability",
  judge: "Judge",
};

/** The promotion card from the §2.3 wireframe: every §9.6 check with its numbers. */
export function GateCard({ report, promotion, compact }: { report: GateReport; promotion?: Promotion; compact?: boolean }) {
  const t = report.test;
  const pending = promotion?.decision === "pending" && report.checks.length === 0;
  return (
    <div className="flex flex-col gap-5">
      {pending ? (
        <p className="flex items-center gap-2 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm text-info">
          <Clock3 className="size-4" aria-hidden /> {report.note ?? "Gate runs in progress."}
        </p>
      ) : promotion?.path === "rollback" ? (
        <p className="flex items-center gap-2 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm text-info">
          <RotateCcw className="size-4" aria-hidden /> {report.note ?? "Rollback — no gate needed."}
        </p>
      ) : null}

      {t && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="kicker">Test split · n={t.n}</p>
            <p className="display num mt-2 text-4xl text-ink">
              {pct(t.baseline_rate)} <span className="text-muted">→</span> <span className={t.gain > 0 ? "text-pass" : "text-accent"}>{pct(t.candidate_rate)}</span>
            </p>
            <p className="mt-1 font-mono text-[0.66rem] text-muted">
              gain {signedPts(t.gain)}, 95% CI {ciPts(t.gain_ci)}
            </p>
          </div>
          <div>
            <p className="kicker">Paired test</p>
            <p className="display num mt-2 text-4xl normal-case text-ink">{pValue(t.mcnemar_p)}</p>
            <p className="mt-1 font-mono text-[0.66rem] text-muted">
              McNemar exact · b={t.b} c={t.c}
            </p>
          </div>
          <div>
            <p className="kicker">Verdict</p>
            <p className={cn("display mt-2 text-4xl", report.passed ? "text-pass" : "text-accent")}>{report.passed ? (report.path ?? "pass") : (report.power?.verdict ?? "fail")}</p>
            {report.power && (
              <p className="mt-1 font-mono text-[0.66rem] text-muted">
                n={report.power.n}: 80% power only for ≥{Math.round(report.power.mde_80 * 100)} pts · P(detect +10)={pct(report.power.power_at_10)}
              </p>
            )}
          </div>
        </div>
      )}

      {report.checks.length > 0 && (
        <ul className={cn("grid gap-2", compact ? "" : "sm:grid-cols-2")}>
          {report.checks.map((c) => {
            const pathCheck = c.name === "quality" || c.name === "efficiency";
            const neutral = pathCheck && !c.passed && report.path && report.path !== c.name;
            return (
              <li key={c.name} className={cn("flex items-start gap-3 rounded-xl border px-3.5 py-2.5", c.passed ? "border-pass/25 bg-pass-soft" : neutral ? "border-line" : "border-accent/35 bg-accent-soft")}>
                {c.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-pass" aria-label="passed" /> : <XCircle className={cn("mt-0.5 size-4 shrink-0", neutral ? "text-muted" : "text-accent")} aria-label="not met" />}
                <div className="min-w-0">
                  <p className="text-[0.82rem] text-ink">
                    {NAMES[c.name] ?? c.name}
                    {pathCheck && report.path === c.name && <span className="ml-2 font-mono text-[0.6rem] uppercase text-pass">path used</span>}
                  </p>
                  <p className="font-mono text-[0.66rem] leading-snug text-muted">{c.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {(report.redteam || report.cost || report.pass_k) && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
          {report.redteam && <Cell k="Red-team ASR" v={`${pct(report.redteam.baseline_asr, 1)} → ${pct(report.redteam.candidate_asr, 1)}`} />}
          {report.redteam && <Cell k="High-severity wins" v={`${report.redteam.baseline_high} → ${report.redteam.candidate_high}`} />}
          {report.cost && <Cell k="Cost / case" v={`${usd(report.cost.candidate_mean)} (${report.cost.change >= 0 ? "+" : "−"}${Math.abs(report.cost.change * 100).toFixed(0)}%)`} />}
          {report.pass_k && <Cell k={`pass^${report.pass_k.k}`} v={`${pct(report.pass_k.baseline)} → ${pct(report.pass_k.candidate)}`} />}
        </div>
      )}
      {(report.test_attempts ?? 0) >= 3 && (
        <p className="rounded-xl border border-warn/30 bg-warn-soft px-4 py-2.5 text-[0.8rem] text-warn">
          {report.test_attempts} gate attempts in a row on the same test split — it is getting “used up”; add fresh test cases (§7.6).
        </p>
      )}
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-surface px-3.5 py-2.5">
      <p className="kicker !text-[0.56rem]">{k}</p>
      <p className="mt-1 font-mono text-[0.78rem] text-ink num">{v}</p>
    </div>
  );
}
