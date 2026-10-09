"use client";

import { MessageSquareWarning, ShieldAlert, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Drawer, JsonView } from "@/components/ui/interactive";
import { TraceStatusChip } from "@/components/ui/primitives";
import { ago, ms, usd } from "@/lib/format";
import { AGENT_META } from "@/lib/meta";
import type { Trace } from "@/lib/types";
import { TraceTimeline } from "./trace-timeline";

export type TraceLite = Omit<Trace, "spans"> & { span_count: number };

function preview(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (typeof i.question === "string") return i.question;
  if (Array.isArray(i.turns)) {
    const t = i.turns[0] as unknown;
    return typeof t === "string" ? t : String((t as Record<string, unknown>)?.user ?? "");
  }
  if (typeof i.text === "string") return i.text;
  return JSON.stringify(input ?? "").slice(0, 120);
}

export function TraceList({ items }: { items: TraceLite[] }) {
  const [open, setOpen] = useState<TraceLite | null>(null);
  const [loaded, setLoaded] = useState<{ id: string; trace: Trace | null } | null>(null);
  const openId = open?.id ?? null;
  useEffect(() => {
    if (!openId) return;
    const ctrl = new AbortController();
    fetch(`/api/v1/traces/${openId}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((t: Trace | null) => setLoaded({ id: openId, trace: t }))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [openId]);
  const full = loaded && loaded.id === openId ? loaded.trace : null;

  return (
    <>
      <ul className="divide-y divide-line">
        {items.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setOpen(t)} className="group grid w-full grid-cols-1 gap-2 px-5 py-3.5 text-left transition hover:bg-surface-2 md:grid-cols-[110px_1fr_auto] md:items-center md:gap-5">
              <TraceStatusChip status={t.status} />
              <span className="min-w-0">
                <span className="block truncate text-[0.86rem] text-ink">{preview(t.input)}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 font-mono text-[0.62rem] text-muted">
                  <span>{AGENT_META[t.agent_id]?.name ?? t.agent_id}</span>
                  <span>{t.profile_version ?? "—"}</span>
                  <span>{t.span_count} spans</span>
                  <span>{t.metrics.llm_calls ?? 0} llm calls</span>
                  {t.guard_hit && (
                    <span className="inline-flex items-center gap-1 text-accent-ink">
                      <ShieldAlert className="size-3" aria-hidden /> guard hit
                    </span>
                  )}
                  {t.feedback?.thumbs === -1 && (
                    <span className="inline-flex items-center gap-1 text-accent-ink">
                      <ThumbsDown className="size-3" aria-hidden /> thumbs-down
                    </span>
                  )}
                  {t.feedback?.thumbs === 1 && (
                    <span className="inline-flex items-center gap-1 text-pass">
                      <ThumbsUp className="size-3" aria-hidden /> thumbs-up
                    </span>
                  )}
                  {t.feedback?.comment && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquareWarning className="size-3" aria-hidden /> “{t.feedback.comment.slice(0, 40)}”
                    </span>
                  )}
                </span>
              </span>
              <span className="flex items-center gap-4 font-mono text-[0.66rem] text-muted num md:justify-end">
                <span>{ms(t.metrics.latency_ms)}</span>
                <span>{usd(t.metrics.list_price_cost_usd, 5)}</span>
                <span className="w-24 text-right">{ago(t.started_at)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Drawer open={!!open} onOpenChange={(o) => !o && setOpen(null)} kicker={open ? `${AGENT_META[open.agent_id]?.name ?? open.agent_id} · ${open.mode} trace` : ""} title={open ? preview(open.input).slice(0, 80) : ""}>
        {open && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3 font-mono text-[0.66rem] text-muted">
              <TraceStatusChip status={open.status} />
              <span>{open.id}</span>
              <span>{open.profile_version}</span>
              <span>{ms(open.metrics.latency_ms)}</span>
              <span>{usd(open.metrics.list_price_cost_usd, 5)} list price</span>
            </div>
            {full ? <TraceTimeline trace={full} /> : <div className="skeleton h-56" />}
            <JsonView label="input (redacted)" value={open.input} defaultOpen />
            <JsonView label="final_output" value={open.final_output} />
            <JsonView label="end_state" value={open.end_state} />
            {full && <JsonView label="full trace.v1" value={full} />}
          </div>
        )}
      </Drawer>
    </>
  );
}
