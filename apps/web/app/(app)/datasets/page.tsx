import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { CaseBrowser } from "@/components/datasets/case-browser";
import { FilterBar } from "@/components/ui/filter-bar";
import { ButtonLink, Card, PageHeader } from "@/components/ui/primitives";
import { dateShort } from "@/lib/format";
import { agentName } from "@/lib/meta";
import { getStore } from "@/lib/server/store";

export const metadata: Metadata = { title: "Datasets" };

const KIND_NOTE: Record<string, string> = {
  benchmark: "BIRD Mini-Dev subset · execution accuracy",
  scenario: "hand-written multi-turn scenarios",
  regression: "mined from live failures + every fixed bug",
  redteam: "seed attacks + accepted mutations",
};

export default async function DatasetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const store = getStore();
  const [suites, versions, all, pending] = await Promise.all([store.suites(), store.suiteVersions(), store.cases(), store.reviews("pending")]);
  const filtered = all.filter((c) => (!sp.suite || c.suite_id === sp.suite) && (!sp.split || c.split === sp.split));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker="Improve · 07 · case.v1"
        title={
          <>
            Data<span className="text-accent">sets</span>
          </>
        }
        subtitle="Versioned suites with stable splits: train feeds the optimizer, val selects candidates, test is touched only at the promotion gate."
        actions={
          <ButtonLink href="/datasets/review" variant="solid">
            <Inbox className="size-3.5" /> Review queue · {pending.length}
          </ButtonLink>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {suites.map((s, i) => {
          const cases = all.filter((c) => c.suite_id === s.id);
          const split = { train: 0, val: 0, test: 0 } as Record<string, number>;
          for (const c of cases) split[c.split]++;
          const vs = versions.filter((v) => v.suite_id === s.id);
          return (
            <Card key={s.id} hover className="rise p-5" style={{ animationDelay: `${40 + i * 40}ms` }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="kicker">{agentName(s.agent_id)} · {s.kind}</p>
                  <p className="mt-1 font-mono text-[0.95rem] text-ink">{s.id}</p>
                </div>
                <p className="display num text-4xl text-ink">{cases.length}</p>
              </div>
              <p className="mt-1 text-[0.76rem] text-muted">{KIND_NOTE[s.kind]}</p>
              <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-surface-3" aria-label={`train ${split.train}, val ${split.val}, test ${split.test}`}>
                <div className="bg-ink-2/60" style={{ width: `${(split.train / Math.max(1, cases.length)) * 100}%` }} />
                <div className="bg-info" style={{ width: `${(split.val / Math.max(1, cases.length)) * 100}%` }} />
                <div className="bg-accent" style={{ width: `${(split.test / Math.max(1, cases.length)) * 100}%` }} />
              </div>
              <div className="mt-2 flex justify-between font-mono text-[0.6rem] text-muted num">
                <span>train {split.train}</span>
                <span className="text-info">val {split.val}</span>
                <span className="text-accent-ink">test {split.test}</span>
              </div>
              <p className="mt-4 font-mono text-[0.6rem] text-muted">
                {vs.length} version{vs.length === 1 ? "" : "s"}
                {vs[0] ? ` · latest ${vs[0].hash.slice(0, 10)} · ${dateShort(vs[0].created_at)}` : ""}
              </p>
            </Card>
          );
        })}
      </div>

      <FilterBar
        base="/datasets"
        values={{ suite: sp.suite, split: sp.split }}
        filters={[
          { key: "suite", label: "Suite", options: suites.map((s) => ({ value: s.id, label: s.id })) },
          { key: "split", label: "Split", options: ["train", "val", "test"].map((v) => ({ value: v, label: v })) },
        ]}
      />
      <Card className="rise overflow-hidden" style={{ animationDelay: "120ms" }}>
        <CaseBrowser cases={filtered.map(({ id, suite_id, split, family, origin, body, content_hash, created_at }) => ({ id, suite_id, split, family, origin, body, content_hash, created_at }))} />
      </Card>
      <p className="font-mono text-[0.64rem] text-muted">
        split = sha256(case_id) mod 10 → 0–5 train · 6–7 val · 8–9 test · red-team cases split by seed family · comparisons use only the intersection of cases.
      </p>
    </div>
  );
}
