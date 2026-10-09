"use client";

import { Check, X } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Chip } from "@/components/ui/primitives";
import { cn, pct, usd } from "@/lib/format";
import type { Candidate, ConfigPoint, ProfileBody } from "@/lib/types";
import { ProfileDiff } from "./profile-diff";

const STATUS: Record<string, { label: string; tone: "accent" | "pass" | "warn" | "info" | undefined }> = {
  rejected_editor: { label: "editor rejected", tone: "accent" },
  rejected_minibatch: { label: "minibatch rejected", tone: undefined },
  evaluated: { label: "evaluated on val", tone: "info" },
  gated: { label: "sent to gate", tone: "warn" },
  promoted: { label: "promoted", tone: "pass" },
};

interface Node {
  c: Candidate;
  depth: number;
  row: number;
}

/** Candidate tree (§2.3 wireframe) — x = generation, y = discovery order within the subtree. */
function layout(cands: Candidate[]): { nodes: Node[]; rows: number; depth: number } {
  const children = new Map<string | null, Candidate[]>();
  for (const c of cands) {
    const k = c.parent_candidate_id ?? null;
    children.set(k, [...(children.get(k) ?? []), c]);
  }
  const nodes: Node[] = [];
  let row = 0;
  let maxDepth = 0;
  const walk = (c: Candidate, depth: number) => {
    maxDepth = Math.max(maxDepth, depth);
    const kids = children.get(c.id) ?? [];
    nodes.push({ c, depth, row });
    if (!kids.length) row++;
    for (const k of kids) walk(k, depth + 1);
  };
  for (const root of children.get(null) ?? []) walk(root, 0);
  // Parents sit at the vertical middle of their children.
  const byId = new Map(nodes.map((n) => [n.c.id, n]));
  for (const n of [...nodes].sort((a, b) => b.depth - a.depth)) {
    const kids = (children.get(n.c.id) ?? []).map((k) => byId.get(k.id)!).filter(Boolean);
    if (kids.length) n.row = (Math.min(...kids.map((k) => k.row)) + Math.max(...kids.map((k) => k.row))) / 2;
  }
  return { nodes, rows: Math.max(1, row), depth: maxDepth };
}

