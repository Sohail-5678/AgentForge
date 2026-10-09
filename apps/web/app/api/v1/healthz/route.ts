import { getStore } from "@/lib/server/store";
import { githubConfigured, tokenCheck } from "@/lib/server/github";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /healthz (§12.3): DB reachable, GitHub token valid, last nightly time + the 36 h scheduler warning (§10.2). */
export async function GET() {
  const store = getStore();
  let db: { ok: boolean; mode: string; error?: string } = { ok: true, mode: store.mode };
  let lastNightly: string | null = null;
  try {
    const runs = await store.runs({ trigger: "nightly", limit: 1 });
    lastNightly = runs[0]?.created_at ?? null;
  } catch (e) {
    db = { ok: false, mode: store.mode, error: (e as Error).message.slice(0, 200) };
  }
  const gh = githubConfigured() ? await tokenCheck().catch(() => ({ ok: false, reason: "unreachable" })) : { ok: false, reason: "GH_TOKEN not configured" };
  const stale = lastNightly ? Date.now() - new Date(lastNightly).getTime() > 36 * 3600_000 : true;
  return json({ ok: db.ok, db, github: gh, last_nightly: lastNightly, nightly_stale: store.mode === "postgres" ? stale : false, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev" }, db.ok ? 200 : 503);
}
