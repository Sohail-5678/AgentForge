"use client";

import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PassChip, SplitChip } from "@/components/ui/primitives";
import { cn, ms, usd } from "@/lib/format";
import { LAYERS } from "@/lib/meta";
import type { CaseBody, Result } from "@/lib/types";
import { CaseDrawer } from "./case-drawer";

export interface CaseInfo {
  body: CaseBody | null;
  split: string;
}

type View = "all" | "failed" | "errors";

export function failedChecks(r: Result) {
  return r.graders.filter((g) => g.passed === false && g.gating !== false).map((g) => g.grader);
}

function failedDetail(r: Result) {
  const g = r.graders.find((x) => x.passed === false && x.gating !== false);
  if (!g) return null;
  const d = g.details ?? {};
  const msg = (d.reason ?? d.message ?? d.failed ?? d.missing ?? d.mismatch) as unknown;
  if (typeof msg === "string") return msg;
  if (Array.isArray(msg)) return msg.join(", ");
  if (msg && typeof msg === "object") return Object.keys(msg as object).join(", ");
  return null;
}

export function ResultsExplorer({
  results,
  cases,
  redteam,
  runLabel,
}: {
  results: Result[];
  cases: Record<string, CaseInfo>;
  redteam: boolean;
  runLabel: string;
}) {
  const [view, setViewRaw] = useState<View>("all");
  const [tag, setTagRaw] = useState("");
  const [grader, setGraderRaw] = useState("");
  const [query, setQueryRaw] = useState("");
  const [open, setOpen] = useState<Result | null>(null);
  const [cursor, setCursor] = useState(0);
  // Changing a filter resets the keyboard cursor to the first row.
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setCursor(0);
  };
  const setView = reset(setViewRaw);
  const setTag = reset(setTagRaw);
  const setGrader = reset(setGraderRaw);
  const setQuery = reset(setQueryRaw);

  const tags = useMemo(() => {
    const s = new Set<string>();
    for (const c of Object.values(cases)) for (const t of c.body?.tags ?? []) s.add(t);
    return [...s].sort();
  }, [cases]);
  const graders = useMemo(() => {
    const s = new Set<string>();
    for (const r of results) for (const g of r.graders) s.add(g.grader);
    return [...s].sort();
  }, [results]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return results
      .filter((r) => {
        if (view === "failed" && r.passed !== false) return false;
        if (view === "errors" && !["error", "budget_exceeded"].includes(r.status)) return false;
        if (tag && !(cases[r.case_id]?.body?.tags ?? []).includes(tag)) return false;
        if (grader && !failedChecks(r).includes(grader)) return false;
        if (q && !r.case_id.toLowerCase().includes(q) && !(cases[r.case_id]?.body?.title ?? "").toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => Number(a.passed ?? 2) - Number(b.passed ?? 2) || a.case_id.localeCompare(b.case_id) || a.attempt - b.attempt);
  }, [results, view, tag, grader, query, cases]);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(rows.length - 1, c + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter" && rows[cursor]) {
        setOpen(rows[cursor]);
      }
    },
    [rows, cursor],
  );

  useEffect(() => {
    document.getElementById(`row-${cursor}`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const counts = {
    all: results.length,
    failed: results.filter((r) => r.passed === false).length,
    errors: results.filter((r) => ["error", "budget_exceeded"].includes(r.status)).length,
  };
  const multiAttempt = results.some((r) => r.attempt > 1);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <div className="flex rounded-full border border-line-strong p-0.5" role="tablist" aria-label="Result filter">
          {(["all", "failed", "errors"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn("rounded-full px-3 py-1 font-mono text-[0.64rem] uppercase tracking-wider transition", view === v ? "bg-accent text-white" : "text-muted hover:text-ink")}
            >
              {v} <span className="opacity-70">{counts[v]}</span>
            </button>
          ))}
        </div>
        <Select label="Tag" value={tag} onChange={setTag} options={tags} />
        <Select label="Failed grader" value={grader} onChange={setGrader} options={graders} />
        <label className="ml-auto flex items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 focus-within:border-accent">
          <Search className="size-3.5 text-muted" aria-hidden />
          <span className="sr-only">Search cases</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="case id or title" className="w-44 bg-transparent font-mono text-[0.72rem] text-ink outline-none placeholder:text-muted" />
        </label>
      </div>
      <div className="max-h-[640px] overflow-auto" tabIndex={0} onKeyDown={onKey} aria-label="Case results — arrow keys to move, Enter to open">
        <table className="table-af min-w-[920px]">
          <thead>
            <tr>
              <th>Case</th>
              {multiAttempt && <th>Try</th>}
              <th>Split</th>
              <th>Status</th>
              <th>{redteam ? "Blocked by" : "Failed checks"}</th>
              <th>Calls</th>
              <th>Cost</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const info = cases[r.case_id];
              const fails = failedChecks(r);
              const layer = LAYERS.find((l) => l.id === r.block_layer);
              return (
                <tr key={`${r.case_id}-${r.attempt}`} id={`row-${i}`} data-active={i === cursor} onClick={() => { setCursor(i); setOpen(r); }} className="cursor-pointer">
                  <td className="max-w-[340px]">
                    <span className="block truncate font-mono text-[0.74rem] text-ink">{r.case_id}</span>
                    {info?.body?.title && <span className="block truncate text-[0.72rem] text-muted">{info.body.title}</span>}
                  </td>
                  {multiAttempt && <td className="font-mono text-[0.7rem] text-muted">{r.attempt}</td>}
                  <td>{info ? <SplitChip split={info.split} /> : "—"}</td>
                  <td>
                    <PassChip passed={r.passed} status={r.status} />
                  </td>
                  <td className="max-w-[300px]">
                    {redteam ? (
                      r.passed === false ? (
                        <span className="font-mono text-[0.7rem] text-accent-ink">attack succeeded</span>
                      ) : layer ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[0.7rem] text-ink-2">
                          <span className="size-2 rounded-sm" style={{ background: layer.color }} />
                          {layer.label}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )
                    ) : fails.length ? (
                      <span className="block truncate font-mono text-[0.7rem] text-accent-ink" title={failedDetail(r) ?? undefined}>
                        {fails.join(", ")}
                        {failedDetail(r) && <span className="text-muted"> · {failedDetail(r)}</span>}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="font-mono text-[0.7rem] text-ink-2 num">{r.llm_calls ?? "—"}</td>
                  <td className="font-mono text-[0.7rem] text-ink-2 num">{usd(r.cost_usd, 5)}</td>
                  <td className="font-mono text-[0.7rem] text-ink-2 num">{ms(r.latency_ms)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-muted">
                  No results match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <CaseDrawer result={open} info={open ? cases[open.case_id] : undefined} onClose={() => setOpen(null)} runLabel={runLabel} />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  if (!options.length) return null;
  return (
    <label className="flex items-center gap-2">
      <span className="kicker !text-[0.58rem]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-full border border-line-strong bg-surface px-3 py-1 font-mono text-[0.68rem] text-ink-2 outline-none focus:border-accent"
      >
        <option value="">all</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
