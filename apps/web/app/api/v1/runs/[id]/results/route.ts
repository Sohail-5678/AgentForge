import { getStore } from "@/lib/server/store";
import { handle, HttpError, json } from "@/lib/server/http";

/** GET /runs/{id}/results?filter=failed|errors&format=jsonl */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const store = getStore();
  const run = await store.run(id);
  if (!run) throw new HttpError(404, "not_found", "Run not found.");
  const u = new URL(req.url);
  const filter = u.searchParams.get("filter");
  let rows = await store.results(run.id);
  if (filter === "failed") rows = rows.filter((r) => r.passed === false);
  if (filter === "errors") rows = rows.filter((r) => r.status === "error" || r.status === "budget_exceeded");
  if (u.searchParams.get("format") === "jsonl") {
    return new Response(rows.map((r) => JSON.stringify(r)).join("\n") + "\n", {
      headers: { "content-type": "application/x-ndjson", "content-disposition": `attachment; filename="run-${run.seq}-results.jsonl"` },
    });
  }
  return json({ run_id: run.id, items: rows });
});
