import { getStore } from "@/lib/server/store";
import { handle, json } from "@/lib/server/http";

export const GET = handle(async () => {
  const store = getStore();
  const [suites, versions, cases] = await Promise.all([store.suites(), store.suiteVersions(), store.cases()]);
  return json({
    items: suites.map((s) => ({
      ...s,
      cases: cases.filter((c) => c.suite_id === s.id).length,
      versions: versions.filter((v) => v.suite_id === s.id).map((v) => ({ id: v.id, hash: v.hash, cases: v.case_ids.length, created_at: v.created_at })),
    })),
  });
});
