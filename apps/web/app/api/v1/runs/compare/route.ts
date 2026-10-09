import { getStore } from "@/lib/server/store";
import { handle, HttpError, json } from "@/lib/server/http";
import { comparePaired } from "@/lib/stats";

/** GET /runs/compare?a=&b= — paired comparison on the intersection of cases (§5.4, §7.2). */
export const GET = handle(async (req: Request) => {
  const u = new URL(req.url);
  const a = u.searchParams.get("a");
  const b = u.searchParams.get("b");
  if (!a || !b) throw new HttpError(400, "bad_request", "Pass ?a=<baseline run>&b=<candidate run>.");
  const store = getStore();
  const [ra, rb] = await Promise.all([store.run(a), store.run(b)]);
  if (!ra || !rb) throw new HttpError(404, "not_found", "Run not found.");
  const [resA, resB] = await Promise.all([store.results(ra.id), store.results(rb.id)]);
  const map = (rows: typeof resA) => new Map(rows.filter((r) => r.attempt === 1).map((r) => [r.case_id, r.passed === true]));
  return json({ ...comparePaired(map(resA), map(resB)), a: ra.id, b: rb.id });
});
