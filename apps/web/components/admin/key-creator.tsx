"use client";

import { KeyRound, Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CopyButton, Modal } from "@/components/ui/interactive";
import { cn } from "@/lib/format";
import { blockedReason, useViewer } from "./viewer";

const SCOPES = ["traces:write", "profiles:read", "gate:trigger"] as const;

/** Create an API key (admin). The plaintext is shown exactly once. */
export function KeyCreator() {
  const viewer = useViewer();
  const router = useRouter();
  const blocked = blockedReason(viewer);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("returnpilot-render");
  const [agent, setAgent] = useState("returnpilot");
  const [scopes, setScopes] = useState<string[]>(["traces:write", "profiles:read"]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, agent_id: agent, scopes }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      setCreated(json.key);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => { setCreated(null); setOpen(true); }} className="inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-[0.8rem] text-ink-2 transition hover:border-accent hover:text-ink">
        {blocked ? <Lock className="size-3.5" /> : <KeyRound className="size-3.5" />} New key
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={created ? "Copy it now" : "Create API key"}
        footer={
          created ? (
            <button type="button" onClick={() => setOpen(false)} className="rounded-full bg-accent-solid px-5 py-2 text-sm font-medium text-white">
              I stored it
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-line-strong px-4 py-2 text-sm text-ink-2">
                Cancel
              </button>
              <button type="button" disabled={!!blocked || busy || !scopes.length} onClick={create} className="inline-flex items-center gap-2 rounded-full bg-accent-solid px-5 py-2 text-sm font-medium text-white disabled:opacity-40">
                {busy && <Loader2 className="size-4 animate-spin" />} Create
              </button>
            </>
          )
        }
      >
        {created ? (
          <div className="flex flex-col gap-3">
            <p className="text-[0.9rem] text-ink-2">This is the only time the key is shown. Put it in the agent&apos;s secret store (e.g. Render env AGENTFORGE_KEY or a GitHub Actions secret).</p>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--code-bg)] px-4 py-3">
              <code className="break-all font-mono text-[0.75rem] text-[#e9e4dc]">{created}</code>
              <CopyButton text={created} className="text-[#c9c3bb]" />
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="kicker">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl border border-line-strong bg-transparent px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
            </label>
            <label className="grid gap-1.5">
              <span className="kicker">Agent</span>
              <select value={agent} onChange={(e) => setAgent(e.target.value)} className="rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent">
                {["returnpilot", "datapilot", "toy"].map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <fieldset className="grid gap-2">
              <legend className="kicker mb-1">Scopes</legend>
              {SCOPES.map((s) => (
                <label key={s} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-sm", scopes.includes(s) ? "border-accent bg-accent-soft text-ink" : "border-line-strong text-ink-2")}>
                  <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes((x) => (e.target.checked ? [...x, s] : x.filter((y) => y !== s)))} className="accent-[var(--accent)]" />
                  <code className="font-mono text-[0.75rem]">{s}</code>
                  <span className="text-[0.72rem] text-muted">{s === "traces:write" ? "agent sends traces + feedback" : s === "profiles:read" ? "agent fetches its active profile" : "target CI requests the PR gate"}</span>
                </label>
              ))}
            </fieldset>
            {blocked && (
              <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2.5 text-[0.8rem] text-warn">
                <Lock className="mt-0.5 size-3.5 shrink-0" /> {blocked}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
