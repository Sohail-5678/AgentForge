/** Word-level diff (LCS) for prompt edits — small inputs (a few thousand chars), so O(n·m) is fine. */

export type DiffPart = { type: "same" | "add" | "del"; text: string };

function tokenize(s: string) {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

export function wordDiff(a: string, b: string): DiffPart[] {
  const x = tokenize(a);
  const y = tokenize(b);
  const n = x.length;
  const m = y.length;
  if (n * m > 4_000_000) return [{ type: "del", text: a }, { type: "add", text: b }];
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (type: DiffPart["type"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push("same", x[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", x[i++]);
    else push("add", y[j++]);
  }
  while (i < n) push("del", x[i++]);
  while (j < m) push("add", y[j++]);
  return out;
}

/** Flatten a profile into dotted paths → string values, so any two versions can be compared key by key. */
export function flatten(v: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(v) && v.every((x) => typeof x !== "object" || x === null)) {
    out[prefix] = v.join(", ");
  } else if (Array.isArray(v)) {
    out[prefix] = JSON.stringify(v, null, 1);
  } else {
    out[prefix] = String(v ?? "");
  }
  return out;
}

export function changedPaths(a: unknown, b: unknown, ignore = ["version", "parent_version", "created_by", "notes"]) {
  const fa = flatten(a);
  const fb = flatten(b);
  return [...new Set([...Object.keys(fa), ...Object.keys(fb)])]
    .filter((k) => !ignore.includes(k) && fa[k] !== fb[k])
    .map((k) => ({ path: k, before: fa[k] ?? "", after: fb[k] ?? "" }));
}
