/**
 * Statistics used by the control plane (SPEC §7). Mirrors runner/agentforge_runner/stats — the vitest suite checks
 * both against the same fixture (runner/tests/fixtures/stats_crosscheck.json) so the two never drift.
 */

const Z95 = 1.959963984540054;

/** Wilson score interval (§7.1) — stays inside [0, 1] and is honest near 0 % and 100 %. */
export function wilson(passed: number, n: number, z = Z95): [number, number] {
  if (n <= 0) return [0, 1];
  const p = passed / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function logChoose(n: number, k: number) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** Exact two-sided McNemar test (§7.2): binomial test of b vs c with p = 0.5 over the discordant pairs only. */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

/** Deterministic PRNG (mulberry32) so bootstrap intervals are reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quantile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Paired bootstrap 95 % interval for the pass-rate difference (candidate − baseline) on the same cases. */
export function pairedBootstrap(base: number[], cand: number[], resamples = 5000, seed = 7): [number, number] {
  const n = base.length;
  if (n === 0 || n !== cand.length) return [0, 0];
  const rand = mulberry32(seed);
  const diffs = new Array<number>(resamples);
  for (let r = 0; r < resamples; r++) {
    let d = 0;
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rand() * n);
      d += cand[j] - base[j];
    }
    diffs[r] = d / n;
  }
  diffs.sort((x, y) => x - y);
  return [quantile(diffs, 0.025), quantile(diffs, 0.975)];
}

export interface PairedComparison {
  shared: number;
  baseline_rate: number;
  rate: number;
  diff: number;
  diff_ci: [number, number];
  b: number;
  c: number;
  p_value: number;
  newly_failing: string[];
  newly_passing: string[];
}

/** Compare two runs on the intersection of their cases (§5.4 / §7.2). Inputs map case_id → passed. */
export function comparePaired(baseline: Map<string, boolean>, candidate: Map<string, boolean>): PairedComparison {
  const ids = [...baseline.keys()].filter((k) => candidate.has(k)).sort();
  const base: number[] = ids.map((k) => (baseline.get(k) ? 1 : 0));
  const cand: number[] = ids.map((k) => (candidate.get(k) ? 1 : 0));
  const newly_failing = ids.filter((k) => baseline.get(k) && !candidate.get(k));
  const newly_passing = ids.filter((k) => !baseline.get(k) && candidate.get(k));
  const b = newly_failing.length;
  const c = newly_passing.length;
  const n = ids.length || 1;
  const baseline_rate = base.reduce((a, x) => a + x, 0) / n;
  const rate = cand.reduce((a, x) => a + x, 0) / n;
  return {
    shared: ids.length,
    baseline_rate,
    rate,
    diff: rate - baseline_rate,
    diff_ci: pairedBootstrap(base, cand),
    b,
    c,
    p_value: mcnemarExact(b, c),
    newly_failing,
    newly_passing,
  };
}

/** Cohen's kappa for two binary raters (§13.2). */
export function cohensKappa(pairs: { human: boolean; judge: boolean }[]) {
  const n = pairs.length;
  let tp = 0,
    tn = 0,
    fp = 0,
    fn = 0;
  for (const { human, judge } of pairs) {
    if (human && judge) tp++;
    else if (!human && !judge) tn++;
    else if (!human && judge) fp++;
    else fn++;
  }
  if (!n) return { kappa: 0, agreement: 0, confusion: { tp, tn, fp, fn }, n };
  const po = (tp + tn) / n;
  const pYes = ((tp + fn) / n) * ((tp + fp) / n);
  const pNo = ((tn + fp) / n) * ((tn + fn) / n);
  const pe = pYes + pNo;
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return { kappa, agreement: po, confusion: { tp, tn, fp, fn }, n };
}

export function percentile(values: number[], q: number) {
  return quantile([...values].sort((a, b) => a - b), q);
}
