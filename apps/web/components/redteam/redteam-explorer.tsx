"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { CaseDrawer } from "@/components/run/case-drawer";
import type { CaseInfo } from "@/components/run/results-explorer";
import { Chip, SeverityChip } from "@/components/ui/primitives";
import { cn, pct } from "@/lib/format";
import { AGENT_META, CATEGORIES, LAYERS } from "@/lib/meta";
import type { Result } from "@/lib/types";

interface Cell {
  n: number;
  succeeded: number;
  asr: number;
  ci: [number, number];
}

export interface RedteamRow {
  run_id: string;
  case_id: string;
  agent: string;
  category: string;
  severity: string;
  family: string | null;
  owasp: string | null;
  title: string | null;
  succeeded: boolean;
  block_layer: string | null;
}

/** Heatmap (category × agent) → filtered attack list → drawer with the trace and the blocking span (§1.5 step 3). */
export function RedteamExplorer({
  agents,
  heat,
  layers,
  rows,
  results,
  cases,
}: {
  agents: string[];
  heat: Record<string, Record<string, Cell>>;
  layers: Record<string, Record<string, number>>;
  rows: RedteamRow[];
  results: Result[];
  cases: Record<string, CaseInfo>;
}) {
  const [sel, setSel] = useState<{ cat: string; agent: string | null } | null>(null);
  const [open, setOpen] = useState<Result | null>(null);
  const [onlySucceeded, setOnlySucceeded] = useState(false);
  const cats = CATEGORIES.filter((c) => heat[c.id]);
  const resultByKey = useMemo(() => new Map(results.map((r) => [`${r.run_id}|${r.case_id}`, r])), [results]);
  const list = rows
    .filter((r) => (!sel || (r.category === sel.cat && (!sel.agent || r.agent === sel.agent))) && (!onlySucceeded || r.succeeded))
    .sort((a, b) => Number(b.succeeded) - Number(a.succeeded) || a.category.localeCompare(b.category));

  return (
    <div className="grid gap-5 2xl:grid-cols-[1.15fr_1fr]">
      {/* heatmap */}
      <div className="card overflow-hidden p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="serif text-2xl text-ink">Attack success heatmap</h2>
          <span className="kicker">click a cell</span>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[520px] border-separate border-spacing-1.5">
            <thead>
              <tr>
                <th className="kicker !text-[0.58rem] text-left font-normal">Category · OWASP</th>
                {agents.map((a) => (
                  <th key={a} className="kicker !text-[0.58rem] font-normal">{AGENT_META[a]?.name ?? a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cats.map((c, i) => (
                <tr key={c.id}>
                  <td className="pr-2">
                    <button type="button" onClick={() => setSel(sel?.cat === c.id && !sel.agent ? null : { cat: c.id, agent: null })} className="text-left">
                      <span className={cn("block text-[0.82rem] transition", sel?.cat === c.id ? "text-accent" : "text-ink hover:text-accent")}>{c.label}</span>
                      <span className="font-mono text-[0.58rem] text-muted">{c.owasp}</span>
                    </button>
                  </td>
                  {agents.map((a) => {
                    const cell = heat[c.id]?.[a];
                    const active = sel?.cat === c.id && sel.agent === a;
                    if (!cell || cell.n === 0)
                      return (
                        <td key={a}>
                          <div className="grid h-14 place-items-center rounded-xl border border-dashed border-line font-mono text-[0.6rem] text-muted/60">n/a</div>
                        </td>
                      );
                    const heatAlpha = cell.asr === 0 ? 0 : 0.18 + Math.min(1, cell.asr * 3) * 0.72;
                    return (
                      <td key={a}>
                        <motion.button
                          type="button"
                          initial={{ opacity: 0, scale: 0.92 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: i * 0.03, duration: 0.4 }}
                          onClick={() => setSel(active ? null : { cat: c.id, agent: a })}
                          aria-pressed={active}
                          aria-label={`${c.label} on ${AGENT_META[a]?.name ?? a}: ${cell.succeeded} of ${cell.n} attacks succeeded`}
                          className={cn(
                            "relative flex h-14 w-full flex-col items-center justify-center rounded-xl border transition duration-300 hover:-translate-y-0.5",
                            active ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-line-strong",
                          )}
                          style={{ background: cell.asr === 0 ? "var(--surface-2)" : `rgb(243 46 53 / ${heatAlpha})` }}
                        >
                          <span className={cn("display num text-xl leading-none", cell.asr > 0.25 ? "text-white" : cell.asr > 0 ? "text-ink" : "text-pass")}>
                            {cell.asr === 0 ? "0%" : pct(cell.asr)}
                          </span>
                          <span className={cn("mt-0.5 font-mono text-[0.56rem]", cell.asr > 0.25 ? "text-white/80" : "text-muted")}>
                            {cell.succeeded}/{cell.n}
                          </span>
                          {cell.asr === 0 && <ShieldCheck className="absolute right-1.5 top-1.5 size-3 text-pass/70" aria-hidden />}
                        </motion.button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center gap-3 font-mono text-[0.6rem] text-muted">
          <span>0%</span>
          <span className="h-2 w-40 rounded-full bg-[linear-gradient(90deg,var(--surface-2),rgb(243_46_53/0.35),rgb(243_46_53/0.9))]" />
          <span>≥33% attack success</span>
        </div>

        {/* attribution */}
        <div className="mt-8 border-t border-line pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="serif text-xl text-ink">Which layer stopped it</h3>
            <span className="kicker">first blocked span · §8.6</span>
          </div>
          <div className="mt-4 flex flex-col gap-2.5">
            {cats.map((c) => {
              const l = layers[c.id] ?? {};
              const total = Object.values(l).reduce((a, b) => a + b, 0) || 1;
              return (
                <div key={c.id} className="grid grid-cols-[130px_1fr_36px] items-center gap-3">
                  <span className="truncate text-[0.74rem] text-ink-2">{c.label}</span>
                  <div className="flex h-3 overflow-hidden rounded-full bg-surface-3">
                    {LAYERS.map((layer) =>
                      l[layer.id] ? (
                        <motion.div
                          key={layer.id}
                          initial={{ width: 0 }}
                          animate={{ width: `${(l[layer.id] / total) * 100}%` }}
                          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                          title={`${layer.label}: ${l[layer.id]}`}
                          style={{ background: layer.color }}
                        />
                      ) : null,
                    )}
                    {l.succeeded ? (
                      <div
                        title={`succeeded: ${l.succeeded}`}
                        className="bg-[repeating-linear-gradient(45deg,var(--accent),var(--accent)_3px,transparent_3px,transparent_6px)]"
                        style={{ width: `${(l.succeeded / total) * 100}%` }}
                      />
                    ) : null}
                  </div>
                  <span className="text-right font-mono text-[0.62rem] text-muted">{total}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
            {LAYERS.map((l) => (
              <span key={l.id} className="flex items-center gap-1.5 font-mono text-[0.6rem] text-muted">
                <span className="size-2 rounded-sm" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5 font-mono text-[0.6rem] text-muted">
              <span className="size-2 rounded-sm bg-[repeating-linear-gradient(45deg,var(--accent),var(--accent)_2px,transparent_2px,transparent_4px)]" />
              succeeded
            </span>
          </div>
          <p className="serif mt-5 text-[1.05rem] italic text-ink-2">
            If one layer stops most attacks, removing it is the riskiest change you can make — that is what defence in depth means.
          </p>
        </div>
      </div>

      {/* attack list */}
      <div className="card flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
          <div>
            <h2 className="serif text-2xl text-ink">Attacks</h2>
            <p className="kicker mt-1">
              {sel ? `${CATEGORIES.find((c) => c.id === sel.cat)?.label}${sel.agent ? ` · ${AGENT_META[sel.agent]?.name}` : ""}` : "latest red-team run per agent"} · {list.length}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {sel && (
              <button type="button" onClick={() => setSel(null)} className="rounded-full border border-line-strong px-3 py-1 font-mono text-[0.62rem] uppercase text-muted hover:text-ink">
                clear
              </button>
            )}
            <label className="flex cursor-pointer items-center gap-2 font-mono text-[0.62rem] uppercase text-muted">
              <input type="checkbox" checked={onlySucceeded} onChange={(e) => setOnlySucceeded(e.target.checked)} className="accent-[var(--accent)]" />
              succeeded only
            </label>
          </div>
        </div>
        <ul className="max-h-[820px] flex-1 overflow-y-auto">
          {list.map((r) => {
            const layer = LAYERS.find((l) => l.id === r.block_layer);
            const res = resultByKey.get(`${r.run_id}|${r.case_id}`);
            return (
              <li key={`${r.run_id}-${r.case_id}`} className="border-b border-line last:border-0">
                <button type="button" onClick={() => res && setOpen(res)} className="group flex w-full items-start gap-3 px-6 py-3.5 text-left transition hover:bg-surface-2">
                  <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", r.succeeded ? "bg-accent-solid text-white" : "bg-surface-3 text-pass")}>
                    {r.succeeded ? <ShieldAlert className="size-3.5" aria-label="attack succeeded" /> : <ShieldCheck className="size-3.5" aria-label="attack stopped" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[0.72rem] text-ink">{r.case_id}</span>
                    <span className="block truncate text-[0.76rem] text-muted">{r.title ?? r.family ?? ""}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Chip>{AGENT_META[r.agent]?.short ?? r.agent}</Chip>
                      <SeverityChip severity={r.severity} />
                      {r.succeeded ? (
                        <Chip tone="accent">succeeded</Chip>
                      ) : layer ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[0.6rem] text-ink-2">
                          <span className="size-2 rounded-sm" style={{ background: layer.color }} />
                          {layer.label}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {list.length === 0 && <li className="px-6 py-10 text-center text-sm text-muted">No attacks match.</li>}
        </ul>
      </div>
      <CaseDrawer result={open} info={open ? cases[open.case_id] : undefined} onClose={() => setOpen(null)} runLabel="Red team" />
    </div>
  );
}
