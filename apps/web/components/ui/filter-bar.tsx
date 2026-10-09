import Link from "next/link";
import { cn } from "@/lib/format";

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

/** URL-driven segmented filters (server-rendered links — no client state, shareable URLs, keyboard friendly). */
export function FilterBar({
  base,
  values,
  filters,
  count,
}: {
  base: string;
  values: Record<string, string | undefined>;
  filters: FilterDef[];
  count?: string;
}) {
  const href = (key: string, value: string | undefined) => {
    const next = { ...values, [key]: value };
    const u = new URLSearchParams(Object.entries(next).filter(([k, v]) => v && k !== "page" && k !== "cursor") as [string, string][]);
    const s = u.toString();
    return s ? `${base}?${s}` : base;
  };
  return (
    <div className="rise flex flex-wrap items-center gap-x-6 gap-y-3" style={{ animationDelay: "40ms" }}>
      {filters.map((f) => (
        <div key={f.key} className="flex flex-wrap items-center gap-1.5" role="group" aria-label={f.label}>
          <span className="kicker mr-1 !text-[0.58rem]">{f.label}</span>
          {[{ value: "", label: "all" }, ...f.options].map((o) => {
            const active = (values[f.key] ?? "") === o.value;
            return (
              <Link
                key={o.value || "all"}
                href={href(f.key, o.value || undefined)}
                aria-current={active ? "true" : undefined}
                scroll={false}
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-wider transition duration-300",
                  active ? "border-accent bg-accent-soft text-accent-ink" : "border-line-strong text-muted hover:border-ink-2 hover:text-ink",
                )}
              >
                {o.label}
              </Link>
            );
          })}
        </div>
      ))}
      {count && <span className="ml-auto font-mono text-[0.65rem] text-muted">{count}</span>}
    </div>
  );
}
