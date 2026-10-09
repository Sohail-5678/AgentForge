import { changedPaths, wordDiff } from "@/lib/diff";
import { cn } from "@/lib/format";

/** Long unchanged stretches collapse to their edges so every edit is visible with a little context. */
function Same({ text, first, last }: { text: string; first: boolean; last: boolean }) {
  const keep = 160;
  if (text.length <= keep * 2 + 40) return <span>{text}</span>;
  const head = first ? "" : text.slice(0, keep);
  const tail = last ? "" : text.slice(-keep);
  const hidden = text.length - head.length - tail.length;
  return (
    <span>
      {head}
      <span className="mx-1 inline-block rounded bg-white/5 px-1.5 text-[0.62rem] text-[#8f8982]">⋯ {hidden.toLocaleString()} unchanged chars ⋯</span>
      {tail}
    </span>
  );
}

/** Per-component diff between two profile.v1 bodies (word-level for text, before/after for params). */
export function ProfileDiff({ before, after, className, max = 6 }: { before: unknown; after: unknown; className?: string; max?: number }) {
  const changes = changedPaths(before, after);
  if (!changes.length) return <p className="text-sm text-muted">No changes.</p>;
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {changes.slice(0, max).map((c) => {
        const long = c.before.length + c.after.length > 80;
        return (
          <div key={c.path} className="overflow-hidden rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-1.5">
              <code className="font-mono text-[0.68rem] text-ink">{c.path}</code>
              <span className="font-mono text-[0.6rem] text-muted">
                {c.before.length} → {c.after.length} chars
              </span>
            </div>
            {long ? (
              <p className="max-h-72 overflow-auto whitespace-pre-wrap bg-[var(--code-bg)] px-4 py-3 font-mono text-[0.7rem] leading-relaxed text-[#bdb7ae]">
                {wordDiff(c.before, c.after).map((p, i, all) =>
                  p.type === "same" ? (
                    <Same key={i} text={p.text} first={i === 0} last={i === all.length - 1} />
                  ) : p.type === "add" ? (
                    <ins key={i} className="rounded bg-[rgb(79_209_161/0.18)] px-0.5 text-[#7ef0c2] no-underline">
                      {p.text}
                    </ins>
                  ) : (
                    <del key={i} className="rounded bg-[rgb(243_46_53/0.18)] px-0.5 text-[#ff8a8f]">
                      {p.text}
                    </del>
                  ),
                )}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-px bg-line font-mono text-[0.72rem]">
                <span className="bg-[var(--code-bg)] px-3 py-2 text-[#ff8a8f] line-through decoration-[#ff8a8f]/50">{c.before || "∅"}</span>
                <span className="bg-[var(--code-bg)] px-3 py-2 text-[#7ef0c2]">{c.after || "∅"}</span>
              </div>
            )}
          </div>
        );
      })}
      {changes.length > max && <p className="font-mono text-[0.64rem] text-muted">+{changes.length - max} more changed fields</p>}
    </div>
  );
}
