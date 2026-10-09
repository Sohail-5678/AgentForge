"use client";

import { CheckCircle2, CircleDashed, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { TraceTimeline } from "@/components/trace/trace-timeline";
import { Drawer, JsonView } from "@/components/ui/interactive";
import { Chip, PassChip, SeverityChip, SplitChip } from "@/components/ui/primitives";
import { cn, ms, usd } from "@/lib/format";
import { CATEGORIES, LAYERS } from "@/lib/meta";
import type { Result, Trace } from "@/lib/types";
import type { CaseInfo } from "./results-explorer";

export function CaseDrawer({ result, info, onClose, runLabel }: { result: Result | null; info?: CaseInfo; onClose: () => void; runLabel: string }) {
  // Fetched trace keyed by id; loading/missing are derived so the effect only syncs with the network.
  const [loaded, setLoaded] = useState<{ id: string; trace: Trace | null } | null>(null);
  const traceId = result?.trace_id ?? null;
  useEffect(() => {
    if (!traceId) return;
    const ctrl = new AbortController();
    fetch(`/api/v1/traces/${traceId}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((t: Trace | null) => setLoaded({ id: traceId, trace: t }))
      .catch(() => !ctrl.signal.aborted && setLoaded({ id: traceId, trace: null }));
    return () => ctrl.abort();
  }, [traceId]);
  const trace = loaded && loaded.id === traceId ? loaded.trace : null;
  const state: "idle" | "loading" | "missing" = !traceId ? "missing" : loaded?.id !== traceId ? "loading" : trace ? "idle" : "missing";

  const body = info?.body;
  const judge = result?.graders.find((g) => g.grader === "rubric_judge" || g.grader === "cheap_judge");
  const layer = LAYERS.find((l) => l.id === result?.block_layer);
  const category = CATEGORIES.find((c) => c.id === body?.category);

  return (
    <Drawer open={!!result} onOpenChange={(o) => !o && onClose()} kicker={`${runLabel} · case`} title={result?.case_id ?? ""}>
      {result && (
        <div className="flex flex-col gap-7">
          <div className="flex flex-wrap items-center gap-2">
            <PassChip passed={result.passed} status={result.status} />
            {info && <SplitChip split={info.split} />}
            {body?.severity && <SeverityChip severity={body.severity} />}
            {category && <Chip tone="violet">{category.owasp} · {category.label}</Chip>}
            {(body?.tags ?? []).map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
            <span className="ml-auto font-mono text-[0.66rem] text-muted">
              try {result.attempt} · {result.llm_calls ?? "?"} calls · {usd(result.cost_usd, 5)} · {ms(result.latency_ms)}
            </span>
          </div>
          {body?.title && <p className="serif -mt-3 text-xl italic text-ink-2">{body.title}</p>}

          {body?.suite === "redteam" && (
            <section className={cn("rounded-2xl border p-4", result.passed === false ? "border-accent/40 bg-accent-soft" : "border-pass/30 bg-pass-soft")}>
              <p className="kicker">{result.passed === false ? "Attack succeeded" : "Attack stopped"}</p>
              <p className="mt-1 text-sm text-ink">
                {result.passed === false
                  ? "The success predicate matched — this is a real finding for the review queue."
                  : layer
                    ? `First blocking layer: ${layer.label}${layer.id === "ineffective" ? " (no block, the attack simply did not work)" : ""}.`
                    : "No attribution recorded."}
              </p>
              {body.family && <p className="mt-1 font-mono text-[0.64rem] text-muted">family {body.family}</p>}
            </section>
          )}

          <Section title="Input">
            <InputView input={body?.input} />
            {body?.setup && Object.keys(body.setup).length > 0 && <JsonView label="setup (persona · seed overrides)" value={body.setup} />}
          </Section>

          <Section title="Graders">
            <div className="overflow-hidden rounded-xl border border-line">
              <table className="table-af">
                <thead>
                  <tr>
                    <th>Grader</th>
                    <th>Gating</th>
                    <th>Result</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {result.graders.map((g) => (
                    <tr key={g.grader}>
                      <td className="font-mono text-[0.72rem] text-ink">{g.grader}</td>
                      <td className="font-mono text-[0.66rem] text-muted">{g.gating === false ? "report" : "gate"}</td>
                      <td>
                        {g.passed == null ? (
                          <CircleDashed className="size-4 text-muted" aria-label="not applicable" />
                        ) : g.passed ? (
                          <CheckCircle2 className="size-4 text-pass" aria-label="passed" />
                        ) : (
                          <XCircle className="size-4 text-accent" aria-label="failed" />
                        )}
                      </td>
                      <td className="max-w-[360px]">
                        <DetailSummary details={g.details} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {judge && Boolean(judge.details?.reasons || judge.details?.items) && (
            <Section title="Judge reasoning">
              <JudgeItems details={judge.details} />
            </Section>
          )}

          <Section title="Expected">
            <ExpectView expect={body?.expect} />
          </Section>

          <Section title="Trace timeline">
            {state === "loading" && <div className="skeleton h-48" />}
            {state === "missing" && <p className="text-sm text-muted">Trace not retained for this result (passing results of older runs keep only grader output — SPEC §10.5).</p>}
            {trace && <TraceTimeline trace={trace} />}
          </Section>

          {trace && (
            <Section title="Output & end state">
              <JsonView label="final_output" value={trace.final_output} defaultOpen />
              <JsonView label="end_state" value={trace.end_state} />
              <JsonView label="full trace.v1" value={trace} />
            </Section>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="kicker mb-3 flex items-center gap-2">
        <span className="h-px w-4 bg-accent" />
        {title}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function InputView({ input }: { input: unknown }) {
  const i = (input ?? {}) as Record<string, unknown>;
  const turns = Array.isArray(i.turns) ? (i.turns as unknown[]) : null;
  if (turns) {
    return (
      <ol className="flex flex-col gap-2">
        {turns.map((t, idx) => {
          const text = typeof t === "string" ? t : String((t as Record<string, unknown>)?.user ?? JSON.stringify(t));
          return (
            <li key={idx} className="flex gap-3">
              <span className="mt-1 font-mono text-[0.6rem] text-accent">U{idx + 1}</span>
              <p className="rounded-2xl rounded-tl-sm bg-surface-2 px-4 py-2.5 text-[0.88rem] text-ink">{text}</p>
            </li>
          );
        })}
      </ol>
    );
  }
  if (typeof i.question === "string") {
    return (
      <div className="rounded-2xl bg-surface-2 px-4 py-3">
        <p className="text-[0.92rem] text-ink">{i.question}</p>
        {typeof i.db_id === "string" && <p className="mt-1 font-mono text-[0.64rem] text-muted">database {i.db_id}</p>}
        {typeof i.evidence === "string" && i.evidence && <p className="mt-2 text-[0.78rem] text-muted">Evidence: {i.evidence}</p>}
      </div>
    );
  }
  return <JsonView label="input" value={input} defaultOpen />;
}

function ExpectView({ expect }: { expect?: Record<string, unknown> }) {
  if (!expect) return <p className="text-sm text-muted">—</p>;
  const order = (expect.tools_called_in_order as string[]) ?? [];
  const forbidden = (expect.tools_forbidden as string[]) ?? [];
  const mustNot = (expect.must_not as string[]) ?? [];
  const rubric = (expect.rubric as string[]) ?? [];
  return (
    <div className="grid gap-3 text-[0.82rem]">
      {order.length > 0 && (
        <Row k="Tools in order">
          <span className="flex flex-wrap items-center gap-1">
            {order.map((t, i) => (
              <span key={t + i} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted">→</span>}
                <code className="rounded bg-pass-soft px-1.5 py-0.5 font-mono text-[0.7rem] text-pass">{t}</code>
              </span>
            ))}
          </span>
        </Row>
      )}
      {forbidden.length > 0 && (
        <Row k="Forbidden tools">
          {forbidden.map((t) => (
            <code key={t} className="mr-1 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[0.7rem] text-accent-ink">{t}</code>
          ))}
        </Row>
      )}
      {mustNot.length > 0 && (
        <Row k="Must not">
          {mustNot.map((t) => (
            <span key={t} className="mr-1 inline-flex items-center gap-1 font-mono text-[0.7rem] text-ink-2">
              <ShieldCheck className="size-3 text-accent" aria-hidden />
              {t}
            </span>
          ))}
        </Row>
      )}
      {expect.end_state != null && Object.keys(expect.end_state as object).length > 0 && (
        <Row k="End state">
          <code className="font-mono text-[0.7rem] text-ink-2">{JSON.stringify(expect.end_state)}</code>
        </Row>
      )}
      {typeof expect.gold_sql === "string" && (
        <Row k="Gold SQL">
          <code className="block whitespace-pre-wrap rounded-lg bg-[var(--code-bg)] p-3 font-mono text-[0.68rem] text-[#e9e4dc]">{expect.gold_sql}</code>
        </Row>
      )}
      {rubric.length > 0 && (
        <Row k="Rubric">
          <ul className="list-disc pl-4 text-ink-2">
            {rubric.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Row>
      )}
      {typeof expect.max_steps === "number" && <Row k="Max steps">{String(expect.max_steps)}</Row>}
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-line pb-2 last:border-0">
      <span className="kicker !text-[0.58rem] pt-0.5">{k}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

type Check = { key?: string; name?: string; expected?: unknown; actual?: unknown; passed?: boolean; ok?: boolean };

function isCheckList(v: unknown): v is Check[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && ("key" in x || "name" in x));
}

function short(v: unknown) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

function DetailSummary({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details ?? {}).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0));
  if (!entries.length) return <span className="text-muted">—</span>;
  const checks = entries.find(([, v]) => isCheckList(v));
  if (checks) {
    const list = checks[1] as Check[];
    return (
      <ul className="flex flex-col gap-0.5">
        {list.slice(0, 6).map((c, i) => {
          const ok = c.passed ?? c.ok ?? (c.expected !== undefined ? JSON.stringify(c.expected) === JSON.stringify(c.actual) : true);
          return (
            <li key={i} className="flex items-center gap-1.5 truncate font-mono text-[0.64rem]" title={`${c.key ?? c.name}: expected ${JSON.stringify(c.expected)} · actual ${JSON.stringify(c.actual)}`}>
              <span className={ok ? "text-pass" : "text-accent"}>{ok ? "✓" : "✗"}</span>
              <span className="text-ink-2">{c.key ?? c.name}</span>
              {!ok && c.expected !== undefined && (
                <span className="truncate text-muted">
                  {short(c.expected)} → <span className="text-accent-ink">{short(c.actual)}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {entries.slice(0, 4).map(([k, v]) => (
        <span key={k} className="truncate font-mono text-[0.66rem] text-muted" title={typeof v === "string" ? v : JSON.stringify(v)}>
          <span className="text-ink-2">{k}</span> {typeof v === "string" ? v : JSON.stringify(v)}
        </span>
      ))}
    </div>
  );
}

function JudgeItems({ details }: { details: Record<string, unknown> }) {
  const items = (details.items ?? details.reasons) as unknown;
  if (!Array.isArray(items)) return <JsonView label="judge" value={details} defaultOpen />;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it, i) => {
        const o = (it ?? {}) as Record<string, unknown>;
        const ok = o.verdict === true || o.passed === true;
        return (
          <li key={i} className="flex gap-3 rounded-xl border border-line bg-surface-2 p-3">
            {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-pass" aria-label="pass" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-accent" aria-label="fail" />}
            <div>
              <p className="text-[0.82rem] text-ink">{String(o.item ?? o.rubric ?? `item ${i + 1}`)}</p>
              {o.reason != null ? <p className="serif mt-0.5 text-[0.95rem] italic text-muted">{String(o.reason)}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
