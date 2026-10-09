import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { splitFor } from "@/lib/server/services";
import { caseSchema, profileSchema, traceSchema } from "@/lib/zod";

const ROOT = join(process.cwd(), "..", "..");
const suiteFiles = ["datapilot/benchmark", "datapilot/regression", "returnpilot/scenario", "returnpilot/regression", "toy/scenario"]
  .map((s) => join(ROOT, "suites", `${s}.jsonl`))
  .filter((p) => {
    try {
      readFileSync(p);
      return true;
    } catch {
      return false;
    }
  });

describe("committed suites validate against case.v1 (zod mirror)", () => {
  for (const file of suiteFiles) {
    it(file.split("suites/")[1], () => {
      const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const parsed = caseSchema.safeParse(JSON.parse(line));
        if (!parsed.success) throw new Error(`${JSON.parse(line).case_id}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
      }
    });
  }
});

describe("stable splits (§5.2) — same rule as the runner and scripts/build_suites.py", () => {
  it("scenario + regression cases carry sha256(case_id) mod 10 splits", () => {
    for (const file of suiteFiles.filter((f) => /scenario|regression/.test(f) && !f.includes("toy"))) {
      for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
        const c = JSON.parse(line);
        expect(`${c.case_id}:${c.split}`).toBe(`${c.case_id}:${splitFor(c.case_id)}`);
      }
    }
  });
  it("is stable and roughly 60/20/20", () => {
    const n = { train: 0, val: 0, test: 0 };
    for (let i = 0; i < 3000; i++) n[splitFor(`case-${i}`)]++;
    expect(n.train / 3000).toBeGreaterThan(0.56);
    expect(n.val / 3000).toBeGreaterThan(0.17);
    expect(n.test / 3000).toBeGreaterThan(0.17);
    expect(splitFor("rp-scn-refund-over-limit")).toBe(splitFor("rp-scn-refund-over-limit"));
  });
});

describe("real target profiles validate against profile.v1", () => {
  for (const p of ["datapilot", "returnpilot"]) {
    const path = join(ROOT, "..", p, "backend", "profiles", "default.json");
    it.skipIf(!(() => { try { readFileSync(path); return true; } catch { return false; } })())(p, () => {
      expect(profileSchema.safeParse(JSON.parse(readFileSync(path, "utf8"))).success).toBe(true);
    });
  }
});

describe("trace.v1", () => {
  const ok = {
    contract_version: "trace.v1",
    trace_id: "6f1b6a2e-6d2e-4f7e-9c49-3e8c2b6f1a10",
    agent: "returnpilot",
    mode: "live",
    started_at: "2026-10-08T12:00:00Z",
    status: "success",
    spans: [{ span_id: "s1", kind: "llm", name: "router", status: "ok", duration_ms: 812 }],
    metrics: { llm_calls: 1, latency_ms: 900, list_price_cost_usd: 0.0004 },
  };
  it("accepts a minimal valid trace", () => expect(traceSchema.safeParse(ok).success).toBe(true));
  it("rejects unknown status / span kind / bad uuid", () => {
    expect(traceSchema.safeParse({ ...ok, status: "great" }).success).toBe(false);
    expect(traceSchema.safeParse({ ...ok, spans: [{ span_id: "s", kind: "magic", name: "x" }] }).success).toBe(false);
    expect(traceSchema.safeParse({ ...ok, trace_id: "nope" }).success).toBe(false);
  });
  it("red-team seed files exist for every category", () => {
    const files = readdirSync(join(ROOT, "suites", "redteam"));
    expect(files.filter((f) => f.endsWith(".yaml")).length).toBeGreaterThanOrEqual(10);
  });
});
