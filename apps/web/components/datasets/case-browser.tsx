"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Drawer, JsonView } from "@/components/ui/interactive";
import { Chip, SeverityChip, SplitChip } from "@/components/ui/primitives";
import type { Case } from "@/lib/types";

export function CaseBrowser({ cases }: { cases: Pick<Case, "id" | "suite_id" | "split" | "family" | "origin" | "body" | "content_hash" | "created_at">[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<(typeof cases)[number] | null>(null);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? cases.filter((c) => c.id.includes(s) || (c.body.title ?? "").toLowerCase().includes(s) || JSON.stringify(c.body.input).toLowerCase().includes(s)) : cases;
  }, [q, cases]);
  const shown = rows.slice(0, 300);

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <label className="flex items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 focus-within:border-accent">
          <Search className="size-3.5 text-muted" aria-hidden />
          <span className="sr-only">Search cases</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search id, title or input" className="w-56 bg-transparent font-mono text-[0.72rem] text-ink outline-none placeholder:text-muted" />
        </label>
        <span className="font-mono text-[0.64rem] text-muted">
          {rows.length} cases{rows.length > shown.length ? ` · showing ${shown.length}` : ""}
        </span>
      </div>
      <div className="max-h-[720px] overflow-auto" tabIndex={0} role="region" aria-label="Cases">
        <table className="table-af min-w-[860px]">
          <thead>
            <tr>
              <th>Case</th>
              <th>Suite</th>
              <th>Split</th>
              <th>Origin</th>
              <th>Tags / category</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} onClick={() => setOpen(c)} className="cursor-pointer">
                <td className="max-w-[360px]">
                  <span className="block truncate font-mono text-[0.72rem] text-ink">{c.id}</span>
                  <span className="block truncate text-[0.72rem] text-muted">{c.body.title ?? (typeof c.body.input?.question === "string" ? c.body.input.question : "")}</span>
                </td>
                <td className="font-mono text-[0.68rem] text-ink-2">{c.suite_id}</td>
                <td>
                  <SplitChip split={c.split} />
                </td>
                <td>
                  <Chip tone={c.origin === "mined" ? "info" : c.origin === "mutation" ? "violet" : undefined}>{c.origin}</Chip>
                </td>
                <td className="max-w-[260px]">
                  <span className="flex flex-wrap gap-1">
                    {c.body.category && <Chip tone="accent">{c.body.category.replace(/_/g, " ")}</Chip>}
                    {c.body.severity && <SeverityChip severity={c.body.severity} />}
                    {(c.body.tags ?? []).slice(0, 3).map((t) => (
                      <Chip key={t}>{t}</Chip>
                    ))}
                  </span>
                </td>
                <td className="font-mono text-[0.62rem] text-muted">{c.content_hash.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Drawer open={!!open} onOpenChange={(o) => !o && setOpen(null)} kicker={open ? `${open.suite_id} · ${open.split} · ${open.origin}` : ""} title={open?.id ?? ""}>
        {open && (
          <div className="flex flex-col gap-5">
            {open.body.title && <p className="serif text-xl italic text-ink-2">{open.body.title}</p>}
            <div className="flex flex-wrap gap-1.5">
              <SplitChip split={open.split} />
              {open.family && <Chip tone="violet">family {open.family}</Chip>}
              {(open.body.tags ?? []).map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
            <JsonView label="input" value={open.body.input} defaultOpen />
            {open.body.setup && <JsonView label="setup" value={open.body.setup} />}
            <JsonView label="expect" value={open.body.expect} defaultOpen />
            {open.body.success_if && <JsonView label="success_if (red-team predicate)" value={open.body.success_if} defaultOpen />}
            <JsonView label="case.v1" value={open.body} />
            <p className="font-mono text-[0.64rem] text-muted">content_hash {open.content_hash} · cases are immutable — edits create a new revision (@2)</p>
          </div>
        )}
      </Drawer>
    </>
  );
}
