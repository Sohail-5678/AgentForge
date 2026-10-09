import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetSnapshotCache, createSnapshotStore } from "@/lib/server/store/snapshot";
import { ReadOnlyError } from "@/lib/server/store/types";

const trace = (i: number) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  agent_id: i % 2 ? "datapilot" : "returnpilot",
  mode: "live",
  run_id: null,
  case_id: null,
  agent_version: null,
  profile_version: "returnpilot@2",
  status: i % 5 === 0 ? "failure" : "success",
  started_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
  ended_at: null,
  input: { question: `q${i}` },
  final_output: null,
  end_state: null,
  spans: [],
  metrics: {},
  feedback: i % 7 === 0 ? { thumbs: -1 } : null,
  guard_hit: i % 3 === 0,
  mined: false,
  received_at: "2026-10-01T00:00:00.000Z",
});

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "af-snap-"));
  const path = join(dir, "snap.json");
  writeFileSync(
    path,
    JSON.stringify({
      contract_version: "snapshot.v1",
      generated_at: "2026-10-08T18:00:00Z",
      generator: { command: "test", runner_version: "0", seed: 1, note: "" },
      tables: {
        agents: [{ id: "returnpilot" }, { id: "datapilot" }],
        profiles: [
          { id: "p1", agent_id: "returnpilot", version: 1, is_active: false },
          { id: "p2", agent_id: "returnpilot", version: 2, is_active: true },
        ],
        runs: [1, 2, 3, 4].map((seq) => ({ id: `run-${seq}`, seq, agent_id: seq % 2 ? "datapilot" : "returnpilot", trigger: seq === 4 ? "pr" : "nightly", status: "done", created_at: `2026-10-0${seq}T07:30:00Z`, suite_version_ids: [] })),
        results: [{ run_id: "run-1", case_id: "a", attempt: 1, passed: true, status: "success", graders: [] }],
        traces: Array.from({ length: 30 }, (_, i) => trace(i)),
      },
    }),
  );
  process.env.AF_SNAPSHOT_PATH = path;
  resetSnapshotCache();
});
afterAll(() => {
  delete process.env.AF_SNAPSHOT_PATH;
  resetSnapshotCache();
});

describe("snapshot store", () => {
  const store = createSnapshotStore();
  it("serves runs newest first with filters and seq lookup", async () => {
    expect((await store.runs()).map((r) => r.seq)).toEqual([4, 3, 2, 1]);
    expect((await store.runs({ trigger: "nightly", agent: "datapilot" })).map((r) => r.seq)).toEqual([3, 1]);
    expect((await store.run("2"))?.id).toBe("run-2");
    expect(await store.countRuns({ trigger: "pr" })).toBe(1);
  });
  it("finds the active profile", async () => expect((await store.activeProfile("returnpilot"))?.version).toBe(2));
  it("paginates traces with a keyset cursor and no overlap", async () => {
    const p1 = await store.traces({ limit: 10 });
    const p2 = await store.traces({ limit: 10, cursor: p1.next });
    const p3 = await store.traces({ limit: 10, cursor: p2.next });
    const ids = [...p1.items, ...p2.items, ...p3.items].map((t) => t.id);
    expect(new Set(ids).size).toBe(30);
    expect(p3.next).toBe(null);
    expect(p1.items[0].started_at > p1.items[9].started_at).toBe(true);
  });
  it("filters traces by feedback and guard hit", async () => {
    expect((await store.traces({ feedback: "down", limit: 100 })).items.every((t) => (t.feedback?.thumbs ?? 0) < 0)).toBe(true);
    expect((await store.traces({ guardHit: true, limit: 100 })).items.length).toBe(10);
  });
  it("is read-only", async () => {
    expect(store.readonly).toBe(true);
    await expect(async () => store.insertTraces([])).rejects.toBeInstanceOf(ReadOnlyError);
  });
});
