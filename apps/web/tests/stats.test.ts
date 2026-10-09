import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cohensKappa, comparePaired, mcnemarExact, pairedBootstrap, wilson } from "@/lib/stats";

// Reference values computed with statsmodels.proportion_confint(method="wilson"), scipy.stats.binomtest, sklearn.
describe("wilson", () => {
  it.each([
    [41, 50, 0.692039, 0.902298],
    [0, 10, 0.0, 0.277533],
    [10, 10, 0.722467, 1.0],
    [7, 30, 0.117924, 0.409283],
    [22, 30, 0.55552, 0.858173],
  ])("%i/%i", (p, n, lo, hi) => {
    const [a, b] = wilson(p, n);
    expect(a).toBeCloseTo(lo, 5);
    expect(b).toBeCloseTo(hi, 5);
  });
  it("is [0, 1] for n = 0", () => expect(wilson(0, 0)).toEqual([0, 1]));
});

describe("mcnemarExact", () => {
  it.each([
    [1, 4, 0.375],
    [0, 6, 0.03125],
    [2, 9, 0.06543],
    [5, 5, 1.0],
    [3, 12, 0.035156],
    [0, 0, 1],
  ])("b=%i c=%i", (b, c, p) => expect(mcnemarExact(b, c)).toBeCloseTo(p, 5));
  it("is symmetric", () => expect(mcnemarExact(9, 2)).toBeCloseTo(mcnemarExact(2, 9), 12));
});

describe("pairedBootstrap", () => {
  const base = Array.from({ length: 50 }, (_, i) => (i % 10 < 7 ? 1 : 0));
  const cand = base.map((x, i) => (i % 10 === 7 ? 1 : x));
  it("is deterministic for a seed", () => expect(pairedBootstrap(base, cand, 2000, 3)).toEqual(pairedBootstrap(base, cand, 2000, 3)));
  it("brackets the observed difference", () => {
    const [lo, hi] = pairedBootstrap(base, cand);
    expect(lo).toBeLessThanOrEqual(0.1);
    expect(hi).toBeGreaterThanOrEqual(0.1);
    expect(lo).toBeGreaterThanOrEqual(0);
  });
  it("covers the true difference ~95% of the time (simulation)", () => {
    let covered = 0;
    const sims = 300;
    let s = 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < sims; k++) {
      const b: number[] = [];
      const c: number[] = [];
      for (let i = 0; i < 60; i++) {
        const bp = rnd() < 0.7 ? 1 : 0;
        b.push(bp);
        c.push(bp ? (rnd() < 0.9 ? 1 : 0) : rnd() < 0.5 ? 1 : 0);
      }
      const truth = 0.7 * -0.1 + 0.3 * 0.5; // E[c - b]
      const [lo, hi] = pairedBootstrap(b, c, 600, k + 1);
      if (lo <= truth && truth <= hi) covered++;
    }
    expect(covered / sims).toBeGreaterThan(0.9);
    expect(covered / sims).toBeLessThan(0.99);
  });
});

describe("comparePaired", () => {
  it("uses only shared cases and counts discordant pairs", () => {
    const a = new Map([["x", true], ["y", false], ["z", true], ["only-a", true]]);
    const b = new Map([["x", false], ["y", true], ["z", true], ["only-b", false]]);
    const r = comparePaired(a, b);
    expect(r.shared).toBe(3);
    expect(r.b).toBe(1);
    expect(r.c).toBe(1);
    expect(r.newly_failing).toEqual(["x"]);
    expect(r.newly_passing).toEqual(["y"]);
    expect(r.diff).toBeCloseTo(0, 10);
  });
});

describe("cohensKappa", () => {
  it("matches sklearn", () => {
    const pairs = [
      ...Array.from({ length: 26 }, () => ({ human: true, judge: true })),
      ...Array.from({ length: 4 }, () => ({ human: true, judge: false })),
      ...Array.from({ length: 5 }, () => ({ human: false, judge: true })),
      ...Array.from({ length: 15 }, () => ({ human: false, judge: false })),
    ];
    const k = cohensKappa(pairs);
    expect(k.kappa).toBeCloseTo(0.621849, 5);
    expect(k.confusion).toEqual({ tp: 26, tn: 15, fp: 5, fn: 4 });
  });
});

// Cross-language check: the runner writes the same inputs + expected outputs from its Python implementation.
const fixture = join(process.cwd(), "..", "..", "runner", "tests", "fixtures", "stats_crosscheck.json");
describe.runIf(existsSync(fixture))("cross-check with runner/agentforge_runner/stats", () => {
  const data = existsSync(fixture) ? JSON.parse(readFileSync(fixture, "utf8")) : {};
  it("wilson", () => {
    for (const w of data.wilson ?? []) {
      const [lo, hi] = wilson(w.passed ?? w.k ?? w.successes, w.n);
      const exp = w.ci ?? w.expected ?? [w.lo, w.hi];
      expect(lo).toBeCloseTo(exp[0], 6);
      expect(hi).toBeCloseTo(exp[1], 6);
    }
  });
  it("mcnemar", () => {
    for (const m of data.mcnemar ?? []) expect(mcnemarExact(m.b, m.c)).toBeCloseTo(m.p ?? m.p_value ?? m.expected, 6);
  });
  it("kappa", () => {
    for (const k of data.kappa ?? []) {
      const pairs = (k.pairs ?? k.human.map((h: boolean, i: number) => ({ human: h, judge: k.judge[i] }))).map((p: { human: boolean; judge: boolean } | [boolean, boolean]) =>
        Array.isArray(p) ? { human: p[0], judge: p[1] } : p,
      );
      expect(cohensKappa(pairs).kappa).toBeCloseTo(k.kappa ?? k.expected, 6);
    }
  });
});
