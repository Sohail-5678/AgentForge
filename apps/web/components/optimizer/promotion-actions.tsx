"use client";

import { Loader2, Lock, Rocket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { blockedReason, useViewer } from "@/components/admin/viewer";
import { Modal } from "@/components/ui/interactive";
import { cn } from "@/lib/format";
import type { GateReport, ProfileBody } from "@/lib/types";
import { GateCard } from "./gate-card";
import { ProfileDiff } from "./profile-diff";

/**
 * Promote / Discard (§2.4): the confirm dialog names the exact object, shows its full diff and the gate card.
 * Promote is enabled only when the gate passed; visitors can open the dialog to see the flow.
 */
export function PromotionActions({
  promotionId,
  candidateId,
  agent,
  fromVersion,
  toVersion,
  report,
  before,
  after,
  state,
}: {
  promotionId: string | null;
  candidateId: string | null;
  agent: string;
  fromVersion: number;
  toVersion: number | null;
  report: GateReport | null;
  before: ProfileBody | null;
  after: ProfileBody;
  state: "candidate" | "pending" | "decided";
}) {
  const viewer = useViewer();
  const router = useRouter();
  const [open, setOpen] = useState<null | "promote" | "reject" | "gate">(null);
  const [busy, setBusy] = useState(false);
  const blocked = blockedReason(viewer);

  async function call(url: string, body: unknown, ok: string) {
    setBusy(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      toast.success(ok);
      setOpen(null);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canPromote = state === "pending" && !!report?.passed;
  return (
    <div className="flex flex-wrap gap-2">
      {state === "candidate" && candidateId && (
        <button type="button" onClick={() => setOpen("gate")} className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-[0_12px_30px_-12px_var(--accent-glow)] transition hover:bg-accent-hi">
          {blocked && <Lock className="size-3.5" />} Send to gate
        </button>
      )}
      {state === "pending" && (
        <>
          <button
            type="button"
            onClick={() => setOpen("promote")}
            className={cn("inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition", canPromote ? "bg-accent text-white shadow-[0_12px_30px_-12px_var(--accent-glow)] hover:bg-accent-hi" : "border border-line-strong text-muted")}
          >
            {blocked ? <Lock className="size-3.5" /> : <Rocket className="size-3.5" />} Promote to active
          </button>
          <button type="button" onClick={() => setOpen("reject")} className="rounded-full border border-line-strong px-5 py-2.5 text-sm text-ink-2 transition hover:border-accent hover:text-ink">
            Discard
          </button>
        </>
      )}
      <Modal
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open === "promote" ? `Promote ${agent} v${fromVersion} → v${toVersion}` : open === "reject" ? `Discard candidate for ${agent}` : `Send candidate to the gate`}
        footer={
          <>
            <button type="button" onClick={() => setOpen(null)} className="rounded-full border border-line-strong px-4 py-2 text-sm text-ink-2 hover:text-ink">
              Cancel
            </button>
            <button
              type="button"
              disabled={!!blocked || busy || (open === "promote" && !canPromote)}
              onClick={() =>
                open === "gate"
                  ? call("/api/v1/promotions", { candidate_id: candidateId }, "Gate runs dispatched")
                  : call(`/api/v1/promotions/${promotionId}/decide`, { decision: open === "promote" ? "promoted" : "rejected" }, open === "promote" ? `v${toVersion} is now active` : "Candidate discarded")
              }
              className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition hover:bg-accent-hi disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {open === "promote" ? "Promote" : open === "reject" ? "Discard" : "Dispatch gate runs"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          {open === "gate" && (
            <p className="text-[0.9rem] leading-relaxed text-ink-2">
              Creates profile v{toVersion ?? "next"} (inactive) and two gate runs — this candidate and the active v{fromVersion} — on the frozen TEST split with pass^2, plus the red-team core. The report appears when both finish; nothing goes live without your second click.
            </p>
          )}
          {open === "promote" && (
            <p className="text-[0.9rem] leading-relaxed text-ink-2">
              Switches the active profile in one transaction, writes promotions + audit_log rows, and agents pick it up within 5 minutes (ETag on <code className="font-mono text-[0.8rem]">GET /profiles/{agent}/active</code>). Rollback stays one click away.
            </p>
          )}
          {report && report.checks.length > 0 && <GateCard report={report} compact />}
          <div>
            <p className="kicker mb-2">Full diff · v{fromVersion} → candidate</p>
            <ProfileDiff before={before} after={after} max={20} />
          </div>
          {blocked && (
            <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2.5 text-[0.8rem] text-warn">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {blocked}
            </p>
          )}
          {open === "promote" && !canPromote && !blocked && <p className="text-[0.8rem] text-accent-ink">The gate has not passed — promotion is disabled.</p>}
        </div>
      </Modal>
    </div>
  );
}
