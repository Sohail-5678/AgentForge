import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function pct(x: number | null | undefined, digits = 0) {
  if (x == null || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

/** "82% (70–91%)" — SPEC §2.4: a sampled number never appears without its interval. */
export function pctCi(rate: number | null | undefined, ci?: [number, number] | null, digits = 0) {
  if (rate == null) return "—";
  if (!ci) return pct(rate, digits);
  return `${pct(rate, digits)} (${(ci[0] * 100).toFixed(digits)}–${(ci[1] * 100).toFixed(digits)}%)`;
}

export function signedPts(diff: number | null | undefined, digits = 0) {
  if (diff == null || Number.isNaN(diff)) return "—";
  const v = diff * 100;
  const s = v.toFixed(digits);
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${s.replace("-", "")} pts`;
}

export function ciPts(ci: [number, number] | null | undefined, digits = 0) {
  if (!ci) return "—";
  const f = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(digits)}`;
  return `${f(ci[0])} to ${f(ci[1])}`;
}

export function usd(x: number | null | undefined, digits = 4) {
  if (x == null || Number.isNaN(x)) return "—";
  if (x === 0) return "$0";
  return `$${x.toFixed(digits)}`;
}

export function ms(x: number | null | undefined) {
  if (x == null || Number.isNaN(x)) return "—";
  if (x < 1000) return `${Math.round(x)} ms`;
  if (x < 60_000) return `${(x / 1000).toFixed(1)} s`;
  return `${Math.floor(x / 60_000)}m ${Math.round((x % 60_000) / 1000)}s`;
}

export function pValue(p: number | null | undefined) {
  if (p == null || Number.isNaN(p)) return "—";
  if (p < 0.001) return "p<0.001";
  return `p=${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`;
}

export function num(x: number | null | undefined) {
  if (x == null) return "—";
  return new Intl.NumberFormat("en-US").format(x);
}

export function compact(x: number | null | undefined) {
  if (x == null) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(x);
}

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "—";
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return RTF.format(Math.round(diff), "second");
  if (abs < 3600) return RTF.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return RTF.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return RTF.format(Math.round(diff / 86400), "day");
  return RTF.format(Math.round(diff / (86400 * 30)), "month");
}

export function dateShort(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC";
}

export function sha(ref: string | null | undefined) {
  if (!ref) return "—";
  return /^[0-9a-f]{7,40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

export function title(s: string) {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/** A run summary that carries a pass rate with its interval (optimizer slices and failed runs do not). */
export function rated<S extends { pass_rate?: number; ci?: [number, number] } | null | undefined>(s: S): s is NonNullable<S> & { pass_rate: number; ci: [number, number] } {
  return !!s && typeof s.pass_rate === "number" && Array.isArray(s.ci) && s.ci.length === 2;
}

/** Same check without type narrowing — for "no rate" branches on data typed as always having one. */
export function hasRate(s: { pass_rate?: number; ci?: [number, number] } | null | undefined): boolean {
  return rated(s);
}

/** Denominator of summary.passed: quality results only (red-team cases have their own ASR). */
export function qualityN(s: { n_quality?: number; n_results: number; attempts?: number; redteam?: { n: number } | null }) {
  if (typeof s.n_quality === "number") return s.n_quality;
  return Math.max(0, Math.round(s.n_results / Math.max(1, s.attempts ?? 1)) - (s.redteam?.n ?? 0));
}
