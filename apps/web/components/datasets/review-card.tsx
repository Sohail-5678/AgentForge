"use client";

import { Check, Loader2, Lock, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { blockedReason, useViewer } from "@/components/admin/viewer";
import { JsonView } from "@/components/ui/interactive";
import { Chip } from "@/components/ui/primitives";
import { ago, cn } from "@/lib/format";
import { AGENT_META } from "@/lib/meta";
import type { CaseReview } from "@/lib/types";

/** One drafted case (§5.3): the LLM proposed it from a failure cluster; only a human can add it to a suite. */
export function ReviewCard({ review }: { review: CaseReview }) {
  const viewer = useViewer();
  const router = useRouter();
  const blocked = blockedReason(viewer);
  const [editing, setEditing] = useState(false);
  const [expectText, setExpectText] = useState(JSON.stringify(review.draft.expect, null, 2));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<null | "accept" | "reject">(null);
  const d = review.draft;
  const turns = Array.isArray(d.input?.turns) ? (d.input.turns as unknown[]) : null;
  const firstInput = turns?.length ? (typeof turns[0] === "string" ? turns[0] : String((turns[0] as Record<string, unknown>)?.user ?? "")) : typeof d.input?.question === "string" ? d.input.question : "";
  const heading = d.title && !d.title.startsWith("Mined:") ? d.title : firstInput || d.case_id;

  async function decide(decision: "accept" | "reject") {
    if (blocked) {
      toast.error(blocked);
      return;
    }
    let edited: Record<string, unknown> | undefined;
    if (decision === "accept" && editing) {
      try {
        edited = { expect: JSON.parse(expectText) };
      } catch {
        toast.error("expect is not valid JSON");
        return;
      }
    }
    setBusy(decision);
    try {
      const res = await fetch(`/api/v1/reviews/${review.id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, edited_case: edited, reason: reason || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      toast.success(decision === "accept" ? `Added ${json.case_id} to the regression suite` : "Draft rejected — the miner will skip similar traces");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const decided = review.status !== "pending";
  return (
    <article className={cn("card p-6", decided && "opacity-75")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="kicker">
            {AGENT_META[d.agent]?.name ?? d.agent} · cluster of {review.source_trace_ids.length} trace{review.source_trace_ids.length === 1 ? "" : "s"} · {ago(review.created_at)}
          </p>
          <h3 className="serif mt-1 text-2xl leading-tight text-ink">{heading}</h3>
          <p className="mt-1 font-mono text-[0.68rem] text-muted">
            {d.case_id}
            {review.cluster_label ? ` · cluster: ${review.cluster_label}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone={review.status === "accepted" ? "pass" : review.status === "rejected" ? "accent" : "warn"}>{review.status}</Chip>
          {(d.tags ?? []).map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <p className="kicker mb-2">Drafted input · personas replace real names</p>
          {turns ? (
            <ol className="flex flex-col gap-2">
              {turns.map((t, i) => (
                <li key={i} className="rounded-2xl rounded-tl-sm bg-surface-2 px-4 py-2.5 text-[0.86rem] text-ink">
                  {typeof t === "string" ? t : String((t as Record<string, unknown>)?.user ?? JSON.stringify(t))}
                </li>
              ))}
            </ol>
          ) : typeof d.input?.question === "string" ? (
            <p className="rounded-2xl bg-surface-2 px-4 py-2.5 text-[0.86rem] text-ink">{d.input.question}</p>
          ) : (
            <JsonView label="input" value={d.input} defaultOpen />
          )}
          {review.source_trace_ids.length > 0 && (
            <p className="mt-3 font-mono text-[0.62rem] text-muted">
              source traces: {review.source_trace_ids.slice(0, 3).map((id) => id.slice(0, 8)).join(", ")}
              {review.source_trace_ids.length > 3 ? ` +${review.source_trace_ids.length - 3}` : ""}
            </p>
          )}
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="kicker">Proposed expectations</p>
            {!decided && (
              <button type="button" onClick={() => setEditing((e) => !e)} className="inline-flex items-center gap-1 font-mono text-[0.62rem] uppercase text-muted hover:text-ink">
                <Pencil className="size-3" /> {editing ? "preview" : "edit"}
              </button>
            )}
          </div>
          {editing ? (
            <textarea
              value={expectText}
              onChange={(e) => setExpectText(e.target.value)}
              spellCheck={false}
              aria-label="Edit expect JSON"
              className="h-56 w-full rounded-xl border border-line-strong bg-[var(--code-bg)] p-3 font-mono text-[0.7rem] text-[#e9e4dc] outline-none focus:border-accent"
            />
          ) : (
            <JsonView label="expect" value={d.expect} defaultOpen />
          )}
        </div>
      </div>

      {decided ? (
        <p className="mt-5 font-mono text-[0.66rem] text-muted">
          {review.status} by {review.reviewer ?? "—"} {review.decided_at ? ago(review.decided_at) : ""}
          {review.resulting_case_id ? ` → ${review.resulting_case_id}` : ""}
          {review.reason ? ` · “${review.reason}”` : ""}
        </p>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="reason (optional; stored with the decision)"
            aria-label="Decision reason"
            className="min-w-[220px] flex-1 rounded-full border border-line-strong bg-transparent px-4 py-2 text-[0.8rem] text-ink outline-none placeholder:text-muted focus:border-accent"
          />
          <button type="button" onClick={() => decide("reject")} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-4 py-2 text-[0.8rem] text-ink-2 transition hover:border-accent hover:text-ink disabled:opacity-50">
            {busy === "reject" ? <Loader2 className="size-3.5 animate-spin" /> : blocked ? <Lock className="size-3.5" /> : <X className="size-3.5" />} Reject
          </button>
          <button type="button" onClick={() => decide("accept")} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full bg-accent-solid px-4 py-2 text-[0.8rem] font-medium text-white transition hover:bg-accent-solid-hi disabled:opacity-50">
            {busy === "accept" ? <Loader2 className="size-3.5 animate-spin" /> : blocked ? <Lock className="size-3.5" /> : <Check className="size-3.5" />} Accept{editing ? " edited" : ""} → regression
          </button>
        </div>
      )}
    </article>
  );
}
