import { describe, expect, it } from "vitest";
import { keepTrace, newApiKey, redactDeep, sha256, truncatePayload } from "@/lib/server/http";

describe("redactDeep (§10.5 defence in depth)", () => {
  it("redacts emails, phones and card numbers anywhere in the payload", () => {
    const out = redactDeep({ a: "mail maya@example.com now", b: ["call +1 415 555 0134"], c: { card: "4242 4242 4242 4242" }, n: 42 });
    expect(JSON.stringify(out)).not.toMatch(/maya@|555 0134|4242 4242/);
    expect(out.n).toBe(42);
  });
  it("keeps order ids and amounts", () => {
    expect(redactDeep("order 1042 for $129.00")).toBe("order 1042 for $129.00");
  });
});

describe("truncatePayload (4 KB span cap)", () => {
  it("passes small payloads through", () => expect(truncatePayload({ a: 1 })).toEqual({ a: 1 }));
  it("truncates large ones with a preview", () => {
    const t = truncatePayload({ big: "x".repeat(10_000) }) as { truncated: boolean; bytes: number; preview: string };
    expect(t.truncated).toBe(true);
    expect(t.preview.length).toBeLessThanOrEqual(4096);
  });
});

describe("keepTrace sampling (§4.1)", () => {
  it("always keeps failures and thumbs-down", () => {
    expect(keepTrace({ trace_id: "a", status: "failure" })).toBe(true);
    expect(keepTrace({ trace_id: "a", status: "success", feedback: { thumbs: -1 } })).toBe(true);
  });
  it("keeps about 20% of successes, deterministically", () => {
    const ids = Array.from({ length: 4000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const kept = ids.filter((id) => keepTrace({ trace_id: id, status: "success" }, 0.2)).length / ids.length;
    expect(kept).toBeGreaterThan(0.17);
    expect(kept).toBeLessThan(0.23);
    expect(keepTrace({ trace_id: ids[7], status: "success" }, 0.2)).toBe(keepTrace({ trace_id: ids[7], status: "success" }, 0.2));
  });
});

describe("newApiKey (§10.1)", () => {
  it("is afk_live_ + 32 random bytes, hash stored, short prefix", () => {
    const k = newApiKey();
    expect(k.key).toMatch(/^afk_live_[A-Za-z0-9_-]{43}$/);
    expect(k.hash).toBe(sha256(k.key));
    expect(k.key.startsWith(k.prefix)).toBe(true);
    expect(newApiKey().key).not.toBe(k.key);
  });
});
