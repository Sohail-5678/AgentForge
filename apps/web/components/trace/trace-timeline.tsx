"use client";

import { Ban, Bot, Brain, Hand, Search, Shield, Terminal, Wrench } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { JsonView } from "@/components/ui/interactive";
import { cn, ms } from "@/lib/format";
import type { Span, Trace } from "@/lib/types";

const KIND: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
  node: { icon: Bot, color: "var(--ink-2)", label: "node" },
  llm: { icon: Brain, color: "var(--info)", label: "llm" },
  tool: { icon: Wrench, color: "var(--pass)", label: "tool" },
  guard: { icon: Shield, color: "var(--warn)", label: "guard" },
  retrieval: { icon: Search, color: "var(--violet)", label: "retrieval" },
  human: { icon: Hand, color: "#ff9f7a", label: "human" },
  sandbox: { icon: Terminal, color: "var(--violet)", label: "sandbox" },
};

interface Placed {
  span: Span;
  start: number;
  dur: number;
  depth: number;
}

/** Lay spans out on a time axis: real start offsets when present, otherwise sequential by duration. */
function place(trace: Trace): { rows: Placed[]; total: number } {
  const t0 = new Date(trace.started_at).getTime();
  const depthOf = new Map<string, number>();
  let cursor = 0;
  const rows: Placed[] = trace.spans.map((span) => {
    const depth = span.parent_id ? (depthOf.get(span.parent_id) ?? 0) + 1 : 0;
    depthOf.set(span.span_id, depth);
    const dur = Math.max(1, span.duration_ms ?? 1);
    let start = span.started_at ? new Date(span.started_at).getTime() - t0 : cursor;
    if (!Number.isFinite(start) || start < 0) start = cursor;
    cursor = Math.max(cursor, start + (depth === 0 ? dur : 0));
    return { span, start, dur, depth };
  });
  const total = Math.max(trace.metrics?.latency_ms ?? 0, ...rows.map((r) => r.start + r.dur), 1);
  return { rows, total };
}

export function TraceTimeline({ trace }: { trace: Trace }) {
  const { rows, total } = useMemo(() => place(trace), [trace]);
  const [sel, setSel] = useState<string | null>(rows.find((r) => r.span.status === "blocked")?.span.span_id ?? null);
  const selected = rows.find((r) => r.span.span_id === sel)?.span;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 font-mono text-[0.6rem] uppercase tracking-wider text-muted">
        {Object.entries(KIND)
          .filter(([k]) => rows.some((r) => r.span.kind === k))
          .map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: v.color }} />
              {v.label}
            </span>
          ))}
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-accent" />
          blocked
        </span>
        <span className="ml-auto normal-case tracking-normal">{ms(total)} total · {rows.length} spans</span>
      </div>
      <div className="relative overflow-hidden rounded-xl border border-line bg-bg-2">
        <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-r border-dashed border-line last:border-0" />
          ))}
        </div>
        <ul className="relative flex flex-col py-1.5" role="list" aria-label="Trace spans">
          {rows.map((r, i) => {
            const k = KIND[r.span.kind] ?? KIND.node;
            const blocked = r.span.status === "blocked";
            const err = r.span.status === "error";
            const color = blocked ? "var(--accent)" : err ? "var(--warn)" : k.color;
            const active = sel === r.span.span_id;
            return (
              <li key={r.span.span_id}>
                <button
                  type="button"
                  onClick={() => setSel(active ? null : r.span.span_id)}
                  className={cn("group grid w-full grid-cols-[minmax(140px,34%)_1fr] items-center gap-3 px-3 py-1 text-left transition", active ? "bg-surface-3" : "hover:bg-surface-2")}
                  aria-pressed={active}
                >
                  <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: r.depth * 12 }}>
                    {blocked ? <Ban className="size-3 shrink-0 text-accent" aria-hidden /> : <k.icon className="size-3 shrink-0" aria-hidden />}
                    <span className={cn("truncate font-mono text-[0.7rem]", blocked ? "text-accent-ink" : "text-ink-2")}>{r.span.name}</span>
                    {blocked && <span className="sr-only">(blocked)</span>}
                  </span>
                  <span className="relative h-5">
                    <motion.span
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ delay: i * 0.025, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute top-1/2 h-2.5 origin-left -translate-y-1/2 rounded-full"
                      style={{
                        left: `${(r.start / total) * 100}%`,
                        width: `max(4px, ${(r.dur / total) * 100}%)`,
                        background: color,
                        boxShadow: blocked ? "0 0 12px var(--accent-glow)" : undefined,
                        opacity: active ? 1 : 0.85,
                      }}
                    />
                    <span
                      className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1.5 font-mono text-[0.58rem] text-muted"
                      style={{ left: `min(calc(${((r.start + r.dur) / total) * 100}%), 85%)` }}
                    >
                      {ms(r.span.duration_ms)}
                      {r.span.model ? ` · ${r.span.model}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {selected && (
        <div className="mt-4 grid gap-3 rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[0.66rem] text-muted">
            <span className="text-ink">{selected.name}</span>
            <span>kind {selected.kind}</span>
            <span>status {selected.status ?? "ok"}</span>
            {selected.provider && <span>{selected.provider}</span>}
            {selected.tokens_in != null && <span>{selected.tokens_in} in / {selected.tokens_out ?? 0} out tokens</span>}
          </div>
          {selected.error != null && <JsonView label="error" value={selected.error} defaultOpen />}
          <JsonView label="input (redacted)" value={selected.input_redacted ?? null} />
          <JsonView label="output (redacted)" value={selected.output_redacted ?? null} />
          {selected.attributes && <JsonView label="attributes" value={selected.attributes} />}
        </div>
      )}
    </div>
  );
}

