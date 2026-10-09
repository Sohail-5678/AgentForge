import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminButton } from "@/components/admin/admin-button";
import { ExperimentExplorer } from "@/components/optimizer/experiment-explorer";
import { GateCard } from "@/components/optimizer/gate-card";
import { PromotionActions } from "@/components/optimizer/promotion-actions";
import { Card, CardHead, Chip, KV, Meter } from "@/components/ui/primitives";
import { ago, dateTime } from "@/lib/format";
import { agentName } from "@/lib/meta";
import { getStore } from "@/lib/server/store";


export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const exp = await getStore().experiment((await params).id);
  return { title: exp?.name ?? "Experiment" };
}

export default async function ExperimentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const exp = await store.experiment(id);
  if (!exp) notFound();
  const [candidates, parent, promotions, profiles] = await Promise.all([store.candidates(id), store.profile(exp.parent_profile_id), store.promotions(exp.agent_id), store.profiles(exp.agent_id)]);
  const best = candidates.find((c) => c.id === exp.best_candidate_id) ?? [...candidates].filter((c) => c.val_mean != null && c.label !== "seed").sort((a, b) => (b.val_mean ?? 0) - (a.val_mean ?? 0))[0];
  const promo = best ? promotions.find((p) => p.candidate_id === best.id) : undefined;
  const toProfile = promo ? profiles.find((p) => p.id === promo.to_profile_id) : null;
  const budget = exp.config.budget_total ?? 0;
  const state = promo ? (promo.decision === "pending" ? "pending" : "decided") : "candidate";
  const history = exp.state?.history ?? [];

  return (
    <div className="flex flex-col gap-7">
      <Link href="/optimizer" className="rise inline-flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-wider text-muted transition hover:text-ink">
        <ArrowLeft className="size-3.5" /> All experiments
      </Link>

      <Card className="rise relative overflow-hidden p-6 sm:p-8" style={{ animationDelay: "40ms" }}>
        <div aria-hidden className="dots dots-fade absolute inset-0 opacity-40" />
        <div className="relative grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="flex flex-wrap gap-2">
              <Chip tone={exp.status === "running" ? "info" : exp.status === "finished" ? "pass" : "warn"}>{exp.status}</Chip>
              <Chip>{agentName(exp.agent_id)}</Chip>
              <Chip>parent v{parent?.version ?? "?"}</Chip>
            </div>
            <h1 className="mt-4 break-all font-mono text-[clamp(1.4rem,3vw,2.2rem)] text-ink">{exp.name}</h1>
            <p className="serif mt-2 text-xl italic text-ink-2">
              {candidates.length} candidates over {exp.state?.night ?? 0} night{(exp.state?.night ?? 0) === 1 ? "" : "s"} · components {(exp.config.components ?? []).join(", ") || "—"}
            </p>
            <div className="mt-6 max-w-xl">
              <Meter label="target-agent call budget" value={exp.calls_used} max={budget || Math.max(1, exp.calls_used)} />
            </div>
            {exp.status !== "finished" && exp.status !== "cancelled" && (
              <div className="mt-5 flex flex-wrap gap-2">
                {exp.status === "running" && <AdminButton action={{ kind: "experiment", id: exp.id, op: "pause" }} label="Pause" />}
                {exp.status === "paused" && <AdminButton action={{ kind: "experiment", id: exp.id, op: "resume" }} label="Resume" />}
                <AdminButton action={{ kind: "experiment", id: exp.id, op: "cancel" }} label="Cancel" />
              </div>
            )}
          </div>
          <dl className="self-end">
            <KV k="minibatch" v={`${exp.config.minibatch ?? 10} train cases (½ parent failures)`} />
            <KV k="nightly slice" v={`${exp.config.nightly_calls ?? "—"} calls`} />
            <KV k="max iterations · patience" v={`${exp.config.max_iters ?? "—"} · ${exp.config.patience ?? 3}`} />
            <KV k="started" v={dateTime(exp.created_at)} />
            <KV k="finished" v={exp.finished_at ? `${ago(exp.finished_at)}` : "—"} />
          </dl>
        </div>
      </Card>

      <ExperimentExplorer candidates={candidates} seedBody={parent?.body ?? null} configPoints={exp.state?.config_search ?? []} bestId={best?.id ?? null} />

      {best && (
        <Card className="rise p-6 sm:p-8" style={{ animationDelay: "120ms" }}>
          <CardHead
            code="G"
            title={`Best candidate ${best.label} → promotion gate`}
            kicker={`changed ${best.component} · selected by highest val mean (ties → lower cost)`}
            right={
              <PromotionActions
                promotionId={promo?.id ?? null}
                candidateId={best.id}
                agent={exp.agent_id}
                fromVersion={parent?.version ?? 0}
                toVersion={toProfile?.version ?? Math.max(0, ...profiles.map((p) => p.version)) + 1}
                report={promo?.gate_report ?? null}
                before={parent?.body ?? null}
                after={best.body}
                state={state}
              />
            }
          />
          <div className="mt-6">
            {promo ? (
              <GateCard report={promo.gate_report} promotion={promo} />
            ) : (
              <p className="text-sm text-muted">Not sent to the gate yet. The gate runs the TEST split × pass^2 and the red-team core for this candidate and the active profile.</p>
            )}
          </div>
        </Card>
      )}

      {history.length > 0 && (
        <Card className="rise overflow-hidden" style={{ animationDelay: "160ms" }}>
          <div className="px-6 pt-6">
            <CardHead code="H" title="Iteration log" kicker="parent → component → child · minibatch scores on the same 10 train cases" />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="table-af min-w-[640px]">
              <thead>
                <tr>
                  <th>Iter</th>
                  <th>Parent</th>
                  <th>Component</th>
                  <th>Child</th>
                  <th>Minibatch</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const lab = (cid: string) => candidates.find((c) => c.id === cid)?.label ?? cid.slice(0, 6);
                  return (
                    <tr key={`${h.iteration}-${h.child}`}>
                      <td className="font-mono text-[0.72rem]">{h.iteration}</td>
                      <td className="font-mono text-[0.72rem] text-ink-2">{lab(h.parent)}</td>
                      <td className="font-mono text-[0.7rem] text-muted">{h.component}</td>
                      <td className="font-mono text-[0.72rem] text-ink">{lab(h.child)}</td>
                      <td className="font-mono text-[0.72rem] num">
                        {Array.isArray(h.minibatch) ? `${h.minibatch[0]} → ${h.minibatch[1]}` : "—"}
                      </td>
                      <td>
                        <Chip tone={h.accepted ? "pass" : undefined}>{h.accepted ? "to val" : "rejected"}</Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
