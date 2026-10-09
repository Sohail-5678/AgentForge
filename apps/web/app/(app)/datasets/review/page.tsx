import type { Metadata } from "next";
import { ReviewCard } from "@/components/datasets/review-card";
import { Empty, PageHeader } from "@/components/ui/primitives";
import { getStore } from "@/lib/server/store";

export const metadata: Metadata = { title: "Review queue" };
export const revalidate = 30;

export default async function ReviewPage() {
  const all = await getStore().reviews();
  const pending = all.filter((r) => r.status === "pending");
  const decided = all.filter((r) => r.status !== "pending").slice(0, 12);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker="Improve · 08 · failure mining"
        title={
          <>
            Review <span className="text-accent">queue</span>
          </>
        }
        subtitle="Failing, thumbs-down and guard-hit traces are embedded, clustered and drafted into cases. Nothing enters a suite without a human."
      />
      <div className="rise flex flex-wrap gap-3 font-mono text-[0.64rem] text-muted" style={{ animationDelay: "40ms" }}>
        {["kept live traces", "embed input + failure reason", "cluster", "LLM labels cluster", "draft case.v1", "human review", "regression suite (new version)"].map((s, i, a) => (
          <span key={s} className="flex items-center gap-3">
            <span className="rounded-full border border-line-strong px-3 py-1 uppercase tracking-wider">{s}</span>
            {i < a.length - 1 && <span className="text-accent">→</span>}
          </span>
        ))}
      </div>
      {pending.length === 0 ? (
        <Empty title="Inbox zero">No drafts waiting. The miner runs after each nightly (af-run mine) and dedupes at cosine ≥ 0.92.</Empty>
      ) : (
        <div className="flex flex-col gap-5">
          {pending.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </div>
      )}
      {decided.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="serif text-2xl text-ink">Recently decided</h2>
          {decided.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </section>
      )}
    </div>
  );
}
