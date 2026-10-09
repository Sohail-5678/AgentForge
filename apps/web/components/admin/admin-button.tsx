"use client";

import { Lock, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/interactive";
import { cn } from "@/lib/format";
import { blockedReason, useViewer } from "./viewer";

export type AdminAction =
  | { kind: "rerun-failed"; runId: string }
  | { kind: "cancel-run"; runId: string }
  | { kind: "trigger-run"; agent: string; suites: string[]; attempts?: number }
  | { kind: "rollback"; agent: string; toVersion: number; fromVersion: number }
  | { kind: "revoke-key"; id: string; name: string }
  | { kind: "experiment"; id: string; op: "pause" | "resume" | "cancel" }
  | { kind: "start-experiment"; agent: string }
  | { kind: "resolve-alert"; id: string };

function describe(a: AdminAction): { title: string; body: string; method: string; url: string; payload?: unknown; danger?: boolean } {
  switch (a.kind) {
    case "rerun-failed":
      return { title: "Re-run failed cases", body: `Creates a new manual run with only the failed cases of run ${a.runId.slice(0, 8)}, same profile and suite versions, and dispatches it to GitHub Actions. Spends target-agent budget.`, method: "POST", url: "/api/v1/runs", payload: { rerun_of: a.runId, only_failed: true } };
    case "cancel-run":
      return { title: "Cancel run", body: `Cancels run ${a.runId.slice(0, 8)} and its GitHub Actions job. Finished results are kept.`, method: "POST", url: `/api/v1/runs/${a.runId}/cancel`, danger: true };
    case "trigger-run":
      return { title: `Start a run · ${a.agent}`, body: `Runs ${a.suites.join(" + ")} on the active profile at the target's main branch${a.attempts && a.attempts > 1 ? ` with pass^${a.attempts}` : ""}. Dispatches run-suite.yml.`, method: "POST", url: "/api/v1/runs", payload: { agent: a.agent, suites: a.suites, attempts: a.attempts ?? 1 } };
    case "rollback":
      return { title: `Roll back ${a.agent}`, body: `Re-activates profile v${a.toVersion} (currently v${a.fromVersion}). No gate needed for a rollback; it is audit-logged and agents pick it up within 5 minutes.`, method: "POST", url: `/api/v1/profiles/${a.agent}/rollback`, payload: { to_version: a.toVersion }, danger: true };
    case "revoke-key":
      return { title: "Revoke API key", body: `Revokes “${a.name}”. Any agent or CI job using it starts getting 401 immediately.`, method: "DELETE", url: `/api/v1/keys?id=${a.id}`, danger: true };
    case "experiment":
      return { title: `${a.op[0].toUpperCase()}${a.op.slice(1)} experiment`, body: `${a.op} optimizer experiment ${a.id.slice(0, 8)}. State is saved; a resumed experiment continues from its last iteration.`, method: "POST", url: `/api/v1/experiments/${a.id}/${a.op}`, danger: a.op === "cancel" };
    case "start-experiment":
      return { title: `Start optimizer · ${a.agent}`, body: "Creates a GEPA-lite experiment from the active profile with the default budgets (OPT_NIGHTLY_CALLS, OPT_TOTAL_CALLS). Runs in nightly slices.", method: "POST", url: "/api/v1/experiments", payload: { agent: a.agent } };
    case "resolve-alert":
      return { title: "Resolve alert", body: "Marks this alert as handled.", method: "POST", url: `/api/v1/alerts/${a.id}/resolve` };
  }
}

export function AdminButton({ action, label, className, children }: { action: AdminAction; label: string; className?: string; children?: React.ReactNode }) {
  const viewer = useViewer();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = describe(action);
  const blocked = blockedReason(viewer);

  async function go() {
    setBusy(true);
    try {
      const res = await fetch(d.url, {
        method: d.method,
        headers: { "content-type": "application/json" },
        body: d.payload ? JSON.stringify(d.payload) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      toast.success(`${d.title} — done`);
      setOpen(false);
      if (json?.run_id) router.push(`/runs/${json.run_id}`);
      else router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-[0.8rem] text-ink-2 transition hover:border-accent hover:text-ink",
          className,
        )}
      >
        {blocked && <Lock className="size-3" aria-hidden />}
        {children ?? label}
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={d.title}
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-line-strong px-4 py-2 text-sm text-ink-2 hover:text-ink">
              Close
            </button>
            <button
              type="button"
              disabled={!!blocked || busy}
              onClick={go}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40",
                "bg-accent-solid hover:bg-accent-solid-hi",
              )}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Confirm
            </button>
          </>
        }
      >
        <p className="text-[0.92rem] leading-relaxed text-ink-2">{d.body}</p>
        {d.payload != null && (
          <pre className="mt-4 overflow-auto rounded-xl bg-[var(--code-bg)] p-3 font-mono text-[0.7rem] text-[#e9e4dc]">
            {d.method} {d.url}
            {"\n"}
            {JSON.stringify(d.payload, null, 2)}
          </pre>
        )}
        {blocked && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2.5 text-[0.8rem] text-warn">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {blocked}
          </p>
        )}
      </Modal>
    </>
  );
}
