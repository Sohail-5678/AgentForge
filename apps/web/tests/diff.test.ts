import { describe, expect, it } from "vitest";
import { changedPaths, wordDiff } from "@/lib/diff";

describe("wordDiff", () => {
  it("marks inserted and deleted words", () => {
    const parts = wordDiff("check the order first", "always check eligibility before refunding");
    const added = parts.filter((p) => p.type === "add").map((p) => p.text).join("");
    const removed = parts.filter((p) => p.type === "del").map((p) => p.text).join("");
    expect(added).toContain("eligibility");
    expect(removed).toContain("order");
    expect(parts.filter((p) => p.type !== "del").map((p) => p.text).join("")).toBe("always check eligibility before refunding");
  });
});

describe("changedPaths", () => {
  it("lists only changed leaves, ignoring version bookkeeping", () => {
    const a = { version: 1, prompts: { system: "a", router: "r" }, params: { temperature: 0.2 } };
    const b = { version: 2, prompts: { system: "b", router: "r" }, params: { temperature: 0.1 } };
    expect(changedPaths(a, b).map((c) => c.path)).toEqual(["prompts.system", "params.temperature"]);
  });
});