export function ExperimentExplorer({ candidates, seedBody, configPoints, bestId }: { candidates: Candidate[]; seedBody: ProfileBody | null; configPoints: ConfigPoint[]; bestId: string | null }) {
  const [sel, setSel] = useState<string | null>(bestId ?? candidates.find((c) => c.on_front)?.id ?? candidates[0]?.id ?? null);
  const { nodes, rows, depth } = useMemo(() => layout(candidates), [candidates]);
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const selected = sel ? byId.get(sel) : null;
  const parent = selected?.parent_candidate_id ? byId.get(selected.parent_candidate_id) : null;
  const seed = candidates.find((c) => c.label === "seed" || !c.parent_candidate_id);

  const W = Math.max(520, (depth + 1) * 150 + 60);
  const H = Math.max(220, rows * 46 + 40);
  const px = (d: number) => 40 + d * 150;
  const py = (r: number) => 30 + r * 46;
  const delta = (c: Candidate) => (c.minibatch_score != null && c.parent_minibatch_score != null ? c.minibatch_score - c.parent_minibatch_score : null);

  // Pareto chart geometry
  const evaluated = candidates.filter((c) => c.val_mean != null && c.cost_mean != null);
  const pts = [...evaluated.map((c) => ({ id: c.id, label: c.label ?? "", x: c.cost_mean!, y: c.val_mean!, front: c.on_front, kind: "cand" as const })), ...configPoints.map((p) => ({ id: `cfg-${p.label}`, label: p.label, x: p.cost_mean, y: p.val_mean, front: !!p.on_front, kind: "cfg" as const }))];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs, 0) * 0.9, Math.max(...xs, 0.0001) * 1.1];
  const [y0, y1] = [Math.max(0, Math.min(...ys, 1) - 0.06), Math.min(1, Math.max(...ys, 0) + 0.06)];
  const PW = 520;
  const PH = 300;
  const sx = (v: number) => 46 + ((v - x0) / (x1 - x0 || 1)) * (PW - 66);
  const sy = (v: number) => PH - 34 - ((v - y0) / (y1 - y0 || 1)) * (PH - 56);
  const front = pts.filter((p) => p.front && p.kind === "cand").sort((a, b) => a.x - b.x);

  return (
    <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
      <div className="card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="serif text-2xl text-ink">Candidate tree</h2>
          <span className="kicker">minibatch Δ vs parent · ring = Pareto front</span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, maxWidth: "100%", minWidth: 480 }} role="img" aria-label="Optimizer candidate tree">
            {nodes.map((n) => {
              const p = n.c.parent_candidate_id ? nodes.find((m) => m.c.id === n.c.parent_candidate_id) : null;
              if (!p) return null;
              const x1_ = px(p.depth) + 14;
              const y1_ = py(p.row);
              const x2_ = px(n.depth) - 14;
              const y2_ = py(n.row);
              const mid = (x1_ + x2_) / 2;
              const dead = n.c.status.startsWith("rejected");
              return (
                <motion.path
                  key={`e-${n.c.id}`}
                  d={`M${x1_},${y1_} C${mid},${y1_} ${mid},${y2_} ${x2_},${y2_}`}
                  fill="none"
                  stroke={dead ? "var(--line-strong)" : "var(--accent)"}
                  strokeOpacity={dead ? 1 : 0.55}
                  strokeWidth={1.4}
                  strokeDasharray={dead ? "3 4" : undefined}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.7, delay: n.depth * 0.12 }}
                />
              );
            })}
            {nodes.map((n) => {
              const d = delta(n.c);
              const active = sel === n.c.id;
              const promoted = n.c.status === "promoted" || n.c.status === "gated";
              const rejected = n.c.status.startsWith("rejected");
              return (
                <g key={n.c.id} transform={`translate(${px(n.depth)},${py(n.row)})`} className="cursor-pointer" onClick={() => setSel(n.c.id)} role="button" tabIndex={0} aria-label={`candidate ${n.c.label}`} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSel(n.c.id)}>
                  {n.c.on_front && <circle r="17" fill="none" stroke="var(--pass)" strokeWidth="1.2" strokeDasharray="2 3" />}
                  {active && <circle r="20" fill="var(--accent)" opacity="0.15" />}
                  <circle r="12" fill={promoted ? "var(--accent)" : rejected ? "var(--surface-3)" : "var(--surface-2)"} stroke={active ? "var(--accent)" : rejected ? "var(--line-strong)" : "var(--ink-2)"} strokeWidth={active ? 2 : 1} />
                  {n.c.status === "rejected_editor" ? (
                    <path d="M-4,-4 L4,4 M4,-4 L-4,4" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
                  ) : (
                    <text textAnchor="middle" dy="3.5" style={{ font: "500 8.5px var(--font-jetbrains)" }} fill={promoted ? "#fff" : "var(--ink)"}>
                      {(n.c.label ?? "?").replace("seed", "v")}
                    </text>
                  )}
                  <text x="18" dy="-2" style={{ font: "500 10px var(--font-jetbrains)" }} fill="var(--ink-2)">
                    {n.c.label === "seed" ? "seed" : n.c.label}
                  </text>
                  <text x="18" dy="10" style={{ font: "400 9px var(--font-jetbrains)" }} fill={d == null ? "var(--muted)" : d > 0 ? "var(--pass)" : "var(--accent)"}>
                    {d == null ? (n.c.val_mean != null ? `val ${Math.round(n.c.val_mean * 100)}%` : n.c.status === "rejected_editor" ? "editor ✗" : "") : `${d > 0 ? "+" : ""}${Math.round(d * 10)}/10`}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 font-mono text-[0.6rem] text-muted">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-accent" />gated / promoted</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border border-ink-2" />evaluated</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border border-dashed border-pass" />on Pareto front</span>
          <span className="flex items-center gap-1.5"><X className="size-3 text-accent" />rejected by editor</span>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="serif text-2xl text-ink">Pareto front</h2>
          <span className="kicker">val pass rate vs list-price cost / case</span>
        </div>
        {pts.length ? (
          <svg viewBox={`0 0 ${PW} ${PH}`} className="mt-4 w-full" role="img" aria-label="Pareto chart of validation pass rate against cost">
            <defs>
              <pattern id="pdots" width="14" height="14" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="var(--dot)" />
              </pattern>
            </defs>
            <rect x="46" y="22" width={PW - 66} height={PH - 56} fill="url(#pdots)" />
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
              const v = y0 + (y1 - y0) * t;
              return (
                <g key={t}>
                  <line x1="46" x2={PW - 20} y1={sy(v)} y2={sy(v)} stroke="var(--line)" />
                  <text x="40" y={sy(v) + 3} textAnchor="end" style={{ font: "400 9px var(--font-jetbrains)" }} fill="var(--muted)">
                    {Math.round(v * 100)}%
                  </text>
                </g>
              );
            })}
            {[0, 0.5, 1].map((t) => {
              const v = x0 + (x1 - x0) * t;
              return (
                <text key={t} x={sx(v)} y={PH - 14} textAnchor="middle" style={{ font: "400 9px var(--font-jetbrains)" }} fill="var(--muted)">
                  ${v.toFixed(4)}
                </text>
              );
            })}
            {front.length > 1 && (
              <motion.path
                d={front.map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join(" ")}
                fill="none"
                stroke="var(--pass)"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1 }}
              />
            )}
            {pts.map((p) => {
              const active = sel === p.id;
              return (
                <g key={p.id} transform={`translate(${sx(p.x)},${sy(p.y)})`} className={p.kind === "cand" ? "cursor-pointer" : undefined} onClick={() => p.kind === "cand" && setSel(p.id)}>
                  {p.kind === "cfg" ? (
                    <rect x="-4" y="-4" width="8" height="8" transform="rotate(45)" fill={p.front ? "var(--info)" : "var(--surface-3)"} stroke="var(--info)" />
                  ) : (
                    <circle r={active ? 7 : 5} fill={p.front ? "var(--accent)" : "var(--surface-3)"} stroke={active ? "var(--ink)" : "var(--accent)"} strokeWidth={active ? 2 : 1} />
                  )}
                  <text x="9" y="-6" style={{ font: "500 9px var(--font-jetbrains)" }} fill="var(--ink-2)">
                    {p.label}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : (
          <p className="mt-6 text-sm text-muted">No candidates evaluated on val yet.</p>
        )}
        <div className="mt-2 flex flex-wrap gap-4 font-mono text-[0.6rem] text-muted">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-accent" />prompt candidate on front</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rotate-45 bg-info" />config-search point (§9.3)</span>
        </div>
      </div>

      {selected && (
        <div className="card p-6 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="kicker">candidate {selected.label} · iteration {selected.iteration ?? 0} · component</p>
              <h3 className="mt-1 font-mono text-lg text-ink">{selected.component}</h3>
              {selected.rationale && <p className="serif mt-2 max-w-3xl text-lg italic leading-snug text-ink-2">“{selected.rationale}”</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={STATUS[selected.status]?.tone}>{STATUS[selected.status]?.label ?? selected.status}</Chip>
              {selected.on_front && <Chip tone="pass">Pareto front</Chip>}
              {selected.val_mean != null && <Chip>val {pct(selected.val_mean)}</Chip>}
              {selected.cost_mean != null && <Chip>{usd(selected.cost_mean)} / case</Chip>}
            </div>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.6fr]">
            <div>
              <p className="kicker mb-3">Editor checks · §9.4</p>
              <ul className="flex flex-col gap-1.5">
                {selected.editor_check.checks.map((ch) => (
                  <li key={ch.name} className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2", ch.passed ? "border-line" : "border-accent/40 bg-accent-soft")}>
                    {ch.passed ? <Check className="mt-0.5 size-3.5 shrink-0 text-pass" aria-label="passed" /> : <X className="mt-0.5 size-3.5 shrink-0 text-accent" aria-label="failed" />}
                    <div className="min-w-0">
                      <p className="font-mono text-[0.7rem] text-ink">{ch.name}</p>
                      <p className="text-[0.74rem] text-muted">{ch.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {selected.minibatch_score != null && (
                <p className="mt-4 font-mono text-[0.68rem] text-muted">
                  minibatch {Math.round((selected.parent_minibatch_score ?? 0) * 10)}/10 → {Math.round(selected.minibatch_score * 10)}/10 on the same 10 train cases
                </p>
              )}
            </div>
            <div>
              <p className="kicker mb-3">Diff vs {parent ? `parent ${parent.label}` : "seed profile"}</p>
              <ProfileDiff before={parent?.body ?? seed?.body ?? seedBody} after={selected.body} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
