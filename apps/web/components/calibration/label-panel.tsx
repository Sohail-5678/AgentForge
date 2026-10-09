"use client";

import { Check, Loader2, Lock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useViewer } from "@/components/admin/viewer";
import { cn } from "@/lib/format";

interface Item {
  run_id: string;
  case_id: string;
  rubric_item: string;
}

/** Blind labelling (§13.2): the labeller never sees the judge's verdict. Non-admin labels wait for admin acceptance. */
export function LabelPanel({ agent }: { agent: string }) {
  const viewer = useViewer();
  const [items, setItems] = useState<Item[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [labels, setLabels] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/calibration/${agent}`)
      .then((r) => r.json())
      .then((d) => alive && setItems(d.items ?? []))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [agent]);

  const blocked = viewer.mode === "snapshot" ? "Read-only demo snapshot — labels can't be saved here." : viewer.role === "visitor" ? "Sign in with GitHub to label." : null;
  const item = items?.[idx];
  const done = Object.keys(labels).length;

  async function submit() {
    if (!items || blocked) return;
    setBusy(true);
    try {
      const body = { labels: Object.entries(labels).map(([i, v]) => ({ run_id: items[+i].run_id, case_id: items[+i].case_id, rubric_item: items[+i].rubric_item, human_verdict: v })) };
      const res = await fetch(`/api/v1/calibration/${agent}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      toast.success(`${json.stored} labels saved${json.accepted ? " and kappa recomputed" : " — waiting for an admin to accept them"}`);
      setLabels({});
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (items === null) return <div className="skeleton h-40" />;
  if (!items.length) return <p className="text-sm text-muted">No unlabelled rubric items in recent runs.</p>;

  return (
    <div>
      <div className="flex items-center justify-between font-mono text-[0.64rem] text-muted">
        <span>
          item {idx + 1} / {items.length} · {done} labelled
        </span>
        <span>judge verdict hidden</span>
      </div>
      {item && (
        <div className="mt-3 rounded-2xl border border-line bg-surface-2 p-5">
          <p className="kicker">{item.case_id}</p>
          <p className="serif mt-2 text-xl leading-snug text-ink">“{item.rubric_item}”</p>
          <p className="mt-2 text-[0.78rem] text-muted">Open the case in its run to read the agent&apos;s final output, then decide whether this rubric item holds.</p>
          <a href={`/runs/${item.run_id}`} className="mt-1 inline-block font-mono text-[0.64rem] text-ink-2 hover:text-accent">
            open run →
          </a>
          <div className="mt-4 flex gap-2">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => {
                  setLabels((l) => ({ ...l, [idx]: v }));
                  setIdx((i) => Math.min(items.length - 1, i + 1));
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[0.8rem] transition",
                  labels[idx] === v ? (v ? "border-pass bg-pass-soft text-pass" : "border-accent bg-accent-soft text-accent-ink") : "border-line-strong text-ink-2 hover:text-ink",
                )}
              >
                {v ? <Check className="size-3.5" /> : <X className="size-3.5" />} {v ? "Holds" : "Does not hold"}
              </button>
            ))}
            <button type="button" onClick={() => setIdx((i) => Math.max(0, i - 1))} className="ml-auto font-mono text-[0.64rem] text-muted hover:text-ink">
              ← back
            </button>
          </div>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        {blocked ? (
          <span className="flex items-center gap-1.5 text-[0.76rem] text-warn">
            <Lock className="size-3.5" /> {blocked}
          </span>
        ) : (
          <span className="text-[0.76rem] text-muted">{viewer.role === "admin" ? "Admin labels count immediately." : "Your labels are stored until an admin accepts them."}</span>
        )}
        <button type="button" disabled={!done || !!blocked || busy} onClick={submit} className="inline-flex items-center gap-2 rounded-full bg-accent-solid px-4 py-2 text-[0.8rem] font-medium text-white transition hover:bg-accent-solid-hi disabled:opacity-40">
          {busy && <Loader2 className="size-3.5 animate-spin" />} Save {done || ""} label{done === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}
